/**
 * Utility functions for message conversion, tool handling, and JSON parsing
 * Adapted from huggingface-vscode-chat extension patterns
 */

import * as vscode from "vscode";
import type {
	OpenAIChatMessage,
	OpenAIChatRole,
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
		const content: string[] = [];
		const toolCalls: OpenAIToolCall[] = [];
		let toolCallId: string | undefined;

		for (const part of msg.content) {
			if (part instanceof vscode.LanguageModelTextPart) {
				content.push(part.value);
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
		if (content.length > 0 || toolCalls.length > 0) {
			const message: OpenAIChatMessage = {
				role,
				content: content.length > 0 ? content.join("\n") : null,
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

	for (const msg of messages) {
		for (const part of msg.content) {
			if (part instanceof vscode.LanguageModelToolCallPart) {
				pendingToolCalls.add(part.callId);
			} else if (part instanceof vscode.LanguageModelToolResultPart) {
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
		return {
			valid: false,
			error: `Missing tool results for calls: ${Array.from(pendingToolCalls).join(", ")}`,
		};
	}

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
		lowerModelId.includes("mistral") ||
		lowerModelId.includes("deepseek") ||
		lowerModelId.includes("qwen") ||
		lowerModelId.includes("gemma") ||
		lowerModelId.includes("nemotron") ||
		lowerModelId.includes("glm") ||
		lowerModelId.includes("kimi") ||
		lowerModelId.includes("minimax") ||
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
 * Parse model ID into components and create display name
 */
export function parseModelInfo(modelId: string): ParsedModelInfo {
	const parts = modelId.split(".");
	const provider = parts[0] || "unknown";
	const modelName = parts.slice(1).join(".") || modelId;

	// Generate display name: capitalize words, format nicely
	const displayName = formatDisplayName(provider, modelName);

	// Infer capabilities
	const capabilities = inferModelCapabilities(modelId);

	// Determine context length based on model patterns
	let contextLength = 128000; // Default 128K
	let maxOutputTokens = 4096; // Default 4K

	// Larger models often have larger context windows
	if (modelId.includes("mistral-large") || modelId.includes("deepseek")) {
		contextLength = 200000;
		maxOutputTokens = 8192;
	} else if (modelId.includes("qwen3-vl") || modelId.includes("qwen3-235b")) {
		contextLength = 180000;
	}

	return {
		id: modelId,
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
