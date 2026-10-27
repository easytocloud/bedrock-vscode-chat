import { test } from "node:test";
import assert from "node:assert/strict";
import type { Message, ReasoningContentBlock } from "@aws-sdk/client-bedrock-runtime";
import {
	ReasoningCache,
	buildThinkingFields,
	demandsAdaptiveThinking,
	effortForBudget,
	attachReasoning,
	looksLikeThinkingRejection,
	planThinking,
	supportsExtendedThinking,
} from "../src/thinking";

const use = (id: string) => ({ toolUse: { toolUseId: id, name: "t", input: {} } });
const res = (id: string) => ({ toolResult: { toolUseId: id, content: [{ text: "ok" }], status: "success" as const } });
const thought = (text: string): ReasoningContentBlock => ({ reasoningText: { text, signature: `sig-${text}` } });

test("supportsExtendedThinking: 3.7 and 4.x/5.x yes, older and non-Claude no", () => {
	for (const id of [
		"us.anthropic.claude-3-7-sonnet-20250219-v1:0",
		"anthropic.claude-sonnet-4-20250514-v1:0",
		"global.anthropic.claude-opus-5-5",
		"anthropic.claude-haiku-4-5-20251001-v1:0",
		"anthropic.claude-fable-5-1",
	]) {
		assert.equal(supportsExtendedThinking(id), true, id);
	}
	for (const id of ["anthropic.claude-3-5-sonnet-20241022-v2:0", "anthropic.claude-3-haiku-20240307-v1:0", "amazon.nova-pro-v1:0"]) {
		assert.equal(supportsExtendedThinking(id), false, id);
	}
});

test("planThinking enforces budget >= 1024 and maxTokens > budget", () => {
	assert.deepEqual(planThinking(4096, undefined), { budgetTokens: 4096, maxTokens: 4096 + 8192 });
	assert.deepEqual(planThinking(500, 20000), { budgetTokens: 1024, maxTokens: 20000 });
	assert.deepEqual(planThinking(50000, 16000), { budgetTokens: 16000 - 1024, maxTokens: 16000 });
	assert.deepEqual(planThinking(4096, 3000), { budgetTokens: 3000 - 1024, maxTokens: 3000 });
	assert.equal(planThinking(4096, 2000), undefined);
});

test("looksLikeThinkingRejection", () => {
	assert.equal(looksLikeThinkingRejection(new Error("ValidationException: thinking.type.enabled is not supported")), true);
	assert.equal(looksLikeThinkingRejection(new Error("budget_tokens must be >= 1024")), true);
	assert.equal(looksLikeThinkingRejection(new Error("ThrottlingException")), false);
});

test("ReasoningCache evicts the oldest entry past its cap", () => {
	const cache = new ReasoningCache();
	for (let i = 0; i < 201; i++) {
		cache.set(`id${i}`, thought(String(i)));
	}
	assert.equal(cache.size, 200);
	assert.equal(cache.get("id0"), undefined);
	assert.ok(cache.get("id200"));
});

test("attachReasoning puts the cached block first without mutating the input", () => {
	const cache = new ReasoningCache();
	cache.set("a", thought("hmm"));
	const input: Message[] = [
		{ role: "user", content: [{ text: "hi" }] },
		{ role: "assistant", content: [{ text: "let me look" }, use("a")] },
		{ role: "user", content: [res("a")] },
	];
	const { messages, complete } = attachReasoning(input, cache);
	assert.equal(complete, true);
	assert.deepEqual(messages[1].content![0], { reasoningContent: thought("hmm") });
	assert.equal(messages[1].content!.length, 3);
	assert.equal(input[1].content!.length, 2);
});

test("attachReasoning is incomplete when the current tool loop lacks cached thinking", () => {
	const { complete } = attachReasoning(
		[
			{ role: "user", content: [{ text: "hi" }] },
			{ role: "assistant", content: [use("a")] },
			{ role: "user", content: [res("a")] },
		],
		new ReasoningCache()
	);
	assert.equal(complete, false);
});

test("attachReasoning tolerates missing thinking in earlier finished turns", () => {
	const cache = new ReasoningCache();
	cache.set("b", thought("now"));
	const { messages, complete } = attachReasoning(
		[
			{ role: "user", content: [{ text: "first" }] },
			{ role: "assistant", content: [use("a")] },
			{ role: "user", content: [res("a")] },
			{ role: "assistant", content: [{ text: "done" }] },
			{ role: "user", content: [{ text: "next" }] },
			{ role: "assistant", content: [use("b")] },
			{ role: "user", content: [res("b")] },
		],
		cache
	);
	assert.equal(complete, true);
	assert.equal(messages[1].content!.length, 1); // old turn left alone
	assert.ok(messages[5].content![0].reasoningContent);
});

test("adaptive thinking: field shape, effort mapping and rejection detection", () => {
	assert.deepEqual(buildThinkingFields("enabled", 4096), { thinking: { type: "enabled", budget_tokens: 4096 } });
	assert.deepEqual(buildThinkingFields("adaptive", 4096), { thinking: { type: "adaptive" }, output_config: { effort: "medium" } });
	assert.equal(effortForBudget(1024), "low");
	assert.equal(effortForBudget(8192), "medium");
	assert.equal(effortForBudget(30000), "high");
	assert.equal(
		demandsAdaptiveThinking(new Error('"thinking.type.enabled" is not supported for this model. Use "thinking.type.adaptive"')),
		true
	);
	assert.equal(demandsAdaptiveThinking(new Error("budget_tokens must be >= 1024")), false);
});

test("attachReasoning with strict:false tolerates a tool call that came with no thinking", () => {
	const { complete } = attachReasoning(
		[
			{ role: "user", content: [{ text: "hi" }] },
			{ role: "assistant", content: [use("a")] },
			{ role: "user", content: [res("a")] },
		],
		new ReasoningCache(),
		{ strict: false }
	);
	assert.equal(complete, true);
});
