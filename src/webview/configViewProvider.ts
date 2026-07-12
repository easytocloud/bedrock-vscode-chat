/**
 * Configuration webview view provider
 * Displays Amazon Bedrock (Copilot Chat) settings in a sidebar accordion panel
 */

import * as vscode from "vscode";
import { NativeBedrockProvider } from "../provider";
import { MantleProvider } from "../mantleProvider";
import {
	getNativeStatus,
	getMantleStatus,
	testNativeConnection,
	testMantleConnection,
	getAvailableProfiles,
	getBedrockRegions,
	getMantleRegions,
	setMantleApiKey,
	clearMantleApiKey,
} from "../configActions";

export class ConfigViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = "aws-bedrock.configView";

	private view?: vscode.WebviewView;
	private cancellationTokenSource = new vscode.CancellationTokenSource();

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly nativeProvider: NativeBedrockProvider,
		private readonly mantleProvider: MantleProvider,
		private readonly output: vscode.OutputChannel
	) {}

	public async resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	) {
		this.view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "src/webview")],
		};

		webviewView.webview.html = await this.getHtmlContent(webviewView.webview);

		// Handle messages from webview
		webviewView.webview.onDidReceiveMessage(async (message) => {
			await this.handleWebviewMessage(message, webviewView.webview);
		});

		// Send initial state
		await this.updateWebviewState(webviewView.webview);

		// Listen for configuration changes
		const configListener = vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration("aws-bedrock")) {
				this.updateWebviewState(webviewView.webview);
			}
		});

		webviewView.onDidDispose(() => {
			configListener.dispose();
			this.cancellationTokenSource.dispose();
		});
	}

	private async handleWebviewMessage(message: any, webview: vscode.Webview) {
		const config = vscode.workspace.getConfiguration("aws-bedrock");

		switch (message.type) {
			case "updateSetting": {
				const { key, value } = message;
				// `config` is already scoped to the "aws-bedrock" section, but data-key attributes
				// in the webview HTML carry the fully-qualified "aws-bedrock.xxx" id (matching
				// package.json), so strip the prefix before updating or this silently writes to a
				// nonexistent nested key instead of the real setting.
				const relativeKey = key.startsWith("aws-bedrock.") ? key.slice("aws-bedrock.".length) : key;
				await config.update(relativeKey, value, vscode.ConfigurationTarget.Global);
				await this.updateWebviewState(webview);
				break;
			}

			case "setApiKey": {
				const { value } = message;
				await setMantleApiKey(this.mantleProvider, value);
				await this.updateWebviewState(webview);
				vscode.window.showInformationMessage("Amazon Bedrock API key saved");
				break;
			}

			case "clearApiKey": {
				await clearMantleApiKey(this.mantleProvider);
				await this.updateWebviewState(webview);
				vscode.window.showInformationMessage("Amazon Bedrock API key cleared");
				break;
			}

			case "testConnection": {
				const { provider } = message;
				try {
					let count = 0;
					await vscode.window.withProgress(
						{
							location: vscode.ProgressLocation.Notification,
							title: `Testing ${provider === "native" ? "Native" : "Mantle"} connection...`,
						},
						async () => {
							if (provider === "native") {
								count = await testNativeConnection(
									this.nativeProvider,
									this.cancellationTokenSource.token
								);
							} else {
								count = await testMantleConnection(
									this.mantleProvider,
									this.cancellationTokenSource.token
								);
							}
						}
					);

					if (count > 0) {
						vscode.window.showInformationMessage(
							`Connection OK — ${count} model(s) available`
						);
					}
				} catch (error) {
					const message =
						error instanceof Error ? error.message : "Unknown error during connection test";
					vscode.window.showErrorMessage(`Connection test failed: ${message}`);
					this.output.appendLine(`ERROR: Connection test failed: ${message}`);
				}
				break;
			}

			case "showLogs": {
				this.output.show(true);
				break;
			}
		}
	}

	private async updateWebviewState(webview: vscode.Webview) {
		if (!this.view) {
			return;
		}

		const config = vscode.workspace.getConfiguration("aws-bedrock");
		const nativeStatus = getNativeStatus(config);
		const mantleStatus = await getMantleStatus(config, this.mantleProvider);
		const profiles = await getAvailableProfiles((error) => {
			const message = error instanceof Error ? error.message : String(error);
			this.output.appendLine(
				`WARNING: Could not read AWS profiles from ~/.aws/config or ~/.aws/credentials: ${message}`
			);
			if (message.toLowerCase().includes("not permitted") || message.toLowerCase().includes("eacces")) {
				this.output.appendLine(
					"  If ~/.aws is a symlink into a cloud-synced folder (iCloud Drive, Dropbox, etc.), " +
						"VS Code may need OS-level permission to read it — check System Settings → Privacy & Security → Files and Folders on macOS."
				);
			}
		});
		const bedrockRegions = getBedrockRegions();
		const mantleRegions = getMantleRegions();

		const state = {
			// General settings
			showAllModels: config.get<boolean>("showAllModels", true),
			logLevel: config.get<string>("logLevel", "info"),
			requestTimeout: config.get<number>("requestTimeout", 120000),

			// Native settings
			enableNative: nativeStatus.enabled,
			awsProfile: nativeStatus.profile,
			region: nativeStatus.region,
			hideMantleModelsFromNative: config.get<boolean>("hideMantleModelsFromNative", false),

			// Mantle settings
			enableMantle: mantleStatus.enabled,
			mantleAuthMethod: mantleStatus.authMethod,
			mantleAwsProfile: mantleStatus.profile,
			mantleRegion: mantleStatus.region,
			mantleHasStoredKey: mantleStatus.hasStoredKey,

			// Chat behavior settings
			sendTools: config.get<boolean>("sendTools", true),
			emitPlaceholders: config.get<boolean>("emitPlaceholders", true),
			enablePromptCaching: config.get<boolean>("enablePromptCaching", true),
			assumeLongContextClaudeModels: config.get<boolean>("assumeLongContextClaudeModels", true),

			// Model metadata settings
			modelMetadataSource: config.get<string>("modelMetadataSource", "none"),
			modelMetadataUrl: config.get<string>(
				"modelMetadataUrl",
				"https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json"
			),
			modelMetadataCacheHours: config.get<number>("modelMetadataCacheHours", 24),

			// Dropdown options
			profiles,
			bedrockRegions: bedrockRegions.map((r) => ({ label: r.label, value: r.value })),
			mantleRegions: mantleRegions.map((r) => ({ label: r.label, value: r.value })),
		};

		await webview.postMessage({
			type: "setState",
			state,
		});
	}

	private async getHtmlContent(webview: vscode.Webview): Promise<string> {
		const nonce = getNonce();

		return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'">
  <title>Amazon Bedrock (Copilot Chat) Configuration</title>
  <style>
    :root {
      --vscode-editor-background: #1e1e1e;
      --vscode-foreground: #d4d4d4;
      --vscode-button-background: #0e639c;
      --vscode-button-hoverBackground: #1177bb;
      --vscode-input-background: #3c3c3c;
      --vscode-input-border: #555555;
      --vscode-input-foreground: #cccccc;
      --vscode-dropdown-background: #3c3c3c;
      --vscode-dropdown-border: #555555;
      --vscode-dropdown-foreground: #cccccc;
      --vscode-panel-border: #3e3e42;
      --vscode-panel-background: #252526;
      --vscode-textLink-foreground: #569cd6;
      --color-success: #89d185;
      --color-error: #f48771;
    }

    * {
      box-sizing: border-box;
    }

    html, body {
      width: 100%;
      min-width: 0;
    }

    body {
      margin: 0;
      padding: 8px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 12px;
      background: var(--vscode-editor-background);
      color: var(--vscode-foreground);
      line-height: 1.4;
    }

    .header {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }

    .header-title {
      font-size: 13px;
      font-weight: 600;
    }

    .section {
      margin-bottom: 8px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 3px;
      overflow: hidden;
    }

    .section-header {
      padding: 8px;
      background: var(--vscode-panel-background);
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      user-select: none;
      transition: background 0.15s;
    }

    .section-header:hover {
      background: #2d2d30;
    }

    .section-toggle {
      display: inline-flex;
      width: 16px;
      height: 16px;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      transition: transform 0.2s;
    }

    .section.collapsed .section-toggle {
      transform: rotate(-90deg);
    }

    .section-title {
      font-weight: 500;
      font-size: 12px;
    }

    .status-badge {
      margin-left: auto;
      font-size: 10px;
      padding: 2px 4px;
      border-radius: 2px;
      background: rgba(137, 209, 133, 0.15);
      color: var(--color-success);
    }

    .status-badge.disabled {
      background: rgba(244, 135, 113, 0.15);
      color: var(--color-error);
    }

    .section-content {
      padding: 8px;
      background: var(--vscode-editor-background);
      display: none;
    }

    .section.expanded .section-content {
      display: block;
    }

    .form-group {
      margin-bottom: 10px;
    }

    .form-group:last-child {
      margin-bottom: 0;
    }

    .form-label {
      display: block;
      font-size: 11px;
      font-weight: 500;
      margin-bottom: 3px;
      color: var(--vscode-foreground);
    }

    .form-label-hint {
      display: block;
      font-size: 10px;
      color: #969696;
      margin-top: 2px;
    }

    .form-control {
      width: 100%;
      padding: 4px 6px;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 2px;
      font-size: 11px;
      font-family: inherit;
    }

    .form-control:focus {
      outline: none;
      border-color: var(--vscode-textLink-foreground);
      box-shadow: 0 0 0 1px var(--vscode-textLink-foreground);
    }

    .checkbox-group {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .checkbox-group input[type="checkbox"] {
      width: 14px;
      height: 14px;
      cursor: pointer;
    }

    .checkbox-group label {
      margin: 0;
      font-weight: normal;
      cursor: pointer;
    }

    .button-group {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
      margin-top: 8px;
    }

    .button {
      padding: 4px 10px;
      border: none;
      border-radius: 2px;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s;
    }

    .button-primary {
      background: var(--vscode-button-background);
      color: white;
    }

    .button-primary:hover {
      background: var(--vscode-button-hoverBackground);
    }

    .button-secondary {
      background: var(--vscode-panel-background);
      color: var(--vscode-foreground);
      border: 1px solid var(--vscode-panel-border);
    }

    .button-secondary:hover {
      background: #2d2d30;
    }

    .status-line {
      font-size: 10px;
      color: #969696;
      margin-bottom: 6px;
      padding: 4px;
      background: var(--vscode-panel-background);
      border-radius: 2px;
    }

    .footer {
      margin-top: 12px;
      padding-top: 8px;
      border-top: 1px solid var(--vscode-panel-border);
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-title">⚙ Configuration</div>
  </div>

  <!-- General Section -->
  <div class="section expanded" data-section="general">
    <div class="section-header" data-action="toggle">
      <span class="section-toggle">▼</span>
      <span class="section-title">General</span>
    </div>
    <div class="section-content">
      <div class="form-group">
        <label class="form-label">Show All Models</label>
        <div class="checkbox-group">
          <input type="checkbox" id="showAllModels" data-key="aws-bedrock.showAllModels">
          <label for="showAllModels">Show specialized variants like safeguard models</label>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Log Level</label>
        <select class="form-control" id="logLevel" data-key="aws-bedrock.logLevel">
          <option value="verbose">verbose</option>
          <option value="info" selected>info</option>
          <option value="warning">warning</option>
          <option value="error">error</option>
          <option value="none">none</option>
        </select>
        <span class="form-label-hint">How much detail to log to the Amazon Bedrock (Copilot Chat) Output channel</span>
      </div>

      <div class="form-group">
        <label class="form-label">Request Timeout (ms)</label>
        <input type="number" class="form-control" id="requestTimeout" data-key="aws-bedrock.requestTimeout" value="120000">
        <span class="form-label-hint">Set to 0 to disable</span>
      </div>
    </div>
  </div>

  <!-- Native Section -->
  <div class="section expanded" data-section="native">
    <div class="section-header" data-action="toggle">
      <span class="section-toggle">▼</span>
      <span class="section-title">Native (Converse API)</span>
      <span class="status-badge" id="native-badge">✓ enabled</span>
    </div>
    <div class="section-content">
      <div class="status-line" id="native-status">Region: us-east-1 · Profile: default</div>

      <div class="form-group">
        <label class="form-label">Enable Provider</label>
        <div class="checkbox-group">
          <input type="checkbox" id="enableNative" data-key="aws-bedrock.enableNative" checked>
          <label for="enableNative">Use native Amazon Bedrock Converse API</label>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">AWS Profile</label>
        <select class="form-control" id="awsProfile" data-key="aws-bedrock.awsProfile"></select>
        <span class="form-label-hint">From ~/.aws/config. Leave empty for default chain.</span>
      </div>

      <div class="form-group">
        <label class="form-label">Region</label>
        <select class="form-control" id="region" data-key="aws-bedrock.region"></select>
      </div>

      <div class="form-group">
        <label class="form-label">Hide Models</label>
        <div class="checkbox-group">
          <input type="checkbox" id="hideMantleModelsFromNative" data-key="aws-bedrock.hideMantleModelsFromNative">
          <label for="hideMantleModelsFromNative">Hide models also in Mantle</label>
        </div>
        <span class="form-label-hint">Open-weight models appear in both by default</span>
      </div>

      <div class="button-group">
        <button class="button button-primary" data-action="testConnection" data-provider="native">Test Connection</button>
      </div>
    </div>
  </div>

  <!-- Mantle Section -->
  <div class="section collapsed" data-section="mantle">
    <div class="section-header" data-action="toggle">
      <span class="section-toggle">▼</span>
      <span class="section-title">Mantle (OpenAI-compatible)</span>
      <span class="status-badge" id="mantle-badge">✓ enabled</span>
    </div>
    <div class="section-content">
      <div class="status-line" id="mantle-status">Region: us-east-1 · Auth: API key set</div>

      <div class="form-group">
        <label class="form-label">Enable Provider</label>
        <div class="checkbox-group">
          <input type="checkbox" id="enableMantle" data-key="aws-bedrock.enableMantle" checked>
          <label for="enableMantle">Use Amazon Bedrock Mantle</label>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Authentication Method</label>
        <select class="form-control" id="mantleAuthMethod" data-key="aws-bedrock.mantleAuthMethod">
          <option value="apiKey">API Key</option>
          <option value="awsCredentials">AWS Credentials</option>
        </select>
      </div>

      <div class="form-group">
        <label class="form-label">API Key</label>
        <input type="password" class="form-control" id="mantleApiKey" placeholder="••••••••••••••" data-secret="true">
        <span class="form-label-hint">From the Amazon Bedrock console. Only stored locally.</span>
      </div>

      <div class="form-group">
        <label class="form-label">AWS Profile (if using credentials)</label>
        <select class="form-control" id="mantleAwsProfile" data-key="aws-bedrock.mantleAwsProfile"></select>
      </div>

      <div class="form-group">
        <label class="form-label">Region</label>
        <select class="form-control" id="mantleRegion" data-key="aws-bedrock.mantleRegion"></select>
        <span class="form-label-hint">Mantle is available in fewer regions than native</span>
      </div>

      <div class="button-group">
        <button class="button button-primary" data-action="testConnection" data-provider="mantle">Test Connection</button>
        <button class="button button-secondary" data-action="clearApiKey">Clear API Key</button>
      </div>
    </div>
  </div>

  <!-- Chat Behavior Section -->
  <div class="section collapsed" data-section="chat">
    <div class="section-header" data-action="toggle">
      <span class="section-toggle">▼</span>
      <span class="section-title">Chat Behavior</span>
    </div>
    <div class="section-content">
      <div class="form-group">
        <label class="form-label">Send Tools</label>
        <div class="checkbox-group">
          <input type="checkbox" id="sendTools" data-key="aws-bedrock.sendTools" checked>
          <label for="sendTools">Send Copilot's tool definitions</label>
        </div>
        <span class="form-label-hint">Turn off to reduce latency, disables tool calling</span>
      </div>

      <div class="form-group">
        <label class="form-label">Emit Placeholders</label>
        <div class="checkbox-group">
          <input type="checkbox" id="emitPlaceholders" data-key="aws-bedrock.emitPlaceholders" checked>
          <label for="emitPlaceholders">Show "Thinking…" while waiting</label>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Prompt Caching</label>
        <div class="checkbox-group">
          <input type="checkbox" id="enablePromptCaching" data-key="aws-bedrock.enablePromptCaching" checked>
          <label for="enablePromptCaching">Cache tools and conversation history</label>
        </div>
        <span class="form-label-hint">Reduces cost and latency on native Converse</span>
      </div>

      <div class="form-group">
        <label class="form-label">Long Context Claude</label>
        <div class="checkbox-group">
          <input type="checkbox" id="assumeLongContextClaudeModels" data-key="aws-bedrock.assumeLongContextClaudeModels" checked>
          <label for="assumeLongContextClaudeModels">Report 1M token window</label>
        </div>
      </div>
    </div>
  </div>

  <!-- Model Metadata Section -->
  <div class="section collapsed" data-section="metadata">
    <div class="section-header" data-action="toggle">
      <span class="section-toggle">▼</span>
      <span class="section-title">Model Metadata</span>
    </div>
    <div class="section-content">
      <div class="form-group">
        <label class="form-label">Metadata Source</label>
        <select class="form-control" id="modelMetadataSource" data-key="aws-bedrock.modelMetadataSource">
          <option value="none">none</option>
          <option value="litellm">litellm</option>
        </select>
        <span class="form-label-hint">"none" uses built-in heuristics, "litellm" fetches a public registry</span>
      </div>

      <div class="form-group">
        <label class="form-label">Registry URL</label>
        <input type="text" class="form-control" id="modelMetadataUrl" data-key="aws-bedrock.modelMetadataUrl">
        <span class="form-label-hint">Only used when source is "litellm"</span>
      </div>

      <div class="form-group">
        <label class="form-label">Cache Duration (hours)</label>
        <input type="number" class="form-control" id="modelMetadataCacheHours" data-key="aws-bedrock.modelMetadataCacheHours" min="0">
        <span class="form-label-hint">0 disables caching</span>
      </div>
    </div>
  </div>

  <div class="footer">
    <button class="button button-secondary" data-action="showLogs">Show Logs</button>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    function toggleSection(headerElement) {
      const section = headerElement.closest('.section');
      if (section.classList.contains('collapsed')) {
        section.classList.remove('collapsed');
        section.classList.add('expanded');
      } else {
        section.classList.add('collapsed');
        section.classList.remove('expanded');
      }
    }

    // Wire up every data-action element (CSP blocks inline onclick handlers,
    // so all interaction is delegated through addEventListener here)
    document.querySelectorAll('[data-action="toggle"]').forEach((header) => {
      header.addEventListener('click', () => toggleSection(header));
    });

    document.querySelectorAll('[data-action="testConnection"]').forEach((button) => {
      button.addEventListener('click', () => {
        vscode.postMessage({
          type: 'testConnection',
          provider: button.dataset.provider
        });
      });
    });

    document.querySelectorAll('[data-action="clearApiKey"]').forEach((button) => {
      button.addEventListener('click', () => {
        vscode.postMessage({ type: 'clearApiKey' });
      });
    });

    document.querySelectorAll('[data-action="showLogs"]').forEach((button) => {
      button.addEventListener('click', () => {
        vscode.postMessage({ type: 'showLogs' });
      });
    });

    // Handle state updates from extension
    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.type === 'setState') {
        const state = message.state;

        // Update form controls
        document.getElementById('showAllModels').checked = state.showAllModels;
        document.getElementById('logLevel').value = state.logLevel;
        document.getElementById('requestTimeout').value = state.requestTimeout;

        document.getElementById('enableNative').checked = state.enableNative;
        document.getElementById('hideMantleModelsFromNative').checked = state.hideMantleModelsFromNative;
        document.getElementById('enableMantle').checked = state.enableMantle;
        document.getElementById('mantleAuthMethod').value = state.mantleAuthMethod;

        document.getElementById('sendTools').checked = state.sendTools;
        document.getElementById('emitPlaceholders').checked = state.emitPlaceholders;
        document.getElementById('enablePromptCaching').checked = state.enablePromptCaching;
        document.getElementById('assumeLongContextClaudeModels').checked = state.assumeLongContextClaudeModels;

        document.getElementById('modelMetadataSource').value = state.modelMetadataSource;
        document.getElementById('modelMetadataUrl').value = state.modelMetadataUrl;
        document.getElementById('modelMetadataCacheHours').value = state.modelMetadataCacheHours;

        // Update profile and region dropdowns
        updateSelect('awsProfile', state.profiles, state.awsProfile);
        updateSelect('region', state.bedrockRegions.map(r => ({ label: r.label, value: r.value, selected: r.value === state.region })), state.region);
        updateSelect('mantleAwsProfile', state.profiles, state.mantleAwsProfile);
        updateSelect('mantleRegion', state.mantleRegions.map(r => ({ label: r.label, value: r.value, selected: r.value === state.mantleRegion })), state.mantleRegion);

        // Update status badges and lines
        document.getElementById('native-badge').textContent = state.enableNative ? '✓ enabled' : '✕ disabled';
        document.getElementById('native-badge').className = state.enableNative ? 'status-badge' : 'status-badge disabled';
        document.getElementById('native-status').textContent = \`Region: \${state.region} · Profile: \${state.awsProfile}\`;

        document.getElementById('mantle-badge').textContent = state.enableMantle ? '✓ enabled' : '✕ disabled';
        document.getElementById('mantle-badge').className = state.enableMantle ? 'status-badge' : 'status-badge disabled';
        const authDesc = state.mantleAuthMethod === 'apiKey'
          ? (state.mantleHasStoredKey ? 'API key set' : 'API key NOT set')
          : 'using AWS credentials';
        document.getElementById('mantle-status').textContent = \`Region: \${state.mantleRegion} · Auth: \${authDesc}\`;
      }
    });

    function updateSelect(id, options, currentValue) {
      const select = document.getElementById(id);
      select.innerHTML = '';
      const values = options.map(opt => (typeof opt === 'string' ? opt : opt.value));
      // Discovery (e.g. AWS profiles from ~/.aws/config) can legitimately come back
      // empty (permissions, missing file, cloud-synced symlink not accessible) — if the
      // currently configured value isn't in the list, show it anyway instead of leaving
      // the dropdown with zero options and no indication of what's actually set.
      if (currentValue && !values.includes(currentValue)) {
        const option = document.createElement('option');
        option.value = currentValue;
        option.textContent = currentValue;
        option.selected = true;
        select.appendChild(option);
      }
      options.forEach(opt => {
        const option = document.createElement('option');
        option.value = typeof opt === 'string' ? opt : opt.value;
        option.textContent = typeof opt === 'string' ? opt : opt.label;
        if ((typeof opt === 'string' ? opt : opt.value) === currentValue) {
          option.selected = true;
        }
        select.appendChild(option);
      });
    }

    // Handle input changes
    document.querySelectorAll('[data-key]').forEach(el => {
      el.addEventListener('change', () => {
        const key = el.dataset.key;
        const value = el.type === 'checkbox' ? el.checked : (el.type === 'number' ? parseFloat(el.value) : el.value);
        vscode.postMessage({
          type: 'updateSetting',
          key: key,
          value: value
        });
      });
    });

    // Handle API key separately (send only on explicit action, not on change)
    document.getElementById('mantleApiKey').addEventListener('blur', () => {
      const value = document.getElementById('mantleApiKey').value;
      if (value) {
        vscode.postMessage({
          type: 'setApiKey',
          value: value
        });
        document.getElementById('mantleApiKey').value = '';
      }
    });
  </script>
</body>
</html>`;
	}
}

function getNonce(): string {
	let text = "";
	const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
