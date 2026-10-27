import { test } from "node:test";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import {
	buildEndpointUrl,
	disambiguateDisplayNames,
	generateCallId,
	inferModelCapabilities,
	inferTokenLimits,
	isHiddenWhenNotShowAll,
	isMantleServedModelId,
	parseModelInfo,
	shouldLog,
	tryParseJSONObject,
	validateRequest,
} from "../src/utils";

test("inferTokenLimits: Claude generations", () => {
	assert.deepEqual(inferTokenLimits("anthropic.claude-3-haiku-20240307-v1:0"), { contextLength: 200000, maxOutputTokens: 4096 });
	assert.deepEqual(inferTokenLimits("anthropic.claude-3-5-sonnet-20241022-v2:0"), { contextLength: 200000, maxOutputTokens: 8192 });
	assert.deepEqual(inferTokenLimits("us.anthropic.claude-3-7-sonnet-20250219-v1:0"), { contextLength: 200000, maxOutputTokens: 64000 });
	assert.deepEqual(inferTokenLimits("anthropic.claude-opus-4-5-20251101-v1:0"), { contextLength: 200000, maxOutputTokens: 64000 });
});

test("inferTokenLimits: 1M-context Claude models, and the opt-out", () => {
	assert.deepEqual(inferTokenLimits("us.anthropic.claude-sonnet-4-6"), { contextLength: 1000000, maxOutputTokens: 64000 });
	assert.deepEqual(inferTokenLimits("global.anthropic.claude-opus-5-5"), { contextLength: 1000000, maxOutputTokens: 128000 });
	assert.deepEqual(inferTokenLimits("anthropic.claude-haiku-5-5"), { contextLength: 1000000, maxOutputTokens: 128000 });
	assert.deepEqual(inferTokenLimits("us.anthropic.claude-sonnet-4-6", { assumeLongContextClaudeModels: false }), {
		contextLength: 200000,
		maxOutputTokens: 64000,
	});
});

test("inferTokenLimits: non-Claude families and the default", () => {
	assert.deepEqual(inferTokenLimits("mistral.mistral-large-2402-v1:0"), { contextLength: 200000, maxOutputTokens: 8192 });
	assert.deepEqual(inferTokenLimits("deepseek.r1-v1:0"), { contextLength: 200000, maxOutputTokens: 8192 });
	assert.deepEqual(inferTokenLimits("amazon.titan-text-express-v1"), { contextLength: 32000, maxOutputTokens: 4096 });
	assert.deepEqual(inferTokenLimits("totally.unknown-model"), { contextLength: 128000, maxOutputTokens: 4096 });
});

test("inferModelCapabilities", () => {
	assert.equal(inferModelCapabilities("qwen.qwen3-vl-235b-a22b").supportsVision, true);
	assert.equal(inferModelCapabilities("qwen.qwen3-coder-30b-a3b").isCodeSpecialized, true);
	assert.equal(inferModelCapabilities("qwen.qwen3-235b-a22b-thinking-2507").isThinking, true);
	assert.equal(inferModelCapabilities("amazon.nova-pro-v1:0").supportsToolCalling, true);
	assert.equal(inferModelCapabilities("totally.unknown-model").supportsToolCalling, false);
});

test("isMantleServedModelId / isHiddenWhenNotShowAll", () => {
	assert.equal(isMantleServedModelId("deepseek.v3-v1:0"), true);
	assert.equal(isMantleServedModelId("openai.gpt-oss-120b"), true);
	assert.equal(isMantleServedModelId("anthropic.claude-sonnet-5"), false);
	assert.equal(isHiddenWhenNotShowAll("amazon.titan-embed-text-v2:0"), true);
	assert.equal(isHiddenWhenNotShowAll("meta.llama3-70b-instruct-v1:0"), false);
});

test("parseModelInfo builds ids and display names", () => {
	const m = parseModelInfo("openai.gpt-oss-120b");
	assert.equal(m.id, "mantle:openai.gpt-oss-120b");
	assert.equal(m.modelId, "openai.gpt-oss-120b");
	assert.equal(m.provider, "openai");
	assert.equal(m.displayName, "Openai Gpt Oss 120B");
	assert.equal(m.backend, "mantle");
});

test("buildEndpointUrl and generateCallId", () => {
	assert.equal(buildEndpointUrl("us-west-2"), "https://bedrock-mantle.us-west-2.api.aws/v1");
	assert.match(generateCallId(), /^call_[a-z0-9]{1,8}$/);
});

test("shouldLog respects the configured level", () => {
	assert.equal(shouldLog("verbose", "verbose"), true);
	assert.equal(shouldLog("warning", "info"), false);
	assert.equal(shouldLog("warning", "error"), true);
	assert.equal(shouldLog("none", "error"), false);
});

test("tryParseJSONObject accepts only plain objects", () => {
	assert.deepEqual(tryParseJSONObject('{"a":1}'), { ok: true, value: { a: 1 } });
	assert.deepEqual(tryParseJSONObject("[1]"), { ok: false });
	assert.deepEqual(tryParseJSONObject('"s"'), { ok: false });
	assert.deepEqual(tryParseJSONObject("nope"), { ok: false });
});

test("disambiguateDisplayNames only touches duplicates", () => {
	const models = [
		{ displayName: "Same", modelId: "a.one" },
		{ displayName: "Same", modelId: "a.two" },
		{ displayName: "Unique", modelId: "a.three" },
	] as any[];
	disambiguateDisplayNames(models);
	assert.deepEqual(
		models.map((m) => m.displayName),
		["Same [a.one]", "Same [a.two]", "Unique"]
	);
});

test("validateRequest pairs tool calls with results", () => {
	const call = (id: string) => new (vscode as any).LanguageModelToolCallPart(id, "t", {});
	const result = (id: string) => new (vscode as any).LanguageModelToolResultPart(id, []);
	const msgs = (...parts: unknown[][]) => parts.map((content) => ({ content })) as any;

	assert.equal(validateRequest(msgs([call("a")], [result("a")])).valid, true);
	assert.equal(validateRequest(msgs([])).valid, true);
	assert.match(validateRequest(msgs([call("a")])).error ?? "", /Missing tool results/);
	assert.match(validateRequest(msgs([result("x")])).error ?? "", /unknown call ID/);
});
