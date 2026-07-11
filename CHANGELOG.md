# Changelog

All notable changes to the AWS Bedrock GitHub Copilot Chat extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] - 2026-07-11

### Added
- **Split into two separate language model providers**: "AWS Bedrock" (native Converse API) and "AWS Bedrock Mantle" (OpenAI-compatible), each with its own vendor ID, region setting, and "Manage" command. Native and Mantle are genuinely different AWS Bedrock endpoints — different region footprints, auth details, and model coverage — so merging them into one provider was misleading. Existing native model selections are unaffected (the original vendor ID was kept for native).
- **Anthropic Messages API support on Mantle** (`/anthropic/v1/messages`): Claude models that Mantle actually supports (Sonnet 5, Haiku 4.5, Opus 4.7, Opus 4.8, Fable 5, Mythos 5, Mythos Preview) are now invoked through Mantle's separate Messages API instead of being hidden. No Claude model supports Mantle's Chat Completions API (`/v1/chat/completions`) on any Bedrock endpoint — that was the actual bug behind the "does not support the '/v1/chat/completions' API" crash, not a blanket Claude/Mantle incompatibility.
- **`aws-bedrock.mantleRegion` setting**: Mantle is deployed to a strict subset of native Bedrock's regions (13 vs 18) — picking a native-only region (`us-west-1`, `ca-central-1`, `eu-west-3`, `ap-northeast-2`, `ap-southeast-1`) no longer silently breaks Mantle.
- **`aws-bedrock.hideMantleModelsFromNative` setting** (default off): optionally hides open-weight models (DeepSeek, Mistral, Qwen, GLM, Nemotron, MiniMax, Kimi, Gemma, gpt-oss) from the native provider's list when they're also available via Mantle, so each model appears in one picker instead of both.
- Automatic display-name disambiguation: any models that would otherwise show identical labels in the picker (only distinguishable by tooltip, and effectively unselectable in some VS Code UI) now get the raw technical model ID appended so every entry stays unique.

### Fixed
- **Amazon Nova, Cohere Command R/R+, and AI21 Jamba models were invisible in VS Code's Agent mode** from first launch. VS Code only shows tool-capable models in the Agent-mode picker, and these three families support tool use on native Bedrock Converse but weren't in the tool-calling heuristic's pattern list and don't carry a parameter-count suffix in their model IDs to fall back on — so they defaulted to "no tool support" with no way to self-correct via runtime probing (a model that's never selectable can never be probed).

## [0.4.0] - 2026-07-11

### Added
- **Prompt Caching**: Native Converse requests to Claude/Nova models now insert Bedrock `cachePoint` checkpoints on tool definitions and the growing conversation history, reducing cost and latency on repeated turns. New `aws-bedrock.enablePromptCaching` setting (default on). Ignored for model families that don't support it.
- **Proactive Inference-Profile Resolution**: Model discovery now calls `ListInferenceProfiles` alongside `ListFoundationModels` and prewarms the resolution cache, so the first request to a current-generation Claude model no longer has to fail an on-demand attempt before falling back to its cross-region inference profile.
- **`aws-bedrock.assumeLongContextClaudeModels` setting**: Reports a 1,000,000-token context window for the specific Claude models known to support it (Sonnet 4, Sonnet 4.6, Sonnet 5, Opus 4.6+). Context window isn't monotonic by version — Sonnet 4.5 is capped at 200K despite sitting between two 1M-context releases — so this comes from a small maintained list rather than a computed rule. On by default; can be disabled per account/region.
- Defensive handling of Converse `reasoningContent` blocks: logged instead of silently dropped, with a lightweight "Thinking…" placeholder if a response ever contains only reasoning content.

### Changed
- **Settings page reorganized** into five grouped sections (AWS Bedrock, › Mantle, › Native, › Chat Behavior, › Model Metadata) with explicit display order and richer, cross-linked descriptions, replacing one flat 14-item list.
- **`aws-bedrock.modelMetadataSource` now defaults to `none`** instead of `litellm` — no external network call on model refresh out of the box. Litellm remains available as an opt-in for more accurate limits on non-Claude Mantle models.
- **Region list expanded from 12 to 18 regions** (added `us-west-1`, `ca-central-1`, `eu-west-3`, `ap-northeast-2`, `ap-southeast-1`, `ap-southeast-2`) and consolidated into a single source of truth (`src/regions.ts`) shared by the settings schema and the region picker.
- Native Bedrock models are now labeled "(Bedrock)" in the model picker instead of "(Native)".
- Token-limit heuristics no longer flatten every current-generation Claude model to 200K/4096 context when external metadata is unavailable; added a Claude 3.7 tier and generous defaults for 4.x/5.x+.

### Fixed
- AWS SDK dependencies bumped from 3.879 to 3.1085 (~6 months of Bedrock feature/region additions). Replaced the deprecated `@aws-sdk/signature-v4` and `@aws-sdk/types` packages with their canonical `@smithy/*` successors.
- Removed a dead `prepareLanguageModelChatInformation` method left over from an earlier, non-stable shape of VS Code's `LanguageModelChatProvider` API — it was never part of the interface VS Code actually calls.
- Replaced a dynamic `require("./utils")` in `bedrockNative.ts` with a static import.

## [0.3.4] - 2026-02-25

### Changed
- Rebranded documentation for GitHub Copilot Chat and sharpened compliance-focused positioning (data residency, region control, enterprise access model) across README, CONTRIBUTING, and other docs.

## [0.3.3] - 2026-02-05

### Fixed
- **Multi-turn Conversation Tool Result Preservation**: Fixed critical bug causing "Expected toolResult blocks" validation errors after ~10-43 conversation turns with tool use
  - Added `hasToolHistory()` function to detect tool blocks in message history
  - Modified tool preservation logic to check both current request AND message history
  - Tool result blocks are now preserved regardless of whether current request includes tools
  - Prevents orphaned tool call blocks that caused Bedrock API validation failures
  - Added debug logging for tool preservation decisions
  - Enhanced `validateRequest()` with better error tracking

## [0.3.2] - 2026-02-05

### Fixed
- **Native Bedrock Tool Calling**: Fixed validation to prevent incorrectly caching "tool unsupported" when request is missing tool results
  - Added pre-flight validation for native Bedrock requests to ensure tool calls have corresponding results
  - Distinguish between tool-config-not-supported errors vs missing-tool-result errors
  - Models no longer incorrectly marked as "no tools" when tool results are missing from context

## [0.3.1] - 2026-02-05

### Added
- Comprehensive Makefile with development, build, and publishing targets
  - Development targets: `install`, `compile`, `watch`, `lint`, `dev`
  - Build targets: `package`, `publish`, `check`
  - Cleanup targets: `clean`, `clean-all`
  - Version management: `version-patch`, `version-minor`, `version-major`
- ESLint flat config (`eslint.config.js`) for TypeScript linting support

### Changed
- Reorganized build artifacts into `dist/` directory (cleaner root)
- Updated `.gitignore` to ignore `dist/` folder instead of individual `*.vsix` files
- Improved publish workflow with built-in compilation and linting verification

## [0.3.0] - 2025-12-21

### Added
- **AWS Credentials Support for Mantle**: Mantle models now support both API key and AWS credential authentication
  - New authentication method selector in management UI
  - AWS SigV4 signing for Mantle requests when using credentials
  - Separate profile configuration for Mantle (`mantleAwsProfile`) and Native Bedrock (`awsProfile`)
  - Configuration option: `aws-bedrock.mantleAuthMethod` (apiKey | awsCredentials)
  - Configuration option: `aws-bedrock.mantleAwsProfile`

### Changed
- Enhanced "Manage AWS Bedrock" menu with authentication method selection
- Improved authentication flow to support both methods seamlessly
- Better error messages that specify which authentication method failed

### Dependencies
- Added `@aws-sdk/signature-v4` for AWS request signing
- Added `@aws-crypto/sha256-js` for signature hashing

## [0.2.4] - 2025-12-21

### Fixed
- **Output Channel Logging**: Replaced console.log with Output Channel logging for visibility in installed extension
  - Extension now creates "AWS Bedrock" output channel
  - All debug and error messages visible via View → Output → AWS Bedrock
  - Console output only appeared in Extension Development Host, not in installed extension

### Changed
- **Dependency Packaging**: Fixed .vscodeignore to include node_modules in VSIX
  - AWS SDK dependencies now bundled with extension
  - Resolves "Cannot find module '@aws-sdk/client-bedrock'" error
  - Extension size increased from 50KB to ~3MB but now works when installed

### Added
- Improved icon with sunburst gradient and horizon glow effect
- Enhanced error logging with stack traces
- Better activation error handling

### Documentation
- Added comprehensive CONTRIBUTING.md with development guidelines
- Documented critical learnings about:
  - Publisher name (must be lowercase: easytocloud)
  - Testing environments (F5 vs installed extension)
  - Logging best practices
  - Icon conversion workflow (rsvg-convert)
  - Dependency packaging requirements

## [0.2.3] - 2025-12-20

### Added
- External model metadata loading from LiteLLM registry
- Configurable metadata source and caching
- Better model capability detection (vision, token limits)

### Configuration
- `aws-bedrock.modelMetadataSource`: Source for model capabilities (litellm | none)
- `aws-bedrock.modelMetadataUrl`: URL for external metadata
- `aws-bedrock.modelMetadataCacheHours`: Cache duration for metadata

## [0.2.0] - 2025-12-19

### Added
- Native AWS Bedrock support via Converse API
- Dual backend architecture (Mantle + Native)
- Models marked as "(Mantle)" or "(Native)" in picker
- AWS profile configuration for native Bedrock
- Separate enable/disable toggles for each backend

### Configuration
- `aws-bedrock.enableMantle`: Enable/disable Mantle models
- `aws-bedrock.enableNative`: Enable/disable native Bedrock models  
- `aws-bedrock.awsProfile`: AWS profile for native Bedrock

## [0.1.0] - 2025-12-18

### Added
- Initial release
- Mantle (OpenAI-compatible) backend support
- Dynamic model discovery from Mantle API
- Streaming chat responses
- Tool calling support
- Multi-region support (12 AWS regions)
- API key management via SecretStorage
- Configuration commands
- Debug logging toggle

### Configuration
- `aws-bedrock.region`: AWS region selection
- `aws-bedrock.showAllModels`: Show/hide specialized model variants
- `aws-bedrock.debugLogging`: Enable verbose logging
- `aws-bedrock.sendTools`: Control tool definition sending
- `aws-bedrock.emitPlaceholders`: Show placeholder text while waiting

### Commands
- `Manage AWS Bedrock`: Main configuration command
- `Show AWS Bedrock Logs`: Open output channel
- `Clear AWS Bedrock API Key`: Remove stored API key

[0.5.0]: https://github.com/easytocloud/bedrock-vscode-chat/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/easytocloud/bedrock-vscode-chat/compare/v0.3.4...v0.4.0
[0.3.4]: https://github.com/easytocloud/bedrock-vscode-chat/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/easytocloud/bedrock-vscode-chat/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/easytocloud/bedrock-vscode-chat/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/easytocloud/bedrock-vscode-chat/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/easytocloud/bedrock-vscode-chat/compare/v0.2.4...v0.3.0
[0.2.4]: https://github.com/easytocloud/bedrock-vscode-chat/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/easytocloud/bedrock-vscode-chat/compare/v0.2.0...v0.2.3
[0.2.0]: https://github.com/easytocloud/bedrock-vscode-chat/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/easytocloud/bedrock-vscode-chat/releases/tag/v0.1.0
