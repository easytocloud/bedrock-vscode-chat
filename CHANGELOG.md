# Changelog

All notable changes to the GitHub Copilot Chat Model Provider for Amazon Bedrock extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.3] - 2026-07-12

### Changed
- **Naming cleanup for trademark correctness and accurate positioning.** The AWS service is now referred to consistently as **"Amazon Bedrock"** (never "AWS Bedrock" or a bare "Bedrock") across the UI, settings, and docs, and the extension is described as a **GitHub Copilot Chat model provider** for Amazon Bedrock rather than as being Amazon Bedrock itself. Specifics:
  - Marketplace display name → "GitHub Copilot Chat Model Provider for Amazon Bedrock".
  - Model-picker provider labels → "Amazon Bedrock" (native) and "Amazon Bedrock Mantle".
  - Activity Bar container, Output channel, Settings group headers, config panel title, and Command Palette category → "Amazon Bedrock (Copilot Chat)".
  - Command titles reworded (e.g. "Manage Native Provider (Converse API)", "Manage Mantle Provider (OpenAI-compatible)", "Clear Mantle API Key", "Show Logs").
  - Native model entries are labeled "(Native)" in the picker again, parallel to "(Mantle)".
  - Added an Amazon Bedrock / AWS trademark attribution note to the README.
  - No setting IDs, command IDs, or vendor IDs changed, so existing configurations and keybindings keep working.

## [0.6.2] - 2026-07-12

### Changed
- **Repository reorganization**: moved configuration files (`esbuild.js`, `tsconfig.json`, `eslint.config.js`, `Makefile`) into `config/` directory, documentation into `docs/`, and assets into `assets/` for better maintainability. Updated all build scripts and paths accordingly.

### Fixed
- Fixed ESLint configuration path resolution in lint script by adding `--config config/eslint.config.js` flag.

## [0.6.1] - 2026-07-12

### Changed
- Improved configuration UX: added profile picker, status headers, connection test, and zero-models warning to help users set up and debug credentials more easily.

## [0.6.0] - 2026-07-11

### Added
- **`aws-bedrock.requestTimeout` setting** (default 120000ms): aborts a request that never responds. For streaming requests (Mantle Chat Completions and Messages API) this only guards time-to-first-response — an actively streaming generation is never cut off once it starts. For native Amazon Bedrock Converse, which isn't streamed, it covers the whole call. Set to 0 to disable.
- **`aws-bedrock.logLevel` setting** (`verbose` | `info` | `warning` | `error` | `none`, default `info`): replaces the binary `aws-bedrock.debugLogging` boolean with proper severity levels, so you can dial output up or down without an all-or-nothing firehose. Existing `debugLogging` settings are no longer read — reconfigure with `logLevel` if you had debug logging on.

### Changed
- **The extension is now bundled with esbuild** into a single `out/extension.js` instead of shipping `node_modules` raw inside the VSIX. This was flagged by `vsce publish` on every release ("This extension consists of 3393 files... you should bundle your extension") — package size drops from ~4.5MB/3300+ files to ~220KB/8 files, with faster install and activation. `.vscodeignore`, `tsconfig.json`, `Makefile`-adjacent build scripts, and the F5 debug watch tasks were all updated to match (dev builds still emit to `out/`, matching the existing `make clean`/debug convention — `dist/` remains reserved for packaged `.vsix` archives).

### Fixed
- **README badges**: the Version/Installs/Rating badges were rendering as "retired badge" — Shields.io permanently retired its `visual-studio-marketplace` badge category (no documented Microsoft API to source live data from). Replaced with a static "Install" badge linking to the Marketplace listing; the GitHub-sourced License/Stars/Issues badges were unaffected and left as-is.

## [0.5.1] - 2026-07-11

### Fixed
- Added the `language-models` keyword so the extension is discoverable via the Marketplace's `@tag:language-models` filter (used by VS Code's "Manage Language Models" → "Install Model Providers" flow). This tag isn't auto-derived from the `languageModelChatProviders` contribution point — confirmed by querying the Marketplace gallery API directly — it's a plain keyword extension authors add themselves.

## [0.5.0] - 2026-07-11

### Added
- **Split into two separate language model providers**: "Amazon Bedrock" (native Converse API) and "Amazon Bedrock Mantle" (OpenAI-compatible), each with its own vendor ID, region setting, and "Manage" command. Native and Mantle are genuinely different Amazon Bedrock endpoints — different region footprints, auth details, and model coverage — so merging them into one provider was misleading. Existing native model selections are unaffected (the original vendor ID was kept for native).
- **Anthropic Messages API support on Mantle** (`/anthropic/v1/messages`): Claude models that Mantle actually supports (Sonnet 5, Haiku 4.5, Opus 4.7, Opus 4.8, Fable 5, Mythos 5, Mythos Preview) are now invoked through Mantle's separate Messages API instead of being hidden. No Claude model supports Mantle's Chat Completions API (`/v1/chat/completions`) on any Amazon Bedrock endpoint — that was the actual bug behind the "does not support the '/v1/chat/completions' API" crash, not a blanket Claude/Mantle incompatibility.
- **`aws-bedrock.mantleRegion` setting**: Mantle is deployed to a strict subset of native Amazon Bedrock's regions (13 vs 18) — picking a native-only region (`us-west-1`, `ca-central-1`, `eu-west-3`, `ap-northeast-2`, `ap-southeast-1`) no longer silently breaks Mantle.
- **`aws-bedrock.hideMantleModelsFromNative` setting** (default off): optionally hides open-weight models (DeepSeek, Mistral, Qwen, GLM, Nemotron, MiniMax, Kimi, Gemma, gpt-oss) from the native provider's list when they're also available via Mantle, so each model appears in one picker instead of both.
- Automatic display-name disambiguation: any models that would otherwise show identical labels in the picker (only distinguishable by tooltip, and effectively unselectable in some VS Code UI) now get the raw technical model ID appended so every entry stays unique.

### Fixed
- **Amazon Nova, Cohere Command R/R+, and AI21 Jamba models were invisible in VS Code's Agent mode** from first launch. VS Code only shows tool-capable models in the Agent-mode picker, and these three families support tool use on native Amazon Bedrock Converse but weren't in the tool-calling heuristic's pattern list and don't carry a parameter-count suffix in their model IDs to fall back on — so they defaulted to "no tool support" with no way to self-correct via runtime probing (a model that's never selectable can never be probed).

## [0.4.0] - 2026-07-11

### Added
- **Prompt Caching**: Native Converse requests to Claude/Nova models now insert Amazon Bedrock `cachePoint` checkpoints on tool definitions and the growing conversation history, reducing cost and latency on repeated turns. New `aws-bedrock.enablePromptCaching` setting (default on). Ignored for model families that don't support it.
- **Proactive Inference-Profile Resolution**: Model discovery now calls `ListInferenceProfiles` alongside `ListFoundationModels` and prewarms the resolution cache, so the first request to a current-generation Claude model no longer has to fail an on-demand attempt before falling back to its cross-region inference profile.
- **`aws-bedrock.assumeLongContextClaudeModels` setting**: Reports a 1,000,000-token context window for the specific Claude models known to support it (Sonnet 4, Sonnet 4.6, Sonnet 5, Opus 4.6+). Context window isn't monotonic by version — Sonnet 4.5 is capped at 200K despite sitting between two 1M-context releases — so this comes from a small maintained list rather than a computed rule. On by default; can be disabled per account/region.
- Defensive handling of Converse `reasoningContent` blocks: logged instead of silently dropped, with a lightweight "Thinking…" placeholder if a response ever contains only reasoning content.

### Changed
- **Settings page reorganized** into five grouped sections (Amazon Bedrock, › Mantle, › Native, › Chat Behavior, › Model Metadata) with explicit display order and richer, cross-linked descriptions, replacing one flat 14-item list.
- **`aws-bedrock.modelMetadataSource` now defaults to `none`** instead of `litellm` — no external network call on model refresh out of the box. Litellm remains available as an opt-in for more accurate limits on non-Claude Mantle models.
- **Region list expanded from 12 to 18 regions** (added `us-west-1`, `ca-central-1`, `eu-west-3`, `ap-northeast-2`, `ap-southeast-1`, `ap-southeast-2`) and consolidated into a single source of truth (`src/regions.ts`) shared by the settings schema and the region picker.
- Native Amazon Bedrock models are now labeled "(Bedrock)" in the model picker instead of "(Native)".
- Token-limit heuristics no longer flatten every current-generation Claude model to 200K/4096 context when external metadata is unavailable; added a Claude 3.7 tier and generous defaults for 4.x/5.x+.

### Fixed
- AWS SDK dependencies bumped from 3.879 to 3.1085 (~6 months of Amazon Bedrock feature/region additions). Replaced the deprecated `@aws-sdk/signature-v4` and `@aws-sdk/types` packages with their canonical `@smithy/*` successors.
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
  - Prevents orphaned tool call blocks that caused Amazon Bedrock API validation failures
  - Added debug logging for tool preservation decisions
  - Enhanced `validateRequest()` with better error tracking

## [0.3.2] - 2026-02-05

### Fixed
- **Native Amazon Bedrock Tool Calling**: Fixed validation to prevent incorrectly caching "tool unsupported" when request is missing tool results
  - Added pre-flight validation for native Amazon Bedrock requests to ensure tool calls have corresponding results
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
  - Separate profile configuration for Mantle (`mantleAwsProfile`) and Native Amazon Bedrock (`awsProfile`)
  - Configuration option: `aws-bedrock.mantleAuthMethod` (apiKey | awsCredentials)
  - Configuration option: `aws-bedrock.mantleAwsProfile`

### Changed
- Enhanced "Manage Amazon Bedrock" menu with authentication method selection
- Improved authentication flow to support both methods seamlessly
- Better error messages that specify which authentication method failed

### Dependencies
- Added `@aws-sdk/signature-v4` for AWS request signing
- Added `@aws-crypto/sha256-js` for signature hashing

## [0.2.4] - 2025-12-21

### Fixed
- **Output Channel Logging**: Replaced console.log with Output Channel logging for visibility in installed extension
  - Extension now creates "Amazon Bedrock" output channel
  - All debug and error messages visible via View → Output → Amazon Bedrock
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
- Native Amazon Bedrock support via Converse API
- Dual backend architecture (Mantle + Native)
- Models marked as "(Mantle)" or "(Native)" in picker
- AWS profile configuration for native Amazon Bedrock
- Separate enable/disable toggles for each backend

### Configuration
- `aws-bedrock.enableMantle`: Enable/disable Mantle models
- `aws-bedrock.enableNative`: Enable/disable native Amazon Bedrock models  
- `aws-bedrock.awsProfile`: AWS profile for native Amazon Bedrock

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
- `Manage Amazon Bedrock`: Main configuration command
- `Show Amazon Bedrock Logs`: Open output channel
- `Clear Amazon Bedrock API Key`: Remove stored API key

[0.6.0]: https://github.com/easytocloud/bedrock-vscode-chat/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/easytocloud/bedrock-vscode-chat/compare/v0.5.0...v0.5.1
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
