import { test } from "node:test";
import assert from "node:assert/strict";
import {
	buildCachePoint,
	effectiveCacheTtl,
	looksLikeCacheTtlRejection,
	supportsExtendedCacheTtl,
} from "../src/promptCache";

test("supportsExtendedCacheTtl: Claude 4.5+ only", () => {
	for (const id of [
		"anthropic.claude-sonnet-4-5-20250929-v1:0",
		"anthropic.claude-haiku-4-5-20251001-v1:0",
		"anthropic.claude-opus-4-6-v1",
		"us.anthropic.claude-sonnet-5-5",
		"anthropic.claude-fable-5",
	]) {
		assert.equal(supportsExtendedCacheTtl(id), true, id);
	}
	for (const id of [
		"anthropic.claude-sonnet-4-20250514-v1:0",
		"anthropic.claude-opus-4-1-20250805-v1:0",
		"anthropic.claude-3-7-sonnet-20250219-v1:0",
		"amazon.nova-pro-v1:0",
	]) {
		assert.equal(supportsExtendedCacheTtl(id), false, id);
	}
});

test("effectiveCacheTtl only returns 1h when requested and supported", () => {
	assert.equal(effectiveCacheTtl("1h", "anthropic.claude-sonnet-4-5-20250929-v1:0"), "1h");
	assert.equal(effectiveCacheTtl("1h", "amazon.nova-pro-v1:0"), "5m");
	assert.equal(effectiveCacheTtl("5m", "anthropic.claude-sonnet-4-5-20250929-v1:0"), "5m");
	assert.equal(effectiveCacheTtl(undefined, "anthropic.claude-sonnet-4-5-20250929-v1:0"), "5m");
});

test("buildCachePoint omits ttl for the 5m default", () => {
	assert.deepEqual(buildCachePoint("5m"), { cachePoint: { type: "default" } });
	assert.deepEqual(buildCachePoint("1h"), { cachePoint: { type: "default", ttl: "1h" } });
});

test("looksLikeCacheTtlRejection", () => {
	assert.equal(looksLikeCacheTtlRejection(new Error("ValidationException: ttl 1h is not supported")), true);
	assert.equal(looksLikeCacheTtlRejection(new Error("invalid cachePoint block")), true);
	assert.equal(looksLikeCacheTtlRejection(new Error("AccessDeniedException")), false);
});
