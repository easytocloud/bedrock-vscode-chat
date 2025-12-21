/**
 * AWS Bedrock Mantle Language Model Provider
 * Implements VSCode's LanguageModelChatProvider using OpenAI-compatible Mantle API
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
import { converseOnce, listNativeBedrockModels } from "./bedrockNative";
import { loadExternalMetadataForModels, type ExternalModelMetadata } from "./externalModelMetadata";
import {
	buildEndpointUrl,
	convertMessages,
	convertTools,
	generateCallId,
	parseModelInfo,
	tryParseJSONObject,
	validateRequest,
} from "./utils";

export class BedrockMantleProvider implements vscode.LanguageModelChatProvider {
	private readonly _onDidChangeLanguageModelChatInformation = new vscode.EventEmitter<void>();
	readonly onDidChangeLanguageModelChatInformation = this._onDidChangeLanguageModelChatInformation.event;

	private _models: ParsedModelInfo[] | null = null;
	private _mantleToolSupport = new Map<string, boolean>();
	private _nativeToolSupport = new Map<string, boolean>();
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
		return this.config.get<string>("modelMetadataSource", "litellm");
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

		// Token limits
		if (typeof meta.max_output_tokens === "number" && meta.max_output_tokens > 0) {
			model.maxOutputTokens = meta.max_output_tokens;
		}
		if (typeof meta.max_input_tokens === "number" && meta.max_input_tokens > 0) {
			model.maxInputTokens = meta.max_input_tokens;
			// Keep contextLength coherent for any fallback logic.
			model.contextLength = Math.max(model.contextLength, meta.max_input_tokens + (model.maxOutputTokens || 0));
		}

		// Tool calling support (use as an initial signal; runtime probing will override)
		const tools = meta.supports_function_calling === true || meta.supports_tool_choice === true;
		if (tools) {
			model.capabilities.supportsToolCalling = true;
		}

		// Vision support: prefer native Bedrock API modalities; use external for Mantle.
		if (model.backend === "mantle" && meta.supports_vision === true) {
			model.capabilities.supportsVision = true;
		}
	}

	private isDebugEnabled(): boolean {
		return this.config.get<boolean>("debugLogging", false);
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

	private isNativeEnabled(): boolean {
		return this.config.get<boolean>("enableNative", true);
	}

	private awsProfile(): string | undefined {
		const profile = this.config.get<string>("awsProfile", "");
		return profile?.trim() ? profile.trim() : undefined;
	}

	private logDebug(message: string): void {
		if (!this.isDebugEnabled()) {
			return;
		}
		const ts = new Date().toISOString();
		this.output.appendLine(`[${ts}] ${message}`);
	}

	private logAlways(message: string): void {
		const ts = new Date().toISOString();
		this.output.appendLine(`[${ts}] ${message}`);
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
		// Keep this copy/paste friendly and safe:
		// - never include the API key
		// - truncate potentially huge payload fields
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
					// Tool schemas can be enormous; omit to keep logs readable.
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

	/**
	 * Prepare available language models (called during initial discovery)
	 */
	async prepareLanguageModelChatInformation(
		options: { silent: boolean },
		token: vscode.CancellationToken
	): Promise<vscode.LanguageModelChatInformation[]> {
		return this.fetchModels(options, token);
	}

	/**
	 * Provide available language models (called when user requests model list)
	 */
	async provideLanguageModelChatInformation(
		options: { silent: boolean },
		token: vscode.CancellationToken
	): Promise<vscode.LanguageModelChatInformation[]> {
		return this.fetchModels(options, token);
	}

	/**
	 * Fetch and return available language models
	 */
	private async fetchModels(
		options: { silent: boolean },
		token: vscode.CancellationToken
	): Promise<vscode.LanguageModelChatInformation[]> {
		console.log(`provideLanguageModelChatInformation called, silent: ${options.silent}`);

		const region = this.config.get<string>("region", "us-east-1");
		const showAllModels = this.config.get<boolean>("showAllModels", true);

		const merged: ParsedModelInfo[] = [];

		// 1) Mantle models (OpenAI-compatible)
		if (this.isMantleEnabled()) {
			// Never prompt during discovery; prompt on first Mantle usage instead.
			const apiKey = await this.ensureApiKey(true);
			if (apiKey) {
				const baseUrl = buildEndpointUrl(region);
				try {
					console.log(`Fetching Mantle models from ${baseUrl}/models`);
					const abortController = new AbortController();
					const cancellation = token.onCancellationRequested(() => abortController.abort());
					const response = await fetch(`${baseUrl}/models`, {
						headers: {
							Authorization: `Bearer ${apiKey}`,
							"User-Agent": this.userAgent,
						},
						signal: abortController.signal,
					});
					cancellation.dispose();

					if (!response.ok) {
						if (response.status === 401) {
							if (!options.silent) {
								vscode.window.showErrorMessage(
									"Invalid AWS Bedrock API key (Mantle). Please update your API key."
								);
							}
						} else if (!options.silent) {
							vscode.window.showErrorMessage(
								`Failed to fetch Mantle models: ${response.status} ${response.statusText}`
							);
						}
					} else {
						const data = (await response.json()) as ModelsListResponse;
						const parsedModels = data.data.map((model) => parseModelInfo(model.id));
						const mantleModels = (showAllModels
							? parsedModels
							: parsedModels.filter((m) => !m.id.includes("safeguard")))
							.map((m) => {
								const override = this._mantleToolSupport.get(m.id);
								if (typeof override === "boolean") {
									m.capabilities.supportsToolCalling = override;
								}
								return m;
							});
						merged.push(...mantleModels);
					}
				} catch (error) {
					if (!options.silent && error instanceof Error) {
						vscode.window.showErrorMessage(`Failed to fetch Mantle models: ${error.message}`);
					}
				}
			} else {
				console.log("Mantle enabled but no API key available");
			}
		}

		// 2) Native Bedrock models (Converse)
		if (this.isNativeEnabled()) {
			try {
				console.log(`Listing native Bedrock models in ${region} (profile=${this.awsProfile() ?? "default"})`);
				const nativeModels = await listNativeBedrockModels({
					region,
					awsProfile: this.awsProfile(),
					userAgent: this.userAgent,
					showAllModels,
				});
				// Apply cached tool support probing results.
				for (const m of nativeModels) {
					const override = this._nativeToolSupport.get(m.id);
					if (typeof override === "boolean") {
						m.capabilities.supportsToolCalling = override;
					}
				}
				merged.push(...nativeModels);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				this.logAlways(
					`native model discovery failed (region=${region} profile=${this.awsProfile() ?? "default"}): ${message}`
				);
				this.logAlways(
					"native model discovery requires valid AWS credentials with bedrock:ListFoundationModels. If using SSO, run `aws sso login` and ensure your profile is configured correctly."
				);
				if (!options.silent) {
					vscode.window.showErrorMessage(
						`Failed to list native Bedrock models (AWS credentials needed): ${message}`
					);
				}
			}
		}

		// IDs are unique per backend (mantle:<id> vs bedrock:<id>), so no de-dupe needed.
		const modelsToReturn = merged;
		try {
			await this.ensureExternalMetadataLoaded(
				modelsToReturn.map((m) => m.modelId),
				region
			);
			for (const m of modelsToReturn) {
				const meta = this._externalMetaByModelId?.get(m.modelId);
				this.applyExternalMetadata(m, meta);
			}
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			this.logAlways(`External model metadata load/apply failed: ${msg}`);
		}

		// Apply runtime-probed tool support overrides last.
		for (const m of modelsToReturn) {
			const override =
				m.backend === "bedrock" ? this._nativeToolSupport.get(m.id) : this._mantleToolSupport.get(m.id);
			if (typeof override === "boolean") {
				m.capabilities.supportsToolCalling = override;
			}
		}

		this._models = modelsToReturn;
		const models = this._models.map((m) => this.toLanguageModelChatInformation(m));
		console.log(`Returning ${models.length} total models (mantle+native) to VSCode`);
		return models;
	}

	private toLanguageModelChatInformation(model: ParsedModelInfo): vscode.LanguageModelChatInformation {
		// VS Code expects maxInputTokens/maxOutputTokens to be coherent.
		// If we have an explicit maxInputTokens (from external metadata), prefer it.
		const explicitMaxInput = typeof model.maxInputTokens === "number" ? Math.floor(model.maxInputTokens) : undefined;
		const maxOutput = Math.max(1, Math.floor(model.maxOutputTokens || 0));
		if (explicitMaxInput && explicitMaxInput > 0) {
			return {
				id: model.id,
				name: model.backend === "bedrock" ? `${model.displayName} (Native)` : `${model.displayName} (Mantle)`,
				family: "aws-bedrock",
				version: "1.0.0",
				tooltip:
					model.backend === "bedrock"
						? "AWS Bedrock (native Converse API)"
						: "AWS Bedrock via Mantle (OpenAI-compatible)",
				maxInputTokens: explicitMaxInput,
				maxOutputTokens: maxOutput,
				capabilities: {
					toolCalling: model.capabilities.supportsToolCalling,
					imageInput: model.capabilities.supportsVision,
				},
			};
		}

		// Fall back: treat ParsedModelInfo.contextLength as the total context window.
		const context = Math.max(2, Math.floor(model.contextLength || 0));
		const safeMaxOutput = Math.min(maxOutput, context - 1);
		const maxInput = Math.max(1, context - safeMaxOutput);

		return {
			id: model.id,
			name: model.backend === "bedrock" ? `${model.displayName} (Native)` : `${model.displayName} (Mantle)`,
			family: "aws-bedrock",
			version: "1.0.0",
			tooltip: model.backend === "bedrock" ? "AWS Bedrock (native Converse API)" : "AWS Bedrock via Mantle (OpenAI-compatible)",
			maxInputTokens: maxInput,
			maxOutputTokens: safeMaxOutput,
			capabilities: {
				toolCalling: model.capabilities.supportsToolCalling,
				imageInput: model.capabilities.supportsVision,
			},
		};
	}

	/**
	 * Clear any cached models and notify VS Code to refresh.
	 */
	refresh(): void {
		this._models = null;
		this._onDidChangeLanguageModelChatInformation.fire();
	}

	/**
	 * Provide chat response with streaming support
	 */
	async provideLanguageModelChatResponse(
		model: vscode.LanguageModelChatInformation,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken
	): Promise<void> {
		const parsed = this._models?.find((m) => m.id === model.id);
		const backend = parsed?.backend ?? (model.id.startsWith("bedrock:") ? "bedrock" : "mantle");

		if (backend === "bedrock") {
			const region = this.config.get<string>("region", "us-east-1");
			const temperature = options.modelOptions?.temperature as number | undefined;
			const maxTokens = options.modelOptions?.max_tokens as number | undefined;
			const toolsToSend = this.shouldSendTools() ? options.tools : undefined;

			this.logDebug(
				`native bedrock request: model=${model.id} modelId=${parsed?.modelId ?? model.id} ` +
				`toolsProvided=${options.tools?.length ?? 0} sendTools=${this.shouldSendTools()} toolsToSend=${toolsToSend?.length ?? 0}`
			);

			try {
				const resp = await converseOnce({
					region,
					awsProfile: this.awsProfile(),
					userAgent: this.userAgent,
					modelId: parsed?.modelId ?? model.id,
					messages,
					tools: toolsToSend,
					temperature,
					maxTokens,
					globalState: this.globalState,
					log: (m) => this.logAlways(m),
				});

				if (resp.text) {
					progress.report(new vscode.LanguageModelTextPart(resp.text));
				}
				for (const toolUse of resp.toolUses) {
					progress.report(new vscode.LanguageModelToolCallPart(toolUse.id, toolUse.name, toolUse.input));
				}

				// If we successfully sent tools, mark tool calling as supported for this model.
				if (toolsToSend && toolsToSend.length > 0) {
					const prev = this._nativeToolSupport.get(model.id);
					if (prev !== true) {
						this._nativeToolSupport.set(model.id, true);
						this._onDidChangeLanguageModelChatInformation.fire();
					}
				}
				return;
			} catch (error) {
				// If the error looks like tool config isn't supported, retry once without tools and cache that.
				const message = error instanceof Error ? error.message : String(error);
				const looksToolRelated = /tool|toolconfig|tool\s*use/i.test(message);
				if (toolsToSend && toolsToSend.length > 0 && looksToolRelated) {
					this.logAlways(`native bedrock toolConfig rejected by model ${model.id}; retrying without tools: ${message}`);
					const prevNative = this._nativeToolSupport.get(model.id);
					this._nativeToolSupport.set(model.id, false);
					if (prevNative !== false) {
						this._onDidChangeLanguageModelChatInformation.fire();
					}
					const resp = await converseOnce({
						region,
						awsProfile: this.awsProfile(),
						userAgent: this.userAgent,
						modelId: parsed?.modelId ?? model.id,
						messages,
						tools: undefined,
						temperature,
						maxTokens,
						globalState: this.globalState,
						log: (m) => this.logAlways(m),
					});
					if (resp.text) {
						progress.report(new vscode.LanguageModelTextPart(resp.text));
					}
					for (const toolUse of resp.toolUses) {
						progress.report(new vscode.LanguageModelToolCallPart(toolUse.id, toolUse.name, toolUse.input));
					}
					return;
				}

				this.logAlways(`native bedrock error: ${message}`);
				throw error instanceof Error ? error : new Error(message);
			}
		}

		// Get API key
		const apiKey = await this.ensureApiKey(false);
		if (!apiKey) {
			throw new Error("AWS Bedrock API key is required");
		}

		// Validate request
		const validation = validateRequest(messages);
		if (!validation.valid) {
			throw new Error(`Invalid request: ${validation.error}`);
		}

		// Convert messages to OpenAI format
		const openaiMessages = convertMessages(messages);
		if (openaiMessages.length === 0) {
			throw new Error("No valid messages to send");
		}

		// Convert tools if provided. We optimistically send tools (unless disabled) and cache
		// whether a model accepts them, since Mantle's /v1/models doesn't expose tool metadata.
		const tools = this.shouldSendTools() ? convertTools(options.tools) : undefined;

		// Build request
		const region = this.config.get<string>("region", "us-east-1");
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

		// Clear tool call buffers
		this._toolCallBuffers.clear();
		this._completedToolCallIndices.clear();
		this._reportedAnyPartInCurrentResponse = false;

		const abortController = new AbortController();
		const cancellation = token.onCancellationRequested(() => abortController.abort());

		const sendRequest = async (toolsOverride: ChatCompletionRequest["tools"]): Promise<Response> => {
			const body: ChatCompletionRequest = {
				...requestBody,
				tools: toolsOverride,
			};
			return fetch(`${baseUrl}/chat/completions`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
					Accept: "text/event-stream",
					"Cache-Control": "no-cache",
					"User-Agent": this.userAgent,
				},
				body: JSON.stringify(body),
				signal: abortController.signal,
			});
		};

		try {
			let response = await sendRequest(tools);

			this.logDebug(`chat response: status=${response.status} ${response.statusText}`);
			this.logDebug(`chat response headers:\n${this.formatHeaders(response.headers)}`);

			if (!response.ok) {
				const errorText = await response.text();
				this.logAlways(`chat error body (truncated 2000 chars): ${errorText.slice(0, 2000)}`);

				// If we tried tools and the provider rejected them, retry without tools once and cache the outcome.
				const looksToolRelated = /tool|tool_choice|function_call|tool_calls/i.test(errorText);
				if (tools && tools.length > 0 && looksToolRelated) {
					this.logAlways(`model rejected tools; caching toolCalling=false for ${model.id} and retrying without tools`);
					const prevMantle = this._mantleToolSupport.get(model.id);
					this._mantleToolSupport.set(model.id, false);
					if (prevMantle !== false) {
						this._onDidChangeLanguageModelChatInformation.fire();
					}
					response = await sendRequest(undefined);
					if (response.ok) {
						// Continue with normal response handling below.
					} else {
						// Fall through to error handling below using the retried response.
						const retryText = await response.text();
						this.logAlways(`chat error body after retry (truncated 2000 chars): ${retryText.slice(0, 2000)}`);
						throw new Error(`API error ${response.status}: ${retryText}`);
					}
				} else {
					if (response.status === 401) {
						throw new Error("Invalid API key. Please update your AWS Bedrock API key.");
					} else if (response.status === 404) {
						throw new Error(`Model ${model.id} not available in region ${region}`);
					} else if (response.status === 429) {
						throw new Error("Rate limit exceeded. Please try again later.");
					}
					throw new Error(`API error ${response.status}: ${errorText}`);
				}
			}

			// If we successfully sent tools, cache toolCalling=true.
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

			// Process streaming response. Some endpoints may return non-stream JSON even when stream=true.
			if (contentType.includes("text/event-stream")) {
				this.logDebug("chat response is SSE (text/event-stream); starting stream parse...");
				await this.processStreamingResponse(response.body, progress, token);
			} else {
				this.logDebug(`chat response is not SSE (content-type='${contentType}'); reading full body...`);
				const text = await response.text();
				this.logDebug(`chat raw body (truncated 4000 chars): ${text.slice(0, 4000)}`);
				try {
					const parsed = JSON.parse(text) as ChatCompletionResponse;
					const content = parsed.choices?.[0]?.message?.content;
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
				this.logAlways("chat parsed no message content; throwing no-response error");
				throw new Error("Sorry, no response was returned");
			}
		} catch (error) {
			if (error instanceof Error) {
				if (error.name === "AbortError") {
					// Request was cancelled
					this.logDebug("chat request aborted");
					return;
				}
				this.logAlways(`chat exception: ${error.message}`);
				throw error;
			}
			this.logAlways("chat exception: Unknown error occurred");
			throw new Error("Unknown error occurred");
		} finally {
			cancellation.dispose();
		}
	}

	/**
	 * Provide token count estimation
	 */
	async provideTokenCount(
		model: vscode.LanguageModelChatInformation,
		text: string | vscode.LanguageModelChatMessage,
		_token: vscode.CancellationToken
	): Promise<number> {
		// Simple estimation: ~4 characters per token
		if (typeof text === "string") {
			return Math.ceil(text.length / 4);
		}

		// Aggregate message content
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

	/**
	 * Process streaming SSE response
	 */
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

			// SSE comment/keepalive line (common: ":\n\n").
			if (trimmed.startsWith(":")) {
				keepAliveCount += 1;
				if (keepAliveCount <= 5 || keepAliveCount % 50 === 0) {
					this.logDebug(`sse keepalive (#${keepAliveCount}): ${trimmed.slice(0, 100)}`);
				}
				return false;
			}
			// Accept both "data:" and "data: " and tolerate CRLF.
			if (!trimmed.startsWith("data:")) {
				// Helpful when providers emit event/id/retry lines.
				if (trimmed.startsWith("event:") || trimmed.startsWith("id:") || trimmed.startsWith("retry:")) {
					this.logDebug(`sse meta: ${trimmed.slice(0, 500)}`);
				}
				return false;
			}

			const data = trimmed.slice("data:".length).trimStart();
			this.logDebug(`sse: ${data.slice(0, 500)}`);
			lastDataAt = Date.now();
			if (data === "[DONE]") {
				// Try to emit any tool calls that became parseable right at the end.
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
				this.logAlways(`Failed to parse SSE chunk (first 500 chars): ${data.slice(0, 500)}`);
				console.error("Failed to parse SSE chunk:", error);
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
					this.logAlways(`No SSE bytes received yet (${Math.round(ms / 1000)}s) - model may be slow or request may be stuck`);
				}

				// If we are receiving bytes (e.g. keepalives) but no data frames, chat will look blank.
				const dataMs = Date.now() - lastDataAt;
				if (firstByteReceived && !emittedAny && dataMs >= 15000) {
					this.logAlways(
						`SSE bytes are arriving but no 'data:' frames seen for ${Math.round(dataMs / 1000)}s (keepalives=${keepAliveCount}). This usually means the model is still queued/running.`
					);
					// Only emit placeholder if explicitly enabled (avoid polluting chat history).
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

			// Process any remaining buffered line on clean end.
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
			this.logAlways("SSE stream ended without emitting any content");
			throw new Error("Sorry, no response was returned");
		}
	}

	/**
	 * Process a single delta from streaming response
	 */
	private async processDelta(
		chunk: ChatCompletionChunk,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>
	): Promise<void> {
		for (const choice of chunk.choices) {
			const delta = choice.delta;

			// Handle text content
			if (delta.content) {
				this.logDebug(`delta.content length=${delta.content.length}`);
				progress.report(new vscode.LanguageModelTextPart(delta.content));
				this._reportedAnyPartInCurrentResponse = true;
			} else if (delta.reasoning) {
				// Mantle (e.g. openai.gpt-oss-*) can stream `delta.reasoning` for a while before any `delta.content`.
				// VS Code chat can look "stuck" unless we report at least one part.
				this.logDebug(`delta.reasoning length=${delta.reasoning.length}`);
				if (!this._reportedAnyPartInCurrentResponse && this.shouldEmitPlaceholders()) {
					progress.report(new vscode.LanguageModelTextPart("Thinking…"));
					this._reportedAnyPartInCurrentResponse = true;
				}
			}

			// Handle tool calls
			if (delta.tool_calls) {
				this.logDebug(`delta.tool_calls count=${delta.tool_calls.length}`);
				for (const toolCall of delta.tool_calls) {
					const idx = toolCall.index;

					// Skip if already completed
					if (this._completedToolCallIndices.has(idx)) {
						continue;
					}

					// Get or create buffer
					const buf = this._toolCallBuffers.get(idx) || { args: "" };

					// Accumulate data
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

					// Try to emit if we have complete JSON
					await this.tryEmitBufferedToolCall(idx, progress);
				}
			}
		}
	}

	/**
	 * Try to emit a buffered tool call if JSON is complete
	 */
	private async tryEmitBufferedToolCall(
		index: number,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>
	): Promise<void> {
		const buf = this._toolCallBuffers.get(index);
		if (!buf || !buf.name) {
			return;
		}

		// Try to parse JSON
		const parsed = tryParseJSONObject(buf.args);
		if (!parsed.ok) {
			return;
		}

		// Successfully parsed - emit tool call
		const callId = buf.id || generateCallId();
		progress.report(new vscode.LanguageModelToolCallPart(callId, buf.name, parsed.value));

		// Mark as completed
		this._toolCallBuffers.delete(index);
		this._completedToolCallIndices.add(index);
	}

	/**
	 * Ensure API key is available, prompt if needed
	 */
	private async ensureApiKey(silent: boolean): Promise<string | undefined> {
		let apiKey = await this.secrets.get("bedrock.apiKey");

		if (!apiKey && !silent) {
			const entered = await vscode.window.showInputBox({
				title: "AWS Bedrock API Key",
				prompt: "Enter your AWS Bedrock API key (from AWS Bedrock Console)",
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

	/**
	 * Clear stored API key
	 */
	async clearApiKey(): Promise<void> {
		await this.secrets.delete("bedrock.apiKey");
		this.refresh();
		vscode.window.showInformationMessage("AWS Bedrock API key cleared");
	}

	async setApiKey(apiKey: string): Promise<void> {
		await this.secrets.store("bedrock.apiKey", apiKey);
		this.refresh();
	}
}
