/**
 * Anthropic Messages API client for the Mantle backend
 * (bedrock-mantle.<region>.api.aws/anthropic/v1/messages).
 *
 * This is a distinct API surface from Mantle's OpenAI-compatible Chat Completions
 * API (chatCompletions.ts-equivalent logic in mantleProvider.ts) — different path,
 * different auth header shape, different request/response format (Anthropic-native,
 * not OpenAI-native). No Claude model supports Chat Completions on any Amazon Bedrock
 * endpoint; a subset of Claude models support this Messages API on Mantle instead.
 * Verified against AWS's API-compatibility-by-model docs on 2026-07-11:
 * https://docs.aws.amazon.com/bedrock/latest/userguide/models-api-compatibility.html
 */

import * as vscode from "vscode";
import type { AnthropicContentBlock, AnthropicMessage, AnthropicMessagesRequest, AnthropicStreamEvent, AnthropicTool } from "./types";
import { signMantleRequest } from "./awsAuth";
import { createRequestTimeoutGuard, generateCallId, tryParseJSONObject } from "./utils";

/**
 * Claude models confirmed to support Mantle's Messages API. This is NOT the same
 * list as "supports Converse/Invoke" (native) — some models here (Mythos 5, Mythos
 * Preview) are Mantle-Messages-*exclusive* (no native access at all), while several
 * native-available Claude models (3 Haiku, 3.5 Haiku, Opus 4.1/4.5/4.6, Sonnet
 * 4/4.5/4.6) are NOT on this list because Mantle doesn't serve them through any API.
 * Maintained list, not derivable from the model ID pattern or from Mantle's /v1/models
 * response (which doesn't expose per-API capability data) — update when AWS adds
 * Messages API support for additional models.
 */
const MANTLE_MESSAGES_CLAUDE_PATTERNS = [
	"claude-sonnet-5",
	"claude-haiku-4-5",
	"claude-opus-4-7",
	"claude-opus-4-8",
	"claude-fable-5",
	"claude-mythos-5",
	"claude-mythos-preview",
];

export function supportsMantleMessagesApi(modelId: string): boolean {
	const id = modelId.toLowerCase();
	if (!id.includes("claude")) {
		return false;
	}
	return MANTLE_MESSAGES_CLAUDE_PATTERNS.some((p) => id.includes(p));
}

/** True for any Claude model, regardless of whether it's usable on Mantle at all. */
export function isClaudeModelId(modelId: string): boolean {
	return modelId.toLowerCase().includes("claude");
}

export function buildMantleMessagesUrl(region: string): string {
	return `https://bedrock-mantle.${region}.api.aws/anthropic/v1/messages`;
}

function mimeToAnthropicMediaType(mime: string): string {
	const m = mime.toLowerCase();
	if (m.includes("png")) return "image/png";
	if (m.includes("gif")) return "image/gif";
	if (m.includes("webp")) return "image/webp";
	return "image/jpeg";
}

function hasToolHistory(messages: readonly vscode.LanguageModelChatRequestMessage[]): boolean {
	for (const msg of messages) {
		for (const part of msg.content) {
			if (part instanceof vscode.LanguageModelToolCallPart || part instanceof vscode.LanguageModelToolResultPart) {
				return true;
			}
		}
	}
	return false;
}

/** Convert VS Code chat messages to Anthropic Messages API format. */
export function convertVscodeMessagesToAnthropic(
	messages: readonly vscode.LanguageModelChatRequestMessage[]
): AnthropicMessage[] {
	const allowToolBlocks = hasToolHistory(messages);
	const outMessages: AnthropicMessage[] = [];

	const pushTextIfNonEmpty = (blocks: AnthropicContentBlock[], text: string) => {
		if (text.trim().length === 0) {
			return;
		}
		blocks.push({ type: "text", text });
	};

	for (const msg of messages) {
		const role: "user" | "assistant" = msg.role === vscode.LanguageModelChatMessageRole.Assistant ? "assistant" : "user";
		const blocks: AnthropicContentBlock[] = [];

		for (const part of msg.content) {
			if (part instanceof vscode.LanguageModelTextPart) {
				pushTextIfNonEmpty(blocks, part.value);
			} else if (part instanceof vscode.LanguageModelDataPart) {
				const mime = part.mimeType ?? "";
				if (mime.toLowerCase().startsWith("image/")) {
					blocks.push({
						type: "image",
						source: {
							type: "base64",
							media_type: mimeToAnthropicMediaType(mime),
							data: Buffer.from(part.data).toString("base64"),
						},
					});
				} else {
					pushTextIfNonEmpty(blocks, Buffer.from(part.data).toString("utf8"));
				}
			} else if (part instanceof vscode.LanguageModelToolCallPart) {
				if (allowToolBlocks) {
					blocks.push({ type: "tool_use", id: part.callId, name: part.name, input: part.input as Record<string, unknown> });
				} else {
					pushTextIfNonEmpty(blocks, `[tool call skipped: ${part.name}]`);
				}
			} else if (part instanceof vscode.LanguageModelToolResultPart) {
				const resultText = part.content
					.map((c) => {
						if (c instanceof vscode.LanguageModelTextPart) return c.value;
						if (c instanceof vscode.LanguageModelDataPart) return Buffer.from(c.data).toString("utf8");
						return "";
					})
					.join("");
				const safeResultText = resultText.trim().length > 0 ? resultText : "(tool returned no output)";
				if (allowToolBlocks) {
					blocks.push({ type: "tool_result", tool_use_id: part.callId, content: safeResultText });
				} else {
					pushTextIfNonEmpty(blocks, `[tool result skipped: ${safeResultText}]`);
				}
			}
		}

		if (blocks.length === 0) {
			continue;
		}
		outMessages.push({ role, content: blocks });
	}

	return outMessages;
}

export function convertVscodeToolsToAnthropicTools(
	tools: readonly vscode.LanguageModelChatTool[] | undefined
): AnthropicTool[] | undefined {
	if (!tools || tools.length === 0) {
		return undefined;
	}
	const converted = tools
		.filter((t) => t.name)
		.map((t) => {
			let schema = t.inputSchema as Record<string, unknown> | undefined;
			if (!schema || typeof schema !== "object" || Object.keys(schema).length === 0) {
				schema = { type: "object", properties: {}, required: [] };
			}
			return {
				name: t.name,
				description: t.description || `Tool: ${t.name}`,
				input_schema: schema,
			};
		});
	return converted.length > 0 ? converted : undefined;
}

export async function sendMantleMessage(options: {
	region: string;
	modelId: string;
	authMethod: "apiKey" | "awsCredentials";
	apiKey: string | undefined;
	awsProfile: string | undefined;
	userAgent: string;
	messages: readonly vscode.LanguageModelChatRequestMessage[];
	tools: readonly vscode.LanguageModelChatTool[] | undefined;
	temperature?: number;
	maxTokens?: number;
	progress: vscode.Progress<vscode.LanguageModelResponsePart>;
	token: vscode.CancellationToken;
	log?: (message: string) => void;
	requestTimeoutMs?: number;
}): Promise<void> {
	const url = buildMantleMessagesUrl(options.region);
	const anthropicMessages = convertVscodeMessagesToAnthropic(options.messages);
	if (anthropicMessages.length === 0) {
		throw new Error("No valid messages to send");
	}
	const tools = convertVscodeToolsToAnthropicTools(options.tools);

	const requestBody: AnthropicMessagesRequest = {
		model: options.modelId,
		max_tokens: options.maxTokens && options.maxTokens > 0 ? options.maxTokens : 4096,
		messages: anthropicMessages,
		tools,
		temperature: options.temperature,
		stream: true,
	};
	const bodyString = JSON.stringify(requestBody);

	let headers: Record<string, string>;
	if (options.authMethod === "awsCredentials") {
		const signed = await signMantleRequest(url, "POST", bodyString, options.region, options.awsProfile);
		headers = {
			...signed.headers,
			"anthropic-version": "2023-06-01",
			Accept: "text/event-stream",
			"User-Agent": options.userAgent,
		};
	} else {
		if (!options.apiKey) {
			throw new Error("Amazon Bedrock API key is required");
		}
		headers = {
			"x-api-key": options.apiKey,
			"anthropic-version": "2023-06-01",
			"Content-Type": "application/json",
			Accept: "text/event-stream",
			"User-Agent": options.userAgent,
		};
	}

	// Timeout only guards time-to-first-response; cleared below once we have one, so a
	// long-but-actively-streaming generation is never killed by this timer.
	const requestGuard = createRequestTimeoutGuard(options.requestTimeoutMs ?? 0, options.token);

	try {
		const response = await fetch(url, {
			method: "POST",
			headers,
			body: bodyString,
			signal: requestGuard.controller.signal,
		});
		requestGuard.clear();

		options.log?.(`Mantle Messages API response: status=${response.status}`);

		if (!response.ok) {
			const errorText = await response.text();
			options.log?.(`Mantle Messages API error body (truncated 2000 chars): ${errorText.slice(0, 2000)}`);
			if (response.status === 401) {
				throw new Error("Invalid Amazon Bedrock API key/credentials for Mantle Messages API.");
			} else if (response.status === 429) {
				throw new Error("Rate limit exceeded. Please try again later.");
			}
			throw new Error(`Messages API error ${response.status}: ${errorText}`);
		}

		if (!response.body) {
			throw new Error("No response body");
		}

		await processAnthropicStream(response.body, options.progress, options.token, options.log);
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") {
			options.log?.("Mantle Messages request aborted");
			return;
		}
		throw error;
	} finally {
		requestGuard.dispose();
	}
}

async function processAnthropicStream(
	body: ReadableStream<Uint8Array>,
	progress: vscode.Progress<vscode.LanguageModelResponsePart>,
	token: vscode.CancellationToken,
	log?: (message: string) => void
): Promise<void> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	// Per-content-block accumulation state, keyed by the block's `index`.
	const toolBuffers = new Map<number, { id: string; name: string; args: string }>();
	let emittedAny = false;
	let doneSeen = false;

	const handleEvent = (event: AnthropicStreamEvent) => {
		switch (event.type) {
			case "content_block_start": {
				if (event.content_block.type === "tool_use") {
					toolBuffers.set(event.index, { id: event.content_block.id, name: event.content_block.name, args: "" });
				}
				break;
			}
			case "content_block_delta": {
				if (event.delta.type === "text_delta") {
					progress.report(new vscode.LanguageModelTextPart(event.delta.text));
					emittedAny = true;
				} else if (event.delta.type === "input_json_delta") {
					const buf = toolBuffers.get(event.index);
					if (buf) {
						buf.args += event.delta.partial_json;
					}
				}
				break;
			}
			case "content_block_stop": {
				const buf = toolBuffers.get(event.index);
				if (buf) {
					const parsed = tryParseJSONObject(buf.args || "{}");
					const input = parsed.ok ? parsed.value : {};
					progress.report(new vscode.LanguageModelToolCallPart(buf.id || generateCallId(), buf.name, input));
					emittedAny = true;
					toolBuffers.delete(event.index);
				}
				break;
			}
			case "error": {
				throw new Error(`Messages API stream error: ${event.error.type}: ${event.error.message}`);
			}
			case "message_stop": {
				doneSeen = true;
				break;
			}
			default:
				break;
		}
	};

	try {
		while (!token.isCancellationRequested && !doneSeen) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split(/\r?\n/);
			buffer = lines.pop() || "";

			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed || trimmed.startsWith(":") || !trimmed.startsWith("data:")) {
					continue;
				}
				const data = trimmed.slice("data:".length).trim();
				if (!data) {
					continue;
				}
				try {
					const event = JSON.parse(data) as AnthropicStreamEvent;
					handleEvent(event);
				} catch (e) {
					log?.(`Failed to parse Messages API SSE chunk: ${data.slice(0, 500)}`);
				}
				if (doneSeen) {
					break;
				}
			}
		}
	} finally {
		try {
			await reader.cancel();
		} catch {
			// ignore
		}
		reader.releaseLock();
	}

	if (!emittedAny && !token.isCancellationRequested) {
		throw new Error("Sorry, no response was returned");
	}
}
