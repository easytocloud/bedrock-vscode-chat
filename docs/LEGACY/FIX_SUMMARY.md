## Fix Summary: Tool Result Block Preservation

### The Problem (Before)

In multi-turn conversations with Bedrock's Converse API, users would encounter:

```
ValidationException: Expected toolResult blocks at messages.43.content for the following Ids: 
tooluse_OzWmhgspl4SrdN4hEiCSkr, tooluse_4vApg8VZAwbKkfYvMSyW9P
```

**When?** After ~10-43 conversation turns involving tool use.

**Why?**
1. Turn 1-3: Model uses a tool, user provides result → Message history has both `toolUse` and `toolResult` blocks
2. Turn 4-43: Regular conversation, then request where model doesn't need tools
3. When `toolConfig` is undefined/not sent in request, the conversion logic would set `allowToolBlocks: false`
4. This stripped all tool blocks from message history, leaving orphaned `toolUse` blocks
5. Bedrock API validation failed: "You have toolUse blocks but no corresponding toolResult blocks"

### The Solution (After)

**Key change in `src/bedrockNative.ts`:**

```typescript
// BEFORE: Gated tool preservation on current request only
const converted = convertVscodeMessagesToBedrock(options.messages, { allowToolBlocks: !!toolConfig });

// AFTER: Check both current request AND message history
const hasTools = !!toolConfig || hasToolHistory(options.messages);
const converted = convertVscodeMessagesToBedrock(options.messages, { allowToolBlocks: hasTools });
```

**New helper function:**
```typescript
function hasToolHistory(messages: readonly vscode.LanguageModelChatRequestMessage[]): boolean {
	for (const msg of messages) {
		for (const part of msg.content) {
			if (part instanceof vscode.LanguageModelToolCallPart || part instanceof vscode.LanguageModelToolResultPart) {
				return true;
			}
		}
	}
	return false;
}
```

### Result

✅ Multi-turn conversations now work reliably beyond 43 messages
✅ Tool blocks are preserved throughout conversation history
✅ Tool calls stay paired with their results
✅ No more "Expected toolResult blocks" validation errors

### Files Modified

1. **src/bedrockNative.ts**
   - Added: `hasToolHistory()` function
   - Modified: Tool preservation logic to check message history
   - Added: Debug logging for tool preservation decisions
   - Added: Explanatory comment about the fix

2. **src/utils.ts**
   - Enhanced: `validateRequest()` to track tool presence
   - Added: Explanatory comment linking to bedrockNative.ts

### Test Coverage

✅ **test-tool-preservation.js** - Integration test showing 40+ messages with tools preserved  
✅ **test-implementation.js** - Verification of actual source and compiled code  
✅ **npm run compile** - TypeScript compilation passes  
✅ **npm run lint** - ESLint checks pass
