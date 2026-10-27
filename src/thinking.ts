import type { ContentBlock, Message, ReasoningContentBlock } from "@aws-sdk/client-bedrock-runtime";

/** Anthropic's minimum `budget_tokens` for extended thinking. */
export const MIN_THINKING_BUDGET = 1024;
/** Room always left for the visible answer on top of the thinking budget. */
const MIN_ANSWER_TOKENS = 1024;
const DEFAULT_ANSWER_TOKENS = 8192;
const MAX_CACHED_REASONING = 200;

// Which models accept `thinking: { type: "enabled", budget_tokens }` is rule-based (3.7+); a model that
// rejects the field anyway is retried without it.
export { supportsExtendedThinking } from "./claudeModels";

/**
 * Pick a thinking budget and max output size that satisfy the API's rules
 * (budget >= 1024, maxTokens strictly greater than the budget). Returns undefined when the
 * caller's maxTokens is too small to fit any thinking, so the request just runs without it.
 */
export function planThinking(
	budgetTokens: number,
	maxTokens: number | undefined
): { budgetTokens: number; maxTokens: number } | undefined {
	const budget = Math.max(MIN_THINKING_BUDGET, Math.floor(budgetTokens));
	if (maxTokens === undefined) {
		return { budgetTokens: budget, maxTokens: budget + DEFAULT_ANSWER_TOKENS };
	}
	if (maxTokens < MIN_THINKING_BUDGET + MIN_ANSWER_TOKENS) {
		return undefined;
	}
	return { budgetTokens: Math.min(budget, maxTokens - MIN_ANSWER_TOKENS), maxTokens };
}

export type ThinkingMode = "enabled" | "adaptive";

/** Maps the user's token budget onto the effort level adaptive-thinking models take instead. */
export function effortForBudget(budgetTokens: number): "low" | "medium" | "high" {
	if (budgetTokens <= 2048) {
		return "low";
	}
	return budgetTokens <= 8192 ? "medium" : "high";
}

/** The `additionalModelRequestFields` for a thinking request in the given mode. */
export function buildThinkingFields(mode: ThinkingMode, budgetTokens: number): Record<string, unknown> {
	return mode === "adaptive"
		? { thinking: { type: "adaptive" }, output_config: { effort: effortForBudget(budgetTokens) } }
		: { thinking: { type: "enabled", budget_tokens: budgetTokens } };
}

/**
 * Newer Claude models reject a fixed budget ("thinking.type.enabled is not supported ... use
 * thinking.type.adaptive"). Detect that so the request can be retried in adaptive mode.
 */
export function demandsAdaptiveThinking(err: unknown): boolean {
	const message = err instanceof Error ? err.message : String(err);
	return /adaptive/i.test(message) && /thinking/i.test(message);
}

/** True when Bedrock rejected the request because of the thinking configuration. */
export function looksLikeThinkingRejection(err: unknown): boolean {
	const message = err instanceof Error ? err.message : String(err);
	return /thinking|budget_tokens/i.test(message);
}

/**
 * Signed thinking blocks keyed by the tool-use ID that followed them. VS Code has no response
 * part for reasoning, but it faithfully round-trips tool-call IDs, so when a tool call comes back
 * in the history we can re-attach the exact thinking block that preceded it. Anthropic requires
 * this while a tool-use loop is in progress with thinking enabled.
 */
export class ReasoningCache {
	private readonly entries = new Map<string, ReasoningContentBlock>();

	set(toolUseId: string, block: ReasoningContentBlock): void {
		this.entries.delete(toolUseId);
		this.entries.set(toolUseId, block);
		if (this.entries.size > MAX_CACHED_REASONING) {
			const oldest = this.entries.keys().next().value;
			if (oldest !== undefined) {
				this.entries.delete(oldest);
			}
		}
	}

	get(toolUseId: string): ReasoningContentBlock | undefined {
		return this.entries.get(toolUseId);
	}

	get size(): number {
		return this.entries.size;
	}
}

function toolUseIds(msg: Message): string[] {
	return (msg.content ?? []).flatMap((b) => (b.toolUse?.toolUseId ? [b.toolUse.toolUseId] : []));
}

/**
 * Re-insert cached thinking blocks at the start of assistant messages that contain tool calls.
 * `complete` is false when an assistant message in the *current* tool loop (everything after the
 * last real user turn) has tool calls but no cached thinking, e.g. after an extension reload;
 * the caller should then send the request without thinking rather than get a validation error.
 * Earlier, finished turns don't need their thinking back. With `strict: false` (adaptive mode)
 * a missing block never makes the result incomplete.
 */
export function attachReasoning(
	messages: readonly Message[],
	cache: ReasoningCache,
	options: { strict?: boolean } = {}
): { messages: Message[]; complete: boolean } {
	// Adaptive mode may legitimately produce no thinking block for a turn, so a missing one isn't an error.
	const strict = options.strict ?? true;
	let loopStart = 0;
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m.role === "user" && !(m.content ?? []).some((b) => b.toolResult)) {
			loopStart = i + 1;
			break;
		}
	}

	let complete = true;
	const out = messages.map((msg, i): Message => {
		if (msg.role !== "assistant") {
			return msg;
		}
		const ids = toolUseIds(msg);
		if (ids.length === 0) {
			return msg;
		}
		const cachedId = ids.find((id) => cache.get(id));
		if (!cachedId) {
			if (strict && i >= loopStart) {
				complete = false;
			}
			return msg;
		}
		const reasoning: ContentBlock = { reasoningContent: cache.get(cachedId)! };
		return { role: "assistant", content: [reasoning, ...(msg.content ?? [])] };
	});
	return { messages: out, complete };
}
