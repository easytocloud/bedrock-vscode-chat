// Issue #8: Converse must use the HTTP/1.1 handler. The SDK's default for Bedrock Runtime is
// HTTP/2, which bypasses VS Code's proxy support (it only hooks http/https) and fails behind proxies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { NodeHttp2Handler, NodeHttpHandler } from "@smithy/node-http-handler";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { converseOnce, createBedrockRuntimeClient } from "../src/bedrockNative";

test("Bedrock Runtime client uses the HTTP/1.1 handler (proxy-compatible), not HTTP/2", () => {
	const client = createBedrockRuntimeClient({ region: "us-west-2", userAgent: "test" });
	try {
		const handler = client.config.requestHandler;
		assert.ok(handler instanceof NodeHttpHandler, "expected NodeHttpHandler");
		assert.ok(!(handler instanceof NodeHttp2Handler), "must not be the HTTP/2 handler");
	} finally {
		client.destroy();
	}
});

// Per-request runtime clients must be destroyed so keep-alive sockets don't pile up
// (adapted from HND-Hidetaka-Takano's tests in PR #9).
test("converseOnce destroys the runtime client after success and after failure", async (t) => {
	const destroy = t.mock.method(BedrockRuntimeClient.prototype, "destroy");
	const send = t.mock.method(BedrockRuntimeClient.prototype, "send", async () => ({
		output: { message: { role: "assistant", content: [{ text: "hello" }] } },
	}));
	const base = { region: "us-west-2", awsProfile: undefined, userAgent: "test", modelId: "test-model", messages: [], tools: undefined };

	const result = await converseOnce(base);
	assert.equal(result.text, "hello");
	assert.equal(destroy.mock.callCount(), 1);

	const failure = new Error("Network failure");
	send.mock.mockImplementation(async () => {
		throw failure;
	});
	await assert.rejects(converseOnce(base), (error) => error === failure);
	assert.equal(destroy.mock.callCount(), 2);
});
