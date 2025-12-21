# AWS Bedrock Chat Provider for VS Code

Use AWS Bedrock models directly in VS Code chat via:

- **Mantle (OpenAI-compatible API)** for the OSS/openai-style model catalog
- **Native Bedrock (Converse API)** for the full Bedrock foundation model catalog

## Features

- **Mantle + Native**: Use Mantle models and native Bedrock foundation models
- **Dynamic Model Discovery**: Mantle models are fetched from Mantle's Models API; native models are listed from AWS Bedrock
- **Streaming Responses**: Real-time chat with streaming support
- **Tool Calling**: Function calling support for capable models
- **Multi-Region**: Support for 12 AWS regions
- **OpenAI Compatible (Mantle)**: Uses familiar OpenAI SDK patterns via Mantle
- **Converse API (Native)**: Uses the unified Bedrock conversation API

## Available Models

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

You can use either backend (or both):

1. **Mantle (optional)**: An **AWS Bedrock API Key** from the [AWS Bedrock Console](https://console.aws.amazon.com/bedrock/)
2. **Native Bedrock (optional)**: **AWS credentials** available to VS Code (env vars, `~/.aws/credentials`, SSO, etc). You can also set `aws-bedrock.awsProfile`.
3. **VS Code**: Version 1.104.0 or later

## Installation

### From Source

1. Clone this repository:
   ```bash
   git clone https://github.com/bedrock/bedrock-vscode-chat.git
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

### From VSIX (Coming Soon)

```bash
code --install-extension bedrock-vscode-chat-0.1.0.vsix
```

## Setup

### 1. Configure Mantle API Key (Optional)

**Method 1: Via Command Palette**
1. Open Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
2. Run: `Manage AWS Bedrock`
3. Select "Enter API Key"
4. Paste your API key from AWS Bedrock Console

**Method 2: On First Use**
- The extension will prompt for your API key when you first try to use a model
- Your key is stored securely in VS Code's SecretStorage

### 2. Configure Native AWS Profile (Optional)

If you're using native Bedrock models and want a specific named profile:

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
  "aws-bedrock.region": "us-west-2"
}
```

### 3. Configure Model Visibility (Optional)

Show/hide specialized models (like safeguard variants):

```json
{
  "aws-bedrock.showAllModels": true  // default: true
}
```

## Usage

### Using in Chat

1. Open VS Code Chat (`Cmd+Shift+I` / `Ctrl+Shift+I`)
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

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `aws-bedrock.region` | string | `us-east-1` | AWS region for Bedrock Mantle endpoint |
| `aws-bedrock.showAllModels` | boolean | `true` | Show all models including specialized variants |

### Supported Regions

- `us-east-1` (N. Virginia) - Default
- `us-east-2` (Ohio)
- `us-west-2` (Oregon)
- `eu-west-1` (Ireland)
- `eu-west-2` (London)
- `eu-central-1` (Frankfurt)
- `eu-north-1` (Stockholm)
- `eu-south-1` (Milan)
- `ap-south-1` (Mumbai)
- `ap-northeast-1` (Tokyo)
- `ap-southeast-3` (Jakarta)
- `sa-east-1` (São Paulo)

## Commands

| Command | Description |
|---------|-------------|
| `Manage AWS Bedrock` | Configure Mantle API key, native AWS profile, region, and settings |
| `Clear AWS Bedrock API Key` | Remove stored API key |

## Architecture

This extension implements VS Code's `LanguageModelChatProvider` interface using AWS Bedrock's Mantle API, which provides OpenAI-compatible endpoints.

### Key Components

- **BedrockMantleProvider**: Main provider implementing VSCode's chat interface
- **Dynamic Model Discovery**: Fetches available models from Mantle's Models API
- **Streaming Support**: Processes SSE (Server-Sent Events) for real-time responses
- **Tool Calling**: Buffers and parses streaming tool calls for function calling support

### Endpoint Format

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

- Mantle models: based on model naming and API behavior
- Native Bedrock models: based on Bedrock's reported input modalities

### Notes on Capability Metadata

- **Token limits + initial capabilities**: The extension can optionally use an external model metadata registry (default: Litellm's public JSON) to populate `maxInputTokens`, `maxOutputTokens`, and initial tool/vision flags. Configure via `aws-bedrock.modelMetadataSource`, `aws-bedrock.modelMetadataUrl`, and `aws-bedrock.modelMetadataCacheHours`.
- **Native Bedrock models**: vision is derived from `ListFoundationModels` input modalities (reliable). Tool support is still verified on-demand by attempting a tool-enabled request and caching whether the model accepts tool config (this overrides external metadata if the runtime behavior differs).
- **Mantle models**: Mantle's `/v1/models` does not include tool/vision/token metadata, so the extension uses external metadata when enabled, plus runtime probing (tools) as a safety net.

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

### Debugging

1. Open the project in VS Code
2. Press `F5` to launch Extension Development Host
3. Set breakpoints in source files
4. Test the extension in the new window

### Project Structure

```
bedrock-vscode-chat/
├── src/
│   ├── extension.ts      # Extension entry point
│   ├── provider.ts        # Main provider implementation
│   ├── types.ts           # TypeScript type definitions
│   └── utils.ts           # Utility functions
├── package.json           # Extension manifest
├── tsconfig.json          # TypeScript configuration
└── README.md             # This file
```

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## Resources

- [AWS Bedrock Mantle Documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/bedrock-mantle.html)
- [VS Code Language Model API](https://code.visualstudio.com/api/references/vscode-api#lm)
- [OpenAI API Reference](https://platform.openai.com/docs/api-reference)

## License

MIT License - See LICENSE file for details

## Acknowledgments

Inspired by the [HuggingFace VSCode Chat](https://github.com/huggingface/huggingface-vscode-chat) extension.

## Support

- **Issues**: [GitHub Issues](https://github.com/bedrock/bedrock-vscode-chat/issues)
- **Discussions**: [GitHub Discussions](https://github.com/bedrock/bedrock-vscode-chat/discussions)
- **AWS Bedrock**: [AWS Support](https://aws.amazon.com/support/)

---

**Version**: 0.1.0  
**Status**: Beta  
**Last Updated**: December 18, 2025
