/**
 * AWS Bedrock GitHub Copilot Chat Extension
 * Entry point for the extension
 *
 * Registers two separate language model providers, because native Bedrock
 * (Converse API) and Mantle (OpenAI-compatible API) are genuinely different
 * AWS Bedrock endpoints — different regions, different auth details, and
 * different model coverage (no Claude model is invocable through Mantle's
 * Chat Completions API on any Bedrock endpoint).
 */

import * as vscode from "vscode";
import { NativeBedrockProvider } from "./provider";
import { MantleProvider } from "./mantleProvider";
import { AWS_BEDROCK_REGIONS, AWS_MANTLE_REGIONS } from "./regions";
import { listKnownAwsProfiles } from "./awsProfiles";

export function activate(context: vscode.ExtensionContext) {
	const output = vscode.window.createOutputChannel("AWS Bedrock");
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

	output.appendLine("AWS Bedrock extension is activating...");
	output.appendLine(`AWS Bedrock activated at ${new Date().toISOString()}`);

	// Build User-Agent string
	const extVersion = (context.extension.packageJSON as { version?: string } | undefined)?.version ?? "unknown";
	const vscodeVersion = vscode.version;
	const userAgent = `bedrock-vscode-chat/${extVersion} VSCode/${vscodeVersion}`;
	output.appendLine(`Version: ${extVersion} | VS Code: ${vscodeVersion}`);

	// Get configuration (both providers currently share the "aws-bedrock" settings
	// namespace; provider-specific keys are prefixed, e.g. mantleAuthMethod/mantleRegion).
	const config = vscode.workspace.getConfiguration("aws-bedrock");

	// Create and register the native Bedrock (Converse) provider. Keeps the extension's
	// original vendor ID so existing users' native model selections keep working.
	const nativeProvider = new NativeBedrockProvider(config, userAgent, output, context.globalState);
	const nativeDisposable = vscode.lm.registerLanguageModelChatProvider(
		"easytocloud.bedrock-mantle-vscode-chat",
		nativeProvider
	);
	output.appendLine("Registered native Bedrock provider with VSCode");

	// Create and register the Mantle (OpenAI-compatible) provider under its own vendor ID.
	const mantleProvider = new MantleProvider(context.secrets, config, userAgent, output, context.globalState);
	const mantleDisposable = vscode.lm.registerLanguageModelChatProvider("easytocloud.bedrock-mantle", mantleProvider);
	output.appendLine("Registered Mantle provider with VSCode");

	context.subscriptions.push(nativeDisposable, mantleDisposable);

	// Eagerly fetch models to populate the picker
	const cancellationToken = new vscode.CancellationTokenSource().token;
	const nativeModelsPromise = nativeProvider.provideLanguageModelChatInformation({ silent: true }, cancellationToken);
	const mantleModelsPromise = mantleProvider.provideLanguageModelChatInformation({ silent: true }, cancellationToken);

	nativeModelsPromise.then(
		(models) => {
			output.appendLine(`Successfully loaded ${models.length} native Bedrock models`);
			if (models.length === 0) {
				output.appendLine("No native models returned - check AWS credentials/region configuration");
			} else {
				output.appendLine(`Native models: ${models.map((m) => m.name).join(", ")}`);
			}
		},
		(error) => {
			output.appendLine(`ERROR: Failed to load native Bedrock models: ${error}`);
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
					"AWS Bedrock: no chat models are available. Check that at least one provider is enabled and configured correctly.",
					"Manage Native",
					"Manage Mantle"
				)
				.then((choice) => {
					if (choice === "Manage Native") {
						vscode.commands.executeCommand("bedrock-mantle-vscode-chat.manage");
					} else if (choice === "Manage Mantle") {
						vscode.commands.executeCommand("bedrock-mantle-vscode-chat.manageMantle");
					}
				});
		}
	});

	// Shared AWS profile picker using discovered profiles from ~/.aws/config / credentials
	const pickAwsProfile = async (current: string, title: string): Promise<string | undefined> => {
		const profiles = await listKnownAwsProfiles();
		const displayCurrent = current || "(default chain)";
		const items: (vscode.QuickPickItem & { profileValue?: string; custom?: boolean })[] = [
			...profiles.map((p) => ({
				label: p === current ? `$(check) ${p}` : p,
				description: p === current ? "currently selected" : undefined,
				profileValue: p,
			})),
			{ label: "", kind: vscode.QuickPickItemKind.Separator },
			{ label: "$(edit) Type a custom profile name...", custom: true },
			{ label: "$(circle-slash) Use default credential chain (clear profile)", profileValue: "" },
		];

		const picked = await vscode.window.showQuickPick(items, {
			title: `${title} — Current: ${displayCurrent}`,
			placeHolder: "Select a profile",
		});

		if (!picked) {
			return undefined;
		}

		if (picked.custom) {
			return vscode.window.showInputBox({
				title,
				prompt: "Optional AWS named profile. Leave empty to use default credentials.",
				ignoreFocusOut: true,
				value: current,
				placeHolder: "e.g. default, my-sso-profile (leave blank for default chain)",
			});
		}

		return picked.profileValue;
	};

	// Management command for native Bedrock: profile + region + logs.
	const manageNativeHandler = async () => {
		const enabled = config.get<boolean>("enableNative", true);
		const region = config.get<string>("region", "us-east-1");
		const profile = config.get<string>("awsProfile", "") || "(default chain)";

		const statusItems = [
			{
				label: enabled ? "$(check) Native Bedrock is enabled" : "$(circle-slash) Native Bedrock is DISABLED",
				description: `region: ${region} · profile: ${profile}`,
				action: "noop",
			},
			{ label: "", kind: vscode.QuickPickItemKind.Separator },
			...(enabled
				? []
				: [
					{
						label: "$(rocket) Enable this provider",
						action: "enable",
					},
				]),
		];

		const actionItems = [
			{ label: "Set AWS Profile", action: "profile" },
			{ label: "Change Region", action: "region" },
			{ label: "$(plug) Test Connection", action: "test" },
			{ label: "Show Logs", action: "logs" },
		];

		const action = await vscode.window.showQuickPick([...statusItems, ...actionItems], {
			title: "Manage AWS Bedrock (Native)",
			placeHolder: "Select an action",
		});

		if (!action) {
			return;
		}

		switch (action.action) {
			case "noop":
				return;

			case "enable": {
				await config.update("enableNative", true, vscode.ConfigurationTarget.Global);
				vscode.window.showInformationMessage("Native Bedrock provider enabled");
				break;
			}

			case "profile": {
				const current = config.get<string>("awsProfile", "");
				const entered = await pickAwsProfile(current, "AWS Profile (Native Bedrock)");

				if (typeof entered === "string") {
					await config.update("awsProfile", entered.trim(), vscode.ConfigurationTarget.Global);
					vscode.window.showInformationMessage(
						entered.trim() ? `AWS profile set to '${entered.trim()}'` : "AWS profile cleared (using default credentials)"
					);
				}
				break;
			}

			case "region": {
				const regions = AWS_BEDROCK_REGIONS.map((r) => ({ label: r.label, value: r.value }));
				const currentRegion = config.get<string>("region", "us-east-1");
				const selected = await vscode.window.showQuickPick(regions, {
					title: "Select AWS Region (Native Bedrock)",
					placeHolder: `Current: ${currentRegion}`,
				});

				if (selected) {
					await config.update("region", selected.value, vscode.ConfigurationTarget.Global);
					vscode.window.showInformationMessage(`Native Bedrock region set to ${selected.label}`);
				}
				break;
			}

			case "test": {
				const result = await vscode.window.withProgress(
					{
						location: vscode.ProgressLocation.Notification,
						title: "Testing AWS Bedrock connection...",
					},
					() => nativeProvider.provideLanguageModelChatInformation({ silent: false }, cancellationToken)
				);
				if (result.length > 0) {
					vscode.window.showInformationMessage(`Connection OK — ${result.length} model(s) available`);
				}
				break;
			}

			case "logs": {
				output.show(true);
				break;
			}
		}
	};

	// Management command for Mantle: auth method, API key, profile, region, logs.
	const manageMantleHandler = async () => {
		const enabled = config.get<boolean>("enableMantle", true);
		const authMethod = config.get<string>("mantleAuthMethod", "apiKey");
		const region = config.get<string>("mantleRegion", "us-east-1");
		const profile = config.get<string>("mantleAwsProfile", "") || "(default chain)";
		const hideMantleModels = config.get<boolean>("hideMantleModelsFromNative", false);

		const hasStoredKey = await mantleProvider.hasStoredApiKey();
		const authDesc =
			authMethod === "apiKey"
				? hasStoredKey
					? "API key set"
					: "API key NOT set ⚠️"
				: "using AWS credentials";

		const statusItems = [
			{
				label: enabled ? "$(check) Mantle is enabled" : "$(circle-slash) Mantle is DISABLED",
				description: `region: ${region} · ${authDesc}`,
				action: "noop",
			},
			{ label: "", kind: vscode.QuickPickItemKind.Separator },
			...(enabled
				? []
				: [
					{
						label: "$(rocket) Enable this provider",
						action: "enable",
					},
				]),
			...(hideMantleModels && !enabled
				? [
					{
						label: "$(warning) Some models are hidden from BOTH providers",
						detail: "hideMantleModelsFromNative is on but Mantle is disabled",
						action: "fix-hide-trap",
					},
				]
				: []),
		];

		const actionItems = [
			{ label: "Configure Authentication", action: "auth" },
			{ label: "Enter API Key", action: "enter" },
			{ label: "Clear API Key", action: "clear" },
			{ label: "Set AWS Profile", action: "mantle-profile" },
			{ label: "Change Region", action: "region" },
			{ label: "$(plug) Test Connection", action: "test" },
			{ label: "Show Logs", action: "logs" },
		];

		const action = await vscode.window.showQuickPick([...statusItems, ...actionItems], {
			title: "Manage AWS Bedrock Mantle",
			placeHolder: "Select an action",
		});

		if (!action) {
			return;
		}

		switch (action.action) {
			case "noop":
				return;

			case "enable": {
				await config.update("enableMantle", true, vscode.ConfigurationTarget.Global);
				vscode.window.showInformationMessage("Mantle provider enabled");
				break;
			}

			case "fix-hide-trap": {
				await config.update("hideMantleModelsFromNative", false, vscode.ConfigurationTarget.Global);
				vscode.window.showInformationMessage("hideMantleModelsFromNative turned off — models now visible in both providers");
				break;
			}

			case "auth": {
				const currentMethod = config.get<string>("mantleAuthMethod", "apiKey");
				const selected = await vscode.window.showQuickPick(
					[
						{
							label: "API Key",
							description: "Use API key from AWS Bedrock Console",
							detail: "Simpler, no AWS CLI setup needed",
							value: "apiKey",
						},
						{
							label: "AWS Credentials",
							description: "Use AWS profile/credentials",
							detail: "Better for existing AWS setups",
							value: "awsCredentials",
						},
					],
					{
						title: "Select Mantle Authentication Method",
						placeHolder: `Current: ${currentMethod === "apiKey" ? "API Key" : "AWS Credentials"}`,
					}
				);

				if (selected) {
					await config.update("mantleAuthMethod", selected.value, vscode.ConfigurationTarget.Global);
					vscode.window.showInformationMessage(`Mantle authentication set to ${selected.label}`);
				}
				break;
			}

			case "enter": {
				const apiKey = await vscode.window.showInputBox({
					title: "AWS Bedrock API Key (Mantle)",
					prompt: "Enter your AWS Bedrock API key from AWS Bedrock Console",
					ignoreFocusOut: true,
					password: true,
					placeHolder: "bedrock-api-key-...",
				});

				if (apiKey && apiKey.trim()) {
					await mantleProvider.setApiKey(apiKey.trim());
					vscode.window.showInformationMessage("AWS Bedrock API key saved");
				}
				break;
			}

			case "clear": {
				await mantleProvider.clearApiKey();
				break;
			}

			case "mantle-profile": {
				const current = config.get<string>("mantleAwsProfile", "");
				const entered = await pickAwsProfile(current, "AWS Profile (Mantle)");

				if (typeof entered === "string") {
					await config.update("mantleAwsProfile", entered.trim(), vscode.ConfigurationTarget.Global);
					vscode.window.showInformationMessage(
						entered.trim()
							? `Mantle AWS profile set to '${entered.trim()}'`
							: "Mantle AWS profile cleared (using default credentials)"
					);
				}
				break;
			}

			case "region": {
				const regions = AWS_MANTLE_REGIONS.map((r) => ({ label: r.label, value: r.value }));
				const currentRegion = config.get<string>("mantleRegion", "us-east-1");
				const selected = await vscode.window.showQuickPick(regions, {
					title: "Select AWS Region (Mantle)",
					placeHolder: `Current: ${currentRegion}`,
				});

				if (selected) {
					await config.update("mantleRegion", selected.value, vscode.ConfigurationTarget.Global);
					vscode.window.showInformationMessage(`Mantle region set to ${selected.label}`);
				}
				break;
			}

			case "test": {
				const result = await vscode.window.withProgress(
					{
						location: vscode.ProgressLocation.Notification,
						title: "Testing Mantle connection...",
					},
					() => mantleProvider.provideLanguageModelChatInformation({ silent: false }, cancellationToken)
				);
				if (result.length > 0) {
					vscode.window.showInformationMessage(`Connection OK — ${result.length} model(s) available`);
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

	const clearApiKeyHandler = async () => {
		await mantleProvider.clearApiKey();
	};

	// Register commands with unique IDs
	registerCommandSafe("bedrock-mantle-vscode-chat.manage", manageNativeHandler);
	registerCommandSafe("bedrock-mantle-vscode-chat.manageMantle", manageMantleHandler);
	registerCommandSafe("bedrock-mantle-vscode-chat.showLogs", showLogsHandler);
	registerCommandSafe("bedrock-mantle-vscode-chat.clearApiKey", clearApiKeyHandler);

	// Best-effort legacy IDs (don't fail activation if they collide)
	registerCommandSafe("aws-bedrock.manage", manageNativeHandler);
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
