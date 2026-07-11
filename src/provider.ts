/**
 * AWS Bedrock Native Language Model Provider
 * Implements VSCode's LanguageModelChatProvider using AWS Bedrock's native
 * Converse API (bedrock-runtime, via @aws-sdk/client-bedrock-runtime).
 *
 * This is a separate AWS Bedrock endpoint from Mantle (see MantleProvider in
 * mantleProvider.ts) — broader region coverage, AWS-credential-only auth, and
 * full Anthropic Claude support (Claude is not available through Mantle's Chat
 * Completions API on any Bedrock endpoint).
 */

import * as vscode from "vscode";
import type { ParsedModelInfo } from "./types";
import { converseOnce, listNativeBedrockModels } from "./bedrockNative";
import { loadExternalMetadataForModels, type ExternalModelMetadata } from "./externalModelMetadata";
import { isMantleServedModelId, validateRequest } from "./utils";

export class NativeBedrockProvider implements vscode.LanguageModelChatProvider {
	private readonly _onDidChangeLanguageModelChatInformation = new vscode.EventEmitter<void>();
	readonly onDidChangeLanguageModelChatInformation = this._onDidChangeLanguageModelChatInformation.event;

	private _models: ParsedModelInfo[] | null = null;
	private _nativeToolSupport = new Map<string, boolean>();
	private _externalMetaByModelId: Map<string, ExternalModelMetadata> | null = null;
	private _externalMetaLoadedAt = 0;

	constructor(
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
		// Vision support comes from Bedrock's own ListFoundationModels input modalities
		// (authoritative), so external metadata's vision flag is intentionally not applied here.
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

	private shouldEnablePromptCaching(): boolean {
		return this.config.get<boolean>("enablePromptCaching", true);
	}

	private shouldAssumeLongContextClaudeModels(): boolean {
		return this.config.get<boolean>("assumeLongContextClaudeModels", true);
	}

	private shouldHideMantleModelsFromNative(): boolean {
		return this.config.get<boolean>("hideMantleModelsFromNative", false);
	}

	private isNativeEnabled(): boolean {
		return this.config.get<boolean>("enableNative", true);
	}

	private awsProfile(): string | undefined {
		const profile = this.config.get<string>("awsProfile", "");
		return profile?.trim() ? profile.trim() : undefined;
	}

	private region(): string {
		return this.config.get<string>("region", "us-east-1");
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

	/**
	 * Provide available language models (called by VS Code for both initial discovery
	 * and subsequent refreshes; there is no separate "prepare" hook in the current API).
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
		_token: vscode.CancellationToken
	): Promise<vscode.LanguageModelChatInformation[]> {
		this.logDebug(`native provideLanguageModelChatInformation called, silent: ${options.silent}`);

		if (!this.isNativeEnabled()) {
			this._models = [];
			return [];
		}

		const region = this.region();
		const showAllModels = this.config.get<boolean>("showAllModels", true);

		let nativeModels: ParsedModelInfo[] = [];
		try {
			this.logDebug(`Listing native Bedrock models in ${region} (profile=${this.awsProfile() ?? "default"})`);
			nativeModels = await listNativeBedrockModels({
				region,
				awsProfile: this.awsProfile(),
				userAgent: this.userAgent,
				showAllModels,
				assumeLongContextClaudeModels: this.shouldAssumeLongContextClaudeModels(),
				globalState: this.globalState,
				log: (m) => this.logDebug(m),
			});
			// Apply cached tool support probing results.
			for (const m of nativeModels) {
				const override = this._nativeToolSupport.get(m.id);
				if (typeof override === "boolean") {
					m.capabilities.supportsToolCalling = override;
				}
			}
			if (this.shouldHideMantleModelsFromNative()) {
				nativeModels = nativeModels.filter((m) => !isMantleServedModelId(m.modelId));
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.logAlways(
				`native model discovery failed (region=${region} profile=${this.awsProfile() ?? "default"}): ${message}`
			);
			this.logAlways(
				"native model discovery requires valid AWS credentials with bedrock:ListFoundationModels. If using SSO, run `aws sso login` and ensure your profile is configured correctly."
			);
			if (!options.silent) {
				vscode.window.showErrorMessage(`Failed to list native Bedrock models (AWS credentials needed): ${message}`);
			}
		}

		try {
			await this.ensureExternalMetadataLoaded(
				nativeModels.map((m) => m.modelId),
				region
			);
			for (const m of nativeModels) {
				const meta = this._externalMetaByModelId?.get(m.modelId);
				this.applyExternalMetadata(m, meta);
			}
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			this.logAlways(`External model metadata load/apply failed: ${msg}`);
		}

		// Apply runtime-probed tool support overrides last.
		for (const m of nativeModels) {
			const override = this._nativeToolSupport.get(m.id);
			if (typeof override === "boolean") {
				m.capabilities.supportsToolCalling = override;
			}
		}

		this._models = nativeModels;
		const models = this._models.map((m) => this.toLanguageModelChatInformation(m));
		this.logAlways(`Returning ${models.length} native Bedrock models to VSCode`);
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
				name: `${model.displayName} (Bedrock)`,
				family: "aws-bedrock",
				version: "1.0.0",
				tooltip: "AWS Bedrock (native Converse API)",
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
			name: `${model.displayName} (Bedrock)`,
			family: "aws-bedrock",
			version: "1.0.0",
			tooltip: "AWS Bedrock (native Converse API)",
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
	 * Report a Converse response's text and tool calls to VS Code. If the model
	 * only returned reasoning content (no text, no tool calls — possible if thinking is
	 * ever returned by account/model defaults even though we never request it, since VS
	 * Code's stable chat provider API has no part type to surface it properly), emit a
	 * lightweight placeholder so the turn doesn't look like an empty/stuck response.
	 */
	private reportResponse(
		resp: { text: string; toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }>; reasoning?: string },
		progress: vscode.Progress<vscode.LanguageModelResponsePart>
	): void {
		if (resp.text) {
			progress.report(new vscode.LanguageModelTextPart(resp.text));
		}
		for (const toolUse of resp.toolUses) {
			progress.report(new vscode.LanguageModelToolCallPart(toolUse.id, toolUse.name, toolUse.input));
		}
		if (!resp.text && resp.toolUses.length === 0 && resp.reasoning && this.shouldEmitPlaceholders()) {
			progress.report(new vscode.LanguageModelTextPart("Thinking…"));
		}
	}

	/**
	 * Provide chat response with streaming support
	 */
	async provideLanguageModelChatResponse(
		model: vscode.LanguageModelChatInformation,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		_token: vscode.CancellationToken
	): Promise<void> {
		const parsed = this._models?.find((m) => m.id === model.id);
		const region = this.region();
		const temperature = options.modelOptions?.temperature as number | undefined;
		const maxTokens = options.modelOptions?.max_tokens as number | undefined;
		const toolsToSend = this.shouldSendTools() ? options.tools : undefined;

		const validation = validateRequest(messages);
		if (!validation.valid) {
			this.logAlways(`native bedrock request invalid: ${validation.error ?? "unknown error"}`);
			throw new Error(`Invalid request: ${validation.error}`);
		}

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
				requiresInferenceProfile: parsed?.requiresInferenceProfile,
				enablePromptCaching: this.shouldEnablePromptCaching(),
				messages,
				tools: toolsToSend,
				temperature,
				maxTokens,
				globalState: this.globalState,
				log: (m) => this.logAlways(m),
			});

			this.reportResponse(resp, progress);

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
			const looksMissingToolResults = /toolresult blocks|expected toolresult/i.test(message);
			if (looksMissingToolResults) {
				this.logAlways(`native bedrock request missing tool results for ${model.id}: ${message}`);
				throw error instanceof Error ? error : new Error(message);
			}
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
					requiresInferenceProfile: parsed?.requiresInferenceProfile,
					enablePromptCaching: this.shouldEnablePromptCaching(),
					messages,
					tools: undefined,
					temperature,
					maxTokens,
					globalState: this.globalState,
					log: (m) => this.logAlways(m),
				});
				this.reportResponse(resp, progress);
				return;
			}

			this.logAlways(`native bedrock error: ${message}`);
			throw error instanceof Error ? error : new Error(message);
		}
	}

	/**
	 * Provide token count estimation
	 */
	async provideTokenCount(
		_model: vscode.LanguageModelChatInformation,
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
}
