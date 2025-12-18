/**
 * AWS Bedrock VSCode Chat Extension
 * Entry point for the extension
 */

import * as vscode from "vscode";
import { BedrockMantleProvider } from "./provider";

export function activate(context: vscode.ExtensionContext) {
	console.log("AWS Bedrock extension is activating...");

	const output = vscode.window.createOutputChannel("AWS Bedrock (Mantle)");
	context.subscriptions.push(output);
	output.appendLine(`AWS Bedrock (Mantle) activated at ${new Date().toISOString()}`);
	
	// Build User-Agent string
	const extVersion = (context.extension.packageJSON as { version?: string } | undefined)?.version ?? "unknown";
	const vscodeVersion = vscode.version;
	const userAgent = `bedrock-vscode-chat/${extVersion} VSCode/${vscodeVersion}`;
	output.appendLine(`Version: ${extVersion} | VS Code: ${vscodeVersion}`);

	console.log(`Extension version: ${extVersion}, VSCode version: ${vscodeVersion}`);

	// Get configuration
	const config = vscode.workspace.getConfiguration("aws-bedrock");

	// Create and register provider
	const provider = new BedrockMantleProvider(context.secrets, config, userAgent, output);
	console.log("Created BedrockMantleProvider");

	const providerDisposable = vscode.lm.registerLanguageModelChatProvider(
		"aws-bedrock",
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
	const manageCommand = vscode.commands.registerCommand("aws-bedrock.manage", async () => {
		const action = await vscode.window.showQuickPick(
			[
				{ label: "Enter API Key", action: "enter" },
				{ label: "Clear API Key", action: "clear" },
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
	});

	const showLogsCommand = vscode.commands.registerCommand("aws-bedrock.showLogs", async () => {
		output.show(true);
	});

	// Register clear API key command
	const clearCommand = vscode.commands.registerCommand("aws-bedrock.clearApiKey", async () => {
		await provider.clearApiKey();
	});

	// Add to subscriptions
	context.subscriptions.push(providerDisposable, manageCommand, clearCommand, showLogsCommand);

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
