import { NodeHttp2Handler, NodeHttpHandler } from "@smithy/node-http-handler";
import { HttpsProxyAgent } from "https-proxy-agent";
import { getProxyForUrl } from "proxy-from-env";

export function createRuntimeRequestHandler(log?: (message: string) => void): ProxyAwareHttpHandler | undefined {
	const configured = ["https_proxy", "HTTPS_PROXY", "http_proxy", "HTTP_PROXY", "all_proxy", "ALL_PROXY"]
		.some((name) => !!process.env[name]);
	log?.(`BedrockRuntimeClient created: proxy=${configured ? "on" : "off"}`);
	return configured ? new ProxyAwareHttpHandler(log) : undefined;
}

/** Evaluate NO_PROXY against the actual SDK endpoint rather than guessing a regional hostname. */
export class ProxyAwareHttpHandler extends NodeHttp2Handler {
	// The SDK must not add HTTP/2 pseudo-headers to proxied HTTP/1.1 requests.
	override readonly metadata = { handlerProtocol: "http/1.1" };
	private readonly proxyHandlers = new Map<string, NodeHttpHandler>();

	constructor(private readonly log?: (message: string) => void) {
		super();
	}

	override handle(
		request: Parameters<NodeHttp2Handler["handle"]>[0],
		options?: Parameters<NodeHttp2Handler["handle"]>[1]
	): ReturnType<NodeHttp2Handler["handle"]> {
		const proxy = getProxyForUrl(`${request.protocol}//${request.hostname}${request.port ? `:${request.port}` : ""}`);
		this.log?.(`Bedrock runtime transport: proxy=${proxy ? "on" : "off"}`);
		if (!proxy) {
			return super.handle(request, options);
		}
		let handler = this.proxyHandlers.get(proxy);
		if (!handler) {
			let url: URL;
			try {
				url = new URL(proxy);
			} catch {
				// URL parsing errors may contain proxy credentials.
				throw new Error("Invalid proxy URL: expected an HTTP or HTTPS URL");
			}
			if (url.protocol !== "http:" && url.protocol !== "https:") {
				throw new Error("Invalid proxy URL: expected an HTTP or HTTPS URL");
			}
			const agent = new HttpsProxyAgent(url);
			handler = new NodeHttpHandler({ httpAgent: agent, httpsAgent: agent });
			this.proxyHandlers.set(proxy, handler);
		}
		return handler.handle(request, options);
	}

	override destroy(): void {
		for (const handler of this.proxyHandlers.values()) {
			handler.destroy();
		}
		this.proxyHandlers.clear();
		super.destroy();
	}
}
