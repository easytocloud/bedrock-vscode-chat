/**
 * Utility functions for message conversion, tool handling, and JSON parsing
 * Adapted from huggingface-vscode-chat extension patterns
 */

import * as vscode from "vscode";
import type {
	OpenAIChatMessage,
	OpenAIChatRole,
	OpenAIMessageContentPart,
	OpenAITool,
	OpenAIToolCall,
	ModelCapabilities,
	ParsedModelInfo,
} from "./types";

/**
 * Convert VSCode LanguageModelChatMessage to OpenAI format
 */
export function convertMessages(
	messages: readonly vscode.LanguageModelChatRequestMessage[]
): OpenAIChatMessage[] {
	const openaiMessages: OpenAIChatMessage[] = [];

	for (const msg of messages) {
		const role = mapRole(msg.role);
		const contentText: string[] = [];
		const contentParts: OpenAIMessageContentPart[] = [];
		let usedMultipart = false;
		const toolCalls: OpenAIToolCall[] = [];
		let toolCallId: string | undefined;

		for (const part of msg.content) {
			if (part instanceof vscode.LanguageModelTextPart) {
				if (usedMultipart) {
					contentParts.push({ type: "text", text: part.value });
				} else {
					contentText.push(part.value);
				}
			} else if (part instanceof vscode.LanguageModelDataPart) {
				const mime = part.mimeType ?? "";
				if (mime.toLowerCase().startsWith("image/")) {
					// Switch to multipart content.
					if (!usedMultipart) {
						usedMultipart = true;
						if (contentText.length) {
							contentParts.push({ type: "text", text: contentText.join("\n") });
							contentText.length = 0;
						}
					}
					const b64 = Buffer.from(part.data).toString("base64");
					const url = `data:${mime};base64,${b64}`;
					contentParts.push({ type: "image_url", image_url: { url } });
				} else {
					// Best-effort: treat other data as UTF-8 text.
					const asText = Buffer.from(part.data).toString("utf8");
					if (usedMultipart) {
						contentParts.push({ type: "text", text: asText });
					} else {
						contentText.push(asText);
					}
				}
			} else if (part instanceof vscode.LanguageModelToolCallPart) {
				toolCalls.push({
					id: part.callId,
					type: "function",
					function: {
						name: part.name,
						arguments: JSON.stringify(part.input),
					},
				});
			} else if (part instanceof vscode.LanguageModelToolResultPart) {
				toolCallId = part.callId;
				// Tool results get their own message
				const resultContent = part.content
					.map((c) => (c instanceof vscode.LanguageModelTextPart ? c.value : ""))
					.join("");
				openaiMessages.push({
					role: "tool",
					tool_call_id: part.callId,
					content: resultContent,
				});
			}
		}

		// Only add message if it has content or tool calls
		const hasContent = usedMultipart ? contentParts.length > 0 : contentText.length > 0;
		if (hasContent || toolCalls.length > 0) {
			const message: OpenAIChatMessage = {
				role,
				content: usedMultipart
					? contentParts
					: contentText.length > 0
						? contentText.join("\n")
						: null,
			};
			if (toolCalls.length > 0) {
				message.tool_calls = toolCalls;
			}
			openaiMessages.push(message);
		}
	}

	return openaiMessages;
}

/**
 * Map VSCode message role to OpenAI role
 */
function mapRole(role: vscode.LanguageModelChatMessageRole): OpenAIChatRole {
	switch (role) {
		case vscode.LanguageModelChatMessageRole.User:
			return "user";
		case vscode.LanguageModelChatMessageRole.Assistant:
			return "assistant";
		default:
			return "user";
	}
}

/**
 * Convert VSCode tool definitions to OpenAI format
 */
export function convertTools(
	tools: readonly vscode.LanguageModelChatTool[] | undefined
): OpenAITool[] | undefined {
	if (!tools || tools.length === 0) {
		return undefined;
	}

	return tools.map((tool) => ({
		type: "function",
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.inputSchema as Record<string, unknown>,
		},
	}));
}

/**
 * Validate that tool calls have corresponding results in the message sequence
 */
export function validateRequest(
	messages: readonly vscode.LanguageModelChatRequestMessage[]
): { valid: boolean; error?: string } {
	const pendingToolCalls = new Set<string>();
	let hasToolUse = false;
	let hasToolResult = false;

	for (const msg of messages) {
		for (const part of msg.content) {
			if (part instanceof vscode.LanguageModelToolCallPart) {
				pendingToolCalls.add(part.callId);
				hasToolUse = true;
			} else if (part instanceof vscode.LanguageModelToolResultPart) {
				hasToolResult = true;
				if (!pendingToolCalls.has(part.callId)) {
					return {
						valid: false,
						error: `Tool result for unknown call ID: ${part.callId}`,
					};
				}
				pendingToolCalls.delete(part.callId);
			}
		}
	}

	if (pendingToolCalls.size > 0) {
		const missingIds = Array.from(pendingToolCalls).join(", ");
		return {
			valid: false,
			error: `Missing tool results for calls: ${missingIds}`,
		};
	}

	// NOTE: This only validates that calls have matching results in the message sequence.
	// The Bedrock API has additional constraints: if message history contains tool blocks,
	// they must be properly structured within the message context. The bedrockNative.ts
	// converter now ensures this by preserving tool blocks if they exist in history.
	return { valid: true };
}

/**
 * Safely attempt to parse a JSON object from a string
 */
export function tryParseJSONObject(str: string): { ok: true; value: Record<string, unknown> } | { ok: false } {
	try {
		const parsed = JSON.parse(str);
		if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
			return { ok: true, value: parsed };
		}
		return { ok: false };
	} catch {
		return { ok: false };
	}
}

/**
 * Infer model capabilities from model ID patterns
 */
export function inferModelCapabilities(modelId: string): ModelCapabilities {
	const lowerModelId = modelId.toLowerCase();

	// Vision support: models with 'vl' in name
	const supportsVision = lowerModelId.includes("-vl-") || lowerModelId.includes("vision");

	// Code specialization: models with 'coder' in name
	const isCodeSpecialized = lowerModelId.includes("coder");

	// Thinking/reasoning: models with 'thinking' in name
	const isThinking = lowerModelId.includes("thinking");

	// Tool calling: The chat model picker currently tends to surface only tool-capable models.
	// Mantle's /v1/models doesn't include tool metadata, so we use broad heuristics.
	const looksLikeChatModel =
		lowerModelId.includes("instruct") ||
		lowerModelId.includes("-it") ||
		lowerModelId.includes("chat");

	const supportsToolCalling =
		// Known tool-capable families / large models
		lowerModelId.includes("gpt-oss") ||
		lowerModelId.includes("claude") ||
		lowerModelId.includes("mistral") ||
		lowerModelId.includes("deepseek") ||
		lowerModelId.includes("qwen") ||
		lowerModelId.includes("gemma") ||
		lowerModelId.includes("nemotron") ||
		lowerModelId.includes("glm") ||
		lowerModelId.includes("kimi") ||
		lowerModelId.includes("minimax") ||
		lowerModelId.includes("llama") ||
		lowerModelId.includes("titan") ||
		// VS Code's chat model picker only shows tool-capable models in Agent mode (models
		// without tool calling are hidden there entirely, not just downgraded) — these
		// families support tool use on native Bedrock Converse but don't carry a parameter
		// count in their model ID and were missing from this list, making them invisible in
		// Agent mode from the very first launch with no way to self-correct via runtime probing.
		lowerModelId.includes("nova") ||
		lowerModelId.includes("cohere") ||
		lowerModelId.includes("command-r") ||
		lowerModelId.includes("jamba") ||
		// Strong signal: marketed as an instruct/chat model
		looksLikeChatModel ||
		// Assume models over 30B parameters likely support tools
		((lowerModelId.match(/(\d+)b/) && parseInt(lowerModelId.match(/(\d+)b/)![1]) >= 30) ?? false);

	return {
		supportsToolCalling: Boolean(supportsToolCalling),
		supportsVision,
		isCodeSpecialized,
		isThinking,
	};
}

/**
 * Model-family substrings Mantle serves via its Chat Completions API (open-weight/
 * 3rd-party models — DeepSeek, Mistral, Qwen, GLM, Nemotron, MiniMax, Kimi, Gemma,
 * gpt-oss, Palmyra). Used only when aws-bedrock.hideMantleModelsFromNative is enabled,
 * to declutter the native provider's list of models also reachable through Mantle.
 * Maintained list — Mantle's catalog isn't derivable from the model ID pattern or
 * exposed by ListFoundationModels. Snapshot from AWS docs on 2026-07-11.
 */
const MANTLE_CHAT_COMPLETIONS_FAMILIES = [
	"deepseek",
	"mistral",
	"qwen",
	"glm",
	"nemotron",
	"minimax",
	"kimi",
	"gemma",
	"gpt-oss",
	"palmyra",
];

export function isMantleServedModelId(modelId: string): boolean {
	const id = modelId.toLowerCase();
	return MANTLE_CHAT_COMPLETIONS_FAMILIES.some((f) => id.includes(f));
}

const HIDDEN_MODEL_SUBSTRINGS = ["embed", "embedding", "guard", "safeguard"];

export function isHiddenWhenNotShowAll(modelId: string): boolean {
	const id = modelId.toLowerCase();
	return HIDDEN_MODEL_SUBSTRINGS.some((s) => id.includes(s));
}

/**
 * Claude models known to support a 1M-token context window. This is NOT a function of
 * generation number — e.g. sonnet-4 and sonnet-4-6 support 1M but sonnet-4-5 (released
 * between them) is capped at 200K — so it can't be derived from a numeric-version regex
 * and has to be a maintained list. Cross-checked against litellm's registry (BerriAI/litellm
 * model_prices_and_context_window.json) on 2026-07-11; update this list when a new Claude
 * release changes its context window, since aws-bedrock.modelMetadataSource defaults to
 * "none" and won't fetch that registry automatically.
 */
const LONG_CONTEXT_CLAUDE_MODELS: Array<{ pattern: string; maxOutputTokens: number }> = [
	{ pattern: "claude-sonnet-4-20250514", maxOutputTokens: 64000 },
	{ pattern: "claude-sonnet-4-6", maxOutputTokens: 64000 },
	{ pattern: "claude-sonnet-5", maxOutputTokens: 128000 },
	{ pattern: "claude-opus-4-6", maxOutputTokens: 128000 },
	{ pattern: "claude-opus-4-7", maxOutputTokens: 128000 },
	{ pattern: "claude-opus-4-8", maxOutputTokens: 128000 },
];

/**
 * Infer token limits from model ID patterns
 */
export function inferTokenLimits(
	modelId: string,
	options: { assumeLongContextClaudeModels?: boolean } = {}
): { contextLength: number; maxOutputTokens: number } {
	const lowerModelId = modelId.toLowerCase();
	const assumeLongContext = options.assumeLongContextClaudeModels ?? true;

	// Claude models. Bedrock model IDs may carry a cross-region inference-profile
	// prefix (us./eu./apac./jp./au./global.) before "anthropic.claude-...", so we
	// match on "claude" anywhere rather than requiring it at the start.
	if (lowerModelId.includes("claude")) {
		if (lowerModelId.includes("claude-3-7") || lowerModelId.includes("claude-3.7")) {
			// Claude 3.7 Sonnet supports extended (up to 64K) output via the Converse API.
			return { contextLength: 200000, maxOutputTokens: 64000 };
		}
		if (lowerModelId.includes("claude-3-5") || lowerModelId.includes("claude-3.5")) {
			return { contextLength: 200000, maxOutputTokens: 8192 };
		}
		if (lowerModelId.includes("claude-3")) {
			return { contextLength: 200000, maxOutputTokens: 4096 };
		}
		const longContext = assumeLongContext
			? LONG_CONTEXT_CLAUDE_MODELS.find((m) => lowerModelId.includes(m.pattern))
			: undefined;
		if (longContext) {
			return { contextLength: 1000000, maxOutputTokens: longContext.maxOutputTokens };
		}
		// Anything else with "claude" in the ID is Claude 4.x/5.x or newer (e.g.
		// claude-opus-4-5, claude-haiku-4-5). Rather than falling back to a conservative
		// non-Claude default (which silently truncated every current-generation model to
		// 100K/4096), assume the modern generous limits these models actually ship with.
		// This will still be overridden by external metadata (litellm) when enabled.
		return { contextLength: 200000, maxOutputTokens: 64000 };
	}

	// Mistral/Mixtral models
	if (lowerModelId.includes("mistral-large") || lowerModelId.includes("mixtral")) {
		return { contextLength: 200000, maxOutputTokens: 8192 };
	}
	if (lowerModelId.includes("mistral")) {
		return { contextLength: 128000, maxOutputTokens: 4096 };
	}

	// DeepSeek models
	if (lowerModelId.includes("deepseek")) {
		return { contextLength: 200000, maxOutputTokens: 8192 };
	}

	// Qwen models
	if (lowerModelId.includes("qwen3-vl") || lowerModelId.includes("qwen3-235b")) {
		return { contextLength: 180000, maxOutputTokens: 8192 };
	}
	if (lowerModelId.includes("qwen")) {
		return { contextLength: 128000, maxOutputTokens: 4096 };
	}

	// Llama models
	if (lowerModelId.includes("llama-3") || lowerModelId.includes("llama3")) {
		return { contextLength: 128000, maxOutputTokens: 4096 };
	}

	// Titan models
	if (lowerModelId.includes("titan")) {
		return { contextLength: 32000, maxOutputTokens: 4096 };
	}

	// Conservative defaults
	return { contextLength: 128000, maxOutputTokens: 4096 };
}

/**
 * Parse model ID into components and create display name
 */
export function parseModelInfo(
	modelId: string,
	options: { assumeLongContextClaudeModels?: boolean } = {}
): ParsedModelInfo {
	const rawModelId = modelId;
	const parts = modelId.split(".");
	const provider = parts[0] || "unknown";
	const modelName = parts.slice(1).join(".") || modelId;

	// Generate display name: capitalize words, format nicely
	const displayName = formatDisplayName(provider, modelName);

	// Infer capabilities
	const capabilities = inferModelCapabilities(modelId);

	// Infer token limits
	const { contextLength, maxOutputTokens } = inferTokenLimits(modelId, options);

	return {
		id: `mantle:${rawModelId}`,
		modelId: rawModelId,
		backend: "mantle",
		provider,
		modelName,
		displayName,
		contextLength,
		maxOutputTokens,
		capabilities,
	};
}

/**
 * Format display name from provider and model name
 */
function formatDisplayName(provider: string, modelName: string): string {
	// Capitalize provider
	const providerName = capitalizeWords(provider);

	// Format model name: capitalize words, handle special cases
	let formattedModel = modelName
		.replace(/-/g, " ")
		.replace(/\./g, " ")
		.split(" ")
		.map((word) => {
			// Keep version numbers lowercase (v3.1, etc.)
			if (/^v\d+/.test(word)) {
				return word;
			}
			// Keep size indicators as-is (120b, 3b, etc.)
			if (/^\d+b$/i.test(word)) {
				return word.toUpperCase();
			}
			// Capitalize first letter
			return capitalizeFirst(word);
		})
		.join(" ");

	return `${providerName} ${formattedModel}`;
}

/**
 * Capitalize first letter of each word
 */
function capitalizeWords(str: string): string {
	return str
		.split(/[-_\s]/)
		.map(capitalizeFirst)
		.join(" ");
}

/**
 * Capitalize first letter of a string
 */
function capitalizeFirst(str: string): string {
	if (!str) return str;
	return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Build Mantle endpoint URL for a region
 */
export function buildEndpointUrl(region: string): string {
	return `https://bedrock-mantle.${region}.api.aws/v1`;
}

/**
 * Generate a random call ID for tool calls
 */
export function generateCallId(): string {
	return `call_${Math.random().toString(36).slice(2, 10)}`;
}

export type LogLevel = "verbose" | "info" | "warning" | "error" | "none";

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
	verbose: 0,
	info: 1,
	warning: 2,
	error: 3,
	none: 4,
};

/** True when a message at `messageLevel` should be emitted given the user's configured `logLevel`. */
export function shouldLog(configuredLevel: LogLevel, messageLevel: Exclude<LogLevel, "none">): boolean {
	return LOG_LEVEL_ORDER[messageLevel] >= LOG_LEVEL_ORDER[configuredLevel];
}

export interface RequestTimeoutGuard {
	controller: AbortController;
	/** Stop the timeout from firing — call once a response has been received. */
	clear: () => void;
	/** Clear the timer and unsubscribe from the cancellation token. Always call when the request is done. */
	dispose: () => void;
}

/**
 * An AbortController that aborts itself if `timeoutMs` elapses with no call to `clear()`,
 * and also aborts when the given VS Code cancellation token fires. For streaming requests,
 * call `clear()` once the initial response is received so a long-but-actively-streaming
 * generation isn't killed — the timeout only guards against a request that never responds
 * at all. For non-streaming requests, leave it unset so the timeout covers the whole call.
 */
export function createRequestTimeoutGuard(timeoutMs: number, token?: vscode.CancellationToken): RequestTimeoutGuard {
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined =
		timeoutMs > 0
			? setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms with no response`)), timeoutMs)
			: undefined;
	const sub = token?.onCancellationRequested(() => controller.abort());

	return {
		controller,
		clear: () => {
			if (timer) {
				clearTimeout(timer);
				timer = undefined;
			}
		},
		dispose: () => {
			if (timer) {
				clearTimeout(timer);
			}
			sub?.dispose();
		},
	};
}

/**
 * VS Code's model picker uses `name` as the visible label, and entries that share an
 * identical label can become effectively unselectable (only distinguishable by hovering
 * for the tooltip, if at all) even though their underlying `id`/`modelId` differ — e.g.
 * two model catalog entries that format to the same display name. Mutates `displayName`
 * in place for any model whose name collides with another model's, appending the raw
 * technical model ID so every entry stays uniquely selectable.
 */
export function disambiguateDisplayNames(models: ParsedModelInfo[]): void {
	const countByName = new Map<string, number>();
	for (const m of models) {
		countByName.set(m.displayName, (countByName.get(m.displayName) ?? 0) + 1);
	}
	for (const m of models) {
		if ((countByName.get(m.displayName) ?? 0) > 1) {
			m.displayName = `${m.displayName} [${m.modelId}]`;
		}
	}
}
