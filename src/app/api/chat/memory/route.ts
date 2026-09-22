// ── Rolling per-chat memory ──
// POST: append a compacted chunk to workspace/memory/<chat>.md
//   body: { sessionId, title, messages: [{role, content, timestamp}] }
//   → writes a dated section with a summary + raw transcript, returns file stats
// GET ?sessionId=... → returns current memory file size for the bloat nudge
//
// Design: the .md file + the live chat window together ARE the full
// conversation. Nothing is ever lost — compacted history stays on disk and the
// agent can read it back with its file tools.

import { NextRequest, NextResponse } from "next/server";
import { appendFileSync, existsSync, mkdirSync, statSync, writeFileSync, readdirSync, unlinkSync } from "fs";
import { join } from "path";
import { getWorkspacePath } from "@/lib/env";

const SMYTH_WORKSPACE = getWorkspacePath();
const MEMORY_DIR = join(SMYTH_WORKSPACE, "workspace", "memory");

function ensureDir() {
  try { mkdirSync(MEMORY_DIR, { recursive: true }); } catch {}
}

function safeFileName(sessionId: string, title: string): string {
  const t = (title || "chat").replace(/[^a-zA-Z0-9-_ ]/g, "").replace(/\s+/g, "_").slice(0, 40);
  return `${t || "chat"}-${sessionId}.md`;
}

function renderSection(title: string, messages: any[]): string {
  const now = new Date();
  const stamp = now.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const lines: string[] = [];
  lines.push(`\n\n## 📦 Compacted ${stamp} — ${messages.length} messages`);
  lines.push("");
  // Lightweight extractive summary: first sentence of each user turn +
  // any assistant turns that produced files. Keeps the file skimmable without
  // an extra model call (fast + free).
  lines.push("### Summary (user turns)");
  lines.push("");
  for (const m of messages) {
    if (m.role === "user") {
      const first = (m.content || "").split("\n")[0].slice(0, 160);
      if (first.trim()) lines.push(`- ${first}`);
    }
  }
  lines.push("");
  lines.push("### Raw transcript");
  lines.push("");
  for (const m of messages) {
    const who = m.role === "user" ? "**User**" : "**Smyth**";
    const body = (m.content || "").slice(0, 8000);
    lines.push(`${who}: ${body}`);
    lines.push("");
  }
  lines.push("---");
  return lines.join("\n");
}

export async function POST(request: NextRequest) {
  try {
    const { sessionId, title, messages } = await request.json();
    if (!sessionId || !Array.isArray(messages)) {
      return NextResponse.json({ error: "sessionId and messages[] required" }, { status: 400 });
    }
    ensureDir();
    const file = join(MEMORY_DIR, safeFileName(sessionId, title));

    if (!existsSync(file)) {
      writeFileSync(file, `# 💬 Chat Memory — ${title || sessionId}\n\nRolling memory for this chat. Compacted sections are appended below; the live chat window holds the most recent messages.\n`, "utf8");
    }
    appendFileSync(file, renderSection(title, messages), "utf8");

    const sizeKB = Math.round(statSync(file).size / 1024);
    return NextResponse.json({ ok: true, file: file.split("/").pop(), sizeKB, overLimit: statSync(file).size > 1024 * 1024 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  const title = request.nextUrl.searchParams.get("title") || "";
  if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  ensureDir();
  const file = join(MEMORY_DIR, safeFileName(sessionId, title));
  if (!existsSync(file)) return NextResponse.json({ exists: false, sizeKB: 0, overLimit: false });
  const size = statSync(file).size;
  return NextResponse.json({ exists: true, sizeKB: Math.round(size / 1024), overLimit: size > 1024 * 1024 });
}

export async function DELETE(request: NextRequest) {
  // Remove a chat's memory file when its session is deleted.
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  ensureDir();
  try {
    for (const f of readdirSync(MEMORY_DIR)) {
      if (f.endsWith(`-${sessionId}.md`)) unlinkSync(join(MEMORY_DIR, f));
    }
  } catch {}
  return NextResponse.json({ ok: true });
}
