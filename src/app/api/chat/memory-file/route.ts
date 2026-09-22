// Serve the full rolling-memory file content for the sidebar download button.
// GET ?sessionId=...&title=... → { content: "<full .md>" }
import { NextRequest, NextResponse } from "next/server";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { getWorkspacePath } from "@/lib/env";

const SMYTH_WORKSPACE = getWorkspacePath();
const MEMORY_DIR = join(SMYTH_WORKSPACE, "workspace", "memory");

function safeFileName(sessionId: string, title: string): string {
  const t = (title || "chat").replace(/[^a-zA-Z0-9-_ ]/g, "").replace(/\s+/g, "_").slice(0, 40);
  return `${t || "chat"}-${sessionId}.md`;
}

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  const title = request.nextUrl.searchParams.get("title") || "";
  if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  try { mkdirSync(MEMORY_DIR, { recursive: true }); } catch {}
  const file = join(MEMORY_DIR, safeFileName(sessionId, title));
  if (!existsSync(file)) return NextResponse.json({ content: "" });
  try {
    return NextResponse.json({ content: readFileSync(file, "utf8") });
  } catch {
    return NextResponse.json({ content: "" });
  }
}
