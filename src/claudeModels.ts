/**
 * Rule-based knowledge about Claude model generations on Amazon Bedrock. Everything here is derived
 * from the (family, major, minor) version in the model ID rather than from per-model lists, so a new
 * release such as "claude-opus-5-7" is handled correctly without an extension update. The weekly
 * drift check (test/modelDrift.test.ts) compares these rules to the public litellm registry.
 */

export interface ClaudeVersion {
	family: string;
	major: number;
	minor: number;
}

/**
 * Parse the generation out of a Claude model ID, with or without an inference-profile prefix and
 * version suffix. Handles both naming schemes: legacy "claude-3-7-sonnet-…" and current
 * "claude-sonnet-4-6" / "claude-sonnet-4-20250514" (an 8-digit date is not a minor version).
 */
export function parseClaudeVersion(modelId: string): ClaudeVersion | undefined {
	const id = modelId.toLowerCase();
	if (id.includes("claude-mythos-preview")) {
		return { family: "mythos", major: 5, minor: 0 };
	}
	const legacy = id.match(/claude-(\d)(?:[-.](\d))?-(opus|sonnet|haiku)/);
	if (legacy) {
		return { family: legacy[3], major: Number(legacy[1]), minor: legacy[2] ? Number(legacy[2]) : 0 };
	}
	const current = id.match(/claude-([a-z]+)-(\d+)(?:-(\d{1,2})(?!\d))?/);
	if (current) {
		return { family: current[1], major: Number(current[2]), minor: current[3] ? Number(current[3]) : 0 };
	}
	return undefined;
}

function atLeast(v: ClaudeVersion, major: number, minor: number): boolean {
	return v.major > major || (v.major === major && v.minor >= minor);
}

/** Extended thinking (budget_tokens): Claude 3.7 and everything newer. */
export function supportsExtendedThinking(modelId: string): boolean {
	const v = parseClaudeVersion(modelId);
	return !!v && atLeast(v, 3, 7);
}

/** 1-hour prompt-cache TTL: Claude 4.5 and everything newer. */
export function supportsExtendedCacheTtl(modelId: string): boolean {
	const v = parseClaudeVersion(modelId);
	return !!v && atLeast(v, 4, 5);
}

/**
 * Context window and max output for long-context models, or undefined for the standard
 * 200K tier. All 5.x and 4.6+ models have a 1M window; Claude 4.5 and earlier (including Sonnet 4,
 * whose 1M window is a beta opt-in) are on the standard tier.
 */
export function longContextLimits(modelId: string): { contextLength: number; maxOutputTokens: number } | undefined {
	const v = parseClaudeVersion(modelId);
	if (!v) {
		return undefined;
	}
	if (v.major >= 5) {
		return { contextLength: 1_000_000, maxOutputTokens: 128_000 };
	}
	if (v.major === 4 && v.minor >= 6) {
		return { contextLength: 1_000_000, maxOutputTokens: v.family === "opus" ? 128_000 : 64_000 };
	}
	return undefined;
}

/** Max output for models on the standard 200K tier: Opus 4 and 4.1 are capped at 32K, the rest allow 64K. */
export function standardMaxOutput(modelId: string): number {
	const v = parseClaudeVersion(modelId);
	return v && v.family === "opus" && v.major === 4 && v.minor <= 1 ? 32_000 : 64_000;
}

/**
 * Claude models served by Mantle's Anthropic Messages API (Mantle's /v1/models also lists Claude
 * models that have no Mantle support at all): every 5.x, Haiku 4.5+, and Opus 4.7+.
 */
export function supportsMantleMessagesApi(modelId: string): boolean {
	const v = parseClaudeVersion(modelId);
	if (!v) {
		return false;
	}
	if (v.major >= 5) {
		return true;
	}
	return v.major === 4 && ((v.family === "haiku" && v.minor >= 5) || (v.family === "opus" && v.minor >= 7));
}
