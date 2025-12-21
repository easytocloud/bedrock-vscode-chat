# Contributing to AWS Bedrock VSCode Chat Extension

## Development Setup

### Prerequisites
- Node.js 20.x or later
- VS Code or VS Code Insiders
- Git
- `rsvg-convert` for icon generation (install via `brew install librsvg` on macOS)

### Initial Setup
```bash
git clone https://github.com/easytocloud/bedrock-vscode-chat.git
cd bedrock-vscode-chat
npm install
npm run compile
```

## Key Project Details

### Publisher Information
- **Publisher ID**: `easytocloud` (lowercase - important!)
- **Extension ID**: `bedrock-mantle-vscode-chat`
- **Display Name**: "Bedrock LLMs for VS Code Chat"

### Package Structure
The extension **MUST** include `node_modules` in the VSIX package because it uses AWS SDK dependencies that are not available in the VS Code runtime.

**Important**: `.vscodeignore` should NOT exclude `node_modules/**`

## Development Workflow

### 1. Local Development (Extension Development Host)

Press `F5` to launch the Extension Development Host. This uses your local `node_modules` and provides:
- Live debugging with breakpoints
- Console output in the Debug Console
- Hot reload on changes (Cmd/Ctrl+R)

### 2. Testing Installed Extension

To test the extension as users will experience it:

```bash
# Package the extension
npm run compile
npx @vscode/vsce package

# Install to VS Code Insiders (if that's what you're using)
code-insiders --install-extension bedrock-mantle-vscode-chat-x.x.x.vsix --force

# Or regular VS Code
code --install-extension bedrock-mantle-vscode-chat-x.x.x.vsix --force
```

**Important**: After installing, reload the window (Cmd+Shift+P → "Developer: Reload Window")

### 3. Viewing Extension Logs

**Extension Development Host (F5 mode):**
- Console output appears in Debug Console
- Use `console.log()` for debugging

**Installed Extension:**
- Open Output panel: Cmd+Shift+U (View → Output)
- Select "AWS Bedrock" from the dropdown
- **Never use `console.log()` - it goes nowhere!**
- Always use `output.appendLine()` or provider's `logDebug()`/`logAlways()` methods

### 4. Debugging Extension Activation Issues

If the extension doesn't appear or activate:

1. **Check Extension Host Logs:**
   - Cmd+Shift+P → "Developer: Show Logs..."
   - Select "Extension Host"

2. **Check Developer Console:**
   - Cmd+Shift+P → "Developer: Toggle Developer Tools"
   - Look for errors in Console tab

3. **Common Issues:**
   - Missing dependencies → Check `node_modules` is in VSIX
   - Syntax errors → Check compilation succeeded
   - Activation event not firing → Check `activationEvents` in package.json

## Logging Best Practices

### ✅ DO:
```typescript
// In extension.ts
const output = vscode.window.createOutputChannel("AWS Bedrock");
output.appendLine("Extension activated");

// In provider.ts
this.logDebug("Fetching models...");
this.logAlways("Error occurred: " + error.message);
```

### ❌ DON'T:
```typescript
// These only work in Extension Development Host, not installed extension!
console.log("Extension activated");
console.error("Error:", error);
console.warn("Warning");
```

## Icon Management

### Updating the Icon

The extension uses both SVG and PNG formats:
- `icon.svg` - Source file (editable)
- `icon.png` - Used by VS Code (128x128)

### Converting SVG to PNG

**Required tool**: `rsvg-convert` (install: `brew install librsvg`)

```bash
# Convert with exact dimensions
rsvg-convert -w 128 -h 128 icon.svg -o icon.png

# Verify the output
ls -lh icon.png
```

### Icon Design Guidelines

- Size: 128x128 pixels
- Format: PNG with transparency
- Style: Should work on both light and dark backgrounds
- Content: Include AWS/Bedrock branding elements

**Current design elements:**
- Sunburst gradient background (light blue to dark)
- AWS Bedrock foundation (orange/yellow)
- Chat bubbles (blue)
- Horizon glow effect (subtle white ellipse)

## Version Management

### Bumping Version

1. Update version in `package.json`:
```json
{
  "version": "0.2.4"
}
```

2. Commit and tag:
```bash
git add package.json
git commit -m "v0.2.4: Description of changes"
git tag v0.2.4
git push origin main --tags
```

### Publishing to Marketplace

```bash
# Package
npx @vscode/vsce package

# Publish (requires authentication)
npx @vscode/vsce publish
```

**Note**: Publishing requires a Personal Access Token (PAT) for the marketplace.

## Testing Checklist

Before releasing a new version:

- [ ] Compile succeeds: `npm run compile`
- [ ] No TypeScript errors: `npm run lint`
- [ ] Extension activates in F5 mode
- [ ] Extension activates when installed from VSIX
- [ ] Output channel shows logs (check "AWS Bedrock" in Output panel)
- [ ] Models load successfully
- [ ] Can send chat messages and receive responses
- [ ] Error messages display correctly
- [ ] Commands work (Manage AWS Bedrock, Show Logs)
- [ ] Icon displays correctly in Extensions panel
- [ ] README is up to date

## Common Development Tasks

### Adding a New Configuration Option

1. Update `package.json` contributes.configuration:
```json
{
  "aws-bedrock.newSetting": {
    "type": "boolean",
    "default": true,
    "description": "Description of setting"
  }
}
```

2. Access in code:
```typescript
const config = vscode.workspace.getConfiguration("aws-bedrock");
const value = config.get<boolean>("newSetting", true);
```

3. Listen for changes:
```typescript
vscode.workspace.onDidChangeConfiguration((e) => {
  if (e.affectsConfiguration("aws-bedrock.newSetting")) {
    // Handle change
  }
});
```

### Adding a New Command

1. Register in `package.json`:
```json
{
  "commands": [
    {
      "command": "bedrock-mantle-vscode-chat.myCommand",
      "title": "My Command Title"
    }
  ]
}
```

2. Implement in `extension.ts`:
```typescript
const myCommandHandler = async () => {
  // Command implementation
};

registerCommandSafe("bedrock-mantle-vscode-chat.myCommand", myCommandHandler);
```

## Architecture Notes

### Key Files

- `src/extension.ts` - Extension entry point, command registration
- `src/provider.ts` - Main provider implementing `LanguageModelChatProvider`
- `src/bedrockNative.ts` - Native AWS Bedrock support via Converse API
- `src/utils.ts` - Utility functions for message conversion, etc.
- `src/types.ts` - TypeScript type definitions
- `src/externalModelMetadata.ts` - External model capability metadata loading

### Provider Lifecycle

1. **Activation** (`onStartupFinished`)
   - Extension activates
   - Output channel created
   - Provider registered with VS Code
   - Models fetched eagerly

2. **Model Discovery** (`provideLanguageModelChatInformation`)
   - Fetch Mantle models (if enabled)
   - Fetch native Bedrock models (if enabled)
   - Merge and return model list

3. **Chat** (`provideLanguageModelChatResponse`)
   - Convert VS Code messages to API format
   - Stream responses via SSE
   - Parse tool calls incrementally
   - Emit text/tool call parts

### Dual Backend Support

The extension supports two backends:

1. **Mantle** (OpenAI-compatible)
   - Requires API key from AWS Bedrock Console
   - Uses `buildEndpointUrl(region)` for endpoints
   - Models marked as "(Mantle)" in picker

2. **Native Bedrock** (Converse API)
   - Uses AWS credentials (SDK)
   - Supports AWS profiles
   - Models marked as "(Native)" in picker

## Troubleshooting Common Issues

### "Cannot find module '@aws-sdk/client-bedrock'"

**Cause**: Dependencies not included in VSIX
**Fix**: Ensure `.vscodeignore` does NOT exclude `node_modules/**`

### No logs in Output Channel

**Cause**: Using `console.log()` instead of output channel
**Fix**: Replace all `console.log()` with `output.appendLine()` or `this.logDebug()`

### Extension doesn't activate

**Possible causes:**
1. Check Extension Host logs for errors
2. Verify `activationEvents` in package.json
3. Check for JavaScript errors in compiled code
4. Ensure `main` points to correct file: `"./out/extension.js"`

### Models not showing up

**Check:**
1. Output channel for error messages
2. API key is set (for Mantle)
3. AWS credentials configured (for Native)
4. Network connectivity
5. Region configuration

## Code Style Guidelines

- Use TypeScript strict mode
- Prefer `const` over `let`
- Use async/await over promises
- Add JSDoc comments for public functions
- Keep functions focused and small
- Use meaningful variable names
- Handle errors gracefully with user-friendly messages

## Resources

- [VS Code Extension API](https://code.visualstudio.com/api)
- [Language Model API](https://code.visualstudio.com/api/extension-guides/language-model)
- [AWS SDK for JavaScript](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/)
- [OpenAI API Reference](https://platform.openai.com/docs/api-reference)

## Getting Help

- Open an issue on GitHub
- Check existing issues for similar problems
- Include logs from Output Channel ("AWS Bedrock")
- Provide VS Code version and extension version
