// ── Microcompact — Clear older tool-result bodies while keeping structure
// Inspired by OpenHuman's MicrocompactMiddleware in tinyagents.
//
// Problem: In a tool-heavy conversation, each tool result (file reads,
// shell output, API responses) can be 10-50KB. After 5-10 turns,
// the context is dominated by stale tool output.
//
// Solution: Keep the STRUCTURE of old tool results ("tool X returned Y")
// but replace the BODY with a placeholder. The agent still knows what
// happened, but doesn't pay token cost for the full output.
//
// FEATURE FLAG: Only runs when ENABLE_MICROCOMPACT env var is set.
//
// Usage:
//   const compacted = microcompact(messages, { keepRecent: 3 });
//   → messages with older tool results replaced by [CLEARED: ...]

export interface MicrocompactOptions {
  keepRecent?: number;      // Keep last N tool results in full (default: 3)
  keepToolIds?: string[];    // Always keep these tool names in full
  placeholder?: string;     // Template for cleared results
}

const DEFAULT_PLACEHOLDER =
  "[CLEARED: previous tool result of {byteCount} bytes — " +
  "use retrieve_tool_output if needed]";

// ── Detect if a message is a tool result ──
function isToolResult(msg: any): boolean {
  return msg.role === "tool" || msg.role === "Tool";
}

// ── Get text content from a message ──
function getText(msg: any): string {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join(" ");
  }
  return "";
}

// ── Set text content on a message ──
function setText(msg: any, text: string): any {
  if (typeof msg.content === "string") {
    return { ...msg, content: text };
  }
  if (Array.isArray(msg.content)) {
    return {
      ...msg,
      content: msg.content.map((c: any) =>
        c.type === "text" ? { ...c, text } : c
      ),
    };
  }
  return { ...msg, content: text };
}

// ── Main microcompact function ──
export function microcompact(
  messages: any[],
  options: MicrocompactOptions = {}
): { messages: any[]; cleared: number; bytesSaved: number } {
  // Feature flag
  if (process.env.ENABLE_MICROCOMPACT !== "true") {
    return { messages, cleared: 0, bytesSaved: 0 };
  }

  const keepRecent = options.keepRecent ?? 3;
  const keepToolIds = new Set(options.keepToolIds || []);
  const placeholder = options.placeholder || DEFAULT_PLACEHOLDER;

  // Find indices of tool results
  const toolResultIndices: number[] = [];
  messages.forEach((msg, i) => {
    if (isToolResult(msg)) toolResultIndices.push(i);
  });

  if (toolResultIndices.length <= keepRecent) {
    return { messages, cleared: 0, bytesSaved: 0 };
  }

  // Keep the last `keepRecent` tool results in full, clear the rest
  const keepSet = new Set(toolResultIndices.slice(-keepRecent));
  let cleared = 0;
  let bytesSaved = 0;

  const compacted = messages.map((msg, i) => {
    if (!isToolResult(msg)) return msg;
    if (keepSet.has(i)) return msg;

    // Check if this tool is in the keep list
    const toolCallId = msg.tool_call_id || "";
    const toolName = toolCallId.split("_")[0] || "";
    if (keepToolIds.has(toolName) || keepToolIds.has(toolCallId)) {
      return msg;
    }

    const text = getText(msg);
    const byteCount = Buffer.byteLength(text);
    if (byteCount < 500) return msg; // Don't bother clearing small results

    cleared++;
    bytesSaved += byteCount;

    const replacement = placeholder.replace("{byteCount}", byteCount.toLocaleString());
    return setText(msg, replacement);
  });

  return { messages: compacted, cleared, bytesSaved };
}

// ── Stats: how much would we save? ──
export function microcompactPreview(
  messages: any[],
  options: MicrocompactOptions = {}
): { wouldClear: number; wouldSave: number; toolResultCount: number } {
  const keepRecent = options.keepRecent ?? 3;
  const keepToolIds = new Set(options.keepToolIds || []);

  const toolResults = messages
    .map((msg, i) => ({ msg, i }))
    .filter(({ msg }) => isToolResult(msg));

  if (toolResults.length <= keepRecent) {
    return { wouldClear: 0, wouldSave: 0, toolResultCount: toolResults.length };
  }

  const keepSet = new Set(
    toolResults.slice(-keepRecent).map(({ i }) => i)
  );

  let wouldClear = 0;
  let wouldSave = 0;

  for (const { msg, i } of toolResults) {
    if (keepSet.has(i)) continue;
    const toolCallId = msg.tool_call_id || "";
    const toolName = toolCallId.split("_")[0] || "";
    if (keepToolIds.has(toolName) || keepToolIds.has(toolCallId)) continue;

    const text = getText(msg);
    const byteCount = Buffer.byteLength(text);
    if (byteCount < 500) continue;

    wouldClear++;
    wouldSave += byteCount;
  }

  return {
    wouldClear,
    wouldSave,
    toolResultCount: toolResults.length,
  };
}
