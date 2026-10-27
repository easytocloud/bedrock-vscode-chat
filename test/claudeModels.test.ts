import { test } from "node:test";
import assert from "node:assert/strict";
import {
	longContextLimits,
	parseClaudeVersion,
	standardMaxOutput,
	supportsExtendedCacheTtl,
	supportsExtendedThinking,
	supportsMantleMessagesApi,
} from "../src/claudeModels";

test("parseClaudeVersion handles both naming schemes and prefixes", () => {
	const cases: Array<[string, unknown]> = [
		["us.anthropic.claude-3-7-sonnet-20250219-v1:0", { family: "sonnet", major: 3, minor: 7 }],
		["anthropic.claude-3-haiku-20240307-v1:0", { family: "haiku", major: 3, minor: 0 }],
		["anthropic.claude-sonnet-4-20250514-v1:0", { family: "sonnet", major: 4, minor: 0 }],
		["anthropic.claude-opus-4-1-20250805-v1:0", { family: "opus", major: 4, minor: 1 }],
		["global.anthropic.claude-opus-4-6-v1", { family: "opus", major: 4, minor: 6 }],
		["anthropic.claude-sonnet-5", { family: "sonnet", major: 5, minor: 0 }],
		["global.anthropic.claude-fable-5-1", { family: "fable", major: 5, minor: 1 }],
		["anthropic.claude-mythos-preview", { family: "mythos", major: 5, minor: 0 }],
	];
	for (const [id, expected] of cases) {
		assert.deepEqual(parseClaudeVersion(id), expected, id);
	}
	assert.equal(parseClaudeVersion("amazon.nova-pro-v1:0"), undefined);
	assert.equal(parseClaudeVersion("anthropic.claude-v2"), undefined);
});

test("a future model is classified correctly with no code change", () => {
	const future = "global.anthropic.claude-opus-5-7";
	assert.equal(supportsExtendedThinking(future), true);
	assert.equal(supportsExtendedCacheTtl(future), true);
	assert.equal(supportsMantleMessagesApi(future), true);
	assert.deepEqual(longContextLimits(future), { contextLength: 1_000_000, maxOutputTokens: 128_000 });
	assert.equal(longContextLimits("anthropic.claude-sonnet-4-9")?.contextLength, 1_000_000);
});

test("longContextLimits keeps the 200K tier for 4.5 and earlier", () => {
	for (const id of ["claude-sonnet-4-20250514-v1:0", "claude-sonnet-4-5-20250929-v1:0", "claude-opus-4-5-20251101-v1:0", "claude-haiku-4-5-20251001-v1:0", "claude-opus-4-1-20250805-v1:0", "claude-3-7-sonnet-20250219-v1:0"]) {
		assert.equal(longContextLimits(id), undefined, id);
	}
	assert.equal(standardMaxOutput("claude-opus-4-1-20250805-v1:0"), 32_000);
	assert.equal(standardMaxOutput("claude-opus-4-20250514-v1:0"), 32_000);
	assert.equal(standardMaxOutput("claude-opus-4-5-20251101-v1:0"), 64_000);
	assert.equal(standardMaxOutput("claude-sonnet-4-20250514-v1:0"), 64_000);
});

test("supportsMantleMessagesApi matches the models Mantle serves", () => {
	for (const id of ["claude-sonnet-5-5", "claude-haiku-4-5-20251001", "claude-haiku-5-5", "claude-opus-4-7", "claude-opus-5-5", "claude-mythos-preview", "claude-fable-5"]) {
		assert.equal(supportsMantleMessagesApi(id), true, id);
	}
	for (const id of ["claude-3-haiku-20240307", "claude-opus-4-6-v1", "claude-sonnet-4-6", "claude-sonnet-4-5-20250929", "openai.gpt-oss-120b"]) {
		assert.equal(supportsMantleMessagesApi(id), false, id);
	}
});
