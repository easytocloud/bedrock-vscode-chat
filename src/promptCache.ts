import type { CachePointBlock } from "@aws-sdk/client-bedrock-runtime";
import { supportsExtendedCacheTtl } from "./claudeModels";

export type PromptCacheTtl = "5m" | "1h";

// Which models accept the 1-hour TTL is rule-based (Claude 4.5+); a model that rejects it anyway is
// retried with the default.
export { supportsExtendedCacheTtl };

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
