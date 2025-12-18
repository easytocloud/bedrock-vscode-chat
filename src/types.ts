/**
 * TypeScript type definitions for AWS Bedrock Mantle OpenAI-compatible API
 */

/**
 * OpenAI chat message roles
 */
export type OpenAIChatRole = "system" | "user" | "assistant" | "tool";

/**
 * OpenAI tool call structure
 */
export interface OpenAIToolCall {
	id: string;
	type: "function";
	function: {
		name: string;
		arguments: string; // JSON string
	};
}

/**
 * OpenAI chat message format
 */
export interface OpenAIChatMessage {
	role: OpenAIChatRole;
	content?: string | null;
	name?: string;
	tool_calls?: OpenAIToolCall[];
	tool_call_id?: string;
}

/**
 * OpenAI tool/function definition
 */
export interface OpenAITool {
	type: "function";
	function: {
		name: string;
		description?: string;
		parameters?: Record<string, unknown>;
	};
}

/**
 * Chat completion request body
 */
export interface ChatCompletionRequest {
	model: string;
	messages: OpenAIChatMessage[];
	temperature?: number;
	max_tokens?: number;
	stream?: boolean;
	tools?: OpenAITool[];
	tool_choice?: "auto" | "none" | { type: "function"; function: { name: string } };
}

/**
 * Chat completion choice (non-streaming)
 */
export interface ChatCompletionChoice {
	index: number;
	message: OpenAIChatMessage;
	finish_reason: string | null;
}

/**
 * Chat completion response (non-streaming)
 */
export interface ChatCompletionResponse {
	id: string;
	object: string;
	created: number;
	model: string;
	choices: ChatCompletionChoice[];
	usage?: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
}

/**
 * Streaming delta for chat completion
 */
export interface ChatCompletionDelta {
	role?: OpenAIChatRole;
	content?: string | null;
	reasoning?: string | null;
	tool_calls?: Array<{
		index: number;
		id?: string;
		type?: "function";
		function?: {
			name?: string;
			arguments?: string;
		};
	}>;
}

/**
 * Streaming choice delta
 */
export interface ChatCompletionChunkChoice {
	index: number;
	delta: ChatCompletionDelta;
	finish_reason: string | null;
}

/**
 * Chat completion streaming chunk
 */
export interface ChatCompletionChunk {
	id: string;
	object: string;
	created: number;
	model: string;
	choices: ChatCompletionChunkChoice[];
}

/**
 * Model information from Models API
 */
export interface ModelInfo {
	id: string;
	object: string;
	created: number;
	owned_by: string;
}

/**
 * Models API list response
 */
export interface ModelsListResponse {
	object: string;
	data: ModelInfo[];
}

/**
 * Buffered tool call during streaming
 */
export interface BufferedToolCall {
	id?: string;
	name?: string;
	args: string;
}

/**
 * Model capabilities inferred from model ID
 */
export interface ModelCapabilities {
	supportsToolCalling: boolean;
	supportsVision: boolean;
	isCodeSpecialized: boolean;
	isThinking: boolean;
}

/**
 * Parsed model information
 */
export interface ParsedModelInfo {
	id: string;
	provider: string;
	modelName: string;
	displayName: string;
	contextLength: number;
	maxOutputTokens: number;
	capabilities: ModelCapabilities;
}
