/**
 * GitHub Copilot Chat Model Provider for Amazon Bedrock
 * Entry point for the extension
 *
 * Registers two separate language model providers, because native Amazon Bedrock
 * (Converse API) and Mantle (OpenAI-compatible API) are genuinely different
 * Amazon Bedrock endpoints — different regions, different auth details, and
 * different model coverage (no Claude model is invocable through Mantle's
 * Chat Completions API on any Amazon Bedrock endpoint).
 */

import * as vscode from "vscode";
import { NativeBedrockProvider } from "./provider";
import { MantleProvider } from "./mantleProvider";
import { ConfigViewProvider } from "./webview/configViewProvider";

export function activate(context: vscode.ExtensionContext) {
	const output = vscode.window.createOutputChannel("Amazon Bedrock (Copilot Chat)");
	context.subscriptions.push(output);

	const registerCommandSafe = (commandId: string, handler: (...args: any[]) => any): void => {
		try {
			context.subscriptions.push(vscode.commands.registerCommand(commandId, handler));
		} catch (e) {
			// VS Code throws if a command ID is already registered (often due to multiple installs/dev hosts).
			// Don't fail activation; just skip and rely on the existing registration.
			const msg = `Command '${commandId}' already exists; skipping registration.`;
			output.appendLine(`WARNING: ${msg}`);
		}
	};

	output.appendLine("Amazon Bedrock (Copilot Chat) extension is activating...");
	output.appendLine(`Amazon Bedrock (Copilot Chat) activated at ${new Date().toISOString()}`);

	// Build User-Agent string
	const extVersion = (context.extension.packageJSON as { version?: string } | undefined)?.version ?? "unknown";
	const vscodeVersion = vscode.version;
	const userAgent = `bedrock-vscode-chat/${extVersion} VSCode/${vscodeVersion}`;
	output.appendLine(`Version: ${extVersion} | VS Code: ${vscodeVersion}`);

	// Get configuration (both providers currently share the "aws-bedrock" settings
	// namespace; provider-specific keys are prefixed, e.g. mantleAuthMethod/mantleRegion).
	const config = vscode.workspace.getConfiguration("aws-bedrock");

	// Create and register the native Amazon Bedrock (Converse) provider. Keeps the extension's
	// original vendor ID so existing users' native model selections keep working.
	const nativeProvider = new NativeBedrockProvider(config, userAgent, output, context.globalState);
	const nativeDisposable = vscode.lm.registerLanguageModelChatProvider(
		"easytocloud.bedrock-mantle-vscode-chat",
		nativeProvider
	);
	output.appendLine("Registered native Amazon Bedrock provider with VSCode");

	// Create and register the Mantle (OpenAI-compatible) provider under its own vendor ID.
	const mantleProvider = new MantleProvider(context.secrets, config, userAgent, output, context.globalState);
	const mantleDisposable = vscode.lm.registerLanguageModelChatProvider("easytocloud.bedrock-mantle", mantleProvider);
	output.appendLine("Registered Mantle provider with VSCode");

	context.subscriptions.push(nativeDisposable, mantleDisposable);

	// Register configuration webview
	const configViewProvider = new ConfigViewProvider(
		context.extensionUri,
		nativeProvider,
		mantleProvider,
		output
	);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			ConfigViewProvider.viewType,
			configViewProvider,
			{ webviewOptions: { retainContextWhenHidden: true } }
		)
	);
	output.appendLine("Registered configuration webview");

	// Eagerly fetch models to populate the picker
	const cancellationToken = new vscode.CancellationTokenSource().token;
	const nativeModelsPromise = nativeProvider.provideLanguageModelChatInformation({ silent: true }, cancellationToken);
	const mantleModelsPromise = mantleProvider.provideLanguageModelChatInformation({ silent: true }, cancellationToken);

	nativeModelsPromise.then(
		(models) => {
			output.appendLine(`Successfully loaded ${models.length} native Amazon Bedrock models`);
			if (models.length === 0) {
				output.appendLine("No native models returned - check AWS credentials/region configuration");
			} else {
				output.appendLine(`Native models: ${models.map((m) => m.name).join(", ")}`);
			}
		},
		(error) => {
			output.appendLine(`ERROR: Failed to load native Amazon Bedrock models: ${error}`);
			if (error instanceof Error) {
				output.appendLine(`  ${error.stack || error.message}`);
			}
		}
	);

	mantleModelsPromise.then(
		(models) => {
			output.appendLine(`Successfully loaded ${models.length} Mantle models`);
			if (models.length === 0) {
				output.appendLine("No Mantle models returned - might need API key or check configuration");
			} else {
				output.appendLine(`Mantle models: ${models.map((m) => m.name).join(", ")}`);
			}
		},
		(error) => {
			output.appendLine(`ERROR: Failed to load Mantle models: ${error}`);
			if (error instanceof Error) {
				output.appendLine(`  ${error.stack || error.message}`);
			}
		}
	);

	// Check for zero-models trap and show warning if both providers have no models
	Promise.allSettled([nativeModelsPromise, mantleModelsPromise]).then(([nResult, mResult]) => {
		const nativeCount = nResult.status === "fulfilled" ? nResult.value.length : 0;
		const mantleCount = mResult.status === "fulfilled" ? mResult.value.length : 0;
		if (nativeCount === 0 && mantleCount === 0) {
			vscode.window
				.showWarningMessage(
					"Amazon Bedrock (Copilot Chat): no chat models are available. Check that at least one provider is enabled and configured correctly.",
					"Configure"
				)
				.then((choice) => {
					if (choice === "Configure") {
						vscode.commands.executeCommand("aws-bedrock.revealConfigView");
					}
				});
		}
	});

	const showLogsHandler = async () => {
		output.show(true);
	};

	const clearApiKeyHandler = async () => {
		await mantleProvider.clearApiKey();
	};

	const revealConfigViewHandler = async () => {
		await vscode.commands.executeCommand("aws-bedrock.configView.focus");
	};

	// Register commands with unique IDs. The old per-provider "manage" commands now
	// just reveal the configuration webview (which covers both providers in one place)
	// instead of opening their old QuickPick menus, so existing keybindings/palette
	// muscle-memory and the Copilot Chat model picker's gear icon keep working.
	registerCommandSafe("aws-bedrock.revealConfigView", revealConfigViewHandler);
	registerCommandSafe("bedrock-mantle-vscode-chat.manage", revealConfigViewHandler);
	registerCommandSafe("bedrock-mantle-vscode-chat.manageMantle", revealConfigViewHandler);
	registerCommandSafe("bedrock-mantle-vscode-chat.showLogs", showLogsHandler);
	registerCommandSafe("bedrock-mantle-vscode-chat.clearApiKey", clearApiKeyHandler);

	// Best-effort legacy IDs (don't fail activation if they collide)
	registerCommandSafe("aws-bedrock.manage", revealConfigViewHandler);
	registerCommandSafe("aws-bedrock.showLogs", showLogsHandler);
	registerCommandSafe("aws-bedrock.clearApiKey", clearApiKeyHandler);

	// Listen for configuration changes and refresh both providers. Settings are cheap to
	// re-fetch and each provider only acts on the keys it actually reads.
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration("aws-bedrock")) {
				nativeProvider.refresh();
				mantleProvider.refresh();
			}
		})
	);
}

export function deactivate() {
	// Cleanup if needed
}
