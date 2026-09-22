// ── Serve workspace files (images, generated assets) ──
// Supports multiple workspace directories:
//   1. Smyth workspace (Desktop/smyth-super-agent/workspace)
//   2. OpenClaw workspace (.openclaw/workspace)
//   3. Home workspace (~/workspace)

import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { getWorkspacePath } from "@/lib/env";

const SMYTH_WORKSPACE = getWorkspacePath();

const WORKSPACE_DIRS = [
  join(SMYTH_WORKSPACE, "workspace"),
  process.env.OPENCLAW_WORKSPACE || join(homedir(), ".openclaw", "workspace"),
  join(homedir(), "workspace"),
];

export async function GET(request: NextRequest) {
  const filePath = request.nextUrl.searchParams.get("file");
  if (!filePath) {
    return NextResponse.json({ error: "file param required" }, { status: 400 });
  }

  // Security: prevent path traversal
  const safeName = filePath.replace(/\.\.\//g, "").replace(/^\/+/, "").split("/").pop() || "";

  // Try each workspace directory
  for (const dir of WORKSPACE_DIRS) {
    const fullPath = join(dir, safeName);
    if (existsSync(fullPath)) {
      const ext = safeName.split(".").pop()?.toLowerCase();
      const mimeTypes: Record<string, string> = {
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        gif: "image/gif",
        webp: "image/webp",
        svg: "image/svg+xml",
        txt: "text/plain",
        md: "text/markdown",
        html: "text/html",
        css: "text/css",
        js: "application/javascript",
        json: "application/json",
      };
      try {
        const buffer = readFileSync(fullPath);
        return new NextResponse(buffer, {
          headers: {
            "Content-Type": mimeTypes[ext || ""] || "application/octet-stream",
            "Cache-Control": "public, max-age=3600",
          },
        });
      } catch {
        continue;
      }
    }
  }

  return NextResponse.json({ error: "File not found" }, { status: 404 });
}
