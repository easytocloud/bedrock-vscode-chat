// Compares the extension's built-in Claude model rules with the public litellm registry.
// Needs network, so it only runs when CHECK_MODEL_DRIFT=1 (the weekly model-drift workflow sets it).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseClaudeVersion, supportsExtendedCacheTtl, supportsExtendedThinking, supportsMantleMessagesApi } from "../src/claudeModels";
import { inferTokenLimits } from "../src/utils";

const REGISTRY_URL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

interface Entry {
	litellm_provider?: string;
	max_input_tokens?: number;
	max_output_tokens?: number;
	supports_reasoning?: boolean;
	cache_creation_input_token_cost_above_1hr?: number;
}

test("model rules agree with the litellm registry", { skip: process.env.CHECK_MODEL_DRIFT !== "1" }, async () => {
	const res = await fetch(REGISTRY_URL);
	assert.ok(res.ok, `registry fetch failed: ${res.status}`);
	const registry = (await res.json()) as Record<string, Entry>;

	const drift: string[] = [];
	for (const [key, e] of Object.entries(registry)) {
		if (!/anthropic\.claude-/.test(key)) {
			continue;
		}
		const modelId = key.split("/").pop()!;
		const version = parseClaudeVersion(modelId);
		if (!version || version.major < 4) {
			continue; // legacy 3.x entries are frozen and inconsistent across variants
		}

		if (e.litellm_provider === "bedrock_mantle") {
			if (!supportsMantleMessagesApi(modelId)) {
				drift.push(`${key}: registry lists it on Mantle but supportsMantleMessagesApi() is false`);
			}
			continue;
		}
		if (key.includes("/") || !e.max_input_tokens || !e.max_output_tokens) {
			continue; // region-pinned or incomplete entries duplicate the plain ones
		}

		const got = inferTokenLimits(modelId);
		if (got.contextLength !== e.max_input_tokens || got.maxOutputTokens !== e.max_output_tokens) {
			drift.push(`${key}: limits ${got.contextLength}/${got.maxOutputTokens}, registry ${e.max_input_tokens}/${e.max_output_tokens}`);
		}
		if (e.supports_reasoning && !supportsExtendedThinking(modelId)) {
			drift.push(`${key}: registry says reasoning is supported but supportsExtendedThinking() is false`);
		}
		if (e.cache_creation_input_token_cost_above_1hr !== undefined && !supportsExtendedCacheTtl(modelId)) {
			drift.push(`${key}: registry prices a 1h cache but supportsExtendedCacheTtl() is false`);
		}
	}
	assert.deepEqual(drift, [], `model rules drifted from the registry:\n${drift.join("\n")}`);
});
