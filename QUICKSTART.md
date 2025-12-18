# Quick Start Guide

## Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Compile the Extension
```bash
npm run compile
```

### 3. Run the Extension
Press `F5` in VS Code to open the Extension Development Host

### 4. Configure API Key
1. In the Extension Development Host window, open Command Palette (`Cmd+Shift+P`)
2. Run: `Manage AWS Bedrock API Key`
3. Select "Enter API Key"
4. Paste your API key from [AWS Bedrock Console](https://console.aws.amazon.com/bedrock/)

### 5. Test the Extension
1. Open VS Code Chat (`Cmd+Shift+I`)
2. Click the model picker dropdown
3. Select an AWS Bedrock model (e.g., "OpenAI GPT OSS 120B")
4. Start chatting!

## Development Workflow

### Watch Mode
```bash
npm run watch
```
This will automatically recompile when you make changes.

### Debugging
1. Set breakpoints in the source code
2. Press `F5` to launch the Extension Development Host
3. Trigger the code you want to debug
4. Debugger will pause at your breakpoints

### Testing Models
Try these models for different use cases:
- **Fast responses**: `mistral.ministral-3-3b-instruct`
- **Balanced**: `google.gemma-3-27b-it`
- **Powerful**: `openai.gpt-oss-120b`
- **Coding**: `qwen.qwen3-coder-30b-a3b-instruct`
- **Vision**: `qwen.qwen3-vl-235b-a22b-instruct`

## Troubleshooting

### Extension Not Showing Up
- Make sure you compiled: `npm run compile`
- Check for errors in the Debug Console (View → Debug Console)

### Models Not Loading
- Verify API key is entered correctly
- Check region setting (Settings → AWS Bedrock → Region)
- Look for errors in Developer Tools (Help → Toggle Developer Tools)

### Changes Not Reflecting
- Reload the Extension Development Host: `Cmd+R` (Mac) / `Ctrl+R` (Windows/Linux)
- Or close and press `F5` again

## Next Steps

See [PLAN.md](PLAN.md) for the full architecture and implementation details.
See [README.md](README.md) for complete documentation.

## Useful Commands

| Command | Description |
|---------|-------------|
| `npm run compile` | Compile TypeScript |
| `npm run watch` | Watch mode compilation |
| `npm run lint` | Run linting |
| `F5` | Launch Extension Development Host |
| `Cmd/Ctrl+R` | Reload Extension Development Host |
