import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { createServer as createHttp2Server } from "node:http2";
import { connect } from "node:net";
import { afterEach, beforeEach, mock, test } from "node:test";
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { NodeHttp2Handler, NodeHttpHandler } from "@smithy/node-http-handler";
import { HttpsProxyAgent } from "https-proxy-agent";
import { createRuntimeRequestHandler, ProxyAwareHttpHandler } from "../src/proxy";
import { converseOnce } from "../src/bedrockNative";

const environmentNames = ["https_proxy", "HTTPS_PROXY", "http_proxy", "HTTP_PROXY", "all_proxy", "ALL_PROXY", "no_proxy", "NO_PROXY"];
const environment = new Map<string, string | undefined>();
const logs: string[] = [];
const log = (message: string) => logs.push(message);
const request: Parameters<NodeHttp2Handler["handle"]>[0] = {
	protocol: "https:",
	hostname: "bedrock-runtime.example.test",
	method: "POST",
	path: "/model/test/converse",
	headers: {},
	query: {},
	clone() { return this; },
};
const originalHandle = NodeHttpHandler.prototype.handle;

beforeEach(() => {
	for (const name of environmentNames) {
		environment.set(name, process.env[name]);
		delete process.env[name];
	}
});

afterEach(() => {
	mock.restoreAll();
	for (const [name, value] of environment) {
		if (value === undefined) {
			delete process.env[name];
		} else {
			process.env[name] = value;
		}
	}
	logs.length = 0;
});

function mockTransports() {
	const response = { response: { statusCode: 200, headers: {} } };
	return {
		direct: mock.method(NodeHttp2Handler.prototype, "handle", async () => response),
		proxy: mock.method(NodeHttpHandler.prototype, "handle", async () => response),
	};
}

async function configuredAgent(handler: unknown) {
	assert.ok(handler instanceof NodeHttpHandler);
	// Resolve the handler's lazy configuration without opening a socket.
	await assert.rejects(originalHandle.call(handler, request, { abortSignal: AbortSignal.abort() }), { name: "AbortError" });
	return handler.httpHandlerConfigs().httpsAgent;
}

// Routing expectations follow the task specification and proxy-from-env's documented NO_PROXY rules.
test("without proxy variables the SDK retains its default HTTP/2 handler", () => {
	const handler = createRuntimeRequestHandler(log);
	assert.equal(handler, undefined);
	const client = new BedrockRuntimeClient({ region: "test-region", requestHandler: handler });
	try {
		assert.ok(client.config.requestHandler instanceof NodeHttp2Handler);
		assert.equal(client.config.requestHandler instanceof ProxyAwareHttpHandler, false);
		assert.deepEqual(logs, ["BedrockRuntimeClient created: proxy=off"]);
	} finally {
		client.destroy();
	}
});

for (const name of ["HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"]) {
	test(`${name} selects HTTP/1.1 with a CONNECT agent and safe logs`, async () => {
		process.env[name] = "http://user:password@proxy.example.test:3128";
		const { direct, proxy } = mockTransports();
		const handler = createRuntimeRequestHandler(log);
		assert.ok(handler instanceof ProxyAwareHttpHandler);
		assert.equal(handler.metadata.handlerProtocol, "http/1.1");
		const options = { abortSignal: new AbortController().signal, requestTimeout: 1000 };
		try {
			await handler.handle(request, options);
			assert.equal(direct.mock.callCount(), 0);
			assert.deepEqual(proxy.mock.calls[0].arguments, [request, options]);
			assert.ok(await configuredAgent(proxy.mock.calls[0].this) instanceof HttpsProxyAgent);
			assert.deepEqual(logs, ["BedrockRuntimeClient created: proxy=on", "Bedrock runtime transport: proxy=on"]);
			assert.doesNotMatch(JSON.stringify(logs), /password|user|proxy\.example/);
		} finally {
			handler.destroy();
		}
	});
}

for (const [noProxy, port] of [
	["bedrock-runtime.example.test", undefined],
	["BEDROCK-RUNTIME.EXAMPLE.TEST", undefined],
	[".example.test", undefined],
	["*.example.test", undefined],
	["unrelated.test, bedrock-runtime.example.test", undefined],
	["unrelated.test bedrock-runtime.example.test", undefined],
	["bedrock-runtime.example.test:443", undefined],
	["bedrock-runtime.example.test:8443", 8443],
	["*", undefined],
] as const) {
	test(`NO_PROXY=${noProxy} bypasses the proxy for port ${port ?? 443}`, async () => {
		process.env.HTTPS_PROXY = "http://proxy.example.test:3128";
		process.env.NO_PROXY = noProxy;
		const { direct, proxy } = mockTransports();
		const handler = new ProxyAwareHttpHandler(log);
		const options = { abortSignal: new AbortController().signal, isEventStream: true };
		const endpoint = { ...request, clone: request.clone, port };
		try {
			await handler.handle(endpoint, options);
			assert.deepEqual(direct.mock.calls[0].arguments, [endpoint, options]);
			assert.equal(proxy.mock.callCount(), 0);
			assert.deepEqual(logs, ["Bedrock runtime transport: proxy=off"]);
		} finally {
			handler.destroy();
		}
	});
}

for (const noProxy of ["example.test", "unrelated.test", "bedrock-runtime.example.test:8443"]) {
	test(`NO_PROXY=${noProxy} does not exclude unrelated hosts or ports`, async () => {
		process.env.HTTPS_PROXY = "http://proxy.example.test:3128";
		process.env.NO_PROXY = noProxy;
		const { direct, proxy } = mockTransports();
		const handler = new ProxyAwareHttpHandler(log);
		try {
			await handler.handle(request);
			assert.equal(direct.mock.callCount(), 0);
			assert.equal(proxy.mock.callCount(), 1);
		} finally {
			handler.destroy();
		}
	});
}

test("lowercase variables take precedence for both proxy and NO_PROXY", async () => {
	process.env.HTTPS_PROXY = "http://upper.example.test:3128";
	process.env.https_proxy = "https://lower.example.test:3128";
	process.env.NO_PROXY = "*";
	process.env.no_proxy = "unrelated.test";
	const { proxy } = mockTransports();
	const handler = new ProxyAwareHttpHandler(log);
	try {
		await handler.handle(request);
		const agent = await configuredAgent(proxy.mock.calls[0].this);
		assert.ok(agent instanceof HttpsProxyAgent);
		assert.equal(agent.proxy.hostname, "lower.example.test");
		assert.equal(agent.proxy.protocol, "https:");
	} finally {
		handler.destroy();
	}
});

test("HTTP_PROXY alone does not change HTTPS transport", async () => {
	process.env.HTTP_PROXY = "http://proxy.example.test:3128";
	const { direct, proxy } = mockTransports();
	const handler = createRuntimeRequestHandler(log);
	assert.ok(handler);
	try {
		await handler.handle(request);
		assert.equal(direct.mock.callCount(), 1);
		assert.equal(proxy.mock.callCount(), 0);
	} finally {
		handler.destroy();
	}
});

for (const url of ["http://user:secret@[invalid", "socks://user:secret@proxy.example.test"]) {
	test("invalid proxy URLs fail explicitly without leaking credentials", () => {
		process.env.HTTPS_PROXY = url;
		const { direct, proxy } = mockTransports();
		const handler = new ProxyAwareHttpHandler(log);
		try {
			assert.throws(() => handler.handle(request), { message: "Invalid proxy URL: expected an HTTP or HTTPS URL" });
			assert.equal(direct.mock.callCount(), 0);
			assert.equal(proxy.mock.callCount(), 0);
		} finally {
			handler.destroy();
		}
	});
}

test("proxy errors propagate without falling back to a direct connection", async () => {
	process.env.HTTPS_PROXY = "http://proxy.example.test:3128";
	const { direct, proxy } = mockTransports();
	const failure = new Error("CONNECT refused");
	proxy.mock.mockImplementation(async () => { throw failure; });
	const handler = new ProxyAwareHttpHandler(log);
	try {
		await assert.rejects(handler.handle(request), (error) => error === failure);
		assert.equal(direct.mock.callCount(), 0);
	} finally {
		handler.destroy();
	}
});

test("proxy handlers are reused and both transports are destroyed", async () => {
	process.env.HTTPS_PROXY = "http://proxy.example.test:3128";
	const { proxy } = mockTransports();
	const destroyProxy = mock.method(NodeHttpHandler.prototype, "destroy");
	const destroyDirect = mock.method(NodeHttp2Handler.prototype, "destroy");
	const handler = new ProxyAwareHttpHandler(log);
	await handler.handle(request);
	await handler.handle(request);
	assert.equal(proxy.mock.calls[0].this, proxy.mock.calls[1].this);
	handler.destroy();
	assert.equal(destroyProxy.mock.callCount(), 1);
	assert.equal(destroyDirect.mock.callCount(), 1);
});

test("converseOnce wires the proxy handler, preserves tools, and releases the runtime", async () => {
	process.env.HTTPS_PROXY = "http://proxy.example.test:3128";
	const send = mock.method(BedrockRuntimeClient.prototype, "send", async function (this: BedrockRuntimeClient, command: ConverseCommand) {
		assert.ok(this.config.requestHandler instanceof ProxyAwareHttpHandler);
		assert.equal(command.input.modelId, "test-model");
		assert.equal(command.input.toolConfig?.tools?.[0].toolSpec?.name, "list_files");
		return {
			output: { message: { role: "assistant", content: [
				{ text: "hello" },
				{ toolUse: { toolUseId: "call-1", name: "list_files", input: { path: "." } } },
			] } },
		};
	});
	const destroy = mock.method(BedrockRuntimeClient.prototype, "destroy");
	const result = await converseOnce({
		region: "test-region", awsProfile: undefined, userAgent: "test", modelId: "test-model", messages: [],
		tools: [{ name: "list_files", description: "List files", inputSchema: { type: "object", properties: {} } }],
		log,
	});
	assert.equal(send.mock.callCount(), 1);
	assert.equal(destroy.mock.callCount(), 1);
	assert.deepEqual(result, { text: "hello", toolUses: [{ id: "call-1", name: "list_files", input: { path: "." } }], reasoning: undefined });
});

test("converseOnce releases the runtime on request failure", async () => {
	const failure = new Error("Network failure");
	mock.method(BedrockRuntimeClient.prototype, "send", async () => { throw failure; });
	const destroy = mock.method(BedrockRuntimeClient.prototype, "destroy");
	await assert.rejects(converseOnce({
		region: "test-region", awsProfile: undefined, userAgent: "test", modelId: "test-model", messages: [], tools: undefined,
	}), (error) => error === failure);
	assert.equal(destroy.mock.callCount(), 1);
});

test("converseOnce retains the request timeout and releases the runtime after abort", async () => {
	process.env.HTTPS_PROXY = "http://proxy.example.test:3128";
	mock.method(BedrockRuntimeClient.prototype, "send", function (
		this: BedrockRuntimeClient,
		_command: ConverseCommand,
		options: { abortSignal: AbortSignal }
	) {
		assert.ok(this.config.requestHandler instanceof ProxyAwareHttpHandler);
		return new Promise((_resolve, reject) => {
			options.abortSignal.addEventListener("abort", () => reject(new Error("Request aborted")), { once: true });
		});
	});
	const destroy = mock.method(BedrockRuntimeClient.prototype, "destroy");
	await assert.rejects(converseOnce({
		region: "test-region", awsProfile: undefined, userAgent: "test", modelId: "test-model",
		messages: [], tools: undefined, requestTimeoutMs: 10,
	}), { message: "Request aborted" });
	assert.equal(destroy.mock.callCount(), 1);
});

const responseBody = {
	output: { message: { role: "assistant", content: [
		{ text: "hello" }, { toolUse: { toolUseId: "call-1", name: "list_files", input: { path: "." } } },
	] } },
	stopReason: "tool_use",
	usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
	metrics: { latencyMs: 1 },
};

test("Converse uses a local CONNECT proxy without resolving the target and preserves the response", async () => {
	const targets: string[] = [];
	const received: Record<string, unknown>[] = [];
	const sockets = new Set<ReturnType<typeof connect>>();
	const upstream = createServer(async (req, res) => {
		assert.equal(req.httpVersion, "1.1");
		const parts: Buffer[] = [];
		for await (const part of req) {
			parts.push(part);
		}
		received.push(JSON.parse(Buffer.concat(parts).toString()));
		res.writeHead(200, { "content-type": "application/json" });
		res.end(JSON.stringify(responseBody));
	});
	const proxy = createServer();
	let upstreamPort: number;
	proxy.on("connect", (req, socket, head) => {
		targets.push(req.url ?? "");
		const target = connect({ host: "127.0.0.1", port: upstreamPort }, () => {
			socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
			target.write(head);
			socket.pipe(target);
			target.pipe(socket);
		});
		sockets.add(target);
		socket.on("close", () => target.destroy());
		target.on("close", () => { socket.destroy(); sockets.delete(target); });
		target.on("error", () => socket.destroy());
		socket.on("error", () => target.destroy());
	});
	let client: BedrockRuntimeClient | undefined;
	try {
		upstream.listen(0, "127.0.0.1");
		await once(upstream, "listening");
		const address = upstream.address();
		assert.ok(address && typeof address !== "string");
		upstreamPort = address.port;
		proxy.listen(0, "127.0.0.1");
		await once(proxy, "listening");
		const proxyAddress = proxy.address();
		assert.ok(proxyAddress && typeof proxyAddress !== "string");
		process.env.HTTP_PROXY = `http://127.0.0.1:${proxyAddress.port}`;
		client = new BedrockRuntimeClient({
			region: "test-region", endpoint: "http://unresolvable.invalid",
			// Synthetic test-only credentials; no AWS calls or local profiles are used.
			credentials: { accessKeyId: "test", secretAccessKey: "test" },
			requestHandler: createRuntimeRequestHandler(log), maxAttempts: 1,
		});
		const result = await client.send(new ConverseCommand({ modelId: "test-model", messages: [{ role: "user", content: [{ text: "hi" }] }] }));
		assert.deepEqual(targets, ["unresolvable.invalid:80"]);
		assert.deepEqual(received[0].messages, [{ role: "user", content: [{ text: "hi" }] }]);
		assert.deepEqual(result.output, responseBody.output);
		assert.deepEqual(result.usage, responseBody.usage);
		assert.equal(result.stopReason, "tool_use");
	} finally {
		client?.destroy();
		for (const socket of sockets) socket.destroy();
		await Promise.all([
			new Promise<void>((resolve) => proxy.close(() => resolve())),
			new Promise<void>((resolve) => upstream.close(() => resolve())),
		]);
	}
});

test("Converse retains HTTP/2 when the actual endpoint matches NO_PROXY", async () => {
	const upstream = createHttp2Server();
	upstream.on("stream", (stream) => {
		stream.respond({ ":status": 200, "content-type": "application/json" });
		stream.end(JSON.stringify(responseBody));
	});
	let client: BedrockRuntimeClient | undefined;
	try {
		upstream.listen(0, "127.0.0.1");
		await once(upstream, "listening");
		const address = upstream.address();
		assert.ok(address && typeof address !== "string");
		process.env.HTTP_PROXY = "http://unreachable.invalid:3128";
		process.env.NO_PROXY = "127.0.0.1";
		client = new BedrockRuntimeClient({
			region: "test-region", endpoint: `http://127.0.0.1:${address.port}`,
			credentials: { accessKeyId: "test", secretAccessKey: "test" },
			requestHandler: createRuntimeRequestHandler(log), maxAttempts: 1,
		});
		const result = await client.send(new ConverseCommand({ modelId: "test-model", messages: [] }));
		assert.deepEqual(result.output, responseBody.output);
		assert.ok(logs.includes("Bedrock runtime transport: proxy=off"));
	} finally {
		client?.destroy();
		await new Promise<void>((resolve) => upstream.close(() => resolve()));
	}
});
