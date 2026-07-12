# AWS Bedrock GitHub Copilot Chat Extension - Implementation Plan

**Date**: February 5, 2026  
**Status**: Released

## Overview

Build a VS Code extension that integrates AWS Bedrock models via Mantle's OpenAI-compatible Chat Completions API. This extension enables users to interact with 26+ Bedrock models directly in GitHub Copilot Chat.

## Architecture

### Key Components

1. **MantleProvider** (`src/provider.ts`)
   - Implements VSCode's `LanguageModelChatProvider` interface
   - Manages model discovery via Mantle Models API
   - Handles streaming chat completions
   - Supports tool calling with buffered parsing

2. **Extension Entry** (`src/extension.ts`)
   - Registers the provider with vendor ID `"aws-bedrock"`
   - Manages Bedrock API key authentication via SecretStorage
   - Provides configuration commands

3. **Utilities** (`src/utils.ts`)
   - Message format conversion (VSCode ↔ OpenAI)
   - Tool definition conversion
   - JSON parsing helpers
   - Request validation

4. **Types** (`src/types.ts`)
   - OpenAI API interfaces
   - Bedrock-specific types
   - Provider state types

## API Details

### Mantle Endpoints

**Base URL Pattern**: `https://bedrock-mantle.<region>.api.aws/v1`

**Supported Regions** (see `src/regions.ts` for the source of truth):
- us-east-1 (N. Virginia) - Default
- us-east-2 (Ohio)
- us-west-1 (N. California)
- us-west-2 (Oregon)
- ca-central-1 (Canada Central)
- eu-west-1 (Ireland)
- eu-west-2 (London)
- eu-west-3 (Paris)
- eu-central-1 (Frankfurt)
- eu-north-1 (Stockholm)
- eu-south-1 (Milan)
- ap-south-1 (Mumbai)
- ap-northeast-1 (Tokyo)
- ap-northeast-2 (Seoul)
- ap-southeast-1 (Singapore)
- ap-southeast-2 (Sydney)
- ap-southeast-3 (Jakarta)
- sa-east-1 (São Paulo)

**Authentication**: Bearer token (Bedrock API Key from AWS Console)

### Available Models (26 total)

From Models API response:
- OpenAI: `gpt-oss-20b`, `gpt-oss-120b`, `gpt-oss-safeguard-20b/120b`
- Google: `gemma-3-4b/12b/27b-it`
- Mistral: `magistral-small-2509`, `mistral-large-3-675b-instruct`, `ministral-3-3b/8b/14b-instruct`, `voxtral-mini-3b/small-24b-2507`
- Qwen: `qwen3-32b`, `qwen3-235b-a22b-2507`, `qwen3-next-80b-a3b-instruct`, `qwen3-vl-235b-a22b-instruct`, `qwen3-coder-30b/480b-instruct`
- DeepSeek: `v3.1`
- Nvidia: `nemotron-nano-9b/12b-v2`
- MoonshotAI: `kimi-k2-thinking`
- Minimax: `minimax-m2`
- ZAI: `glm-4.6`

### Model Capability Mapping

**Pattern-based detection**:
- Vision support: Models with `vl` in name (e.g., `qwen3-vl-235b`)
- Code specialization: Models with `coder` in name
- Tool calling: Large models (>30B parameters), `mistral-large`, `deepseek.v3.1`, `gpt-oss-120b`
- Thinking/reasoning: Models with `thinking` in name

**Default capabilities**:
- Context length: 128K tokens (conservative default)
- Max output: 4K tokens
- Tool calling: Enabled for qualified models
- Vision: Disabled unless detected

### Display Name Formatting

Transform `provider.model-name` → "Provider Model Name"

Examples:
- `mistral.magistral-small-2509` → "Mistral Magistral Small (2509)"
- `qwen.qwen3-vl-235b-a22b-instruct` → "Qwen Qwen3 VL 235B A22B Instruct"
- `deepseek.v3.1` → "DeepSeek V3.1"

## Implementation Steps

### Phase 1: Project Setup ✓
- [x] Create PLAN.md
- [x] Initialize package.json
- [x] Configure TypeScript (tsconfig.json)
- [x] Setup debugging (.vscode/launch.json)
- [x] Create .gitignore

### Phase 2: Core Types & Utilities
- [x] Define OpenAI API types (src/types.ts)
- [x] Implement message conversion (src/utils.ts)
- [x] Add tool definition conversion
- [x] Create JSON parsing helpers

### Phase 3: Provider Implementation
- [x] Implement model discovery (prepareLanguageModelChatInformation)
- [x] Build chat completions handler (provideLanguageModelChatResponse)
- [x] Add streaming SSE parser
- [x] Implement tool call buffering
- [x] Add token counting (provideTokenCount)

### Phase 4: Extension Registration
- [x] Create extension activation (src/extension.ts)
- [x] Implement API key management
- [x] Register provider with VSCode
- [x] Add configuration commands

### Phase 5: Error Handling & Polish
- [x] Add HTTP error handlers (401, 404, 429)
- [x] Implement user-friendly error messages
- [x] Add logging for debugging
- [x] Create comprehensive README

### Phase 6: Testing & Documentation
- [x] Manual testing with various models
- [x] Test streaming responses
- [x] Test tool calling
- [x] Verify error scenarios
- [x] Update README with usage examples

## Configuration Schema

### Settings (package.json contributions)

```json
{
  "aws-bedrock.region": {
    "type": "string",
    "enum": ["us-east-1", "us-east-2", "us-west-2", ...],
    "default": "us-east-1",
   "description": "AWS region for Bedrock (Mantle + native)"
  },
  "aws-bedrock.showAllModels": {
    "type": "boolean",
    "default": true,
    "description": "Show all available models including specialized variants"
  }
}
```

### Secrets (SecretStorage)

- `bedrock.apiKey`: Bedrock API Key from AWS Console

### Commands

- `bedrock-mantle-vscode-chat.manage`: Configure authentication, profiles, region, and settings
- `bedrock-mantle-vscode-chat.clearApiKey`: Remove stored Mantle API key
- `bedrock-mantle-vscode-chat.showLogs`: Open the output channel

## Technical Decisions

### 1. Authentication
**Decision**: Support Mantle API key and AWS credential authentication  
**Rationale**: API key is simplest for Mantle; AWS credentials allow native Bedrock and Mantle SigV4

### 2. API Choice
**Decision**: Use Chat Completions API (not Responses API)  
**Rationale**: Standard OpenAI compatibility, proven pattern from HuggingFace extension

### 3. Model Discovery
**Decision**: Dynamic fetching from Models API  
**Rationale**: Always up-to-date with new models, no hardcoded list maintenance

### 4. Capability Detection
**Decision**: Pattern-matching model IDs with conservative defaults  
**Rationale**: Models API doesn't provide capability metadata, pattern-matching is pragmatic

### 5. Tool Call Handling
**Decision**: Buffer-based incremental parsing  
**Rationale**: Streaming tool calls arrive as JSON deltas, must accumulate before emitting

### 6. Logging Strategy
**Decision**: Use Output Channel instead of console.log  
**Rationale**: console.log only works in Extension Development Host, not in installed extensions. Output Channel is visible to all users.

### 7. Dependency Packaging
**Decision**: Include node_modules in VSIX package  
**Rationale**: AWS SDK dependencies are not available in VS Code runtime, must be bundled with extension.

## Critical Implementation Notes

### Publisher Name
- **Must be lowercase**: `easytocloud` (not `EasyToCloud`)
- Used in vendor ID: `easytocloud.bedrock-mantle-vscode-chat`

### Testing Environments
1. **Extension Development Host (F5)**:
   - Uses local node_modules
   - console.log works (appears in Debug Console)
   - Hot reload with Cmd/Ctrl+R
   - Best for active development

2. **Installed Extension (VSIX)**:
   - Uses bundled dependencies
   - console.log goes nowhere (use Output Channel!)
   - Must reload window after install
   - Best for final testing

### Icon Management
- Source: `icon.svg` (128x128)
- Output: `icon.png` (128x128)
- Conversion: `rsvg-convert -w 128 -h 128 icon.svg -o icon.png`
- Tool required: librsvg (`brew install librsvg` on macOS)

## Error Handling Strategy

### HTTP Errors
- **401 Unauthorized**: Prompt for new API key, clear invalid key
- **404 Not Found**: Show "Model not available in region" message
- **429 Rate Limited**: Display retry message with backoff suggestion
- **5xx Server Error**: Show temporary error, suggest retry

### Network Errors
- Connection timeout: Suggest checking internet/firewall
- DNS resolution: Suggest checking region configuration
- Abort/Cancellation: Clean up streams gracefully

### API Key Management
- Missing key: Prompt on first use
- Invalid key: Detect 401, prompt for re-entry
- Key storage: Use VSCode SecretStorage (encrypted)

## Dependencies

### Production
- `@aws-crypto/sha256-js`
- `@aws-sdk/client-bedrock`
- `@aws-sdk/client-bedrock-runtime`
- `@aws-sdk/credential-provider-ini`
- `@aws-sdk/credential-provider-node`
- `@aws-sdk/signature-v4`

### Development
- `@types/vscode`: ^1.104.0
- `typescript`: ^5.x
- `eslint`: ^9.x

## Reference Implementation

Based on: [huggingface/huggingface-vscode-chat](https://github.com/huggingface/huggingface-vscode-chat)

Key patterns adapted:
- Provider interface implementation
- SSE streaming parser
- Tool call buffering system
- Message conversion utilities
- SecretStorage for API keys

## Future Enhancements

1. **Advanced Features**
   - Responses API support for stateful conversations
   - Context caching for cost optimization
   - Model usage analytics

2. **UX Improvements**
   - Model search/filter in settings
   - Favorite models list
   - Custom model aliases

3. **Developer Features**
   - Debug logging toggle
   - Request/response inspection
   - Performance metrics

## Testing Strategy

### Manual Testing Checklist
- [ ] Install extension in VS Code
- [ ] Configure API key
- [ ] Verify model list loads
- [ ] Test basic chat with multiple models
- [ ] Test streaming responses
- [ ] Test tool calling (if supported)
- [ ] Test error scenarios (invalid key, network issues)
- [ ] Test region switching
- [ ] Verify cancellation works

### Test Models
- Small: `mistral.ministral-3-3b-instruct` (fast, basic)
- Medium: `google.gemma-3-27b-it` (good balance)
- Large: `openai.gpt-oss-120b` (full features)
- Vision: `qwen.qwen3-vl-235b-a22b-instruct` (multimodal)
- Specialized: `deepseek.v3.1` (reasoning)

## Success Criteria

1. ✅ Extension installs without errors
2. ✅ API key configuration works smoothly
3. ✅ All 26+ models appear in model picker
4. ✅ Chat responses stream correctly
5. ✅ Tool calling works for capable models
6. ✅ Error messages are clear and actionable
7. ✅ Performance is comparable to other providers
8. ✅ Region switching works correctly

## Resources

- [AWS Bedrock Mantle Documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/bedrock-mantle.html)
- [VSCode Language Model API](https://code.visualstudio.com/api/references/vscode-api#lm)
- [OpenAI API Reference](https://platform.openai.com/docs/api-reference)
- [HuggingFace VSCode Extension](https://github.com/huggingface/huggingface-vscode-chat)

---

**Next Steps**: Begin Phase 2 implementation - create core types and utilities.
