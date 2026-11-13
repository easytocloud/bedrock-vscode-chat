// Issue #8: Converse must use the HTTP/1.1 handler. The SDK's default for Bedrock Runtime is
// HTTP/2, which bypasses VS Code's proxy support (it only hooks http/https) and fails behind proxies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { NodeHttp2Handler, NodeHttpHandler } from "@smithy/node-http-handler";
import { createBedrockRuntimeClient } from "../src/bedrockNative";

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
