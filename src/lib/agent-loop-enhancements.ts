// ── Agent Loop Enhancements — Opt-in middleware for Smyth's tool loop
// Wraps the existing executeNativeToolLoop without modifying it.
//
// This module adds:
//   1. TokenJuice compression on tool results (after each tool call)
//   2. Microcompact clearing of old tool bodies (after each tool call)
//   3. Episodic memory auto-archiving of every turn
//   4. Token savings telemetry
//
// FEATURE FLAG: All enhancements are OFF by default.
// Set ENABLE_TOKENJUICE=true, ENABLE_MICROCOMPACT=true, ENABLE_EPISODIC_MEMORY=true
// in .env.local to activate.
//
// Integration:
//   In agent/route.ts, replace:
//     result = await executeNativeToolLoop(...)
//   With:
//     result = await executeEnhancedToolLoop(...)
//   (Original function is left untouched)

import { tokenjuiceCompress } from "./tokenjuice";
import { microcompact } from "./microcompact";
import { recordTurn, searchEpisodicMemory, type ToolUsage } from "./episodic-memory";

// Re-export the original types so callers don't need to change imports
export interface ToolPhase {
  tool: string;
  status: "running" | "done" | "error";
  args?: Record<string, any>;
  result?: string;
}

export interface EnhancedResult {
  reply: string;
  tokens: number;
  phases: ToolPhase[];
  telemetry: {
    tokenjuiceSavings: number;
    microcompactCleared: number;
    microcompactBytesSaved: number;
    episodicFile: string | null;
    totalBytesSaved: number;
  };
}

// ── Create a post-tool callback that applies TokenJuice + Microcompact ──
function createPostToolCallback(): (
  toolName: string,
  result: string,
  messages: any[]
) => Promise<void> {
  return async (toolName: string, result: string, messages: any[]) => {
    // 1. TokenJuice: compress the latest tool result in-place
    if (process.env.ENABLE_TOKENJUICE === "true") {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && lastMsg.role === "tool" && typeof lastMsg.content === "string") {
        const compressed = tokenjuiceCompress(lastMsg.content, {
          contentType: "auto",
          maxBytes: 16 * 1024,
        });
        if (compressed.savings > 0) {
          lastMsg.content = compressed.text;
          // Log silently — too noisy per-tool
          // console.log(`[tokenjuice] ${toolName}: ${compressed.savings}% saved (${compressed.technique})`);
        }
      }
    }

    // 2. Microcompact: clear older tool results while keeping structure
    if (process.env.ENABLE_MICROCOMPACT === "true" && messages.length > 8) {
      // Only microcompact every 3rd tool call to avoid thrashing
      const toolResultCount = messages.filter((m) => m.role === "tool").length;
      if (toolResultCount > 3 && toolResultCount % 3 === 0) {
        const mc = microcompact(messages, { keepRecent: 2 });
        if (mc.cleared > 0) {
          // Merge compacted messages back into the array
          messages.length = 0;
          messages.push(...mc.messages);
        }
      }
    }
  };
}

// ── Wrap a tool loop with all enhancements ──
// This is a HIGHER-ORDER FUNCTION: it wraps the original executeNativeToolLoop
// and applies compression + archiving on every turn.
//
// Usage:
//   const enhanced = wrapWithEnhancements(executeNativeToolLoop);
//   const result = await enhanced(messages, endpoint, apiKey, modelId, ...);
export function wrapWithEnhancements(
  originalExecute: (
    messages: any[],
    endpoint: string,
    apiKey: string,
    modelId: string,
    timeoutMs: number,
    maxTurns?: number,
    requestStart?: number,
    maxTotalMs?: number,
    onToolResult?: (toolName: string, result: string, messages: any[]) => void | Promise<void>,
    toolsRef?: { current: any[] },
    loadCategoryTools?: (categories: string[]) => void,
    pool?: string,
    account?: string,
  ) => Promise<{ reply: string; tokens: number; phases: ToolPhase[] }>
): (
  messages: any[],
  endpoint: string,
  apiKey: string,
  modelId: string,
  timeoutMs: number,
  maxTurns?: number,
  requestStart?: number,
  maxTotalMs?: number,
  sessionId?: string,
  userMessage?: string,
  toolsRef?: { current: any[] },
  loadCategoryTools?: (categories: string[]) => void,
  pool?: string,
  account?: string,
) => Promise<EnhancedResult> {

  return async (
    messages,
    endpoint,
    apiKey,
    modelId,
    timeoutMs,
    maxTurns = 20,
    requestStart = 0,
    maxTotalMs = 240_000,
    sessionId = "unknown",
    userMessage = "",
    toolsRef,
    loadCategoryTools,
    pool,
    account,
  ): Promise<EnhancedResult> => {
    let totalTokenjuiceSavings = 0;
    let totalMicrocompactCleared = 0;
    let totalMicrocompactBytes = 0;
    let episodicFile: string | null = null;

    // === Pre-compress existing messages ===
    // TokenJuice on initial messages
    if (process.env.ENABLE_TOKENJUICE === "true") {
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.role === "tool" && typeof msg.content === "string" && Buffer.byteLength(msg.content) > 4000) {
          const compressed = tokenjuiceCompress(msg.content, { contentType: "auto" });
          if (compressed.savings > 0) {
            messages[i].content = compressed.text;
            totalTokenjuiceSavings = Math.max(totalTokenjuiceSavings, compressed.savings);
          }
        }
      }
    }

    // Microcompact on initial messages
    if (process.env.ENABLE_MICROCOMPACT === "true" && messages.length > 10) {
      const mc = microcompact(messages, { keepRecent: 3 });
      if (mc.cleared > 0) {
        // Replace in-place
        messages.length = 0;
        messages.push(...mc.messages);
        totalMicrocompactCleared += mc.cleared;
        totalMicrocompactBytes += mc.bytesSaved;
      }
    }

    // Build post-tool callback
    const onToolResult = createPostToolCallback();

    // Run the ORIGINAL tool loop (unchanged)
    const result = await originalExecute(
      messages,
      endpoint,
      apiKey,
      modelId,
      timeoutMs,
      maxTurns,
      requestStart,
      maxTotalMs,
      onToolResult,
      toolsRef,
      loadCategoryTools,
      pool,
      account,
    );

    // === After loop: archive this turn to episodic memory ===
    if (process.env.ENABLE_EPISODIC_MEMORY === "true") {
      try {
        const toolsUsed: ToolUsage[] = result.phases.map((p) => ({
          name: p.tool,
          args: p.args || {},
          result: p.result ? `${p.result.slice(0, 500)}${p.result.length > 500 ? "..." : ""}` : "",
          durationMs: undefined,
          error: p.status === "error" ? p.result || "unknown error" : undefined,
        }));

        episodicFile = await recordTurn({
          timestamp: new Date().toISOString(),
          sessionId,
          userMessage,
          assistantReply: result.reply,
          toolsUsed,
          modelUsed: modelId,
          tokenCount: result.tokens,
          outcome: result.phases.length > 0
            ? `${result.phases.filter((p) => p.status === "done").length}/${result.phases.length} tools completed`
            : "no tools",
        });
      } catch (episodicErr: any) {
        console.error(`[episodic-memory] Non-fatal error: ${episodicErr.message}`);
      }
    }

    return {
      ...result,
      telemetry: {
        tokenjuiceSavings: totalTokenjuiceSavings,
        microcompactCleared: totalMicrocompactCleared,
        microcompactBytesSaved: totalMicrocompactBytes,
        episodicFile,
        totalBytesSaved: totalMicrocompactBytes,
      },
    };
  };
}

// ── Preview how much would be saved (no side effects) ──
export function previewEnhancements(messages: any[]): {
  tokenjuiceSavings: number;
  microcompactWouldClear: number;
  microcompactWouldSave: number;
  totalMessages: number;
  toolResultCount: number;
} {
  let tjSavings = 0;
  if (process.env.ENABLE_TOKENJUICE === "true") {
    for (const msg of messages) {
      if (msg.role === "tool" && typeof msg.content === "string" && Buffer.byteLength(msg.content) > 4000) {
        const compressed = tokenjuiceCompress(msg.content, { contentType: "auto" });
        if (compressed.savings > tjSavings) tjSavings = compressed.savings;
      }
    }
  }

  // Need to import microcompactPreview — doing inline for preview
  const { microcompactPreview } = require("./microcompact");
  const mc = microcompactPreview(messages, { keepRecent: 3 });

  return {
    tokenjuiceSavings: tjSavings,
    microcompactWouldClear: mc.wouldClear,
    microcompactWouldSave: mc.wouldSave,
    totalMessages: messages.length,
    toolResultCount: mc.toolResultCount,
  };
}

// ── Search episodic memory (passthrough) ──
export { searchEpisodicMemory };
