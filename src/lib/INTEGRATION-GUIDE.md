# Phase 1 Enhancements — Integration Guide

## What Was Built

Three new modules (pure additions, zero modifications to existing files):

1. **`src/lib/tokenjuice.ts`** — Content-aware compression for tool results
2. **`src/lib/microcompact.ts`** — Clear old tool-result bodies while keeping structure
3. **`src/lib/episodic-memory.ts`** — Auto-archive every turn with metadata
4. **`src/lib/agent-loop-enhancements.ts`** — Wrapper that applies all three to the tool loop

## Feature Flags (All OFF by default)

Add to `.env.local`:

```bash
# Phase 1: Token Efficiency + Memory
ENABLE_TOKENJUICE=true        # Content-aware tool result compression
ENABLE_MICROCOMPACT=true      # Clear old tool result bodies
ENABLE_EPISODIC_MEMORY=true   # Auto-archive every turn
```

If any flag is missing or not `"true"`, that feature is a no-op.

## How to Integrate

### Option A: Minimal (recommended for testing)

In `src/app/api/agent/route.ts`, find:

```typescript
result = await executeNativeToolLoop(
  compacted.messages,
  finalSelected.endpoint,
  finalSelected.apiKey,
  finalSelected.modelId,
  timeoutMs,
  maxTurns,
  requestStart,
  maxTotalMs,
);
```

Replace with:

```typescript
import { wrapWithEnhancements } from "@/lib/agent-loop-enhancements";

// ... inside the POST handler ...
const enhancedExecute = wrapWithEnhancements(executeNativeToolLoop);
const enhancedResult = await enhancedExecute(
  compacted.messages,
  finalSelected.endpoint,
  finalSelected.apiKey,
  finalSelected.modelId,
  timeoutMs,
  maxTurns,
  requestStart,
  maxTotalMs,
  sessionId || "unknown",
  message || "",
);

// If you want telemetry in the response:
if (enhancedResult.telemetry.tokenjuiceSavings > 0) {
  console.log(`[tokenjuice] Saved ${enhancedResult.telemetry.tokenjuiceSavings}% on tool results`);
}
if (enhancedResult.telemetry.microcompactCleared > 0) {
  console.log(`[microcompact] Cleared ${enhancedResult.telemetry.microcompactCleared} old tool results`);
}
if (enhancedResult.telemetry.episodicFile) {
  console.log(`[episodic] Archived to ${enhancedResult.telemetry.episodicFile}`);
}

// Use the original fields (unchanged):
result = {
  reply: enhancedResult.reply,
  tokens: enhancedResult.tokens,
  phases: enhancedResult.phases,
};
```

### Option B: Preview First (zero risk)

Before enabling, preview what would be saved:

```typescript
import { previewEnhancements } from "@/lib/agent-loop-enhancements";

// In the POST handler, after building messages:
const preview = previewEnhancements(compacted.messages);
console.log("Would clear", preview.microcompactWouldClear, "tool results");
console.log("Would save ~", preview.microcompactWouldSave, "bytes");
console.log("TokenJuice would save", preview.tokenjuiceSavings, "%");
```

This is a pure computation — no mutations, no side effects.

## Rollback

If anything breaks:

1. Remove the `ENABLE_*` lines from `.env.local`
2. Revert `agent/route.ts` to the original `executeNativeToolLoop` call

The new modules remain in `src/lib/` but are no-ops when disabled.

## Testing Without Integration

You can test each module standalone:

```typescript
// tokenjuice
import { tokenjuiceCompress } from "@/lib/tokenjuice";
process.env.ENABLE_TOKENJUICE = "true"; // force on
const r = tokenjuiceCompress(largeJSON, { contentType: "json", maxBytes: 4000 });
console.log(r.savings, "% saved via", r.technique);

// microcompact
import { microcompact } from "@/lib/microcompact";
process.env.ENABLE_MICROCOMPACT = "true";
const mc = microcompact(messages, { keepRecent: 3 });
console.log("Cleared", mc.cleared, "messages, saved", mc.bytesSaved, "bytes");

// episodic memory
import { recordTurn, searchEpisodicMemory } from "@/lib/episodic-memory";
process.env.ENABLE_EPISODIC_MEMORY = "true";
await recordTurn({ sessionId: "test", userMessage: "hello", modelUsed: "test" });
const results = await searchEpisodicMemory("hello");
```
