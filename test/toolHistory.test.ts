import { test } from "node:test";
import assert from "node:assert/strict";
import type { Message } from "@aws-sdk/client-bedrock-runtime";
import { repairToolHistory } from "../src/toolHistory";

const use = (id: string) => ({ toolUse: { toolUseId: id, name: "t", input: {} } });
const res = (id: string, text = "ok") => ({ toolResult: { toolUseId: id, content: [{ text }], status: "success" as const } });

test("well-formed history is unchanged", () => {
	const m: Message[] = [
		{ role: "user", content: [{ text: "hi" }] },
		{ role: "assistant", content: [use("a")] },
		{ role: "user", content: [res("a")] },
	];
	assert.deepEqual(repairToolHistory(m), m);
});

test("missing result is synthesized (issue #3)", () => {
	const out = repairToolHistory([
		{ role: "user", content: [{ text: "hi" }] },
		{ role: "assistant", content: [use("a")] },
		{ role: "user", content: [{ text: "continue" }] },
	]);
	assert.equal(out[2].content![0].toolResult?.toolUseId, "a");
	assert.equal(out[2].content![0].toolResult?.status, "error");
	assert.equal(out[2].content![1].text, "continue");
});

test("text before toolResult is reordered so results come first", () => {
	const out = repairToolHistory([
		{ role: "assistant", content: [use("a")] },
		{ role: "user", content: [{ text: "ctx" }, res("a")] },
	]);
	assert.ok(out[1].content![0].toolResult);
});

test("result delivered in a later message is moved, orphan dropped", () => {
	const out = repairToolHistory([
		{ role: "assistant", content: [use("a")] },
		{ role: "user", content: [{ text: "x" }] },
		{ role: "assistant", content: [{ text: "y" }] },
		{ role: "user", content: [res("a", "real")] },
	]);
	assert.equal(out[1].content![0].toolResult?.content?.[0].text, "real");
	assert.equal(out.length, 3); // emptied user message dropped
	assert.equal(out[2].role, "assistant");
});

test("consecutive same-role messages merge; parallel calls all answered", () => {
	const out = repairToolHistory([
		{ role: "assistant", content: [use("a")] },
		{ role: "assistant", content: [use("b")] },
		{ role: "user", content: [res("b")] },
	]);
	assert.equal(out.length, 2);
	assert.deepEqual(out[1].content!.map((b) => b.toolResult?.toolUseId), ["a", "b"]);
});

test("trailing unanswered tool call gets a result", () => {
	const out = repairToolHistory([{ role: "assistant", content: [use("a")] }]);
	assert.equal(out[1].role, "user");
});
