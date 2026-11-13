/**
 * AWS Signature Version 4 signing for Mantle API requests
 * Allows using AWS credentials instead of API keys for Mantle endpoints
 */

import { SignatureV4 } from "@smithy/signature-v4";
import { Sha256 } from "@aws-crypto/sha256-js";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { fromIni } from "@aws-sdk/credential-provider-ini";
import type { AwsCredentialIdentity, Provider } from "@smithy/types";

export function getCredentialsProvider(profile: string | undefined): Provider<AwsCredentialIdentity> {
	const trimmed = (profile ?? "").trim();
	return trimmed ? fromIni({ profile: trimmed }) : defaultProvider();
}

export interface SignedRequest {
	url: string;
	headers: Record<string, string>;
}

/**
 * Sign a request using AWS Signature V4
 * This allows authenticating to Mantle endpoints using AWS credentials instead of API keys
 */
export async function signMantleRequest(
	url: string,
	method: string,
	body: string | undefined,
	region: string,
	profile: string | undefined
): Promise<SignedRequest> {
	const credentials = getCredentialsProvider(profile);
	
	const signer = new SignatureV4({
		credentials,
		region,
		service: "bedrock",
		sha256: Sha256,
	});

	const urlObj = new URL(url);
	
	const request = {
		method,
		hostname: urlObj.hostname,
		path: urlObj.pathname + urlObj.search,
		protocol: urlObj.protocol,
		headers: {
			"Content-Type": "application/json",
			host: urlObj.hostname,
		},
		body,
	};

	const signed = await signer.sign(request);
	
	return {
		url,
		headers: signed.headers as Record<string, string>,
	};
}

/**
 * True when an error means AWS credentials simply aren't available (yet): no credentials
 * found, SSO session not logged in or expired, expired temporary credentials. These are
 * expected at startup when VS Code activates the extension before the user has signed in,
 * so callers report them quietly instead of as errors. Authorization failures (e.g.
 * AccessDeniedException) are deliberately not matched — those are real configuration problems.
 */
export function isMissingCredentialsError(error: unknown): boolean {
	if (!error || typeof error !== "object") {
		return false;
	}
	const name = String((error as { name?: unknown }).name ?? "");
	const code = String((error as { Code?: unknown; code?: unknown }).Code ?? (error as { code?: unknown }).code ?? "");
	if (
		[
			"CredentialsProviderError",
			"TokenProviderError",
			"ExpiredTokenException",
			"ExpiredToken",
		].some((n) => n === name || n === code)
	) {
		return true;
	}
	const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
	return [
		"could not load credentials",
		"unable to load sso token",
		"sso session",
		"token is expired",
		"the security token included in the request is expired",
		"run 'aws sso login'",
		"run aws sso login",
	].some((needle) => message.includes(needle));
}
