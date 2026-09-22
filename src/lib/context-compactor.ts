// ── Context Compactor for Smyth ──
// Workflow-safe: fast heuristic by default, LLM summarizer is opt-in.
// Based on OmniRoute's aggressive compression + jcode's reactive compaction:
// 1. Caveman (strip filler/pleasantries) — fast, no API call
// 2. Heuristic summarization (intents, files, errors, decisions) — fast, deterministic
// 3. LLM-based summarization — opt-in via useLlmSummarizer, slow due to local model load
// 4. Keep recent N messages in full fidelity
// 5. Auto-compact before every request when threshold is exceeded
// 6. Emergency hard compact if context-limit error detected

const LOCAL_OLLAMA_URL = "http://127.0.0.1:11434/v1";
const SUMMARIZER_MODEL = "llama3.1:8b";

// Feature flag: off by default because local model is too slow
// Set to true to use LLM-generated summaries (better quality, ~10-30s per call)
const useLlmSummarizer = false;

// ── Caveman rules — strip filler words and pleasantries ──

const CAVEMAN_RULES: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bsure[,.]?\s*/gi, replacement: "" },
  { pattern: /\bcertainly[,.]?\s*/gi, replacement: "" },
  { pattern: /\bof course[,.]?\s*/gi, replacement: "" },
  { pattern: /\bhappy to help[,.]?\s*/gi, replacement: "" },
  { pattern: /\bthanks[,.]?\s*/gi, replacement: "" },
  { pattern: /\bthank you[,.]?\s*/gi, replacement: "" },
  { pattern: /\bglad to help[,.]?\s*/gi, replacement: "" },
  { pattern: /\bno problem[,.]?\s*/gi, replacement: "" },
  { pattern: /\byou'?re welcome[,.]?\s*/gi, replacement: "" },
  { pattern: /\babsolutely[,.]?\s*/gi, replacement: "" },
  { pattern: /\b(basically|essentially|actually|literally|simply)\s+/gi, replacement: "" },
  { pattern: /^(hi there|hello|good morning|hey)[,.]?\s*/i, replacement: "" },
  { pattern: /\b(it seems like|it appears that|i think that|i believe that)\s+/gi, replacement: "" },
  { pattern: /\b(probably|possibly|maybe it)\s+/gi, replacement: "" },
  { pattern: /\b(make sure|be sure)\s+/gi, replacement: "" },
  { pattern: /\b(due to the fact|the reason is because)\s+/gi, replacement: "" },
  { pattern: /\b(it is important|you should|remember to)\s+/gi, replacement: "" },
  { pattern: /\b(i want to|i need to|i'd like to|i'm looking for)\s+/gi, replacement: "" },
  { pattern: /\b(provide a detailed|give me a comprehensive|write an in-depth|create a thorough|explain in detail)\s+/gi, replacement: "" },
  { pattern: /\b(please|kindly)\s+/gi, replacement: "" },
  { pattern: /\b(could you please|would you please|can you please)\s+/gi, replacement: "" },
  { pattern: /\b(i was wondering|would it be possible)\s+/gi, replacement: "" },
  { pattern: /\s{2,}/g, replacement: " " },
];

// ── Token estimation (rough: ~4 chars per token) ──

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function getMessageText(msg: any): string {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .map((c: any) => (c.type === "text" ? c.text : ""))
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

// ── Caveman compression — strip filler from a single message ──

function cavemanCompress(text: string): string {
  let result = text;
  for (const rule of CAVEMAN_RULES) {
    result = result.replace(rule.pattern, rule.replacement);
  }
  return result.trim();
}

// ── LLM-based summarization using local Ollama ──
// jcode's SUMMARY_PROMPT pattern: structured, preserves intent + state + decisions

const SUMMARIZER_PROMPT = `Summarize this conversation so a fresh model can continue the work later.

Write in natural language with these sections:
- **Context:** What we're working on and why (1-2 sentences)
- **What we did:** Key actions taken, files changed, problems solved
- **Current state:** What works, what's broken, what's next
- **User preferences:** Specific requirements or decisions they made

Be concise but preserve important details: exact file paths, error messages, configuration values, named APIs, and tool choices. If something was tried and failed, say so. Do NOT include pleasantries, filler, or meta-commentary.

Conversation to summarize:`;

async function callLocalSummarizer(text: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000); // 25s — fast enough to not block user
    const res = await fetch(`${LOCAL_OLLAMA_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: SUMMARIZER_MODEL,
        messages: [
          { role: "user", content: SUMMARIZER_PROMPT + "\n\n" + text.slice(0, 8000) },
        ],
        max_tokens: 400,
        temperature: 0.2,
        stream: false,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      console.error(`[compactor] summarizer HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    const summary = data?.choices?.[0]?.message?.content?.trim();
    return summary || null;
  } catch (err: any) {
    if (err.name === "AbortError") {
      console.error("[compactor] summarizer timeout (25s) — using heuristic fallback");
    } else {
      console.error("[compactor] summarizer error:", err.message);
    }
    return null;
  }
}

// ── Fallback heuristic summary (when local model is unavailable or disabled) ──
// jcode-style structured output: Context, What we did, Current state, User preferences

function heuristicSummary(messages: any[]): string {
  const intents: string[] = [];
  const files = new Set<string>();
  const errors: string[] = [];
  const decisions: string[] = [];
  const facts: string[] = [];
  const exchanges: string[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const text = getMessageText(msg);
    if (!text) continue;

    if (msg.role === "user") {
      const firstLine = text.split("\n")[0].trim();
      if (firstLine.length > 0 && firstLine.length < 200) {
        intents.push(firstLine);
      }
    }

    // Capture key exchanges: user question → assistant response summary
    if (msg.role === "user" && i + 1 < messages.length && messages[i + 1].role === "assistant") {
      const userQ = text.split("\n")[0].slice(0, 80);
      const assistantA = getMessageText(messages[i + 1])?.split("\n")[0].slice(0, 80);
      if (userQ && assistantA) {
        exchanges.push(`User: "${userQ}" → Assistant: "${assistantA}"`);
      }
    }

    // Extract file paths
    const fileMatches = text.match(/[\w\-./]+\.(ts|tsx|js|jsx|py|md|json|sql|css|html|yaml|yml|sh|go|rs|java|swift|kt)\b/g);
    if (fileMatches) {
      for (const f of fileMatches) {
        if (f.length < 100 && !files.has(f)) files.add(f);
      }
    }

    // Extract error messages
    if (/(Error|Exception|TypeError|ReferenceError|SyntaxError):/i.test(text)) {
      const errorMatch = text.match(/(TypeError|ReferenceError|SyntaxError|RangeError|Error|Exception)[^\n]{0,150}/);
      if (errorMatch) errors.push(errorMatch[0].slice(0, 120));
    }

    // Extract decisions / key facts
    const decisionMatch = text.match(/^(decided|chose|using|will use|set to|configured|created|added|removed|fixed|changed to|we will|let's)[^\n]{0,100}/im);
    if (decisionMatch) decisions.push(decisionMatch[0].slice(0, 100));

    // Capture key facts the user stated
    if (msg.role === "user") {
      const factPatterns = [
        /the (problem|issue|bug|feature|requirement) is[:\s]+([^\n]+)/i,
        /we (need|want|should|must)[:\s]+([^\n]+)/i,
        /the (repo|project|branch|file) is[:\s]+([^\n]+)/i,
        /my (setup|config|env) is[:\s]+([^\n]+)/i,
      ];
      for (const pattern of factPatterns) {
        const match = text.match(pattern);
        if (match) facts.push(match[0].slice(0, 100));
      }
    }
  }

  // Build detailed structured summary
  const sections: string[] = [];

  if (intents.length > 0) {
    sections.push(`**Context:** Working on: ${intents.slice(0, 5).join("; ")}.`);
  }

  if (exchanges.length > 0) {
    sections.push(`**Key exchanges:**\n${exchanges.slice(0, 10).join("\n")}`);
  }

  if (decisions.length > 0 || files.size > 0) {
    const parts: string[] = [];
    if (decisions.length > 0) parts.push(`Decisions: ${decisions.slice(0, 8).join(" | ")}`);
    if (files.size > 0) parts.push(`Files: ${Array.from(files).slice(0, 15).join(", ")}`);
    sections.push(`**What we did:** ${parts.join(". ")}`);
  }

  if (errors.length > 0) {
    sections.push(`**Current state:** Recent issues: ${errors.slice(0, 3).join(" | ")}`);
  } else if (intents.length > 0) {
    sections.push(`**Current state:** ${messages.length} messages exchanged, continuing.`);
  }

  if (facts.length > 0) {
    sections.push(`**User-stated facts:** ${facts.slice(0, 5).join(" | ")}`);
  }

  return sections.length > 0 ? sections.join("\n") : `${messages.length} earlier messages compressed (no structured summary available).`;
}

// ── Main: compact a conversation if needed ──

export interface CompactionResult {
  messages: any[];
  wasCompacted: boolean;
  originalTokens: number;
  finalTokens: number;
  techniques: string[];
  summarizerUsed?: "llm" | "heuristic";
}

// 256K OmniRoute window — compact at ~78% so there's headroom for the
// compacted response, hard-cap just under the window so we never overflow.
const CONTEXT_THRESHOLD = 200_000;
const HARD_LIMIT = 240_000;
const KEEP_RECENT = 30;

export async function compactContext(messages: any[]): Promise<CompactionResult> {
  if (messages.length <= 2) {
    return { messages, wasCompacted: false, originalTokens: 0, finalTokens: 0, techniques: [] };
  }

  const techniques: string[] = [];
  let totalTokens = 0;
  for (const msg of messages) {
    totalTokens += estimateTokens(getMessageText(msg));
  }
  const originalTokens = totalTokens;

  // ── Step 1: Caveman on all messages EXCEPT system messages (cheap, always safe) ──
  let working = messages.map((msg) => {
    // Never compress the system prompt — it contains identity, instructions, and tools
    if (msg.role === "system") return msg;
    const text = getMessageText(msg);
    if (!text) return msg;
    const compressed = cavemanCompress(text);
    if (compressed.length < text.length) {
      if (typeof msg.content === "string") {
        return { ...msg, content: compressed };
      } else if (Array.isArray(msg.content)) {
        return {
          ...msg,
          content: msg.content.map((c: any) =>
            c.type === "text" ? { ...c, text: compressed } : c
          ),
        };
      }
    }
    return msg;
  });

  const cavemanTokens = working.reduce((sum, m) => sum + estimateTokens(getMessageText(m)), 0);
  if (cavemanTokens < totalTokens) techniques.push("caveman");
  totalTokens = cavemanTokens;

  // ── Step 2: If still over threshold, summarize old messages via local LLM ──
  let summarizerUsed: "llm" | "heuristic" | undefined;
  if (totalTokens > CONTEXT_THRESHOLD && working.length > KEEP_RECENT + 2) {
    // Separate system messages (first one is the main system prompt — never touch it)
    const systemMsgs = working.filter((m) => m.role === "system" && working.indexOf(m) < 2);
    const chatMsgs = working.filter((m) => m.role !== "system" || working.indexOf(m) >= 2);
    const toCompress = chatMsgs.slice(0, chatMsgs.length - KEEP_RECENT);
    const toKeep = chatMsgs.slice(chatMsgs.length - KEEP_RECENT);

    // Format the old messages for the summarizer
    const conversationText = toCompress
      .map((m) => {
        const role = m.role === "user" ? "User" : m.role === "assistant" ? "Assistant" : "System";
        return `${role}: ${getMessageText(m)}`;
      })
      .join("\n\n");

    // Try local LLM first if enabled, fall back to heuristic
    let summary: string;
    if (useLlmSummarizer) {
      const llmSummary = await callLocalSummarizer(conversationText);
      summary = llmSummary ?? heuristicSummary(toCompress);
      summarizerUsed = llmSummary ? "llm" : "heuristic";
    } else {
      summary = heuristicSummary(toCompress);
      summarizerUsed = "heuristic";
    }

    const summaryMsg = {
      role: "system",
      content: `[COMPRESSED CONTEXT — ${toCompress.length} earlier messages summarized via ${summarizerUsed}]\n\n${summary}`,
    };

    working = [...systemMsgs, summaryMsg, ...toKeep];
    techniques.push("summarization");
    totalTokens = working.reduce((sum, m) => sum + estimateTokens(getMessageText(m)), 0);
  }

  // ── Step 3: If still over hard limit, drop more old messages (never touch system prompts) ──
  if (totalTokens > HARD_LIMIT && working.length > KEEP_RECENT + 1) {
    const systemMsgs = working.filter((m) => m.role === "system" && working.indexOf(m) < 2);
    const nonSystemMsgs = working.filter((m) => m.role !== "system" || working.indexOf(m) >= 2);
    const tail = nonSystemMsgs.slice(nonSystemMsgs.length - KEEP_RECENT);
    const dropped = nonSystemMsgs.length - KEEP_RECENT;
    const summaryMsg = systemMsgs.length > 0
      ? { ...systemMsgs[0], content: systemMsgs[0].content + `\n\n[${dropped} older messages dropped to fit context]` }
      : { role: "system", content: `[${dropped} older messages dropped to fit context]` };
    working = [
      ...systemMsgs.filter((_, i) => i > 0), // additional system msgs (shouldn't exist, but be safe)
      summaryMsg,
      ...tail,
    ];
    techniques.push("truncation");
    totalTokens = working.reduce((sum, m) => sum + estimateTokens(getMessageText(m)), 0);
  }

  const wasCompacted = techniques.length > 0;
  return { messages: working, wasCompacted, originalTokens, finalTokens: totalTokens, techniques, summarizerUsed };
}

// ── Emergency hard compact (synchronous, used when API returns context-length error) ──
// Drops oldest messages until under HARD_LIMIT, keeps recent KEEP_RECENT
// Returns immediately — no LLM call, just truncation

export function emergencyHardCompact(messages: any[]): CompactionResult {
  const originalTokens = messages.reduce((sum, m) => sum + estimateTokens(getMessageText(m)), 0);

  // Never drop system prompts
  const systemMsgs = messages.filter((m) => m.role === "system");
  const nonSystemMsgs = messages.filter((m) => m.role !== "system");

  if (nonSystemMsgs.length <= KEEP_RECENT) {
    return { messages, wasCompacted: false, originalTokens: 0, finalTokens: 0, techniques: [] };
  }

  const tail = nonSystemMsgs.slice(nonSystemMsgs.length - KEEP_RECENT);
  const dropped = nonSystemMsgs.length - KEEP_RECENT;
  const summaryMsg = {
    role: "system",
    content: `[EMERGENCY CONTEXT RECOVERY — ${dropped} older messages dropped to fit context window]`,
  };
  const finalMessages = [...systemMsgs, summaryMsg, ...tail];
  const finalTokens = finalMessages.reduce((sum, m) => sum + estimateTokens(getMessageText(m)), 0);

  return {
    messages: finalMessages,
    wasCompacted: true,
    originalTokens,
    finalTokens,
    techniques: ["emergency-hard-compact"],
  };
}

// ── Detect context-length errors (jcode's is_context_limit_error pattern) ──

export function isContextLimitError(errorText: string): boolean {
  const lower = errorText.toLowerCase();
  return (
    lower.includes("context length") ||
    lower.includes("context window") ||
    lower.includes("maximum context") ||
    lower.includes("max context") ||
    lower.includes("token limit") ||
    lower.includes("too many tokens") ||
    lower.includes("prompt is too long") ||
    lower.includes("input is too long") ||
    lower.includes("request too large") ||
    lower.includes("length limit") ||
    lower.includes("maximum tokens") ||
    (lower.includes("exceeded") && lower.includes("tokens"))
  );
}

// ── Stats for UI ──

export function getContextStats(messages: any[]) {
  const tokens = messages.reduce((sum, m) => sum + estimateTokens(getMessageText(m)), 0);
  return {
    tokens,
    messageCount: messages.length,
    needsCompaction: tokens > CONTEXT_THRESHOLD,
    hardLimitExceeded: tokens > HARD_LIMIT,
  };
}