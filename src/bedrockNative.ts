import * as vscode from "vscode";
import { BedrockClient, ListFoundationModelsCommand, ListInferenceProfilesCommand } from "@aws-sdk/client-bedrock";
import {
	BedrockRuntimeClient,
	ConverseCommand,
	type ContentBlock,
	type Message,
	type ToolConfiguration,
} from "@aws-sdk/client-bedrock-runtime";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { fromIni } from "@aws-sdk/credential-provider-ini";
import type { ParsedModelInfo } from "./types";
import { createRequestTimeoutGuard, disambiguateDisplayNames, inferModelCapabilities, inferTokenLimits, isHiddenWhenNotShowAll } from "./utils";

function getCredentials(profile: string | undefined) {
	const trimmed = (profile ?? "").trim();
	return trimmed ? fromIni({ profile: trimmed }) : defaultProvider();
}

function buildUserAgentFragment(userAgent: string): string {
	// AWS SDK expects customUserAgent to be a short string fragment.
	// Keep it reasonably small.
	return userAgent.slice(0, 80);
}

type InferenceProfileResolution = {
	identifier: string;
	source: "cache" | "lookup";
};

type CachedInferenceProfile = {
	identifier: string;
	modelId: string;
	region: string;
	awsProfile?: string;
	inferenceProfileArn?: string;
	inferenceProfileId?: string;
	inferenceProfileName?: string;
	cachedAt: number;
};

function looksLikeInferenceProfileRequiredError(err: unknown): boolean {
	const msg = err instanceof Error ? err.message : String(err);
	return (
		/on-demand throughput.*isn'?t supported/i.test(msg) ||
		/retry your request with the id or arn of an inference profile/i.test(msg) ||
		/\binference profile\b/i.test(msg)
	);
}

function inferenceProfileCacheKey(region: string, awsProfile: string | undefined, modelId: string): string {
	const profileKey = (awsProfile ?? "default").trim() || "default";
	return `aws-bedrock.inferenceProfileForModel.v1:${region}:${profileKey}:${modelId}`;
}

function profileMatchesModel(profile: any, modelId: string): boolean {
	const models: any[] = Array.isArray(profile?.models) ? profile.models : [];
	for (const m of models) {
		const arn = m?.modelArn;
		if (typeof arn === "string" && arn.includes(modelId)) {
			return true;
		}
	}
	return false;
}

function scoreInferenceProfile(profile: any): number {
	// Prefer ACTIVE, then SYSTEM_DEFINED over APPLICATION.
	const status = (profile?.status ?? "").toString().toUpperCase();
	const type = (profile?.type ?? "").toString().toUpperCase();
	let score = 0;
	if (status === "ACTIVE") score += 100;
	if (type === "SYSTEM_DEFINED") score += 10;
	if (type === "APPLICATION") score += 5;
	return score;
}

async function resolveInferenceProfileIdentifierForModel(options: {
	region: string;
	awsProfile: string | undefined;
	userAgent: string;
	modelId: string;
	globalState?: vscode.Memento;
	log?: (message: string) => void;
	forceRefresh?: boolean;
	requestTimeoutMs?: number;
}): Promise<InferenceProfileResolution | undefined> {
	const key = inferenceProfileCacheKey(options.region, options.awsProfile, options.modelId);

	if (!options.forceRefresh && options.globalState) {
		const cached = options.globalState.get<CachedInferenceProfile | undefined>(key);
		if (cached?.identifier) {
			// Keep cache fairly long-lived; if it stops working we'll refresh on error.
			const ageMs = Date.now() - (cached.cachedAt ?? 0);
			if (ageMs >= 0 && ageMs < 7 * 24 * 60 * 60 * 1000) {
				return { identifier: cached.identifier, source: "cache" };
			}
		}
	}

	const credentials = getCredentials(options.awsProfile);
	const client = new BedrockClient({
		region: options.region,
		credentials,
		customUserAgent: buildUserAgentFragment(options.userAgent),
	});

	let nextToken: string | undefined;
	let best: any | undefined;
	let bestScore = -1;

	do {
		const guard = createRequestTimeoutGuard(options.requestTimeoutMs ?? 0);
		let resp;
		try {
			resp = await client.send(
				new ListInferenceProfilesCommand({
					maxResults: 100,
					nextToken,
				}),
				{ abortSignal: guard.controller.signal }
			);
		} finally {
			guard.dispose();
		}
		const profiles: any[] = Array.isArray((resp as any)?.inferenceProfileSummaries)
			? ((resp as any).inferenceProfileSummaries as any[])
			: [];

		for (const p of profiles) {
			if (!profileMatchesModel(p, options.modelId)) {
				continue;
			}
			const score = scoreInferenceProfile(p);
			if (score > bestScore) {
				best = p;
				bestScore = score;
			}
		}

		nextToken = (resp as any)?.nextToken;
	} while (nextToken);

	const identifier: string | undefined =
		(typeof best?.inferenceProfileArn === "string" && best.inferenceProfileArn) ||
		(typeof best?.inferenceProfileId === "string" && best.inferenceProfileId) ||
		undefined;

	if (!identifier) {
		options.log?.(
			`No inference profile found that contains model ${options.modelId} (region=${options.region}, profile=${options.awsProfile ?? "default"})`
		);
		return undefined;
	}

	options.log?.(
		`Resolved inference profile for ${options.modelId}: ${identifier} (name=${best?.inferenceProfileName ?? "?"}, type=${best?.type ?? "?"}, status=${best?.status ?? "?"})`
	);

	if (options.globalState) {
		const value: CachedInferenceProfile = {
			identifier,
			modelId: options.modelId,
			region: options.region,
			awsProfile: options.awsProfile,
			inferenceProfileArn: best?.inferenceProfileArn,
			inferenceProfileId: best?.inferenceProfileId,
			inferenceProfileName: best?.inferenceProfileName,
			cachedAt: Date.now(),
		};
		await options.globalState.update(key, value);
	}

	return { identifier, source: "lookup" };
}

function extractModelIdFromArn(arn: string): string | undefined {
	// Typical shape: arn:aws:bedrock:<region>::foundation-model/<modelId>
	const marker = "foundation-model/";
	const idx = arn.indexOf(marker);
	return idx === -1 ? undefined : arn.slice(idx + marker.length);
}

/**
 * Lists every inference profile once and returns, for each model ID contained in any
 * profile, the best-scoring profile identifier. Used at model-discovery time so we know
 * upfront which models require an inference profile instead of discovering it via a
 * failed on-demand Converse call on the user's first message with that model.
 */
async function listInferenceProfileModelMap(options: {
	region: string;
	awsProfile: string | undefined;
	userAgent: string;
	requestTimeoutMs?: number;
}): Promise<Map<string, { identifier: string; name?: string }>> {
	const credentials = getCredentials(options.awsProfile);
	const client = new BedrockClient({
		region: options.region,
		credentials,
		customUserAgent: buildUserAgentFragment(options.userAgent),
	});

	const best = new Map<string, { identifier: string; name?: string; score: number }>();
	let nextToken: string | undefined;

	do {
		const guard = createRequestTimeoutGuard(options.requestTimeoutMs ?? 0);
		let resp;
		try {
			resp = await client.send(
				new ListInferenceProfilesCommand({
					maxResults: 100,
					nextToken,
				}),
				{ abortSignal: guard.controller.signal }
			);
		} finally {
			guard.dispose();
		}
		const profiles: any[] = Array.isArray((resp as any)?.inferenceProfileSummaries)
			? ((resp as any).inferenceProfileSummaries as any[])
			: [];

		for (const p of profiles) {
			const identifier: string | undefined =
				(typeof p?.inferenceProfileArn === "string" && p.inferenceProfileArn) ||
				(typeof p?.inferenceProfileId === "string" && p.inferenceProfileId) ||
				undefined;
			if (!identifier) {
				continue;
			}
			const score = scoreInferenceProfile(p);
			const profileModels: any[] = Array.isArray(p?.models) ? p.models : [];
			for (const pm of profileModels) {
				const modelId = typeof pm?.modelArn === "string" ? extractModelIdFromArn(pm.modelArn) : undefined;
				if (!modelId) {
					continue;
				}
				const existing = best.get(modelId);
				if (!existing || score > existing.score) {
					best.set(modelId, { identifier, name: p?.inferenceProfileName, score });
				}
			}
		}

		nextToken = (resp as any)?.nextToken;
	} while (nextToken);

	const out = new Map<string, { identifier: string; name?: string }>();
	for (const [modelId, v] of best) {
		out.set(modelId, { identifier: v.identifier, name: v.name });
	}
	return out;
}

export async function listNativeBedrockModels(options: {
	region: string;
	awsProfile: string | undefined;
	userAgent: string;
	showAllModels: boolean;
	assumeLongContextClaudeModels?: boolean;
	globalState?: vscode.Memento;
	log?: (message: string) => void;
	requestTimeoutMs?: number;
}): Promise<ParsedModelInfo[]> {
	const credentials = getCredentials(options.awsProfile);
	const client = new BedrockClient({
		region: options.region,
		credentials,
		customUserAgent: buildUserAgentFragment(options.userAgent),
	});

	const listGuard = createRequestTimeoutGuard(options.requestTimeoutMs ?? 0);
	let resp;
	let profileMap: Map<string, { identifier: string; name?: string }>;
	try {
		[resp, profileMap] = await Promise.all([
			client.send(new ListFoundationModelsCommand({}), { abortSignal: listGuard.controller.signal }),
			listInferenceProfileModelMap({
				region: options.region,
				awsProfile: options.awsProfile,
				userAgent: options.userAgent,
				requestTimeoutMs: options.requestTimeoutMs,
			}).catch((e) => {
				options.log?.(
					`Failed to list inference profiles during model discovery (will fall back to reactive resolution): ${e instanceof Error ? e.message : String(e)}`
				);
				return new Map<string, { identifier: string; name?: string }>();
			}),
		]);
	} finally {
		listGuard.dispose();
	}
	const summaries = resp.modelSummaries ?? [];

	const models: ParsedModelInfo[] = summaries
		.filter((m) => {
			// Always exclude non-active models (LEGACY, etc.). ACTIVE means currently available.
			const lifecycleStatus = (m.modelLifecycle?.status ?? "").toString().toUpperCase();
			if (lifecycleStatus !== "ACTIVE") {
				return false;
			}

			if (options.showAllModels) {
				return true;
			}
			// When not showing all, hide obvious embeddings/safeguards and non-text outputs.
			const id = m.modelId ?? "";
			if (!id) {
				return false;
			}
			if (isHiddenWhenNotShowAll(id)) {
				return false;
			}
			return true;
		})
		.map((m) => {
			const rawModelId = m.modelId ?? "unknown";
			const provider = (m.providerName ?? rawModelId.split(".")[0] ?? "unknown").toString();
			const modelName = (m.modelName ?? rawModelId).toString();

			// Vision support from AWS API (authoritative)
			const supportsVision = (m.inputModalities ?? []).some((mod) => mod.toString().toUpperCase() === "IMAGE");

			const displayName = `${provider} ${modelName}`.replace(/\s+/g, " ").trim();

			// Infer capabilities from model ID patterns
			// Tool support is not in ListFoundationModels API, so we use heuristics.
			// Runtime probing in the provider will cache the actual truth per-model.
			const inferredCaps = inferModelCapabilities(rawModelId);
			const { contextLength, maxOutputTokens } = inferTokenLimits(rawModelId, {
				assumeLongContextClaudeModels: options.assumeLongContextClaudeModels,
			});

			// If discovery found an inference profile containing this model, prewarm the
			// resolution cache so the first Converse call for it doesn't have to fail an
			// on-demand attempt before falling back — see converseOnce()'s
			// requiresInferenceProfile fast path.
			const profileMatch = profileMap.get(rawModelId);
			if (profileMatch && options.globalState) {
				const key = inferenceProfileCacheKey(options.region, options.awsProfile, rawModelId);
				const value: CachedInferenceProfile = {
					identifier: profileMatch.identifier,
					modelId: rawModelId,
					region: options.region,
					awsProfile: options.awsProfile,
					inferenceProfileName: profileMatch.name,
					cachedAt: Date.now(),
				};
				void options.globalState.update(key, value);
			}

			return {
				id: `bedrock:${rawModelId}`,
				modelId: rawModelId,
				backend: "bedrock",
				provider,
				modelName,
				displayName,
				// Token limits from inference (will be overridden by external metadata if available)
				contextLength,
				maxOutputTokens,
				capabilities: {
					// Use inferred tool support, but prefer AWS API vision data
					supportsToolCalling: inferredCaps.supportsToolCalling,
					supportsVision, // From AWS API
					isCodeSpecialized: inferredCaps.isCodeSpecialized,
					isThinking: inferredCaps.isThinking,
				},
				requiresInferenceProfile: !!profileMatch,
			};
		});

	// Disambiguate any models that formatted to the same display name (e.g. distinct
	// catalog entries whose IDs differ only in a part formatDisplayName doesn't surface)
	// before sorting, so the sort order reflects what's actually shown.
	disambiguateDisplayNames(models);

	// Stable ordering for the picker.
	models.sort((a, b) => a.displayName.localeCompare(b.displayName));
	return models;
}

function mimeToBedrockImageFormat(mime: string): "png" | "jpeg" {
	const m = mime.toLowerCase();
	if (m.includes("png")) {
		return "png";
	}
	return "jpeg";
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

function convertVscodeMessagesToBedrock(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	options: { allowToolBlocks: boolean; includeCachePoint: boolean }
): { system: undefined; messages: Message[] } {
	const outMessages: Message[] = [];

	const pushTextIfNonEmpty = (blocks: ContentBlock[], text: string) => {
		// Bedrock Converse rejects empty text blocks.
		if (text.trim().length === 0) {
			return;
		}
		blocks.push({ text });
	};

	for (const msg of messages) {
		const role: "user" | "assistant" =
			msg.role === vscode.LanguageModelChatMessageRole.Assistant ? "assistant" : "user";

		const blocks: ContentBlock[] = [];

		for (const part of msg.content) {
			if (part instanceof vscode.LanguageModelTextPart) {
				pushTextIfNonEmpty(blocks, part.value);
			} else if (part instanceof vscode.LanguageModelDataPart) {
				const mime = part.mimeType ?? "";
				if (mime.toLowerCase().startsWith("image/")) {
					blocks.push({
						image: {
							format: mimeToBedrockImageFormat(mime),
							source: { bytes: part.data },
						},
					});
				} else if (mime.toLowerCase().includes("json")) {
					// Best-effort: treat arbitrary data as text if we can't map it.
					pushTextIfNonEmpty(blocks, Buffer.from(part.data).toString("utf8"));
				} else {
					pushTextIfNonEmpty(blocks, Buffer.from(part.data).toString("utf8"));
				}
			} else if (part instanceof vscode.LanguageModelToolCallPart) {
				if (options.allowToolBlocks) {
					blocks.push({
						toolUse: {
							toolUseId: part.callId,
							name: part.name,
							input: part.input as any,
						},
					});
				} else {
					pushTextIfNonEmpty(
						blocks,
						`[tool call skipped: ${part.name} ${safeStringify(part.input)}]`
					);
				}
			} else if (part instanceof vscode.LanguageModelToolResultPart) {
				const resultText = part.content
					.map((c) => {
						if (c instanceof vscode.LanguageModelTextPart) {
							return c.value;
						}
						if (c instanceof vscode.LanguageModelDataPart) {
							return Buffer.from(c.data).toString("utf8");
						}
						return "";
					})
					.join("");

				const safeResultText = resultText.trim().length > 0 ? resultText : "(tool returned no output)";
				if (options.allowToolBlocks) {
					blocks.push({
						toolResult: {
							toolUseId: part.callId,
							content: [{ text: safeResultText }],
							status: "success",
						},
					});
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

	// Mark a cache checkpoint at the end of the second-to-last message, i.e. everything
	// except the newest turn. That prefix is identical to what was sent last turn, so on
	// each subsequent request Bedrock can reuse the cached prefix instead of reprocessing
	// the whole (ever-growing) conversation history. Below Anthropic's per-model minimum
	// token count this is simply a no-op, not an error, so it's safe to always attempt.
	if (options.includeCachePoint && outMessages.length >= 2) {
		const target = outMessages[outMessages.length - 2];
		target.content = [...(target.content ?? []), { cachePoint: { type: "default" } }];
	}

	return {
		system: undefined,
		messages: outMessages,
	};
}

function safeStringify(value: unknown): string {
	try {
		const s = JSON.stringify(value);
		return s.length > 500 ? `${s.slice(0, 500)}…(truncated)` : s;
	} catch {
		return "<unserializable>";
	}
}

export function convertVscodeToolsToBedrockToolConfig(
	tools: readonly vscode.LanguageModelChatTool[] | undefined,
	options: { includeCachePoint: boolean } = { includeCachePoint: false }
): ToolConfiguration | undefined {
	if (!tools || tools.length === 0) {
		return undefined;
	}

	const convertedTools: ToolConfiguration["tools"] = tools
		.filter((t) => t.name) // Filter out tools without names
		.map((t) => {
			// Bedrock requires a non-empty inputSchema. Provide a minimal valid schema if missing.
			let schema = t.inputSchema as Record<string, unknown> | undefined;
			if (!schema || typeof schema !== "object" || Object.keys(schema).length === 0) {
				schema = { type: "object", properties: {}, required: [] };
			}
			return {
				toolSpec: {
					name: t.name,
					description: t.description || `Tool: ${t.name}`,
					inputSchema: {
						json: schema as any,
					},
				},
			};
		});

	if (convertedTools.length === 0) {
		return undefined;
	}

	// Tool definitions are re-sent verbatim on every single turn and can be large
	// (see safeStringify's truncation for logging). Caching them avoids reprocessing
	// the same schema blob on every request for models that support prompt caching.
	if (options.includeCachePoint) {
		convertedTools.push({ cachePoint: { type: "default" } });
	}

	return { tools: convertedTools };
}

export async function converseOnce(options: {
	region: string;
	awsProfile: string | undefined;
	userAgent: string;
	modelId: string;
	/**
	 * Set when model discovery already determined (via ListInferenceProfiles) that this
	 * model is only reachable through a cross-region inference profile. Skips the doomed
	 * on-demand attempt and resolves the profile directly (typically served from the cache
	 * discovery prewarmed) instead of learning this reactively from a failed request.
	 */
	requiresInferenceProfile?: boolean;
	/** Whether to insert Bedrock prompt-cache checkpoints. Ignored for model families that don't support it. */
	enablePromptCaching?: boolean;
	messages: readonly vscode.LanguageModelChatRequestMessage[];
	tools: readonly vscode.LanguageModelChatTool[] | undefined;
	temperature?: number;
	maxTokens?: number;
	globalState?: vscode.Memento;
	log?: (message: string) => void;
	/** Converse is non-streaming, so this covers the whole call, not just time-to-first-byte. */
	requestTimeoutMs?: number;
}): Promise<{
	text: string;
	toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }>;
	reasoning?: string;
}> {
	const credentials = getCredentials(options.awsProfile);
	const runtime = new BedrockRuntimeClient({
		region: options.region,
		credentials,
		customUserAgent: buildUserAgentFragment(options.userAgent),
	});

	// Prompt caching (cachePoint) is only supported by Anthropic Claude and Amazon Nova
	// models on Bedrock today; other families (Llama, Mistral, DeepSeek, Qwen, ...) reject
	// the field. Gate on the model family rather than sending it unconditionally.
	const modelFamilySupportsCaching = /anthropic\.claude|amazon\.nova/i.test(options.modelId);
	const includeCachePoint = (options.enablePromptCaching ?? true) && modelFamilySupportsCaching;

	const toolConfig = convertVscodeToolsToBedrockToolConfig(options.tools, { includeCachePoint });
	// IMPORTANT: Always preserve tool history (toolUse/toolResult blocks) from message history,
	// even if the current request doesn't include tools. Bedrock API requires that if a previous
	// toolUse block exists in the history, its corresponding toolResult block must also be present.
	// Stripping tool results would cause validation errors like:
	// "Expected toolResult blocks at messages.43.content for the following Ids: ..."
	const hasTools = !!toolConfig || hasToolHistory(options.messages);
	const converted = convertVscodeMessagesToBedrock(options.messages, { allowToolBlocks: hasTools, includeCachePoint });

	const sendConverse = async (modelId: string) => {
		const guard = createRequestTimeoutGuard(options.requestTimeoutMs ?? 0);
		try {
			return await runtime.send(
				new ConverseCommand({
					modelId,
					system: converted.system,
					messages: converted.messages,
					toolConfig,
					inferenceConfig: {
						temperature: options.temperature,
						maxTokens: options.maxTokens,
					},
				}),
				{ abortSignal: guard.controller.signal }
			);
		} finally {
			guard.dispose();
		}
	};

	if (hasTools) {
		const toolsInRequest = options.tools?.length ?? 0;
		const historyHasTools = hasToolHistory(options.messages);
		options.log?.(
			`converseOnce: Using toolConfig (toolsInRequest=${toolsInRequest}, historyHasTools=${historyHasTools})`
		);
	}

	// Shared "use this resolved profile, and if a *cached* identifier turns out to be
	// stale, refresh once and retry" logic used by both the proactive and reactive paths.
	const sendViaResolvedProfile = async (
		resolution: InferenceProfileResolution
	): Promise<Awaited<ReturnType<typeof sendConverse>>> => {
		try {
			return await sendConverse(resolution.identifier);
		} catch (retryErr) {
			if (resolution.source !== "cache" || !options.globalState) {
				throw retryErr;
			}
			options.log?.(
				`Cached inference profile failed for ${options.modelId}; refreshing inference profile mapping and retrying once...`
			);
			const refreshed = await resolveInferenceProfileIdentifierForModel({
				region: options.region,
				awsProfile: options.awsProfile,
				userAgent: options.userAgent,
				modelId: options.modelId,
				globalState: options.globalState,
				log: options.log,
				forceRefresh: true,
				requestTimeoutMs: options.requestTimeoutMs,
			});
			if (!refreshed) {
				throw retryErr;
			}
			return sendConverse(refreshed.identifier);
		}
	};

	let resp: Awaited<ReturnType<typeof sendConverse>>;

	if (options.requiresInferenceProfile) {
		// Discovery already told us this model needs a profile — resolve it directly
		// (served from the prewarmed cache in the common case) instead of making a
		// request we already know will fail.
		const resolution = await resolveInferenceProfileIdentifierForModel({
			region: options.region,
			awsProfile: options.awsProfile,
			userAgent: options.userAgent,
			modelId: options.modelId,
			globalState: options.globalState,
			log: options.log,
			requestTimeoutMs: options.requestTimeoutMs,
		});
		resp = resolution
			? await sendViaResolvedProfile(resolution)
			: await sendConverse(options.modelId);
	} else {
		try {
			resp = await sendConverse(options.modelId);
		} catch (err) {
			if (!looksLikeInferenceProfileRequiredError(err)) {
				throw err;
			}

			options.log?.(
				`Model ${options.modelId} requires an inference profile; attempting automatic inference-profile fallback...`
			);

			const resolution = await resolveInferenceProfileIdentifierForModel({
				region: options.region,
				awsProfile: options.awsProfile,
				userAgent: options.userAgent,
				modelId: options.modelId,
				globalState: options.globalState,
				log: options.log,
				requestTimeoutMs: options.requestTimeoutMs,
			});
			if (!resolution) {
				throw err;
			}

			resp = await sendViaResolvedProfile(resolution);
		}
	}

	const content = resp.output?.message?.content ?? [];
	let text = "";
	let reasoning = "";
	const toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];

	for (const block of content) {
		if (block.text) {
			text += block.text;
		} else if (block.toolUse) {
			toolUses.push({
				id: block.toolUse.toolUseId ?? `call_${Math.random().toString(36).slice(2, 10)}`,
				name: block.toolUse.name ?? "tool",
				input: (block.toolUse.input ?? {}) as Record<string, unknown>,
			});
		} else if (block.reasoningContent) {
			// Extended-thinking output. VS Code's stable LanguageModelChatProvider API has no
			// dedicated response part for reasoning (only text/toolCall/toolResult/data), and
			// no way to round-trip a reasoning block back into a later request's history — so
			// we deliberately never *request* thinking (no additionalModelRequestFields) and
			// don't try to fake multi-turn replay of it here. We still surface it defensively:
			// if a model or account-level default ever returns reasoningContent anyway, log it
			// instead of silently discarding it, and let the caller decide whether to show a
			// placeholder when it's the only content in the response.
			const reasoningText = block.reasoningContent.reasoningText?.text;
			if (reasoningText) {
				reasoning += reasoningText;
			}
		}
	}

	if (reasoning) {
		options.log?.(`converseOnce: response included reasoningContent (${reasoning.length} chars)`);
	}

	return { text, toolUses, reasoning: reasoning || undefined };
}
