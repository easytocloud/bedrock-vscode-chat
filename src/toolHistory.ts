import type { ContentBlock, Message } from "@aws-sdk/client-bedrock-runtime";

const MISSING_RESULT_TEXT = "Tool call was cancelled or its result is unavailable.";

function missingResult(toolUseId: string): ContentBlock {
	return { toolResult: { toolUseId, content: [{ text: MISSING_RESULT_TEXT }], status: "error" } };
}

function toolUseIds(msg: Message): string[] {
	const ids: string[] = [];
	for (const b of msg.content ?? []) {
		if (b.toolUse?.toolUseId) {
			ids.push(b.toolUse.toolUseId);
		}
	}
	return ids;
}

function mergeAdjacentSameRole(messages: Message[]): Message[] {
	const out: Message[] = [];
	for (const msg of messages) {
		if (!msg.content || msg.content.length === 0) {
			continue;
		}
		const prev = out[out.length - 1];
		if (prev && prev.role === msg.role) {
			prev.content = [...(prev.content ?? []), ...msg.content];
		} else {
			out.push({ role: msg.role, content: [...msg.content] });
		}
	}
	return out;
}

/**
 * Make a tool-using conversation satisfy Amazon Bedrock Converse's strict pairing rules:
 * every assistant `toolUse` must be answered by a `toolResult` in the *immediately following*
 * user message (results first), and a `toolResult` may only answer a call from the message
 * right before it. VS Code can hand us histories that break this (cancelled tool calls,
 * summarized context, results delivered in a later message), which Bedrock rejects with
 * "Expected toolResult blocks at messages.N.content".
 */
export function repairToolHistory(input: readonly Message[]): Message[] {
	// Remember every real result so a misplaced one can be moved rather than replaced.
	const resultsById = new Map<string, ContentBlock>();
	for (const msg of input) {
		for (const b of msg.content ?? []) {
			const id = b.toolResult?.toolUseId;
			if (id && !resultsById.has(id)) {
				resultsById.set(id, b);
			}
		}
	}

	const messages = mergeAdjacentSameRole(input.map((m) => ({ role: m.role, content: [...(m.content ?? [])] })));
	const out: Message[] = [];

	for (const msg of messages) {
		const prev = out[out.length - 1];
		if (msg.role === "user") {
			const expected = prev?.role === "assistant" ? toolUseIds(prev) : [];
			const seen = new Set<string>();
			const rest: ContentBlock[] = [];
			for (const b of msg.content ?? []) {
				if (!b.toolResult) {
					rest.push(b);
				}
			}
			const results: ContentBlock[] = [];
			for (const id of expected) {
				if (seen.has(id)) {
					continue;
				}
				seen.add(id);
				results.push(
					resultsById.get(id) ?? missingResult(id)
				);
			}
			const content = [...results, ...rest];
			if (content.length > 0) {
				out.push({ role: "user", content });
			}
		} else {
			out.push(msg);
		}
	}

	// A trailing assistant turn with unanswered tool calls still needs its results.
	const last = out[out.length - 1];
	if (last?.role === "assistant" && toolUseIds(last).length > 0) {
		out.push({ role: "user", content: toolUseIds(last).map(missingResult) });
	}

	// Dropping orphan results can leave two same-role messages adjacent.
	return mergeAdjacentSameRole(out);
}
