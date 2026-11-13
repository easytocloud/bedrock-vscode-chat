import { test } from "node:test";
import assert from "node:assert/strict";
import {
	findExternalMetadata,
	loadExternalMetadataForModels,
	toExternalMetadata,
	type ExternalModelMetadata,
} from "../src/externalModelMetadata";
import { isMissingCredentialsError } from "../src/awsAuth";

const catalog: Record<string, ExternalModelMetadata> = {
	"anthropic.claude-sonnet-4-6": { contextLength: 1_000_000, maxOutputTokens: 128_000 },
	"eu.anthropic.claude-sonnet-4-6": { contextLength: 1_000_000, maxOutputTokens: 64_000 },
	"us.anthropic.claude-opus-5": { contextLength: 1_000_000, maxOutputTokens: 128_000 },
	"openai.gpt-oss-120b-1:0": { contextLength: 131_072, maxOutputTokens: 128_000, toolCalling: true },
	"amazon.nova-pro-v1:0": { contextLength: 300_000, maxOutputTokens: 10_000 },
};

test("findExternalMetadata: exact key wins", () => {
	assert.equal(findExternalMetadata(catalog, "eu.anthropic.claude-sonnet-4-6", "eu-west-1")?.maxOutputTokens, 64_000);
	assert.equal(findExternalMetadata(catalog, "anthropic.claude-sonnet-4-6", "eu-west-1")?.maxOutputTokens, 128_000);
});

test("findExternalMetadata: falls back to the region-group inference profile", () => {
	assert.ok(findExternalMetadata(catalog, "anthropic.claude-opus-5", "us-west-2"));
	// Any region's profile is an acceptable last resort: limits don't vary by geography.
	assert.ok(findExternalMetadata(catalog, "anthropic.claude-opus-5", "ap-south-1"));
});

test("findExternalMetadata: version-insensitive match for Mantle-style IDs", () => {
	assert.equal(findExternalMetadata(catalog, "openai.gpt-oss-120b", "us-east-1")?.toolCalling, true);
	assert.equal(findExternalMetadata(catalog, "amazon.nova-pro", "us-east-1")?.contextLength, 300_000);
	assert.equal(findExternalMetadata(catalog, "openai.gpt-oss-20b", "us-east-1"), undefined);
});

test("toExternalMetadata maps models.dev fields", () => {
	const meta = toExternalMetadata({
		id: "x",
		name: "x",
		description: "",
		attachment: true,
		reasoning: true,
		tool_call: true,
		release_date: "2026-01",
		last_updated: "2026-01",
		modalities: { input: ["text", "image"], output: ["text"] },
		open_weights: false,
		limit: { context: 1_050_000, input: 922_000, output: 128_000 },
	});
	assert.deepEqual(meta, {
		contextLength: 1_050_000,
		maxInputTokens: 922_000,
		maxOutputTokens: 128_000,
		toolCalling: true,
		vision: true,
		reasoning: true,
	});
});

function memento() {
	const store = new Map<string, unknown>();
	return {
		store,
		get: <T>(k: string) => store.get(k) as T | undefined,
		update: async (k: string, v: unknown) => void store.set(k, v),
		keys: () => [...store.keys()],
	};
}

test("loadExternalMetadataForModels fetches models.dev, caches, and survives failures", async () => {
	const realFetch = globalThis.fetch;
	let calls = 0;
	let fail = false;
	globalThis.fetch = (async (url: URL) => {
		calls++;
		assert.equal(String(url), "https://models.dev/api.json");
		if (fail) {
			throw new Error("offline");
		}
		const body = {
			"amazon-bedrock": {
				models: {
					"openai.gpt-oss-120b-1:0": {
						id: "openai.gpt-oss-120b-1:0",
						tool_call: true,
						modalities: { input: ["text"], output: ["text"] },
						limit: { context: 131072, output: 128000 },
					},
				},
			},
		};
		return new Response(JSON.stringify(body), { status: 200 });
	}) as typeof fetch;
	try {
		const m = memento();
		const opts = {
			memento: m as never,
			cacheKey: "k",
			cacheHours: 24,
			region: "us-east-1",
			userAgent: "test",
			modelIds: ["openai.gpt-oss-120b", "unknown.model"],
			logDebug: () => undefined,
			logAlways: () => undefined,
		};
		const first = await loadExternalMetadataForModels(opts);
		assert.equal(first.get("openai.gpt-oss-120b")?.contextLength, 131072);
		assert.equal(first.has("unknown.model"), false);

		await loadExternalMetadataForModels(opts); // fresh cache: no refetch
		assert.equal(calls, 1);

		fail = true;
		const stale = await loadExternalMetadataForModels({ ...opts, cacheHours: 0 }); // forced refetch fails
		assert.equal(calls, 2);
		assert.equal(stale.get("openai.gpt-oss-120b")?.maxOutputTokens, 128000, "falls back to cached copy");
	} finally {
		globalThis.fetch = realFetch;
	}
});

test("isMissingCredentialsError recognises not-signed-in errors only", () => {
	const named = (name: string, message = "x") => Object.assign(new Error(message), { name });
	assert.equal(isMissingCredentialsError(named("CredentialsProviderError", "Could not load credentials from any providers")), true);
	assert.equal(isMissingCredentialsError(named("TokenProviderError")), true);
	assert.equal(isMissingCredentialsError(new Error("The SSO session associated with this profile has expired or is otherwise invalid")), true);
	assert.equal(isMissingCredentialsError(named("ExpiredTokenException")), true);
	assert.equal(isMissingCredentialsError(named("AccessDeniedException", "not authorized to perform bedrock:ListFoundationModels")), false);
	assert.equal(isMissingCredentialsError(new Error("socket hang up")), false);
	assert.equal(isMissingCredentialsError(undefined), false);
});
