# Model Capabilities Detection Strategy

## Problem Statement

Amazon Bedrock APIs (`ListFoundationModels`, `GetFoundationModel`) do **NOT** provide:
- Context window size / token limits
- Tool calling / function calling support  
- Maximum input/output tokens

They **DO** provide:
- `inputModalities` / `outputModalities` (TEXT, IMAGE, EMBEDDING) for vision
- `responseStreamingSupported`
- `modelLifecycle.status` (ACTIVE/LEGACY)

## Current Multi-Tier Approach (RECOMMENDED)

###  1. Amazon Bedrock API (Authoritative for Vision)
**Source**: `ListFoundationModels` API → `inputModalities`

```typescript
// In bedrockNative.ts
const supportsVision = (m.inputModalities ?? []).some(
  (mod) => mod.toString().toUpperCase() === "IMAGE"
);
```

**Reliability**: ✅ **100%** - This is the official AWS API data

### 2. External Metadata (models.dev)
**Source**: https://models.dev/api.json, fetched with the `@opencode-ai/models` client (`src/externalModelMetadata.ts`), provider `amazon-bedrock`

Keyed by native Amazon Bedrock model ID, including cross-region inference-profile prefixes (`us.`, `eu.`, `global.`, ...). Provides:
- `limit.context` / `limit.input` / `limit.output`
- `tool_call`
- `modalities.input` (vision = includes `image`)
- `reasoning`

**Reliability**: ⚠️ **~80-90%** - Community maintained, may lag behind AWS releases

### 3. Runtime Probing (Fallback & Verification)
**Method**: Try using a feature, cache the result

```typescript
// In provider.ts - already implemented
private _mantleToolSupport = new Map<string, boolean>();
private _nativeToolSupport = new Map<string, boolean>();
```

**Reliability**: ✅ **100%** for tested models, but requires actual API calls

### 4. Heuristic Fallbacks (Last Resort)
**Method**: Pattern matching on model IDs

```typescript
// In utils.ts
function inferModelCapabilities(modelId: string): ModelCapabilities {
  const lowerModelId = modelId.toLowerCase();
  
  // Vision from name patterns
  const supportsVision = lowerModelId.includes("-vl-") || 
                         lowerModelId.includes("vision");
  
  // Tool calling from known families
  const supportsToolCalling = 
    lowerModelId.includes("gpt-oss") ||
    lowerModelId.includes("claude") ||
    // ... etc
}
```

**Reliability**: ⚠️ **60-70%** - Best guess, will have false positives/negatives

## Recommended Implementation Order

1. **AWS API** for vision (already correct ✅)
2. **models.dev metadata** for token limits & initial tool support hint
3. **Runtime probing** to verify tool support on first use
4. **Heuristics** as final fallback if all else fails

## Why This Is The Best We Can Do

The Amazon Bedrock team intentionally does **NOT** expose:
- Tool calling in model metadata (models vary by region/version)
- Token limits (considered implementation details that may change)
- Detailed capability matrices

The extension must rely on:
- External community registries (models.dev)
- Runtime behavior observation
- Conservative defaults

## Action Items

### SHORT TERM (Keep Current Approach)
- ✅ Use AWS API for vision (`inputModalities`)
- ✅ Use models.dev for token limits
- ✅ Use runtime probing for tool support
- ✅ Maintain conservative defaults

### MEDIUM TERM (Enhancements)
- 📝 Add AWS official model docs scraper (if they publish capability tables)
- 📝 Build telemetry to report actual capabilities back for refinement
- 📝 Create per-model override configuration for users

### LONG TERM (Amazon Bedrock Feature Request)
- 📧 Request AWS add `supportsToolCalling` and `tokenLimits` to `FoundationModelSummary`
- 📧 Ask for model capability matrix API endpoint

## Conclusion

**The current 3-tier approach is industry standard and correct.**

There is no "reliable programmatic way" to get all capabilities from AWS alone. The combination of:
1. AWS APIs (vision)
2. models.dev metadata (tokens, tool hints)
3. Runtime probing (verification)

...is the **best possible solution** given Amazon Bedrock's current API limitations.
