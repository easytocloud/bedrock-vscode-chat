/**
 * AWS Signature Version 4 signing for Mantle API requests
 * Allows using AWS credentials instead of API keys for Mantle endpoints
 */

import { SignatureV4 } from "@aws-sdk/signature-v4";
import { Sha256 } from "@aws-crypto/sha256-js";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { fromIni } from "@aws-sdk/credential-provider-ini";
import type { AwsCredentialIdentity, Provider } from "@aws-sdk/types";

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
