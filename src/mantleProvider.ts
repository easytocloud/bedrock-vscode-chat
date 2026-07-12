/**
 * Amazon Bedrock Mantle Language Model Provider
 * Implements VSCode's LanguageModelChatProvider using Amazon Bedrock's OpenAI-compatible
 * Mantle Chat Completions API (bedrock-mantle.<region>.api.aws/v1/chat/completions)
 * for most models, and Mantle's Anthropic Messages API
 * (bedrock-mantle.<region>.api.aws/anthropic/v1/messages, see mantleMessages.ts)
 * for the subset of Claude models Mantle supports.
 *
 * Mantle is a genuinely separate Amazon Bedrock endpoint from the native
 * Converse/Invoke backend (see NativeBedrockProvider in provider.ts) — different
 * region footprint, different auth model details, and different model coverage.
 * No Anthropic Claude model supports Mantle's Chat Completions API — confirmed
 * against AWS's own API-compatibility-by-model docs — but several current Claude
 * models are reachable via Mantle's separate Messages API instead.
 */

import * as vscode from "vscode";
import type {
	BufferedToolCall,
	ChatCompletionChunk,
	ChatCompletionRequest,
	ChatCompletionResponse,
	ModelsListResponse,
	ParsedModelInfo,
} from "./types";
import { loadExternalMetadataForModels, type ExternalModelMetadata } from "./externalModelMetadata";
import { signMantleRequest } from "./awsAuth";
import { isClaudeModelId, sendMantleMessage, supportsMantleMessagesApi } from "./mantleMessages";
import {
	buildEndpointUrl,
	convertMessages,
	convertTools,
	createRequestTimeoutGuard,
	disambiguateDisplayNames,
	generateCallId,
	isHiddenWhenNotShowAll,
	parseModelInfo,
	shouldLog,
	tryParseJSONObject,
	validateRequest,
	type LogLevel,
} from "./utils";

export class MantleProvider implements vscode.LanguageModelChatProvider {
	private readonly _onDidChangeLanguageModelChatInformation = new vscode.EventEmitter<void>();
	readonly onDidChangeLanguageModelChatInformation = this._onDidChangeLanguageModelChatInformation.event;

	private _models: ParsedModelInfo[] | null = null;
	private _mantleToolSupport = new Map<string, boolean>();
	private _toolCallBuffers = new Map<number, BufferedToolCall>();
	private _completedToolCallIndices = new Set<number>();
	private _reportedAnyPartInCurrentResponse = false;
	private _externalMetaByModelId: Map<string, ExternalModelMetadata> | null = null;
	private _externalMetaLoadedAt = 0;

	constructor(
		private readonly secrets: vscode.SecretStorage,
		private readonly config: vscode.WorkspaceConfiguration,
		private readonly userAgent: string,
		private readonly output: vscode.OutputChannel,
		private readonly globalState: vscode.Memento
	) {}

	private externalMetadataSource(): string {
		return this.config.get<string>("modelMetadataSource", "none");
	}

	private externalMetadataUrl(): string {
		return this.config.get<string>(
			"modelMetadataUrl",
			"https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json"
		);
	}

	private externalMetadataCacheHours(): number {
		return this.config.get<number>("modelMetadataCacheHours", 24);
	}

	private shouldUseExternalMetadata(): boolean {
		const src = (this.externalMetadataSource() ?? "").toLowerCase().trim();
		return src !== "none";
	}

	private async ensureExternalMetadataLoaded(modelIds: string[], region: string): Promise<void> {
		if (!this.shouldUseExternalMetadata()) {
			this._externalMetaByModelId = new Map();
			return;
		}

		// Avoid repeated fetches within a short window in a single session.
		const cacheMs = Math.max(0, this.externalMetadataCacheHours()) * 60 * 60 * 1000;
		const recentlyLoaded = cacheMs > 0 && Date.now() - this._externalMetaLoadedAt < Math.min(cacheMs, 60_000);
		if (this._externalMetaByModelId && recentlyLoaded) {
			return;
		}

		this._externalMetaByModelId = await loadExternalMetadataForModels({
			memento: this.globalState,
			cacheKey: "aws-bedrock.externalModelMetadata.v1",
			url: this.externalMetadataUrl(),
			cacheHours: this.externalMetadataCacheHours(),
			region,
			userAgent: this.userAgent,
			modelIds,
			logDebug: (m) => this.logDebug(m),
			logAlways: (m) => this.logAlways(m),
		});
		this._externalMetaLoadedAt = Date.now();
	}

	private applyExternalMetadata(model: ParsedModelInfo, meta: ExternalModelMetadata | undefined): void {
		if (!meta) {
			return;
		}

		if (typeof meta.max_output_tokens === "number" && meta.max_output_tokens > 0) {
			model.maxOutputTokens = meta.max_output_tokens;
		}
		if (typeof meta.max_input_tokens === "number" && meta.max_input_tokens > 0) {
			model.maxInputTokens = meta.max_input_tokens;
			model.contextLength = Math.max(model.contextLength, meta.max_input_tokens + (model.maxOutputTokens || 0));
		}

		const tools = meta.supports_function_calling === true || meta.supports_tool_choice === true;
		if (tools) {
			model.capabilities.supportsToolCalling = true;
		}

		if (meta.supports_vision === true) {
			model.capabilities.supportsVision = true;
		}
	}

	private logLevel(): LogLevel {
		return this.config.get<LogLevel>("logLevel", "info");
	}

	private shouldSendTools(): boolean {
		return this.config.get<boolean>("sendTools", true);
	}

	private shouldEmitPlaceholders(): boolean {
		return this.config.get<boolean>("emitPlaceholders", false);
	}

	private isMantleEnabled(): boolean {
		return this.config.get<boolean>("enableMantle", true);
	}

	private mantleAuthMethod(): "apiKey" | "awsCredentials" {
		return this.config.get<string>("mantleAuthMethod", "apiKey") as "apiKey" | "awsCredentials";
	}

	private mantleAwsProfile(): string | undefined {
		const profile = this.config.get<string>("mantleAwsProfile", "");
		return profile?.trim() ? profile.trim() : undefined;
	}

	private mantleRegion(): string {
		return this.config.get<string>("mantleRegion", "us-east-1");
	}

	private requestTimeoutMs(): number {
		return this.config.get<number>("requestTimeout", 120000);
	}

	private log(level: Exclude<LogLevel, "none">, message: string): void {
		if (!shouldLog(this.logLevel(), level)) {
			return;
		}
		const ts = new Date().toISOString();
		this.output.appendLine(`[${ts}] [${level.toUpperCase()}] ${message}`);
	}

	/** Verbose-tier logging: only shown when logLevel is "verbose". */
	private logDebug(message: string): void {
		this.log("verbose", message);
	}

	/** Info-tier logging: shown at "verbose" and "info" (the default). */
	private logAlways(message: string): void {
		this.log("info", message);
	}

	private formatHeaders(headers: Headers): string {
		const pairs: string[] = [];
		headers.forEach((value, key) => {
			pairs.push(`${key}: ${value}`);
		});
		return pairs.join("\n");
	}

	private safeJsonForLogs(value: unknown, maxLen: number): string {
		try {
			const s = JSON.stringify(value);
			return s.length > maxLen ? `${s.slice(0, maxLen)}…(truncated)` : s;
		} catch {
			return "<unserializable>";
		}
	}

	private makeCurlLines(baseUrl: string, requestBody: ChatCompletionRequest): string[] {
		const bodyForCurl: Record<string, unknown> = {
			...requestBody,
			messages: requestBody.messages.map((m) => ({
				...m,
				content:
					typeof m.content === "string" && m.content.length > 300
						? `${m.content.slice(0, 300)}…(truncated)`
						: m.content,
			})),
			tools: requestBody.tools?.map((t) => ({
				...t,
				function: {
					...t.function,
					parameters: t.function.parameters ? "<omitted>" : undefined,
				},
			})),
		};

		const body = JSON.stringify(bodyForCurl, null, 2);
		return [
			"Equivalent curl (API key via $OPENAI_API_KEY):",
			`export OPENAI_BASE_URL='${baseUrl}'`,
			"curl -X POST $OPENAI_BASE_URL/chat/completions \\",
			"  -H 'Content-Type: application/json' \\",
			"  -H 'Accept: text/event-stream' \\",
			"  -H 'Authorization: Bearer $OPENAI_API_KEY' \\",
			"  -d @- <<'JSON'",
			body,
			"JSON",
		];
	}

	async provideLanguageModelChatInformation(
		options: { silent: boolean },
		token: vscode.CancellationToken
	): Promise<vscode.LanguageModelChatInformation[]> {
		return this.fetchModels(options, token);
	}

	private async fetchModels(
		options: { silent: boolean },
		token: vscode.CancellationToken
	): Promise<vscode.LanguageModelChatInformation[]> {
		this.logDebug(`Mantle provideLanguageModelChatInformation called, silent: ${options.silent}`);

		if (!this.isMantleEnabled()) {
			this._models = [];
			return [];
		}

		const region = this.mantleRegion();
		const showAllModels = this.config.get<boolean>("showAllModels", true);
		const baseUrl = buildEndpointUrl(region);
		const authMethod = this.mantleAuthMethod();

		let parsedModels: ParsedModelInfo[] = [];

		const discoveryGuard = createRequestTimeoutGuard(this.requestTimeoutMs(), token);
		try {
			this.logDebug(`Fetching Mantle models from ${baseUrl}/models (auth: ${authMethod})`);

			let headers: Record<string, string> | undefined;

			if (authMethod === "awsCredentials") {
				const signed = await signMantleRequest(`${baseUrl}/models`, "GET", undefined, region, this.mantleAwsProfile());
				headers = {
					...signed.headers,
					"User-Agent": this.userAgent,
				};
			} else {
				// Never prompt during discovery; prompt on first Mantle usage instead.
				const apiKey = await this.ensureApiKey(true);
				if (!apiKey) {
					this.logDebug("Mantle enabled but no API key available");
				} else {
					headers = {
						Authorization: `Bearer ${apiKey}`,
						"User-Agent": this.userAgent,
					};
				}
			}

			if (headers) {
				const response = await fetch(`${baseUrl}/models`, {
					headers,
					signal: discoveryGuard.controller.signal,
				});

				if (!response.ok) {
					const authDesc = authMethod === "awsCredentials" ? "AWS credentials" : "API key";
					if (response.status === 401) {
						if (!options.silent) {
							vscode.window.showErrorMessage(`Invalid ${authDesc} for Mantle. Please check your configuration.`);
						}
					} else if (!options.silent) {
						vscode.window.showErrorMessage(`Failed to fetch Mantle models: ${response.status} ${response.statusText}`);
					}
				} else {
					const data = (await response.json()) as ModelsListResponse;
					parsedModels = data.data
						// Mantle's /v1/models catalog lists Anthropic Claude models, but its
						// /v1/chat/completions invoke endpoint rejects ALL of them outright — no
						// Claude model supports Chat Completions on any Amazon Bedrock endpoint. Claude
						// is only usable through Mantle's separate Messages API
						// (/anthropic/v1/messages), and only for the subset of models in
						// MANTLE_MESSAGES_CLAUDE_PATTERNS. Anything else Claude-flavored has zero
						// Mantle support of any kind and is reachable only via the native provider.
						.filter((model) => !isClaudeModelId(model.id) || supportsMantleMessagesApi(model.id))
						.map((model) => {
							const parsed = parseModelInfo(model.id);
							if (isClaudeModelId(model.id)) {
								parsed.usesMantleMessagesApi = true;
							}
							return parsed;
						})
						.map((m) => {
							const override = this._mantleToolSupport.get(m.id);
							if (typeof override === "boolean") {
								m.capabilities.supportsToolCalling = override;
							}
							return m;
						});
					if (!showAllModels) {
						parsedModels = parsedModels.filter((m) => !isHiddenWhenNotShowAll(m.id));
					}
				}
			}
		} catch (error) {
			const authDesc = authMethod === "awsCredentials" ? "AWS credentials" : "API key";
			const message = error instanceof Error ? error.message : String(error);
			this.log("error", `Failed to fetch Mantle models using ${authDesc}: ${message}`);
			if (!options.silent) {
				vscode.window.showErrorMessage(`Failed to fetch Mantle models: ${message}`);
			}
		} finally {
			discoveryGuard.dispose();
		}

		try {
			await this.ensureExternalMetadataLoaded(
				parsedModels.map((m) => m.modelId),
				region
			);
			for (const m of parsedModels) {
				const meta = this._externalMetaByModelId?.get(m.modelId);
				this.applyExternalMetadata(m, meta);
			}
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			this.log("warning", `External model metadata load/apply failed: ${msg}`);
		}

		disambiguateDisplayNames(parsedModels);

		this._models = parsedModels;
		const models = this._models.map((m) => this.toLanguageModelChatInformation(m));
		this.logAlways(`Returning ${models.length} Mantle models to VSCode`);
		return models;
	}

	private toLanguageModelChatInformation(model: ParsedModelInfo): vscode.LanguageModelChatInformation {
		const explicitMaxInput = typeof model.maxInputTokens === "number" ? Math.floor(model.maxInputTokens) : undefined;
		const maxOutput = Math.max(1, Math.floor(model.maxOutputTokens || 0));
		if (explicitMaxInput && explicitMaxInput > 0) {
			return {
				id: model.id,
				name: `${model.displayName} (Mantle)`,
				family: "aws-bedrock-mantle",
				version: "1.0.0",
				tooltip: "Amazon Bedrock via Mantle (OpenAI-compatible)",
				maxInputTokens: explicitMaxInput,
				maxOutputTokens: maxOutput,
				capabilities: {
					toolCalling: model.capabilities.supportsToolCalling,
					imageInput: model.capabilities.supportsVision,
				},
			};
		}

		const context = Math.max(2, Math.floor(model.contextLength || 0));
		const safeMaxOutput = Math.min(maxOutput, context - 1);
		const maxInput = Math.max(1, context - safeMaxOutput);

		return {
			id: model.id,
			name: `${model.displayName} (Mantle)`,
			family: "aws-bedrock-mantle",
			version: "1.0.0",
			tooltip: "Amazon Bedrock via Mantle (OpenAI-compatible)",
			maxInputTokens: maxInput,
			maxOutputTokens: safeMaxOutput,
			capabilities: {
				toolCalling: model.capabilities.supportsToolCalling,
				imageInput: model.capabilities.supportsVision,
			},
		};
	}

	refresh(): void {
		this._models = null;
		this._onDidChangeLanguageModelChatInformation.fire();
	}

	async provideLanguageModelChatResponse(
		model: vscode.LanguageModelChatInformation,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken
	): Promise<void> {
		const parsed = this._models?.find((m) => m.id === model.id);
		const modelId = parsed?.modelId ?? model.id;

		const authMethod = this.mantleAuthMethod();
		let apiKey: string | undefined;

		if (authMethod === "apiKey") {
			apiKey = await this.ensureApiKey(false);
			if (!apiKey) {
				throw new Error("Amazon Bedrock API key is required");
			}
		}

		// Claude models on Mantle go through the separate Anthropic Messages API, not
		// Chat Completions (which no Claude model supports on any Amazon Bedrock endpoint).
		const usesMessagesApi = parsed?.usesMantleMessagesApi ?? (isClaudeModelId(modelId) && supportsMantleMessagesApi(modelId));
		if (usesMessagesApi) {
			const region = this.mantleRegion();
			await sendMantleMessage({
				region,
				modelId,
				authMethod,
				apiKey,
				awsProfile: this.mantleAwsProfile(),
				userAgent: this.userAgent,
				messages,
				tools: this.shouldSendTools() ? options.tools : undefined,
				temperature: options.modelOptions?.temperature as number | undefined,
				maxTokens: options.modelOptions?.max_tokens as number | undefined,
				progress,
				token,
				log: (m) => this.logAlways(m),
				requestTimeoutMs: this.requestTimeoutMs(),
			});
			return;
		}

		const validation = validateRequest(messages);
		if (!validation.valid) {
			throw new Error(`Invalid request: ${validation.error}`);
		}

		const openaiMessages = convertMessages(messages);
		if (openaiMessages.length === 0) {
			throw new Error("No valid messages to send");
		}

		// Convert tools if provided. We optimistically send tools (unless disabled) and cache
		// whether a model accepts them, since Mantle's /v1/models doesn't expose tool metadata.
		const tools = this.shouldSendTools() ? convertTools(options.tools) : undefined;

		const region = this.mantleRegion();
		const baseUrl = buildEndpointUrl(region);

		const requestBody: ChatCompletionRequest = {
			model: parsed?.modelId ?? model.id,
			messages: openaiMessages,
			stream: true,
			temperature: options.modelOptions?.temperature as number | undefined,
			max_tokens: options.modelOptions?.max_tokens as number | undefined,
			tools,
		};

		this.logDebug(`chat request url: ${baseUrl}/chat/completions`);
		this.logDebug(`chat request body (truncated 4000 chars): ${this.safeJsonForLogs(requestBody, 4000)}`);
		for (const line of this.makeCurlLines(baseUrl, requestBody)) {
			this.logDebug(line);
		}

		this.logDebug(
			`chat request: model=${model.id} region=${region} stream=true messages=${openaiMessages.length} tools=${tools?.length ?? 0} sendTools=${this.shouldSendTools()}`
		);
		this.logDebug(
			`chat request message summary: ${openaiMessages
				.map((m) => `${m.role}:${(m.content ?? "").toString().length}`)
				.join(" ")}`
		);

		this._toolCallBuffers.clear();
		this._completedToolCallIndices.clear();
		this._reportedAnyPartInCurrentResponse = false;

		// Timeout only guards time-to-first-response; cleared below once we have one, so a
		// long-but-actively-streaming generation is never killed by this timer.
		const requestGuard = createRequestTimeoutGuard(this.requestTimeoutMs(), token);

		const sendRequest = async (toolsOverride: ChatCompletionRequest["tools"]): Promise<Response> => {
			const body: ChatCompletionRequest = {
				...requestBody,
				tools: toolsOverride,
			};
			const bodyString = JSON.stringify(body);

			let headers: Record<string, string>;

			if (authMethod === "awsCredentials") {
				const signed = await signMantleRequest(
					`${baseUrl}/chat/completions`,
					"POST",
					bodyString,
					region,
					this.mantleAwsProfile()
				);
				headers = {
					...signed.headers,
					"Content-Type": "application/json",
					Accept: "text/event-stream",
					"Cache-Control": "no-cache",
					"User-Agent": this.userAgent,
				};
			} else {
				headers = {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
					Accept: "text/event-stream",
					"Cache-Control": "no-cache",
					"User-Agent": this.userAgent,
				};
			}

			return fetch(`${baseUrl}/chat/completions`, {
				method: "POST",
				headers,
				body: bodyString,
				signal: requestGuard.controller.signal,
			});
		};

		try {
			let response = await sendRequest(tools);
			requestGuard.clear();

			this.logDebug(`chat response: status=${response.status} ${response.statusText}`);
			this.logDebug(`chat response headers:\n${this.formatHeaders(response.headers)}`);

			if (!response.ok) {
				const errorText = await response.text();
				this.log("warning", `chat error body (truncated 2000 chars): ${errorText.slice(0, 2000)}`);

				// Some models (notably Anthropic Claude) are listed by Mantle's /v1/models
				// catalog but rejected outright by its /v1/chat/completions invoke endpoint.
				// We filter Claude out of the model list at discovery time, but a stale
				// cached selection from before that fix (or a similarly-affected model we
				// haven't seen yet) could still land here — fail fast with an actionable
				// message instead of retrying a request that can never succeed.
				if (/does not support the .*chat\/completions/i.test(errorText)) {
					throw new Error(
						`${parsed?.modelId ?? model.id} can't be invoked through Amazon Bedrock Mantle's chat/completions API. ` +
							`Use the "Amazon Bedrock" (native) provider for this model instead.`
					);
				}

				// If we tried tools and the provider rejected them, retry without tools once and cache the outcome.
				const looksToolRelated = /tool|tool_choice|function_call|tool_calls/i.test(errorText);
				if (tools && tools.length > 0 && looksToolRelated) {
					this.log("warning", `model rejected tools; caching toolCalling=false for ${model.id} and retrying without tools`);
					const prevMantle = this._mantleToolSupport.get(model.id);
					this._mantleToolSupport.set(model.id, false);
					if (prevMantle !== false) {
						this._onDidChangeLanguageModelChatInformation.fire();
					}
					response = await sendRequest(undefined);
					if (!response.ok) {
						const retryText = await response.text();
						this.log("error", `chat error body after retry (truncated 2000 chars): ${retryText.slice(0, 2000)}`);
						throw new Error(`API error ${response.status}: ${retryText}`);
					}
				} else {
					if (response.status === 401) {
						throw new Error("Invalid API key. Please update your Amazon Bedrock API key.");
					} else if (response.status === 404) {
						throw new Error(`Model ${model.id} not available in region ${region}`);
					} else if (response.status === 429) {
						throw new Error("Rate limit exceeded. Please try again later.");
					}
					throw new Error(`API error ${response.status}: ${errorText}`);
				}
			}

			if (tools && tools.length > 0) {
				const prevMantleSuccess = this._mantleToolSupport.get(model.id);
				if (prevMantleSuccess !== true) {
					this._mantleToolSupport.set(model.id, true);
					this._onDidChangeLanguageModelChatInformation.fire();
				}
			}

			const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
			if (!response.body) {
				throw new Error("No response body");
			}

			if (contentType.includes("text/event-stream")) {
				this.logDebug("chat response is SSE (text/event-stream); starting stream parse...");
				await this.processStreamingResponse(response.body, progress, token);
			} else {
				this.logDebug(`chat response is not SSE (content-type='${contentType}'); reading full body...`);
				const text = await response.text();
				this.logDebug(`chat raw body (truncated 4000 chars): ${text.slice(0, 4000)}`);
				try {
					const parsedBody = JSON.parse(text) as ChatCompletionResponse;
					const content = parsedBody.choices?.[0]?.message?.content;
					const messageText =
						typeof content === "string"
							? content
							: Array.isArray(content)
								? content
									.filter((p) => p && typeof p === "object" && (p as any).type === "text")
									.map((p) => (p as any).text ?? "")
									.join("")
								: undefined;
					if (messageText) {
						progress.report(new vscode.LanguageModelTextPart(messageText));
						this.logDebug(`chat parsed message length=${messageText.length}`);
						return;
					}
				} catch {
					// fall through
				}
				this.log("error", "chat parsed no message content; throwing no-response error");
				throw new Error("Sorry, no response was returned");
			}
		} catch (error) {
			if (error instanceof Error) {
				if (error.name === "AbortError") {
					this.logDebug("chat request aborted");
					return;
				}
				this.log("error", `chat exception: ${error.message}`);
				throw error;
			}
			this.log("error", "chat exception: Unknown error occurred");
			throw new Error("Unknown error occurred");
		} finally {
			requestGuard.dispose();
		}
	}

	async provideTokenCount(
		_model: vscode.LanguageModelChatInformation,
		text: string | vscode.LanguageModelChatMessage,
		_token: vscode.CancellationToken
	): Promise<number> {
		if (typeof text === "string") {
			return Math.ceil(text.length / 4);
		}

		let totalLength = 0;
		for (const part of text.content) {
			if (part instanceof vscode.LanguageModelTextPart) {
				totalLength += part.value.length;
			} else if (part instanceof vscode.LanguageModelToolCallPart) {
				totalLength += JSON.stringify(part.input).length + part.name.length;
			}
		}

		return Math.ceil(totalLength / 4);
	}

	private async processStreamingResponse(
		responseBody: ReadableStream<Uint8Array>,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken
	): Promise<void> {
		const reader = responseBody.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		let chunkCount = 0;
		let firstByteReceived = false;
		let lastByteAt = Date.now();
		let lastDataAt = Date.now();
		let keepAliveCount = 0;
		let heartbeat: ReturnType<typeof setInterval> | undefined;

		let emittedAny = false;
		let doneSeen = false;

		const processLine = async (line: string): Promise<boolean> => {
			const trimmed = line.trim();
			if (!trimmed) {
				return false;
			}

			if (trimmed.startsWith(":")) {
				keepAliveCount += 1;
				if (keepAliveCount <= 5 || keepAliveCount % 50 === 0) {
					this.logDebug(`sse keepalive (#${keepAliveCount}): ${trimmed.slice(0, 100)}`);
				}
				return false;
			}
			if (!trimmed.startsWith("data:")) {
				if (trimmed.startsWith("event:") || trimmed.startsWith("id:") || trimmed.startsWith("retry:")) {
					this.logDebug(`sse meta: ${trimmed.slice(0, 500)}`);
				}
				return false;
			}

			const data = trimmed.slice("data:".length).trimStart();
			this.logDebug(`sse: ${data.slice(0, 500)}`);
			lastDataAt = Date.now();
			if (data === "[DONE]") {
				for (const idx of Array.from(this._toolCallBuffers.keys())) {
					await this.tryEmitBufferedToolCall(idx, progress);
				}
				doneSeen = true;
				return true;
			}
			if (!data) {
				return false;
			}

			try {
				const chunk = JSON.parse(data) as ChatCompletionChunk;
				await this.processDelta(chunk, progress);
				emittedAny = true;
			} catch (error) {
				this.log("warning", `Failed to parse SSE chunk (first 500 chars): ${data.slice(0, 500)}`);
				this.log("warning", `Parse error: ${error instanceof Error ? error.message : String(error)}`);
			}

			return false;
		};

		try {
			heartbeat = setInterval(() => {
				if (token.isCancellationRequested || doneSeen) {
					return;
				}
				const ms = Date.now() - lastByteAt;
				if (!firstByteReceived && ms >= 5000) {
					this.log("warning", `No SSE bytes received yet (${Math.round(ms / 1000)}s) - model may be slow or request may be stuck`);
				}

				const dataMs = Date.now() - lastDataAt;
				if (firstByteReceived && !emittedAny && dataMs >= 15000) {
					this.log(
						"warning",
						`SSE bytes are arriving but no 'data:' frames seen for ${Math.round(dataMs / 1000)}s (keepalives=${keepAliveCount}). This usually means the model is still queued/running.`
					);
					if (this.shouldEmitPlaceholders()) {
						progress.report(new vscode.LanguageModelTextPart("(Waiting for model output…)"));
						emittedAny = true;
					}
					lastDataAt = Date.now();
				}
			}, 5000);

			while (!token.isCancellationRequested && !doneSeen) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}

				chunkCount += 1;
				firstByteReceived = true;
				lastByteAt = Date.now();
				const decoded = decoder.decode(value, { stream: true });
				this.logDebug(
					`stream chunk#${chunkCount} bytes=${value.byteLength} textPreview=${JSON.stringify(decoded.slice(0, 300))}`
				);

				buffer += decoded;
				const lines = buffer.split(/\r?\n/);
				buffer = lines.pop() || "";

				for (const line of lines) {
					const shouldStop = await processLine(line);
					if (shouldStop) {
						break;
					}
				}
			}

			if (!doneSeen && buffer.trim()) {
				await processLine(buffer);
			}
		} finally {
			if (heartbeat) {
				clearInterval(heartbeat);
			}
			if (doneSeen) {
				try {
					await reader.cancel();
				} catch {
					// ignore
				}
			}
			reader.releaseLock();
		}

		if (!emittedAny && !token.isCancellationRequested) {
			this.log("error", "SSE stream ended without emitting any content");
			throw new Error("Sorry, no response was returned");
		}
	}

	private async processDelta(
		chunk: ChatCompletionChunk,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>
	): Promise<void> {
		for (const choice of chunk.choices) {
			const delta = choice.delta;

			if (delta.content) {
				this.logDebug(`delta.content length=${delta.content.length}`);
				progress.report(new vscode.LanguageModelTextPart(delta.content));
				this._reportedAnyPartInCurrentResponse = true;
			} else if (delta.reasoning) {
				// Mantle (e.g. openai.gpt-oss-*) can stream `delta.reasoning` for a while before any `delta.content`.
				// GitHub Copilot Chat can look "stuck" unless we report at least one part.
				this.logDebug(`delta.reasoning length=${delta.reasoning.length}`);
				if (!this._reportedAnyPartInCurrentResponse && this.shouldEmitPlaceholders()) {
					progress.report(new vscode.LanguageModelTextPart("Thinking…"));
					this._reportedAnyPartInCurrentResponse = true;
				}
			}

			if (delta.tool_calls) {
				this.logDebug(`delta.tool_calls count=${delta.tool_calls.length}`);
				for (const toolCall of delta.tool_calls) {
					const idx = toolCall.index;

					if (this._completedToolCallIndices.has(idx)) {
						continue;
					}

					const buf = this._toolCallBuffers.get(idx) || { args: "" };

					if (toolCall.id) {
						buf.id = toolCall.id;
					}
					if (toolCall.function?.name) {
						buf.name = toolCall.function.name;
					}
					if (toolCall.function?.arguments) {
						buf.args += toolCall.function.arguments;
					}

					this._toolCallBuffers.set(idx, buf);

					await this.tryEmitBufferedToolCall(idx, progress);
				}
			}
		}
	}

	private async tryEmitBufferedToolCall(
		index: number,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>
	): Promise<void> {
		const buf = this._toolCallBuffers.get(index);
		if (!buf || !buf.name) {
			return;
		}

		const parsed = tryParseJSONObject(buf.args);
		if (!parsed.ok) {
			return;
		}

		const callId = buf.id || generateCallId();
		progress.report(new vscode.LanguageModelToolCallPart(callId, buf.name, parsed.value));

		this._toolCallBuffers.delete(index);
		this._completedToolCallIndices.add(index);
	}

	private async ensureApiKey(silent: boolean): Promise<string | undefined> {
		let apiKey = await this.secrets.get("bedrock.apiKey");

		if (!apiKey && !silent) {
			const entered = await vscode.window.showInputBox({
				title: "Amazon Bedrock API Key",
				prompt: "Enter your Amazon Bedrock API key (from the Amazon Bedrock console)",
				ignoreFocusOut: true,
				password: true,
				placeHolder: "bedrock-api-key-...",
			});

			if (entered && entered.trim()) {
				apiKey = entered.trim();
				await this.secrets.store("bedrock.apiKey", apiKey);
				this.refresh();
			}
		}

		return apiKey;
	}

	async clearApiKey(): Promise<void> {
		await this.secrets.delete("bedrock.apiKey");
		this.refresh();
		vscode.window.showInformationMessage("Amazon Bedrock API key cleared");
	}

	async setApiKey(apiKey: string): Promise<void> {
		await this.secrets.store("bedrock.apiKey", apiKey);
		this.refresh();
	}

	async hasStoredApiKey(): Promise<boolean> {
		return (await this.secrets.get("bedrock.apiKey")) !== undefined;
	}
}
