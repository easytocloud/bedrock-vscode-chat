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
}): Promise<InferenceProfileResolution | undefined> {
	const key = inferenceProfileCacheKey(options.region, options.awsProfile, options.modelId);

	if (!options.forceRefresh && options.globalState) {
		const cached = options.globalState.get<CachedInferenceProfile | undefined>(key);
		if (cached?.identifier) {
			// Keep cache fairly long-lived; if it stops working we’ll refresh on error.
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
		const resp = await client.send(
			new ListInferenceProfilesCommand({
				maxResults: 100,
				nextToken,
			})
		);
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

export async function listNativeBedrockModels(options: {
	region: string;
	awsProfile: string | undefined;
	userAgent: string;
	showAllModels: boolean;
}): Promise<ParsedModelInfo[]> {
	const credentials = getCredentials(options.awsProfile);
	const client = new BedrockClient({
		region: options.region,
		credentials,
		customUserAgent: buildUserAgentFragment(options.userAgent),
	});

	const resp = await client.send(new ListFoundationModelsCommand({}));
	const summaries = resp.modelSummaries ?? [];

	const models: ParsedModelInfo[] = summaries
		.filter((m) => {
			if (options.showAllModels) {
				return true;
			}
			// When not showing all, hide obvious embeddings/safeguards and non-text outputs.
			const id = (m.modelId ?? "").toLowerCase();
			if (!id) {
				return false;
			}
			if (id.includes("embed") || id.includes("embedding") || id.includes("guard") || id.includes("safeguard")) {
				return false;
			}
			return true;
		})
		.map((m) => {
			const rawModelId = m.modelId ?? "unknown";
			const provider = (m.providerName ?? rawModelId.split(".")[0] ?? "unknown").toString();
			const modelName = (m.modelName ?? rawModelId).toString();

			const supportsVision = (m.inputModalities ?? []).some((mod) => mod.toString().toUpperCase() === "IMAGE");

			// Tool support is not surfaced reliably by ListFoundationModels.
			// Default to true so VS Code will surface these models and provide tool definitions.
			// Runtime probing in the provider will cache the truth per-model.
			const supportsToolCalling = true;

			const displayName = `${provider} ${modelName}`.replace(/\s+/g, " ").trim();

			return {
				id: `bedrock:${rawModelId}`,
				modelId: rawModelId,
				backend: "bedrock",
				provider,
				modelName,
				displayName,
				// Bedrock's model summary doesn't currently provide token limits.
				// Use conservative defaults to keep VS Code happy.
				contextLength: 32000,
				maxOutputTokens: 4096,
				capabilities: {
					supportsToolCalling,
					supportsVision,
					isCodeSpecialized: false,
					isThinking: false,
				},
			};
		});

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

function convertVscodeMessagesToBedrock(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	options: { allowToolBlocks: boolean }
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
	tools: readonly vscode.LanguageModelChatTool[] | undefined
): ToolConfiguration | undefined {
	if (!tools || tools.length === 0) {
		return undefined;
	}

	const convertedTools = tools
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

	return { tools: convertedTools };
}

export async function converseOnce(options: {
	region: string;
	awsProfile: string | undefined;
	userAgent: string;
	modelId: string;
	messages: readonly vscode.LanguageModelChatRequestMessage[];
	tools: readonly vscode.LanguageModelChatTool[] | undefined;
	temperature?: number;
	maxTokens?: number;
	globalState?: vscode.Memento;
	log?: (message: string) => void;
}): Promise<{ text: string; toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }> }> {
	const credentials = getCredentials(options.awsProfile);
	const runtime = new BedrockRuntimeClient({
		region: options.region,
		credentials,
		customUserAgent: buildUserAgentFragment(options.userAgent),
	});

	const toolConfig = convertVscodeToolsToBedrockToolConfig(options.tools);
	const converted = convertVscodeMessagesToBedrock(options.messages, { allowToolBlocks: !!toolConfig });

	const sendConverse = async (modelId: string) => {
		return runtime.send(
			new ConverseCommand({
				modelId,
				system: converted.system,
				messages: converted.messages,
				toolConfig,
				inferenceConfig: {
					temperature: options.temperature,
					maxTokens: options.maxTokens,
				},
			})
		);
	};

	let resp: Awaited<ReturnType<typeof sendConverse>>;
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
		});
		if (!resolution) {
			throw err;
		}

		try {
			resp = await sendConverse(resolution.identifier);
		} catch (retryErr) {
			// If we used a cached identifier and it failed, refresh once and retry.
			if (resolution.source === "cache" && options.globalState) {
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
				});
				if (refreshed) {
					resp = await sendConverse(refreshed.identifier);
				} else {
					throw retryErr;
				}
			} else {
				throw retryErr;
			}
		}
	}

	const content = resp.output?.message?.content ?? [];
	let text = "";
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
		}
	}

	return { text, toolUses };
}
