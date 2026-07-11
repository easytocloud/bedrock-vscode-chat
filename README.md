# AWS Bedrock Models for GitHub Copilot Chat (VS Code Extension)

[![Version](https://img.shields.io/visual-studio-marketplace/v/easytocloud.bedrock-mantle-vscode-chat?style=flat-square&label=VS%20Code%20Marketplace&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=easytocloud.bedrock-mantle-vscode-chat)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/easytocloud.bedrock-mantle-vscode-chat?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=easytocloud.bedrock-mantle-vscode-chat)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/easytocloud.bedrock-mantle-vscode-chat?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=easytocloud.bedrock-mantle-vscode-chat)
[![License](https://img.shields.io/github/license/easytocloud/bedrock-vscode-chat?style=flat-square)](https://github.com/easytocloud/bedrock-vscode-chat/blob/main/LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/easytocloud/bedrock-vscode-chat?style=flat-square&logo=github)](https://github.com/easytocloud/bedrock-vscode-chat)
[![GitHub Issues](https://img.shields.io/github/issues/easytocloud/bedrock-vscode-chat?style=flat-square&logo=github)](https://github.com/easytocloud/bedrock-vscode-chat/issues)

Use AWS Bedrock models directly in GitHub Copilot Chat, including Claude, Llama, Mistral, Qwen, and more.

- **Keep code and prompts in your AWS account** for stronger governance
- **Choose your AWS region** to align with residency and compliance requirements
- **Streaming + tool calling** for responsive coding workflows
- **Multi-region support** across 18 AWS regions

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

## Setup

### 1. Configure Authentication (Optional)

The extension supports two authentication methods:

#### Option A: API Key (Simpler)

**Via Command Palette:**
1. Open Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
2. Run: `Manage AWS Bedrock`
3. Select "Enter API Key (Mantle)"
4. Paste your API key from AWS Bedrock Console

**On First Use:**
- The extension will prompt for your API key when required
- Your key is stored securely in VS Code's SecretStorage

#### Option B: AWS Credentials (Better for existing AWS setups)

1. Open Command Palette
2. Run: `Manage AWS Bedrock`
3. Select "Configure Mantle Authentication"
4. Choose "AWS Credentials"
5. Optionally set a specific profile via "Set AWS Profile (Mantle)"

This method uses AWS Signature V4 authentication with your existing AWS credentials.

### 2. Configure AWS Profile (Optional)

If you want a specific named profile:

1. Run: `Manage AWS Bedrock`
2. Select "Set AWS Profile (Native)"
3. Enter a profile name (or leave blank to use the default credential chain)

### 3. Select Region (Optional)

Default region is `us-east-1`. To change:

1. Open Command Palette
2. Run: `Manage AWS Bedrock`
3. Select "Change Region"
4. Choose your preferred AWS region

Or set in Settings:
```json
{
  "aws-bedrock.region": "us-west-2",
  "aws-bedrock.mantleAuthMethod": "awsCredentials",  // or "apiKey"
  "aws-bedrock.mantleAwsProfile": "my-profile",      // optional
  "aws-bedrock.awsProfile": "my-profile"             // for native Bedrock
}
```

### 4. Configure Model Visibility (Optional)

Show/hide specialized models (like safeguard variants):

```json
{
  "aws-bedrock.showAllModels": true  // default: true
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

Settings are grouped into sections in VS Code's Settings UI (search `aws-bedrock`): **AWS Bedrock**, **› Mantle**, **› Native**, **› Chat Behavior**, and **› Model Metadata**.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `aws-bedrock.region` | string | `us-east-1` | AWS region for Bedrock requests |
| `aws-bedrock.showAllModels` | boolean | `true` | Show all models including specialized variants |
| `aws-bedrock.debugLogging` | boolean | `false` | Enable verbose debug logging |
| `aws-bedrock.enableMantle` | boolean | `true` | Enable models available through API key mode |
| `aws-bedrock.mantleAuthMethod` | string | `apiKey` | Auth mode for API key path: apiKey or awsCredentials |
| `aws-bedrock.mantleAwsProfile` | string | empty | Optional AWS profile for API key path when using credentials |
| `aws-bedrock.enableNative` | boolean | `true` | Enable models available through Converse API |
| `aws-bedrock.awsProfile` | string | empty | Optional AWS profile for Converse API path |
| `aws-bedrock.sendTools` | boolean | `true` | Send tool definitions to the model |
| `aws-bedrock.emitPlaceholders` | boolean | `true` | Emit placeholder text while waiting |
| `aws-bedrock.enablePromptCaching` | boolean | `true` | Insert Bedrock `cachePoint` checkpoints for native Converse requests to Claude/Nova models |
| `aws-bedrock.assumeLongContextClaudeModels` | boolean | `true` | Report a 1M-token context window for Claude models known to support it (Sonnet 4, Sonnet 4.6, Sonnet 5, Opus 4.6+) |
| `aws-bedrock.modelMetadataSource` | string | `none` | Metadata source for token/capability info: `none` (built-in heuristics only, no network calls) or `litellm` |
| `aws-bedrock.modelMetadataUrl` | string | default URL | External metadata registry URL (used when source is `litellm`) |
| `aws-bedrock.modelMetadataCacheHours` | number | `24` | Cache duration for external metadata (used when source is `litellm`) |

Note: setting keys and some command labels include `mantle` naming for backward compatibility.

### Supported Regions

- `us-east-1` (N. Virginia) - Default
- `us-east-2` (Ohio)
- `us-west-1` (N. California)
- `us-west-2` (Oregon)
- `ca-central-1` (Canada Central)
- `eu-west-1` (Ireland)
- `eu-west-2` (London)
- `eu-west-3` (Paris)
- `eu-central-1` (Frankfurt)
- `eu-north-1` (Stockholm)
- `eu-south-1` (Milan)
- `ap-south-1` (Mumbai)
- `ap-northeast-1` (Tokyo)
- `ap-northeast-2` (Seoul)
- `ap-southeast-1` (Singapore)
- `ap-southeast-2` (Sydney)
- `ap-southeast-3` (Jakarta)
- `sa-east-1` (São Paulo)

## Commands

| Command | Description |
|---------|-------------|
| `Manage AWS Bedrock` | Configure authentication, AWS profile, region, and settings |
| `Clear AWS Bedrock API Key (Mantle)` | Remove stored AWS Bedrock API key |
| `Show AWS Bedrock Logs` | Open the extension output channel |

## Architecture

This extension implements VS Code's `LanguageModelChatProvider` interface using AWS Bedrock APIs.

### Key Components

- **BedrockMantleProvider**: Main provider implementing the GitHub Copilot Chat provider interface
- **Dynamic Model Discovery**: Fetches available model catalogs from AWS Bedrock APIs
- **Streaming Support**: Processes SSE (Server-Sent Events) for real-time responses
- **Tool Calling**: Buffers and parses streaming tool calls for function calling support

### API Endpoint Format

```
https://bedrock-mantle.<region>.api.aws/v1
```

## Model Capabilities

### Tool Calling Support

Models with function calling capabilities:
- `gpt-oss-120b`
- `mistral-large-3-675b-instruct`
- `magistral-small-2509`
- `deepseek.v3.1`
- `qwen3-235b` and larger models
- `qwen3-vl-235b` (vision + tools)

### Vision Support

Models with multimodal (image) input:

- Models from API-key mode: based on model naming and API behavior
- Models from Converse API mode: based on Bedrock's reported input modalities

### Notes on Capability Metadata

- **Token limits + initial capabilities**: By default the extension uses built-in heuristics only, with no external network calls. It can optionally use an external model metadata registry (litellm's public JSON) for more accurate limits on non-Claude Mantle models — set `aws-bedrock.modelMetadataSource` to `litellm` to enable it (also configurable via `aws-bedrock.modelMetadataUrl` and `aws-bedrock.modelMetadataCacheHours`). For Claude specifically, `aws-bedrock.assumeLongContextClaudeModels` (on by default) reports the correct 1M-token window for the specific models that support it, without needing the external registry.
- **Converse API models**: vision is derived from `ListFoundationModels` input modalities (reliable). Tool support is verified on-demand by attempting a tool-enabled request and caching whether the model accepts tool config (this overrides external metadata if runtime behavior differs).
- **API-key catalog models**: `/v1/models` does not include full tool/vision/token metadata, so the extension uses external metadata when enabled, plus runtime probing (tools) as a safety net.

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
2. Run: `Manage AWS Bedrock` → "Clear API Key (Mantle)"
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
│   ├── extension.ts           # Extension entry point
│   ├── provider.ts             # Main provider implementation
│   ├── bedrockNative.ts        # Native Bedrock Converse API
│   ├── externalModelMetadata.ts # External model metadata loader
│   ├── regions.ts               # AWS region list (single source of truth)
│   ├── types.ts                # TypeScript type definitions
│   └── utils.ts                # Utility functions
├── package.json                # Extension manifest
├── tsconfig.json               # TypeScript configuration
├── icon.svg                    # Source icon (editable)
├── icon.png                    # Extension icon (128x128)
├── README.md                   # This file
├── CONTRIBUTING.md             # Development guide
└── PLAN.md                     # Architecture details
```

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed development guidelines.

**Quick start for contributors:**

1. Fork and clone the repository
2. Install dependencies: `npm install`
3. Compile: `npm run compile`
4. Press F5 to launch Extension Development Host
5. See CONTRIBUTING.md for testing, logging, and publishing guidelines

**Key development notes:**
- Publisher name: `easytocloud` (lowercase)
- Use Output Channel for logging, not console.log
- Include node_modules in VSIX (required for AWS SDK)
- Test in both F5 mode and installed VSIX
- Use `rsvg-convert` for icon generation

## Resources

- [AWS Bedrock Documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/what-is-bedrock.html)
- [VS Code Language Model API](https://code.visualstudio.com/api/references/vscode-api#lm)
- [OpenAI API Reference](https://platform.openai.com/docs/api-reference)
- [Contributing Guide](CONTRIBUTING.md) - Detailed development documentation

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

**Version**: 0.4.0  
**Status**: Production
**Last Updated**: July 11, 2026
