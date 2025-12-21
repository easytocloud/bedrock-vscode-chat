/**
 * AWS Bedrock VSCode Chat Extension
 * Entry point for the extension
 */

import * as vscode from "vscode";
import { BedrockMantleProvider } from "./provider";

function registerCommandSafe(
	context: vscode.ExtensionContext,
	commandId: string,
	handler: (...args: any[]) => any
): void {
	try {
		context.subscriptions.push(vscode.commands.registerCommand(commandId, handler));
	} catch (e) {
		// VS Code throws if a command ID is already registered (often due to multiple installs/dev hosts).
		// Don't fail activation; just skip and rely on the existing registration.
		console.warn(`Command '${commandId}' already exists; skipping registration.`, e);
	}
}

export function activate(context: vscode.ExtensionContext) {
	console.log("AWS Bedrock extension is activating...");

	const output = vscode.window.createOutputChannel("AWS Bedrock");
	context.subscriptions.push(output);
	output.appendLine(`AWS Bedrock activated at ${new Date().toISOString()}`);
	
	// Build User-Agent string
	const extVersion = (context.extension.packageJSON as { version?: string } | undefined)?.version ?? "unknown";
	const vscodeVersion = vscode.version;
	const userAgent = `bedrock-vscode-chat/${extVersion} VSCode/${vscodeVersion}`;
	output.appendLine(`Version: ${extVersion} | VS Code: ${vscodeVersion}`);

	console.log(`Extension version: ${extVersion}, VSCode version: ${vscodeVersion}`);

	// Get configuration
	const config = vscode.workspace.getConfiguration("aws-bedrock");

	// Create and register provider
	const provider = new BedrockMantleProvider(context.secrets, config, userAgent, output, context.globalState);
	console.log("Created BedrockMantleProvider");

	const providerDisposable = vscode.lm.registerLanguageModelChatProvider(
		"easytocloud.bedrock-mantle-vscode-chat",
		provider
	);
	
	console.log("Registered aws-bedrock provider with VSCode");
	
	// Eagerly fetch models to populate the picker
	provider.provideLanguageModelChatInformation({ silent: true }, new vscode.CancellationTokenSource().token).then(
		models => {
			console.log(`Successfully loaded ${models.length} Bedrock models`);
			if (models.length === 0) {
				console.log("No models returned - might need API key");
			} else {
				console.log(`Models: ${models.map(m => m.name).join(", ")}`);
			}
		},
		error => {
			console.error("Failed to load Bedrock models:", error);
		}
	);

	// Register management command for API key configuration
	const manageHandler = async () => {
		const action = await vscode.window.showQuickPick(
			[
				{ label: "Enter API Key (Mantle)", action: "enter" },
				{ label: "Clear API Key (Mantle)", action: "clear" },
				{ label: "Set AWS Profile (Native)", action: "profile" },
				{ label: "Change Region", action: "region" },
				{ label: "Show Logs", action: "logs" },
			],
			{
				title: "Manage AWS Bedrock",
				placeHolder: "Select an action",
			}
		);

		if (!action) {
			return;
		}

		switch (action.action) {
			case "enter": {
				const apiKey = await vscode.window.showInputBox({
					title: "AWS Bedrock API Key",
					prompt: "Enter your AWS Bedrock API key (from AWS Bedrock Console)",
					ignoreFocusOut: true,
					password: true,
					placeHolder: "bedrock-api-key-...",
				});

				if (apiKey && apiKey.trim()) {
					await provider.setApiKey(apiKey.trim());
					vscode.window.showInformationMessage("AWS Bedrock API key saved");
				}
				break;
			}

			case "clear": {
				await provider.clearApiKey();
				break;
			}

			case "profile": {
				const current = config.get<string>("awsProfile", "");
				const entered = await vscode.window.showInputBox({
					title: "AWS Profile (Native Bedrock)",
					prompt: "Optional AWS named profile to use for native Bedrock (Converse). Leave empty to use default credentials.",
					ignoreFocusOut: true,
					value: current,
					placeHolder: "e.g. default, my-sso-profile (leave blank for default chain)",
				});

				if (typeof entered === "string") {
					await config.update("awsProfile", entered.trim(), vscode.ConfigurationTarget.Global);
					vscode.window.showInformationMessage(
						entered.trim()
							? `AWS profile set to '${entered.trim()}'`
							: "AWS profile cleared (using default credentials)"
					);
				}
				break;
			}

			case "region": {
				const regions = [
					{ label: "US East (N. Virginia)", value: "us-east-1" },
					{ label: "US East (Ohio)", value: "us-east-2" },
					{ label: "US West (Oregon)", value: "us-west-2" },
					{ label: "Europe (Ireland)", value: "eu-west-1" },
					{ label: "Europe (London)", value: "eu-west-2" },
					{ label: "Europe (Frankfurt)", value: "eu-central-1" },
					{ label: "Europe (Stockholm)", value: "eu-north-1" },
					{ label: "Europe (Milan)", value: "eu-south-1" },
					{ label: "Asia Pacific (Mumbai)", value: "ap-south-1" },
					{ label: "Asia Pacific (Tokyo)", value: "ap-northeast-1" },
					{ label: "Asia Pacific (Jakarta)", value: "ap-southeast-3" },
					{ label: "South America (São Paulo)", value: "sa-east-1" },
				];

				const currentRegion = config.get<string>("region", "us-east-1");
				const selected = await vscode.window.showQuickPick(regions, {
					title: "Select AWS Region",
					placeHolder: `Current: ${currentRegion}`,
				});

				if (selected) {
					await config.update("region", selected.value, vscode.ConfigurationTarget.Global);
					vscode.window.showInformationMessage(`Region set to ${selected.label}`);
				}
				break;
			}

			case "logs": {
				output.show(true);
				break;
			}
		}
	};

	const showLogsHandler = async () => {
		output.show(true);
	};

	// Register clear API key command
	const clearApiKeyHandler = async () => {
		await provider.clearApiKey();
	};

	// Register commands with unique IDs
	registerCommandSafe(context, "bedrock-mantle-vscode-chat.manage", manageHandler);
	registerCommandSafe(context, "bedrock-mantle-vscode-chat.showLogs", showLogsHandler);
	registerCommandSafe(context, "bedrock-mantle-vscode-chat.clearApiKey", clearApiKeyHandler);

	// Best-effort legacy IDs (don't fail activation if they collide)
	registerCommandSafe(context, "aws-bedrock.manage", manageHandler);
	registerCommandSafe(context, "aws-bedrock.showLogs", showLogsHandler);
	registerCommandSafe(context, "aws-bedrock.clearApiKey", clearApiKeyHandler);

	// Add to subscriptions
	context.subscriptions.push(providerDisposable);

	// Listen for configuration changes
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration("aws-bedrock")) {
				provider.refresh();
			}
		})
	);
}

export function deactivate() {
	// Cleanup if needed
}
