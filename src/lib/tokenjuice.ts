// ── TokenJuice-lite — Content-aware compression for tool results
// Inspired by OpenHuman's TokenJuice crate. Zero deps, pure TypeScript.
//
// Usage: tokenjuiceCompress(resultText, { contentType: "json", maxBytes: 16000 })
// Returns: compressed string + metadata about what was done
//
// FEATURE FLAG: Only runs when ENABLE_TOKENJUICE env var is set.
// If disabled, returns original text unchanged.

export interface CompressionResult {
  text: string;
  originalBytes: number;
  finalBytes: number;
  savings: number; // percentage
  technique: string;
}

// ── Detect content type from text ──
function detectContentType(text: string): "json" | "code" | "logs" | "diff" | "html" | "generic" {
  const t = text.trim();
  if (t.startsWith("[") || t.startsWith("{")) {
    try { JSON.parse(t); return "json"; } catch {}
  }
  if (/^\s*(\+|\-|@@|index|diff\s+--git)/m.test(t)) return "diff";
  if (/^\s*(\d{4}-\d{2}-\d{2}|\[\d{4}-|\w+\s+\|\s+\w+\s+\|)/m.test(t) && t.split("\n").length > 5) return "logs";
  if (t.includes("<html") || t.includes("<!DOCTYPE") || t.includes("<div")) return "html";
  // Code: contains function/class/def/const/etc and has braces
  if (/\b(function|class|const|let|var|def|import|export|return)\b/.test(t) && /[{};]/.test(t)) return "code";
  return "generic";
}

// ── JSON minifier ──
function minifyJSON(text: string): string {
  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(parsed);
  } catch {
    return text;
  }
}

// ── JSON pretty-printer with depth limit ──
function compressJSON(text: string, maxDepth = 2): string {
  try {
    const obj = JSON.parse(text);
    return JSON.stringify(obj, function(key, value) {
      if (value && typeof value === "object") {
        // At max depth, replace nested objects with summaries
        const depth = (this as any).__depth || 0;
        if (depth >= maxDepth) {
          if (Array.isArray(value)) return `[Array: ${value.length} items]`;
          const keys = Object.keys(value);
          return `{Object: ${keys.length} keys${keys.length > 0 ? ` (${keys.slice(0, 5).join(", ")}${keys.length > 5 ? "..." : ""})` : ""}}`;
        }
        (value as any).__depth = depth + 1;
      }
      return value;
    }, 2);
  } catch {
    return text;
  }
}

// ── Log deduplicator ──
function deduplicateLogs(text: string): string {
  const lines = text.split("\n");
  const seen = new Map<string, number>();
  const output: string[] = [];
  let consecutiveDup = 0;

  for (const line of lines) {
    const normalized = line.replace(/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}.*/, "").trim();
    if (!normalized) {
      output.push(line);
      continue;
    }
    const count = seen.get(normalized) || 0;
    if (count > 2) {
      consecutiveDup++;
      continue;
    }
    seen.set(normalized, count + 1);
    if (consecutiveDup > 0) {
      output.push(`... (${consecutiveDup} duplicate lines suppressed) ...`);
      consecutiveDup = 0;
    }
    output.push(line);
  }

  if (consecutiveDup > 0) {
    output.push(`... (${consecutiveDup} duplicate lines suppressed) ...`);
  }

  return output.join("\n");
}

// ── Code signature extractor ──
function extractCodeSignatures(text: string): string {
  const lines = text.split("\n");
  const signatures: string[] = [];
  const bodyLines: string[] = [];
  let inFunction = false;
  let braceDepth = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    // Capture signatures: function/class/def declarations, imports, exports
    if (/^(import|export|function|class|def|async\s+def|const|let|var|type|interface)\s/.test(trimmed)) {
      signatures.push(line);
      continue;
    }
    // Capture struct/enum declarations (Rust/Go style)
    if (/^(struct|enum|trait|impl)\s/.test(trimmed)) {
      signatures.push(line);
      continue;
    }
    // Track body depth
    if (trimmed.includes("{")) braceDepth += (trimmed.match(/{/g) || []).length;
    if (trimmed.includes("}")) braceDepth -= (trimmed.match(/}/g) || []).length;

    if (braceDepth > 0 || inFunction) {
      // In function body — keep first and last few lines, skip middle
      bodyLines.push(line);
      inFunction = braceDepth > 0;
    } else {
      signatures.push(line);
    }
  }

  if (bodyLines.length > 20) {
    const head = bodyLines.slice(0, 10);
    const tail = bodyLines.slice(-5);
    return [...signatures, ...head, `  ... (${bodyLines.length - 15} lines of implementation omitted) ...`, ...tail].join("\n");
  }

  return text;
}

// ── Diff compressor ──
function compressDiff(text: string): string {
  const lines = text.split("\n");
  const output: string[] = [];
  let contextSkipped = 0;
  let inHunk = false;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      if (contextSkipped > 5) {
        output.push(`... (${contextSkipped} context lines) ...`);
      }
      contextSkipped = 0;
      inHunk = true;
      output.push(line);
    } else if (line.startsWith("+") || line.startsWith("-")) {
      inHunk = true;
      if (contextSkipped > 3) {
        output.push(`... (${contextSkipped} context lines) ...`);
        contextSkipped = 0;
      }
      output.push(line);
    } else if (line.startsWith("index ") || line.startsWith("diff ")) {
      output.push(line);
    } else {
      contextSkipped++;
    }
  }

  return output.join("\n");
}

// ── HTML stripper ──
function compressHTML(text: string): string {
  // Simple: strip script/style tags, collapse whitespace, keep text content
  let stripped = text
    .replace(/<script[^\u003e]*>[\s\S]*?<\/script>/gi, "[script removed]")
    .replace(/<style[^\u003e]*>[\s\S]*?<\/style>/gi, "[style removed]")
    .replace(/\n\s*\n/g, "\n")
    .replace(/\s{2,}/g, " ");

  // If still huge, truncate with note
  if (stripped.length > 10000) {
    return stripped.slice(0, 10000) + `\n\n... [HTML truncated: ${stripped.length - 10000} chars remaining] ...`;
  }
  return stripped;
}

// ── Generic truncation with smart breakpoints ──
function smartTruncate(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text) <= maxBytes) return text;

  const maxChars = Math.floor(maxBytes / 2); // conservative: assume mixed ASCII/UTF-8
  let cutAt = maxChars;

  // Try to cut at sentence boundary
  const sentenceEnd = text.lastIndexOf(". ", cutAt);
  if (sentenceEnd > cutAt * 0.7) cutAt = sentenceEnd + 1;

  // Try to cut at paragraph boundary
  const paraEnd = text.lastIndexOf("\n\n", cutAt);
  if (paraEnd > cutAt * 0.5) cutAt = paraEnd;

  // Try to cut at line boundary
  const lineEnd = text.lastIndexOf("\n", cutAt);
  if (lineEnd > cutAt * 0.8) cutAt = lineEnd;

  const truncated = text.slice(0, cutAt);
  const remaining = text.length - cutAt;
  return `${truncated}\n\n... [${remaining} chars truncated] ...`;
}

// ── Main entry point ──
export function tokenjuiceCompress(
  text: string,
  options: {
    contentType?: "json" | "code" | "logs" | "diff" | "html" | "generic" | "auto";
    maxBytes?: number;
  } = {}
): CompressionResult {
  // Feature flag: disabled by default
  if (process.env.ENABLE_TOKENJUICE !== "true") {
    return {
      text,
      originalBytes: Buffer.byteLength(text),
      finalBytes: Buffer.byteLength(text),
      savings: 0,
      technique: "disabled",
    };
  }

  const maxBytes = options.maxBytes || 16 * 1024; // 16KB default
  const originalBytes = Buffer.byteLength(text);
  let technique = "none";

  // Auto-detect if not specified
  const contentType = options.contentType === "auto" || !options.contentType
    ? detectContentType(text)
    : options.contentType;

  let compressed = text;

  switch (contentType) {
    case "json":
      compressed = minifyJSON(text);
      if (Buffer.byteLength(compressed) > maxBytes) {
        compressed = compressJSON(text, 2);
        technique = "json-depth-limit";
      } else {
        technique = "json-minify";
      }
      break;

    case "logs":
      compressed = deduplicateLogs(text);
      technique = "log-dedup";
      break;

    case "code":
      compressed = extractCodeSignatures(text);
      technique = "code-signatures";
      break;

    case "diff":
      compressed = compressDiff(text);
      technique = "diff-compress";
      break;

    case "html":
      compressed = compressHTML(text);
      technique = "html-strip";
      break;

    default:
      technique = "none";
  }

  // Final truncation if still over budget
  if (Buffer.byteLength(compressed) > maxBytes) {
    compressed = smartTruncate(compressed, maxBytes);
    technique += technique === "none" ? "smart-truncate" : "+truncate";
  }

  const finalBytes = Buffer.byteLength(compressed);
  const savings = originalBytes > 0 ? Math.round(((originalBytes - finalBytes) / originalBytes) * 100) : 0;

  return { text: compressed, originalBytes, finalBytes, savings, technique };
}

// ── Batch compress tool results in a conversation ──
export function tokenjuiceCompressMessages(
  messages: any[],
  options: { maxBytes?: number } = {}
): { messages: any[]; stats: { totalSavings: number; techniques: string[] } } {
  if (process.env.ENABLE_TOKENJUICE !== "true") {
    return { messages, stats: { totalSavings: 0, techniques: [] } };
  }

  const maxBytes = options.maxBytes || 16 * 1024;
  let totalOriginal = 0;
  let totalFinal = 0;
  const techniques = new Set<string>();

  const compressed = messages.map((msg) => {
    // Only compress tool results and assistant messages with large content
    if (msg.role !== "tool" && msg.role !== "assistant") return msg;

    const text = typeof msg.content === "string"
      ? msg.content
      : Array.isArray(msg.content)
        ? msg.content.map((c: any) => (c.type === "text" ? c.text : "")).join(" ")
        : "";

    if (Buffer.byteLength(text) <= maxBytes) return msg;

    const result = tokenjuiceCompress(text, { maxBytes });
    totalOriginal += result.originalBytes;
    totalFinal += result.finalBytes;
    if (result.technique !== "disabled" && result.technique !== "none") {
      techniques.add(result.technique);
    }

    if (typeof msg.content === "string") {
      return { ...msg, content: result.text };
    }
    // For array content, compress text blocks
    if (Array.isArray(msg.content)) {
      return {
        ...msg,
        content: msg.content.map((c: any) =>
          c.type === "text" ? { ...c, text: result.text } : c
        ),
      };
    }
    return msg;
  });

  const savings = totalOriginal > 0 ? Math.round(((totalOriginal - totalFinal) / totalOriginal) * 100) : 0;

  return {
    messages: compressed,
    stats: {
      totalSavings: savings,
      techniques: Array.from(techniques),
    },
  };
}
