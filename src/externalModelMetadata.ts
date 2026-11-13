import * as vscode from "vscode";
import { Models, type Model } from "@opencode-ai/models";

/**
 * Model metadata from models.dev (https://models.dev), an open database of model
 * capabilities and limits, fetched through the official @opencode-ai/models client.
 * Entries come from its "amazon-bedrock" provider, which is keyed by native Amazon
 * Bedrock model IDs (including cross-region inference-profile prefixes like "us.").
 */
export interface ExternalModelMetadata {
	/** Total context window in tokens. */
	contextLength?: number;
	/** Explicit input cap, only when models.dev publishes one separate from the context window. */
	maxInputTokens?: number;
	maxOutputTokens?: number;
	toolCalling?: boolean;
	vision?: boolean;
	reasoning?: boolean;
}

export interface ExternalMetadataCache {
	fetchedAt: number;
	source: string;
	byModelId: Record<string, ExternalModelMetadata>;
}

const MODELS_DEV_PROVIDER_ID = "amazon-bedrock";
const SOURCE_ID = `models.dev/${MODELS_DEV_PROVIDER_ID}`;
const FETCH_TIMEOUT_MS = 15_000;

/** Cross-region inference-profile prefixes used in Amazon Bedrock model IDs. */
const REGION_PREFIX = /^(?:global|us-gov|us|eu|apac|jp|au|in|ca|sa)\./;

function regionGroupPrefixes(region: string): string[] {
	if (region.startsWith("us-gov-")) {
		return ["us-gov"];
	}
	if (region.startsWith("us-")) {
		return ["us"];
	}
	if (region.startsWith("eu-")) {
		return ["eu"];
	}
	if (region.startsWith("ca-")) {
		return ["ca", "us"];
	}
	if (region.startsWith("sa-")) {
		return ["sa", "us"];
	}
	if (region === "ap-northeast-1" || region === "ap-northeast-3") {
		return ["jp", "apac"];
	}
	if (region === "ap-southeast-2" || region === "ap-southeast-4") {
		return ["au", "apac"];
	}
	if (region.startsWith("ap-south-")) {
		return ["in", "apac"];
	}
	if (region.startsWith("ap-")) {
		return ["apac"];
	}
	return [];
}

/** Strip an inference-profile prefix and a ":N" / "-vN:N" / "-vN" version suffix. */
function normalizeModelId(modelId: string): string {
	return modelId
		.toLowerCase()
		.replace(REGION_PREFIX, "")
		.replace(/-v\d+(?::\d+)?$/, "")
		.replace(/-\d+:\d+$/, "")
		.replace(/:\d+$/, "");
}

function buildCandidateKeys(modelId: string, region: string): string[] {
	const base = modelId.replace(REGION_PREFIX, "");
	const out = [modelId, base];
	for (const group of regionGroupPrefixes(region)) {
		out.push(`${group}.${base}`);
	}
	out.push(`global.${base}`);
	return [...new Set(out)];
}

/** Look up metadata for a model ID: exact/prefixed keys first, then a version-insensitive match. */
export function findExternalMetadata(
	byModelId: Record<string, ExternalModelMetadata>,
	modelId: string,
	region: string
): ExternalModelMetadata | undefined {
	for (const key of buildCandidateKeys(modelId, region)) {
		if (byModelId[key]) {
			return byModelId[key];
		}
	}
	const wanted = normalizeModelId(modelId);
	let fallback: ExternalModelMetadata | undefined;
	for (const [key, meta] of Object.entries(byModelId)) {
		if (normalizeModelId(key) !== wanted) {
			continue;
		}
		// Prefer the unprefixed (in-region) entry over a cross-region one.
		if (!REGION_PREFIX.test(key)) {
			return meta;
		}
		fallback ??= meta;
	}
	return fallback;
}

export function toExternalMetadata(model: Model): ExternalModelMetadata | undefined {
	const limit = model.limit;
	const positive = (n: unknown) => (typeof n === "number" && n > 0 ? n : undefined);
	const meta: ExternalModelMetadata = {
		contextLength: positive(limit?.context),
		maxInputTokens: positive(limit?.input),
		maxOutputTokens: positive(limit?.output),
		toolCalling: typeof model.tool_call === "boolean" ? model.tool_call : undefined,
		vision: Array.isArray(model.modalities?.input) ? model.modalities.input.includes("image") : undefined,
		reasoning: typeof model.reasoning === "boolean" ? model.reasoning : undefined,
	};
	const useful = meta.contextLength || meta.maxOutputTokens || meta.toolCalling !== undefined || meta.vision !== undefined;
	return useful ? meta : undefined;
}

function readCache(memento: vscode.Memento, key: string): ExternalMetadataCache | undefined {
	const value = memento.get<ExternalMetadataCache>(key);
	if (!value || typeof value !== "object") {
		return undefined;
	}
	if (typeof value.fetchedAt !== "number" || value.source !== SOURCE_ID || typeof value.byModelId !== "object") {
		return undefined;
	}
	return value;
}

/**
 * Load the Amazon Bedrock model catalog from models.dev, using a globalState cache.
 * The whole provider catalog (a few hundred small entries) is cached rather than just
 * the requested IDs, so newly discovered models resolve without a refetch.
 * Never throws: on any failure it falls back to stale cache, or an empty map.
 */
export async function loadExternalMetadataForModels(options: {
	memento: vscode.Memento;
	cacheKey: string;
	cacheHours: number;
	region: string;
	userAgent: string;
	modelIds: string[];
	logDebug: (msg: string) => void;
	logAlways: (msg: string) => void;
}): Promise<Map<string, ExternalModelMetadata>> {
	const maxAgeMs = Math.max(0, options.cacheHours) * 60 * 60 * 1000;
	const cached = readCache(options.memento, options.cacheKey);
	const cacheFresh = !!cached && maxAgeMs > 0 && Date.now() - cached.fetchedAt <= maxAgeMs;

	let catalog = cached?.byModelId ?? {};
	if (!cacheFresh) {
		options.logDebug(`External model metadata: fetching ${SOURCE_ID} (cached=${!!cached})`);
		try {
			const client = Models.make({ headers: { "User-Agent": options.userAgent } });
			const providers = await client.providers({ signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
			const models = providers[MODELS_DEV_PROVIDER_ID]?.models;
			if (!models || typeof models !== "object") {
				throw new Error(`provider "${MODELS_DEV_PROVIDER_ID}" missing from models.dev response`);
			}
			const fresh: Record<string, ExternalModelMetadata> = {};
			for (const [id, model] of Object.entries(models)) {
				const meta = toExternalMetadata(model);
				if (meta) {
					fresh[id] = meta;
				}
			}
			catalog = fresh;
			await options.memento.update(options.cacheKey, {
				fetchedAt: Date.now(),
				source: SOURCE_ID,
				byModelId: fresh,
			} satisfies ExternalMetadataCache);
			options.logDebug(`External model metadata: cached ${Object.keys(fresh).length} models.dev entries`);
		} catch (e) {
			const inner = (e as { cause?: unknown } | undefined)?.cause;
			const cause = inner instanceof Error ? ` (${inner.message})` : "";
			const msg = e instanceof Error ? e.message : String(e);
			options.logAlways(
				`External model metadata fetch from models.dev failed: ${msg}${cause}${cached ? " — using cached copy" : ""}`
			);
		}
	}

	const out = new Map<string, ExternalModelMetadata>();
	for (const modelId of options.modelIds) {
		const meta = findExternalMetadata(catalog, modelId, options.region);
		if (meta) {
			out.set(modelId, meta);
		}
	}
	options.logDebug(`External model metadata: matched ${out.size}/${options.modelIds.length} models`);
	return out;
}
