import type { CachePointBlock } from "@aws-sdk/client-bedrock-runtime";

export type PromptCacheTtl = "5m" | "1h";

/**
 * Models that accept the extended 1-hour cache TTL on Amazon Bedrock: Claude 4.5 and newer.
 * Older Claude and Amazon Nova only support the default 5-minute cache. A maintained pattern list
 * (like LONG_CONTEXT_CLAUDE_MODELS); a model that rejects the TTL anyway is retried with the default.
 */
export function supportsExtendedCacheTtl(modelId: string): boolean {
	return /claude-(opus|sonnet|haiku)-(4-[5-9]|[5-9])|claude-(fable|mythos)-\d/i.test(modelId);
}

/** The TTL to actually send: "1h" only when requested and supported, otherwise the 5m default. */
export function effectiveCacheTtl(requested: PromptCacheTtl | undefined, modelId: string): PromptCacheTtl {
	return requested === "1h" && supportsExtendedCacheTtl(modelId) ? "1h" : "5m";
}

/** A cache checkpoint; the TTL field is omitted for the default 5m so that request shape is unchanged. */
export function buildCachePoint(ttl: PromptCacheTtl): { cachePoint: CachePointBlock } {
	return { cachePoint: ttl === "1h" ? { type: "default", ttl: "1h" } : { type: "default" } };
}

/** True when Bedrock rejected the request because of the cache TTL. */
export function looksLikeCacheTtlRejection(err: unknown): boolean {
	const message = err instanceof Error ? err.message : String(err);
	return /\bttl\b|cache[_ ]?point|cache_control/i.test(message);
}
