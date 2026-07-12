/**
 * Shared configuration actions (business logic)
 * Used by both QuickPick UI and webview UI to avoid duplication
 */

import * as vscode from "vscode";
import { NativeBedrockProvider } from "./provider";
import { MantleProvider } from "./mantleProvider";
import { listKnownAwsProfiles } from "./awsProfiles";
import { AWS_BEDROCK_REGIONS, AWS_MANTLE_REGIONS } from "./regions";

export interface NativeStatus {
	enabled: boolean;
	region: string;
	profile: string;
}

export interface MantleStatus {
	enabled: boolean;
	region: string;
	authMethod: "apiKey" | "awsCredentials";
	hasStoredKey: boolean;
	profile: string;
}

export function getNativeStatus(config: vscode.WorkspaceConfiguration): NativeStatus {
	return {
		enabled: config.get<boolean>("enableNative", true),
		region: config.get<string>("region", "us-east-1"),
		profile: config.get<string>("awsProfile", "") || "(default chain)",
	};
}

export async function getMantleStatus(
	config: vscode.WorkspaceConfiguration,
	mantleProvider: MantleProvider
): Promise<MantleStatus> {
	return {
		enabled: config.get<boolean>("enableMantle", true),
		region: config.get<string>("mantleRegion", "us-east-1"),
		authMethod: (config.get<string>("mantleAuthMethod", "apiKey") as "apiKey" | "awsCredentials"),
		hasStoredKey: await mantleProvider.hasStoredApiKey(),
		profile: config.get<string>("mantleAwsProfile", "") || "(default chain)",
	};
}

export async function testNativeConnection(
	nativeProvider: NativeBedrockProvider,
	cancellationToken: vscode.CancellationToken
): Promise<number> {
	const result = await nativeProvider.provideLanguageModelChatInformation(
		{ silent: false },
		cancellationToken
	);
	return result.length;
}

export async function testMantleConnection(
	mantleProvider: MantleProvider,
	cancellationToken: vscode.CancellationToken
): Promise<number> {
	const result = await mantleProvider.provideLanguageModelChatInformation(
		{ silent: false },
		cancellationToken
	);
	return result.length;
}

export async function getAvailableProfiles(onError?: (error: unknown) => void): Promise<string[]> {
	return listKnownAwsProfiles(onError);
}

export function getBedrockRegions() {
	return AWS_BEDROCK_REGIONS;
}

export function getMantleRegions() {
	return AWS_MANTLE_REGIONS;
}

export async function setMantleApiKey(
	mantleProvider: MantleProvider,
	apiKey: string
): Promise<void> {
	await mantleProvider.setApiKey(apiKey);
}

export async function clearMantleApiKey(mantleProvider: MantleProvider): Promise<void> {
	await mantleProvider.clearApiKey();
}
