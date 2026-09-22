// ── List workspace files ──
// Scans the Smyth workspace directory and returns files grouped by type

import { NextResponse } from "next/server";
import { readdirSync, statSync, existsSync } from "fs";
import { join, extname } from "path";
import { getWorkspacePath } from "@/lib/env";

const WORKSPACE_DIR = getWorkspacePath();

function scanDir(dir: string, prefix = "", maxDepth = 2, depth = 0): { name: string; type: string; size: number }[] {
  if (depth >= maxDepth) return [];
  if (!existsSync(dir)) return [];

  let results: { name: string; type: string; size: number }[] = [];
  let entries: string[];

  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  for (const entry of entries) {
    // Skip hidden dirs, node_modules, .git, .next, etc.
    if (entry.startsWith(".") || entry === "node_modules" || entry === "__pycache__") continue;

    const fullPath = join(dir, entry);
    const relPath = prefix ? `${prefix}/${entry}` : entry;

    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        results = results.concat(scanDir(fullPath, relPath, maxDepth, depth + 1));
      } else {
        const ext = extname(entry).slice(1).toLowerCase();
        let type = "file";
        if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) type = "img";
        else if (["md", "txt"].includes(ext)) type = "md";
        else if (["ts", "tsx", "js", "jsx"].includes(ext)) type = "code";
        else if (["py"].includes(ext)) type = "py";
        else if (["json", "yaml", "yml"].includes(ext)) type = "data";
        else if (["sh", "bash"].includes(ext)) type = "sh";
        else if (["html", "css"].includes(ext)) type = "web";

        // Skip noise files
        if (["lock", "log"].includes(ext)) continue;

        results.push({ name: relPath, type, size: stat.size });
      }
    } catch {
      continue;
    }
  }

  return results;
}

export const dynamic = "force-dynamic";

export async function GET() {
  const files = scanDir(WORKSPACE_DIR);
  return NextResponse.json({ files });
}