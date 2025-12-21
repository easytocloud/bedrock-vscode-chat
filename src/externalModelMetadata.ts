import * as vscode from "vscode";

export interface ExternalModelMetadata {
	max_input_tokens?: number;
	max_output_tokens?: number;
	supports_function_calling?: boolean;
	supports_tool_choice?: boolean;
	supports_vision?: boolean;
	mode?: string;
}

export interface ExternalMetadataCache {
	fetchedAt: number;
	url: string;
	byModelId: Record<string, ExternalModelMetadata>;
}

function regionGroupPrefix(region: string): string | undefined {
	if (region.startsWith("us-")) {
		return "us";
	}
	if (region.startsWith("eu-")) {
		return "eu";
	}
	if (region.startsWith("ap-")) {
		return "apac";
	}
	if (region.startsWith("sa-")) {
		return "sa";
	}
	return undefined;
}

function buildCandidateKeys(modelId: string, region: string): string[] {
	const out: string[] = [modelId];

	// Common registry conventions (e.g. LiteLLM):
	// - "bedrock/<modelId>"
	// - "bedrock.<modelId>"
	out.push(`bedrock/${modelId}`);
	out.push(`bedrock.${modelId}`);

	out.push(`global.${modelId}`);
	out.push(`global.bedrock/${modelId}`);
	out.push(`global.bedrock.${modelId}`);

	const group = regionGroupPrefix(region);
	if (group) {
		out.push(`${group}.${modelId}`);
		out.push(`${group}.bedrock/${modelId}`);
		out.push(`${group}.bedrock.${modelId}`);
	}

	return out;
}

function normalizeUrl(url: string): string {
	return url.trim();
}

function isCacheFresh(cache: ExternalMetadataCache, maxAgeMs: number): boolean {
	return Date.now() - cache.fetchedAt <= maxAgeMs;
}

function readCache(memento: vscode.Memento, key: string): ExternalMetadataCache | undefined {
	const value = memento.get<ExternalMetadataCache>(key);
	if (!value || typeof value !== "object") {
		return undefined;
	}
	if (typeof value.fetchedAt !== "number" || typeof value.url !== "string" || typeof value.byModelId !== "object") {
		return undefined;
	}
	return value;
}

export async function loadExternalMetadataForModels(options: {
	memento: vscode.Memento;
	cacheKey: string;
	url: string;
	cacheHours: number;
	region: string;
	userAgent: string;
	modelIds: string[];
	logDebug: (msg: string) => void;
	logAlways: (msg: string) => void;
}): Promise<Map<string, ExternalModelMetadata>> {
	const url = normalizeUrl(options.url);
	const cacheHours = Math.max(0, options.cacheHours);
	const maxAgeMs = cacheHours * 60 * 60 * 1000;

	const cached = readCache(options.memento, options.cacheKey);
	const cachedUsable = cached && cached.url === url && (maxAgeMs === 0 ? false : isCacheFresh(cached, maxAgeMs));

	const byModelId: Record<string, ExternalModelMetadata> = cachedUsable ? cached.byModelId : {};
	const missing = options.modelIds.filter((id) => !byModelId[id]);

	if (cachedUsable && missing.length === 0) {
		return new Map(Object.entries(byModelId));
	}

	// If cache is fresh but missing a handful of models, fetch anyway (metadata correctness matters).
	options.logDebug(
		`External model metadata: fetching from ${url} (cachedUsable=${cachedUsable} missing=${missing.length}/${options.modelIds.length})`
	);

	let response: Response;
	try {
		response = await fetch(url, {
			headers: {
				"User-Agent": options.userAgent,
				Accept: "application/json",
			},
		});
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		options.logAlways(`External model metadata fetch failed: ${msg}`);
		return new Map(Object.entries(byModelId));
	}

	if (!response.ok) {
		options.logAlways(
			`External model metadata fetch failed: ${response.status} ${response.statusText} (url=${url})`
		);
		return new Map(Object.entries(byModelId));
	}

	let json: unknown;
	try {
		json = (await response.json()) as unknown;
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		options.logAlways(`External model metadata JSON parse failed: ${msg}`);
		return new Map(Object.entries(byModelId));
	}

	if (!json || typeof json !== "object") {
		options.logAlways("External model metadata JSON shape unexpected (expected object)");
		return new Map(Object.entries(byModelId));
	}

	const full = json as Record<string, any>;
	for (const modelId of options.modelIds) {
		const candidates = buildCandidateKeys(modelId, options.region);
		let picked: any | undefined;
		for (const key of candidates) {
			picked = full[key];
			if (picked && typeof picked === "object") {
				break;
			}
			picked = undefined;
		}

		if (!picked) {
			continue;
		}

		const meta: ExternalModelMetadata = {
			max_input_tokens: typeof picked.max_input_tokens === "number" ? picked.max_input_tokens : undefined,
			max_output_tokens: typeof picked.max_output_tokens === "number" ? picked.max_output_tokens : undefined,
			supports_function_calling:
				typeof picked.supports_function_calling === "boolean" ? picked.supports_function_calling : undefined,
			supports_tool_choice:
				typeof picked.supports_tool_choice === "boolean" ? picked.supports_tool_choice : undefined,
			supports_vision: typeof picked.supports_vision === "boolean" ? picked.supports_vision : undefined,
			mode: typeof picked.mode === "string" ? picked.mode : undefined,
		};

		// Only store if it contains something useful.
		if (
			meta.max_input_tokens ||
			meta.max_output_tokens ||
			meta.supports_function_calling !== undefined ||
			meta.supports_tool_choice !== undefined ||
			meta.supports_vision !== undefined
		) {
			byModelId[modelId] = meta;
		}
	}

	await options.memento.update(options.cacheKey, {
		fetchedAt: Date.now(),
		url,
		byModelId,
	} satisfies ExternalMetadataCache);

	options.logDebug(
		`External model metadata: cached ${Object.keys(byModelId).length}/${options.modelIds.length} entries`
	);

	return new Map(Object.entries(byModelId));
}
