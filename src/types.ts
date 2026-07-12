/**
 * TypeScript type definitions for the Amazon Bedrock Mantle OpenAI-compatible API
 */

/**
 * OpenAI chat message roles
 */
export type OpenAIChatRole = "system" | "user" | "assistant" | "tool";

export type OpenAIMessageContentPart =
	| { type: "text"; text: string }
	| { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } };

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
	content?: string | OpenAIMessageContentPart[] | null;
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

export type ModelBackend = "mantle" | "bedrock";

/**
 * Parsed model information
 */
export interface ParsedModelInfo {
	/**
	 * Unique ID exposed to VS Code. Must be unique across all backends.
	 * Format: "mantle:<rawModelId>" | "bedrock:<rawModelId>".
	 */
	id: string;
	/**
	 * Underlying model identifier used when invoking the backend.
	 * For Mantle: the OpenAI-compatible model name.
	 * For native Amazon Bedrock: the Amazon Bedrock modelId (or an inference profile identifier when required).
	 */
	modelId: string;
	backend: ModelBackend;
	provider: string;
	modelName: string;
	displayName: string;
	contextLength: number;
	/**
	 * Optional: maximum prompt/input tokens (more reliable than deriving from contextLength).
	 */
	maxInputTokens?: number;
	maxOutputTokens: number;
	capabilities: ModelCapabilities;
	/**
	 * Native Amazon Bedrock only: true when discovery found a cross-region inference profile
	 * that contains this model, meaning direct on-demand invocation by model ID is
	 * expected to fail and the profile identifier should be used instead.
	 */
	requiresInferenceProfile?: boolean;
	/**
	 * Mantle only: true when this Claude model is invoked through Mantle's Anthropic
	 * Messages API (/anthropic/v1/messages) rather than its OpenAI-compatible Chat
	 * Completions API (/v1/chat/completions), which no Claude model supports.
	 */
	usesMantleMessagesApi?: boolean;
}

// ---------------------------------------------------------------------------
// Anthropic Messages API (used by Mantle's /anthropic/v1/messages for the
// subset of Claude models that support it — see mantleMessages.ts)
// ---------------------------------------------------------------------------

export type AnthropicRole = "user" | "assistant";

export type AnthropicContentBlock =
	| { type: "text"; text: string }
	| { type: "image"; source: { type: "base64"; media_type: string; data: string } }
	| { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
	| { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export interface AnthropicMessage {
	role: AnthropicRole;
	content: AnthropicContentBlock[];
}

export interface AnthropicTool {
	name: string;
	description?: string;
	input_schema: Record<string, unknown>;
}

export interface AnthropicMessagesRequest {
	model: string;
	max_tokens: number;
	messages: AnthropicMessage[];
	system?: string;
	tools?: AnthropicTool[];
	temperature?: number;
	stream?: boolean;
}

export interface AnthropicMessagesResponse {
	id: string;
	type: "message";
	role: "assistant";
	content: AnthropicContentBlock[];
	stop_reason: string | null;
	usage?: { input_tokens: number; output_tokens: number };
}

/**
 * Streaming SSE event shapes for the Messages API. Field names match Anthropic's
 * public API exactly (unchanged by the bedrock-mantle wrapper).
 */
export type AnthropicStreamEvent =
	| { type: "message_start"; message: Partial<AnthropicMessagesResponse> }
	| { type: "content_block_start"; index: number; content_block: AnthropicContentBlock }
	| {
			type: "content_block_delta";
			index: number;
			delta: { type: "text_delta"; text: string } | { type: "input_json_delta"; partial_json: string };
	  }
	| { type: "content_block_stop"; index: number }
	| { type: "message_delta"; delta: { stop_reason?: string | null }; usage?: { output_tokens: number } }
	| { type: "message_stop" }
	| { type: "ping" }
	| { type: "error"; error: { type: string; message: string } };
