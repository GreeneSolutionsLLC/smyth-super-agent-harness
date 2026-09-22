// ── Episodic Memory — Auto-archive every conversation turn
// Inspired by OpenHuman's Memory Archivist (tinycortex::memory::archivist).
//
// Every turn is automatically saved to memory/episodic/YYYY-MM-DD/<seq>.md
// with metadata (timestamp, topics, tools used, outcome).
//
// FEATURE FLAG: Only runs when ENABLE_EPISODIC_MEMORY env var is set.
// If disabled, all functions are no-ops.
//
// Usage:
//   await recordTurn(sessionId, {
//     timestamp: new Date().toISOString(),
//     userMessage: "...",
//     assistantReply: "...",
//     toolsUsed: [{ name: "shell", args: {...}, result: "..." }],
//     topics: ["architecture", "OpenHuman"],
//   });

import { mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { getWorkspacePath } from "@/lib/env";

const WORKSPACE = getWorkspacePath();
const EPISODIC_DIR = join(WORKSPACE, "memory", "episodic");

// ── Ensure directory exists ──
function ensureDir(dir: string) {
  try {
    mkdirSync(dir, { recursive: true });
  } catch {}
}

// ── Get next sequence number for today ──
function getNextSeq(dateDir: string): number {
  ensureDir(dateDir);
  const files = readdirSync(dateDir).filter((f) => f.endsWith(".md"));
  if (files.length === 0) return 1;
  const nums = files
    .map((f) => parseInt(f.replace(".md", ""), 10))
    .filter((n) => !isNaN(n));
  return nums.length > 0 ? Math.max(...nums) + 1 : 1;
}

// ── Sanitize session ID for filenames ──
function sanitizeSessionId(id: string): string {
  return id.replace(/[^a-zA-Z0-9\-_]/g, "_").slice(0, 50);
}

export interface ToolUsage {
  name: string;
  args?: Record<string, any>;
  result?: string;
  durationMs?: number;
  error?: string;
}

export interface TurnRecord {
  timestamp: string;
  sessionId: string;
  userMessage: string;
  assistantReply?: string;
  toolsUsed?: ToolUsage[];
  topics?: string[];
  goal?: string;
  outcome?: string;
  modelUsed?: string;
  tokenCount?: number;
}

// ── Record a single turn ──
export async function recordTurn(turn: TurnRecord): Promise<string | null> {
  if (process.env.ENABLE_EPISODIC_MEMORY !== "true") return null;

  const date = new Date(turn.timestamp || Date.now());
  const dateStr = date.toISOString().slice(0, 10);
  const dateDir = join(EPISODIC_DIR, dateStr);
  const seq = getNextSeq(dateDir);
  const sessionDir = join(dateDir, sanitizeSessionId(turn.sessionId || "unknown"));
  ensureDir(sessionDir);

  const filename = `${seq.toString().padStart(4, "0")}.md`;
  const filepath = join(sessionDir, filename);

  // Build topics from content if not provided
  const topics = turn.topics || extractTopics(turn.userMessage, turn.assistantReply || "");

  const frontmatter = [
    "---",
    `timestamp: ${turn.timestamp || new Date().toISOString()}`,
    `session: ${turn.sessionId || "unknown"}`,
    `seq: ${seq}`,
    `model: ${turn.modelUsed || "unknown"}`,
    topics.length > 0 ? `topics: [${topics.map((t) => `"${t}"`).join(", ")}]` : "",
    turn.goal ? `goal: "${turn.goal.replace(/"/g, '\\"')}"` : "",
    turn.outcome ? `outcome: "${turn.outcome.replace(/"/g, '\\"')}"` : "",
    turn.tokenCount ? `tokens: ${turn.tokenCount}` : "",
    turn.toolsUsed ? `tools: [${turn.toolsUsed.map((t) => `"${t.name}"`).join(", ")}]` : "",
    "---",
    "",
  ]
    .filter(Boolean)
    .join("\n");

  const body = [
    "## User",
    "",
    turn.userMessage || "(no message)",
    "",
  ];

  if (turn.assistantReply) {
    body.push("## Assistant", "", turn.assistantReply, "");
  }

  if (turn.toolsUsed && turn.toolsUsed.length > 0) {
    body.push("## Tools Used", "");
    for (const tool of turn.toolsUsed) {
      body.push(`### ${tool.name}`, "");
      if (tool.args) {
        body.push("**Args:**", "```json", JSON.stringify(tool.args, null, 2), "```", "");
      }
      if (tool.result) {
        const preview = tool.result.slice(0, 2000);
        body.push(
          "**Result:**",
          "```",
          preview + (tool.result.length > 2000 ? `\n... (${tool.result.length - 2000} more chars)` : ""),
          "```",
          ""
        );
      }
      if (tool.error) {
        body.push("**Error:**", "```", tool.error, "```", "");
      }
      if (tool.durationMs) {
        body.push(`*(took ${tool.durationMs}ms)*`, "");
      }
    }
  }

  const content = frontmatter + "\n" + body.join("\n");

  try {
    writeFileSync(filepath, content, "utf-8");
    return filepath;
  } catch (err: any) {
    console.error("[episodic-memory] Failed to write:", err.message);
    return null;
  }
}

// ── Extract topics via simple keyword matching ──
function extractTopics(userMsg: string, assistantReply: string): string[] {
  const text = (userMsg + " " + assistantReply).toLowerCase();
  const topicMap: Record<string, string[]> = {
    code: ["function", "class", "import", "export", "const", "let", "def", "return"],
    design: ["color", "font", "layout", "template", "css", "html", "ui", "brand"],
    video: ["video", "render", "ffmpeg", "clip", "timeline", "opencut"],
    research: ["search", "research", "find", "lookup", "web", "api", "scrape"],
    memory: ["remember", "forget", "memory", "session", "context", "history"],
    social: ["instagram", "tiktok", "youtube", "zernio", "post", "schedule", "content"],
    ai: ["model", "llm", "agent", "openai", "claude", "kimi", "gemini", "gpt"],
    system: ["shell", "command", "bash", "script", "run", "execute"],
    file: ["file", "read", "write", "edit", "path", "directory", "folder"],
  };

  const found: string[] = [];
  for (const [topic, keywords] of Object.entries(topicMap)) {
    if (keywords.some((k) => text.includes(k))) {
      found.push(topic);
    }
  }

  return found.slice(0, 5);
}

// ── Search episodic memory ──
export async function searchEpisodicMemory(
  query: string,
  options: { limit?: number; since?: string } = {}
): Promise<{ filepath: string; score: number; preview: string }[]> {
  if (process.env.ENABLE_EPISODIC_MEMORY !== "true") return [];

  const limit = options.limit || 10;
  const queryWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  if (queryWords.length === 0) return [];

  const results: Array<{ filepath: string; score: number; preview: string }> = [];

  try {
    // Walk all date directories
    const dateDirs = readdirSync(EPISODIC_DIR).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
    for (const dateDir of dateDirs) {
      const sessionPath = join(EPISODIC_DIR, dateDir);
      if (!existsSync(sessionPath)) continue;
      const sessions = readdirSync(sessionPath, { withFileTypes: true }).filter((d) => d.isDirectory());

      for (const session of sessions) {
        const sessionDir = join(sessionPath, session.name);
        const files = readdirSync(sessionDir).filter((f) => f.endsWith(".md"));
        for (const file of files) {
          const filepath = join(sessionDir, file);
          try {
            const content = readFileSync(filepath, "utf-8");
            const contentLower = content.toLowerCase();
            let score = 0;
            for (const word of queryWords) {
              if (contentLower.includes(word)) score++;
            }
            if (score > 0) {
              // Extract preview (first 300 chars after frontmatter)
              const bodyMatch = content.match(/---[\s\S]*?---\s*\n([\s\S]{0,500})/);
              const preview = bodyMatch ? bodyMatch[1].trim().replace(/\n/g, " ").slice(0, 300) : "";
              results.push({ filepath, score, preview });
            }
          } catch {}
        }
      }
    }
  } catch (err: any) {
    console.error("[episodic-memory] Search error:", err.message);
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

// ── Get recent turns for a session ──
export async function getRecentTurns(
  sessionId: string,
  limit: number = 10
): Promise<TurnRecord[]> {
  if (process.env.ENABLE_EPISODIC_MEMORY !== "true") return [];

  const records: TurnRecord[] = [];
  const sanitized = sanitizeSessionId(sessionId);

  try {
    const dateDirs = readdirSync(EPISODIC_DIR).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
    // Sort newest first
    dateDirs.sort((a, b) => b.localeCompare(a));

    for (const dateDir of dateDirs) {
      const sessionDir = join(EPISODIC_DIR, dateDir, sanitized);
      if (!existsSync(sessionDir)) continue;

      const files = readdirSync(sessionDir)
        .filter((f) => f.endsWith(".md"))
        .sort((a, b) => parseInt(a) - parseInt(b));

      for (const file of files) {
        const content = readFileSync(join(sessionDir, file), "utf-8");
        // Parse frontmatter
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)/);
        if (!fmMatch) continue;

        const fm = parseFrontmatter(fmMatch[1]);
        const body = fmMatch[2];

        // Split body into sections
        const userMatch = body.match(/## User\n\n([\s\S]*?)(?=\n## |$)/);
        const assistantMatch = body.match(/## Assistant\n\n([\s\S]*?)(?=\n## |$)/);

        records.push({
          timestamp: fm.timestamp || "",
          sessionId: fm.session || sessionId,
          userMessage: userMatch ? userMatch[1].trim() : "",
          assistantReply: assistantMatch ? assistantMatch[1].trim() : "",
          topics: fm.topics || [],
          goal: fm.goal || "",
          outcome: fm.outcome || "",
          tokenCount: fm.tokens ? parseInt(fm.tokens, 10) : undefined,
        });
      }

      if (records.length >= limit) break;
    }
  } catch (err: any) {
    console.error("[episodic-memory] Get recent turns error:", err.message);
  }

  return records.slice(-limit);
}

function parseFrontmatter(text: string): Record<string, any> {
  const result: Record<string, any> = {};
  const lines = text.split("\n");
  for (const line of lines) {
    const match = line.match(/^([\w]+):\s*(.+)$/);
    if (match) {
      const key = match[1];
      const val = match[2].trim();
      if (val.startsWith("[") && val.endsWith("]")) {
        try {
          result[key] = JSON.parse(val);
        } catch {
          result[key] = val;
        }
      } else {
        result[key] = val.replace(/^"(.*)"$/, "$1");
      }
    }
  }
  return result;
}
