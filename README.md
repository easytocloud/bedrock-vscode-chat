# AWS Bedrock Models for GitHub Copilot Chat (VS Code Extension)

[![VS Code Marketplace](https://img.shields.io/badge/VS%20Code%20Marketplace-Install-blue?style=flat-square&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=easytocloud.bedrock-mantle-vscode-chat)
[![License](https://img.shields.io/github/license/easytocloud/bedrock-vscode-chat?style=flat-square)](https://github.com/easytocloud/bedrock-vscode-chat/blob/main/LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/easytocloud/bedrock-vscode-chat?style=flat-square&logo=github)](https://github.com/easytocloud/bedrock-vscode-chat)
[![GitHub Issues](https://img.shields.io/github/issues/easytocloud/bedrock-vscode-chat?style=flat-square&logo=github)](https://github.com/easytocloud/bedrock-vscode-chat/issues)

Use AWS Bedrock models directly in GitHub Copilot Chat, including Claude, Llama, Mistral, Qwen, and more.

This extension registers **two separate language model providers**, because native Bedrock and Mantle are genuinely different AWS Bedrock endpoints — different regions, different auth details, and different model coverage:

- **AWS Bedrock** (native Converse API) — the full Bedrock foundation model catalog, including all Anthropic Claude models, across 18 AWS regions.
- **AWS Bedrock Mantle** (OpenAI-compatible + Anthropic Messages API) — open-weight models (DeepSeek, Mistral, Qwen, GLM, Nemotron, MiniMax, Kimi, Gemma, gpt-oss) plus the subset of current Claude models Mantle supports, across 13 AWS regions.

Both show up together in the Copilot Chat model picker; enable either or both independently.

- **Keep code and prompts in your AWS account** for stronger governance
- **Choose your AWS region** to align with residency and compliance requirements
- **Streaming + tool calling** for responsive coding workflows
- **Multi-region support** across 18 AWS regions (native) / 13 AWS regions (Mantle)

## Why This Extension

- **Compliance-first architecture**: prompts, code context, and responses stay within your AWS account boundary.
- **Data residency control**: select the AWS region your team is allowed to use and keep traffic there.
- **Enterprise-ready access model**: works with existing AWS credentials, profiles, and IAM controls.
- **No model lock-in**: use multiple Bedrock model families from one Copilot Chat workflow.
- **Built for developer UX**: streaming responses, tool calling, and model switching in the standard chat UI.

## Supported Model Families

### OpenAI
- `gpt-oss-20b`, `gpt-oss-120b`
- Safeguard variants: `gpt-oss-safeguard-20b/120b`

### Google
- Gemma 3: `4b`, `12b`, `27b` variants

### Mistral
- `magistral-small-2509`
- `mistral-large-3-675b-instruct`
- Ministral: `3b`, `8b`, `14b` variants
- Voxtral: `mini-3b`, `small-24b` variants

### Qwen
- General: `qwen3-32b`, `qwen3-235b`, `qwen3-next-80b`
- Vision: `qwen3-vl-235b` (multimodal)
- Coding: `qwen3-coder-30b/480b`

### DeepSeek
- `v3.1`

### Nvidia
- `nemotron-nano-9b-v2`, `nemotron-nano-12b-v2`

### Others
- MoonshotAI: `kimi-k2-thinking`
- Minimax: `minimax-m2`
- ZAI: `glm-4.6`

## Prerequisites

Authentication options:

1. **API key mode (optional)**:
   - Use an AWS Bedrock API key from the [AWS Bedrock Console](https://console.aws.amazon.com/bedrock/)
2. **AWS credentials mode (optional)**:
   - Use AWS credentials/profile available to VS Code (env vars, `~/.aws/credentials`, SSO, etc)
   - You can also set `aws-bedrock.awsProfile`
3. **VS Code**: Version 1.104.0 or later

The extension includes a built-in profile picker, status headers, and connection test to help you debug authentication setup.

## Installation

### From VS Code Marketplace

1. Open VS Code
2. Go to Extensions (Cmd+Shift+X)
3. Search for "Bedrock LLMs for GitHub Copilot Chat"
4. Click Install

### From Source

1. Clone this repository:
   ```bash
   git clone https://github.com/easytocloud/bedrock-vscode-chat.git
   cd bedrock-vscode-chat
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Compile the extension:
   ```bash
   npm run compile
   ```

4. Press `F5` to open a new VS Code window with the extension loaded

## Setup & Quick Start

Native Bedrock and Mantle each have their own management command and settings, since they're independent providers with independent AWS endpoints, regions, and authentication details.

### Quick Start: Use the Manage Commands

The fastest way to configure both providers is via the VS Code Command Palette:

1. Open Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
2. Type `Manage AWS Bedrock` to see the two commands:
   - **`Manage AWS Bedrock (Native)`** — configures native Bedrock (Converse API)
   - **`Manage AWS Bedrock Mantle`** — configures Mantle (OpenAI-compatible API)
3. Each command opens an interactive QuickPick menu with the current settings prominently displayed, real-time profile discovery from `~/.aws/config`, and a "Test Connection" action to verify your setup

The manage commands are also accessible via a gear icon next to the model picker in the Copilot Chat panel.

### 1. Native Bedrock (Converse API)

Via `Manage AWS Bedrock (Native)` command or settings:

1. **Set AWS Profile** — optional named profile (leave blank for the default AWS credential chain). The manage command auto-discovers profiles from `~/.aws/config` and `~/.aws/credentials`.
2. **Change Region** — choose from native Bedrock's 18 supported regions (default `us-east-1`)
3. **Test Connection** — run a real credential check to verify your setup works

Native Bedrock always authenticates with AWS credentials (env vars, `~/.aws/credentials`, SSO, etc.) — there's no API key option here.

### 2. Mantle (OpenAI-compatible + Anthropic Messages)

Via `Manage AWS Bedrock Mantle` command or settings:

1. **Configure Authentication** — choose API Key (simpler) or AWS Credentials
   - **API Key**: run `Manage AWS Bedrock Mantle` → "Enter API Key" and paste your key from the [AWS Bedrock Console](https://console.aws.amazon.com/bedrock/). You'll also be prompted automatically on first use. Keys are stored in VS Code's SecretStorage.
   - **AWS Credentials**: uses AWS Signature V4 with your existing credentials; optionally set a specific profile via "Set AWS Profile" (auto-discovered from `~/.aws/config`)
2. **Change Region** — choose from Mantle's 13 supported regions (a strict subset of native Bedrock's — default `us-east-1`)
3. **Test Connection** — run a real credential check to verify your setup works

### Configure via Settings

Both providers' settings can also be set directly:

```json
{
  "aws-bedrock.region": "us-west-2",               // native Bedrock region
  "aws-bedrock.awsProfile": "my-profile",          // native Bedrock AWS profile

  "aws-bedrock.mantleRegion": "us-east-1",         // Mantle region (smaller region list than native)
  "aws-bedrock.mantleAuthMethod": "awsCredentials", // or "apiKey"
  "aws-bedrock.mantleAwsProfile": "my-profile"      // optional
}
```

### Configure Model Visibility (Optional)

Show/hide specialized models (like safeguard variants), and optionally hide open-weight models from the native picker when they're also available via Mantle:

```json
{
  "aws-bedrock.showAllModels": true,               // default: true
  "aws-bedrock.hideMantleModelsFromNative": false  // default: false
}
```

## Usage

### Using in Chat

1. Open GitHub Copilot Chat (`Cmd+Shift+I` / `Ctrl+Shift+I`)
2. Click the model picker (top of chat panel)
3. Select an AWS Bedrock model (e.g., "OpenAI GPT OSS 120B")
4. Start chatting!

### Using with Copilot Chat

1. In any editor, use `@workspace` or other chat participants
2. The model picker will include Bedrock models
3. Select a Bedrock model for your conversation

### Example Chat

```
You: What are the key features of Rust's ownership system?

Assistant (via Bedrock): [Streams response in real-time...]
```

## Configuration

### Settings

Settings are grouped into sections in VS Code's Settings UI (search `aws-bedrock`): **AWS Bedrock**, **› Native (Converse API)**, **› Mantle (OpenAI-compatible)**, **› Chat Behavior**, and **› Model Metadata**.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `aws-bedrock.showAllModels` | boolean | `true` | Show all models including specialized variants (applies to both providers) |
| `aws-bedrock.logLevel` | string | `info` | Output channel verbosity: `verbose`, `info`, `warning`, `error`, or `none` (applies to both providers) |
| `aws-bedrock.requestTimeout` | number | `120000` | Max time (ms) to wait for a response before aborting; 0 disables. Streaming requests only time out waiting for the *first* response (applies to both providers) |
| `aws-bedrock.enableNative` | boolean | `true` | Register the native Bedrock (Converse API) provider |
| `aws-bedrock.awsProfile` | string | empty | Optional AWS profile for native Bedrock |
| `aws-bedrock.region` | string | `us-east-1` | AWS region for native Bedrock (18 supported regions) |
| `aws-bedrock.hideMantleModelsFromNative` | boolean | `false` | Hide open-weight models from the native list when also available via Mantle |
| `aws-bedrock.enableMantle` | boolean | `true` | Register the Mantle provider |
| `aws-bedrock.mantleAuthMethod` | string | `apiKey` | Mantle auth mode: `apiKey` or `awsCredentials` |
| `aws-bedrock.mantleAwsProfile` | string | empty | Optional AWS profile for Mantle when using AWS credentials |
| `aws-bedrock.mantleRegion` | string | `us-east-1` | AWS region for Mantle (13 supported regions — a subset of native's) |
| `aws-bedrock.sendTools` | boolean | `true` | Send tool definitions to the model |
| `aws-bedrock.emitPlaceholders` | boolean | `true` | Emit placeholder text while waiting |
| `aws-bedrock.enablePromptCaching` | boolean | `true` | Insert Bedrock `cachePoint` checkpoints for native Converse requests to Claude/Nova models |
| `aws-bedrock.assumeLongContextClaudeModels` | boolean | `true` | Report a 1M-token context window for Claude models known to support it (Sonnet 4, Sonnet 4.6, Sonnet 5, Opus 4.6+) |
| `aws-bedrock.modelMetadataSource` | string | `none` | Metadata source for token/capability info: `none` (built-in heuristics only, no network calls) or `litellm` |
| `aws-bedrock.modelMetadataUrl` | string | default URL | External metadata registry URL (used when source is `litellm`) |
| `aws-bedrock.modelMetadataCacheHours` | number | `24` | Cache duration for external metadata (used when source is `litellm`) |

### Supported Regions

**Native Bedrock** (`aws-bedrock.region`) — 18 regions:

`us-east-1` (default), `us-east-2`, `us-west-1`, `us-west-2`, `ca-central-1`, `eu-west-1`, `eu-west-2`, `eu-west-3`, `eu-central-1`, `eu-north-1`, `eu-south-1`, `ap-south-1`, `ap-northeast-1`, `ap-northeast-2`, `ap-southeast-1`, `ap-southeast-2`, `ap-southeast-3`, `sa-east-1`

**Mantle** (`aws-bedrock.mantleRegion`) — 13 regions, a strict subset of native's (missing `us-west-1`, `ca-central-1`, `eu-west-3`, `ap-northeast-2`, `ap-southeast-1`):

`us-east-1` (default), `us-east-2`, `us-west-2`, `eu-west-1`, `eu-west-2`, `eu-central-1`, `eu-north-1`, `eu-south-1`, `ap-south-1`, `ap-northeast-1`, `ap-southeast-2`, `ap-southeast-3`, `sa-east-1`

## Commands

| Command | Description |
|---------|-------------|
| `Manage AWS Bedrock (Native)` | Configure AWS profile and region for native Bedrock |
| `Manage AWS Bedrock Mantle` | Configure authentication, AWS profile, and region for Mantle |
| `Clear AWS Bedrock API Key (Mantle)` | Remove stored AWS Bedrock API key |
| `Show AWS Bedrock Logs` | Open the extension output channel |

## Architecture

This extension registers **two** VS Code `LanguageModelChatProvider` implementations, because native Bedrock and Mantle are genuinely different AWS Bedrock endpoints with different region footprints, auth details, and model coverage.

### Key Components

- **NativeBedrockProvider** (`src/provider.ts`): Native Bedrock (Converse API) provider, using `@aws-sdk/client-bedrock-runtime`
- **MantleProvider** (`src/mantleProvider.ts`): Mantle provider — dispatches to Chat Completions (OpenAI-compatible) for most models, and to the Anthropic Messages API for the subset of Claude models Mantle supports
- **Mantle Messages API client** (`src/mantleMessages.ts`): Request/response conversion and SSE streaming for Mantle's `/anthropic/v1/messages`
- **Dynamic Model Discovery**: Fetches available model catalogs from AWS Bedrock APIs for both providers
- **Streaming Support**: Processes SSE (Server-Sent Events) for real-time responses on all three API paths
- **Tool Calling**: Buffers and parses streaming tool calls for function calling support

### API Endpoint Formats

```
https://bedrock-mantle.<region>.api.aws/v1                    # Mantle: models list, Chat Completions
https://bedrock-mantle.<region>.api.aws/anthropic/v1/messages # Mantle: Anthropic Messages API (Claude)
```

Native Bedrock uses the AWS SDK (`@aws-sdk/client-bedrock` / `@aws-sdk/client-bedrock-runtime`) rather than a raw HTTP endpoint.

## Model Capabilities

### Tool Calling Support

Models with function calling capabilities:
- `gpt-oss-120b`
- `mistral-large-3-675b-instruct`
- `magistral-small-2509`
- `deepseek.v3.1`
- `qwen3-235b` and larger models
- `qwen3-vl-235b` (vision + tools)
- All Anthropic Claude models (native Bedrock)
- Amazon Nova, Cohere Command R/R+, AI21 Jamba (native Bedrock)

> VS Code's Agent mode only shows models that report tool-calling support in the model picker — a model without it is hidden there entirely (though still usable in plain Ask-mode chat). If a model you expect to see is missing from Agent mode, it's most likely a tool-calling capability gap; please [open an issue](https://github.com/easytocloud/bedrock-vscode-chat/issues).

### Vision Support

Models with multimodal (image) input:

- Models from API-key mode: based on model naming and API behavior
- Models from Converse API mode: based on Bedrock's reported input modalities

### Notes on Capability Metadata

- **Token limits + initial capabilities**: By default the extension uses built-in heuristics only, with no external network calls. It can optionally use an external model metadata registry (litellm's public JSON) for more accurate limits on non-Claude Mantle models — set `aws-bedrock.modelMetadataSource` to `litellm` to enable it (also configurable via `aws-bedrock.modelMetadataUrl` and `aws-bedrock.modelMetadataCacheHours`). For Claude specifically, `aws-bedrock.assumeLongContextClaudeModels` (on by default) reports the correct 1M-token window for the specific models that support it, without needing the external registry.
- **Native Bedrock models**: vision is derived from `ListFoundationModels` input modalities (reliable). Tool support is verified on-demand by attempting a tool-enabled request and caching whether the model accepts tool config (this overrides external metadata if runtime behavior differs).
- **Mantle models**: `/v1/models` does not include full tool/vision/token metadata, so the extension uses external metadata when enabled, plus runtime probing (tools) as a safety net. Claude models on Mantle are routed to the Anthropic Messages API automatically; models with zero Mantle support (neither Chat Completions nor Messages) are excluded from the Mantle picker entirely.
- **Duplicate names**: if two models in the same provider's list would otherwise show an identical label, the extension appends the raw technical model ID to keep every entry uniquely selectable.

### Code Specialization

Models optimized for coding:
- `qwen3-coder-30b-a3b-instruct`
- `qwen3-coder-480b-a35b-instruct`

### Reasoning/Thinking

Models with enhanced reasoning:
- `kimi-k2-thinking`

## Troubleshooting

### API Key Issues

**Problem**: "Invalid API key" error

**Solution**:
1. Verify your API key in AWS Bedrock Console
2. Run: `Manage AWS Bedrock Mantle` → "Clear API Key"
3. Re-enter your API key

### Model Not Available

**Problem**: "Model not available in region" error

**Solution**:
- Not all models are available in all regions
- Try changing to `us-east-1` (widest availability)
- Check [AWS Bedrock Model Availability](https://docs.aws.amazon.com/bedrock/latest/userguide/models-regions.html)

### Rate Limiting

**Problem**: "Rate limit exceeded" error

**Solution**:
- Wait a few moments and try again
- Consider using smaller models for testing
- Check your AWS Bedrock quotas in AWS Console

### Connection Issues

**Problem**: Network or timeout errors

**Solution**:
- Check your internet connection
- Verify firewall/proxy settings allow access to `*.api.aws`
- Ensure the selected region is accessible from your location

## Development

### Building from Source

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch mode for development
npm run watch

# Run linting
npm run lint
```

Or use the Makefile shortcuts:

```bash
make install
make compile
make watch
make lint
```

### Debugging

1. Open the project in VS Code
2. Press `F5` to launch Extension Development Host
3. Set breakpoints in source files
4. Test the extension in the new window

### Project Structure

```
bedrock-vscode-chat/
├── src/
│   ├── extension.ts           # Extension entry point; registers both providers
│   ├── provider.ts             # NativeBedrockProvider (Converse API)
│   ├── bedrockNative.ts        # Native Bedrock Converse API client
│   ├── mantleProvider.ts        # MantleProvider (Chat Completions + Messages dispatch)
│   ├── mantleMessages.ts        # Mantle Anthropic Messages API client
│   ├── externalModelMetadata.ts # External model metadata loader
│   ├── regions.ts               # AWS region lists (native + Mantle, single source of truth)
│   ├── types.ts                # TypeScript type definitions
│   └── utils.ts                # Utility functions
├── package.json                # Extension manifest
├── tsconfig.json               # TypeScript configuration
├── assets/
│   ├── icon.svg                # Source icon (editable)
│   └── icon.png                # Extension icon (128x128)
├── docs/
│   ├── CONTRIBUTING.md         # Development guide
│   ├── QUICKSTART.md           # Quick start for developers
│   ├── TESTING.md              # Testing guide
│   └── dev/
│       └── MODEL_STRATEGIES.md # Model capability detection strategy
├── config/
│   ├── Makefile                # Build automation
│   ├── esbuild.js              # Bundler configuration
│   ├── eslint.config.js        # Linter configuration
│   └── tsconfig.json           # TypeScript configuration
├── README.md                   # This file
```

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](docs/CONTRIBUTING.md) for detailed development guidelines.

**Quick start for contributors:**

1. Fork and clone the repository
2. Install dependencies: `npm install`
3. Compile: `npm run compile`
4. Press F5 to launch Extension Development Host
5. See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for testing, logging, and publishing guidelines

**Key development notes:**
- Publisher name: `easytocloud` (lowercase)
- Use Output Channel for logging, not console.log
- The extension is bundled with esbuild (`out/extension.js`) — `node_modules` is excluded from the VSIX
- Test in both F5 mode and installed VSIX
- Use `rsvg-convert` for icon generation

## Resources

- [AWS Bedrock Documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/what-is-bedrock.html)
- [VS Code Language Model API](https://code.visualstudio.com/api/references/vscode-api#lm)
- [OpenAI API Reference](https://platform.openai.com/docs/api-reference)
- [Contributing Guide](docs/CONTRIBUTING.md) - Detailed development documentation

## License

MIT License - See LICENSE file for details

## Credits

 - **Project Lead**: easytocloud
- **Development Assistant**: GitHub Copilot

## Acknowledgments

Inspired by the [HuggingFace extension for GitHub Copilot Chat](https://github.com/huggingface/huggingface-vscode-chat).

## Support

* **Issues**: [GitHub Issues](https://github.com/easytocloud/bedrock-vscode-chat/issues)
* **Discussions**: [GitHub Discussions](https://github.com/easytocloud/bedrock-vscode-chat/discussions)
* **AWS Bedrock**: [AWS Support](https://aws.amazon.com/support/)

---

**Version**: 0.6.0  
**Status**: Production
**Last Updated**: July 11, 2026
