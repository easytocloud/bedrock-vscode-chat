.PHONY: help install compile watch lint clean package publish dev test check

# Color output
GREEN := \033[0;32m
BLUE := \033[0;34m
NC := \033[0m # No Color

# Default target
help:
	@echo "$(BLUE)Bedrock GitHub Copilot Chat Extension - Available targets:$(NC)"
	@echo ""
	@echo "$(GREEN)Development:$(NC)"
	@echo "  make install    - Install dependencies"
	@echo "  make compile    - Compile TypeScript"
	@echo "  make watch      - Watch TypeScript files and compile on changes"
	@echo "  make lint       - Lint TypeScript code"
	@echo "  make dev        - Start development mode (watch + debugging ready)"
	@echo "  make test       - Run tests (if available)"
	@echo ""
	@echo "$(GREEN)Building & Publishing:$(NC)"
	@echo "  make check      - Run compile and lint checks"
	@echo "  make clean      - Clean build artifacts"
	@echo "  make package    - Package extension as VSIX"
	@echo "  make publish    - Publish to VS Code Marketplace (requires PAT)"
	@echo ""
	@echo "$(GREEN)Cleanup:$(NC)"
	@echo "  make clean-all  - Remove node_modules and build artifacts"

# Install dependencies
install:
	@echo "$(BLUE)Installing dependencies...$(NC)"
	npm install

# Compile TypeScript
compile:
	@echo "$(BLUE)Compiling TypeScript...$(NC)"
	npm run compile

# Watch mode for development
watch:
	@echo "$(BLUE)Watching TypeScript files...$(NC)"
	npm run watch

# Lint code
lint:
	@echo "$(BLUE)Linting code...$(NC)"
	npm run lint

# Development mode (watch compilation)
dev: compile
	@echo "$(BLUE)Starting development mode...$(NC)"
	@echo "Press F5 in VS Code to launch the Extension Development Host"
	npm run watch

# Run checks (compile + lint)
check: compile lint
	@echo "$(GREEN)✓ All checks passed$(NC)"

# Clean build artifacts
clean:
	@echo "$(BLUE)Cleaning build artifacts...$(NC)"
	rm -rf ../out/
	find .. -name "*.js" -path "../out/*" -delete 2>/dev/null || true
	find .. -name "*.js.map" -path "../out/*" -delete 2>/dev/null || true

# Complete cleanup
clean-all: clean
	@echo "$(BLUE)Removing node_modules...$(NC)"
	rm -rf ../node_modules/
	rm -rf ../dist/

# Package extension as VSIX
package: check
	@echo "$(BLUE)Packaging extension...$(NC)"
	mkdir -p ../dist
	npx @vscode/vsce package --out ../dist/

# Publish to VS Code Marketplace
publish: check
	@echo "$(BLUE)Publishing to VS Code Marketplace...$(NC)"
	@echo "Note: This requires a valid Personal Access Token (PAT)"
	@echo "Make sure you have authenticated with: npx @vscode/vsce login"
	@echo ""
	npx @vscode/vsce publish

# Test target (placeholder for future test setup)
test:
	@echo "$(BLUE)Running tests...$(NC)"
	@echo "No tests configured yet"

# Version management targets
.PHONY: version-patch version-minor version-major

version-patch:
	@echo "$(BLUE)Bumping patch version...$(NC)"
	npm version patch

version-minor:
	@echo "$(BLUE)Bumping minor version...$(NC)"
	npm version minor

version-major:
	@echo "$(BLUE)Bumping major version...$(NC)"
	npm version major

# Print current version
version:
	@grep '"version"' ../package.json | head -1 | sed 's/.*"version": "\(.*\)".*/\1/'
