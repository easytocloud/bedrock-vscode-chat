# Changelog

All notable changes to the AWS Bedrock VSCode Chat extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.3.0]: https://github.com/easytocloud/bedrock-vscode-chat/compare/v0.2.4...v0.3.0
[0.2.4]: https://github.com/easytocloud/bedrock-vscode-chat/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/easytocloud/bedrock-vscode-chat/compare/v0.2.0...v0.2.3
[0.2.0]: https://github.com/easytocloud/bedrock-vscode-chat/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/easytocloud/bedrock-vscode-chat/releases/tag/v0.1.0
