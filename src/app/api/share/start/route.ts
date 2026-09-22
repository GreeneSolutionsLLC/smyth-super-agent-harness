// ── Smyth Share — API route ──
// Manages the LocalSend-compatible HTTP file server lifecycle
// Accepts files from both:
//   1. Smyth-generated files (absolute paths in workspace)
//   2. Browser-picked files (uploaded as form data)

import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import {
  startShareServer,
  stopShareServer,
  getShareStatus,
} from "@/lib/share-server";
import { getWorkspacePath } from "@/lib/env";

export async function POST(request: NextRequest) {
  try {
    const WORKSPACE = getWorkspacePath();
    const SHARE_TEMP = path.join(WORKSPACE, ".shared");

    let files: Array<{ filePath: string; fileName: string }> = [];

    // Check if it's multipart form data (browser file upload) or JSON
    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      await mkdir(SHARE_TEMP, { recursive: true });

      // Handle workspace files (passed as JSON string alongside uploaded files)
      const workspaceFilesJson = formData.get("workspaceFiles") as string | null;
      if (workspaceFilesJson) {
        try {
          const wsFiles = JSON.parse(workspaceFilesJson);
          for (const f of wsFiles) {
            const filePath = f.filePath.startsWith("/") ? f.filePath : path.join(/*turbopackIgnore: true*/ WORKSPACE, f.filePath);
            if (existsSync(filePath)) {
              files.push({ filePath, fileName: f.fileName || path.basename(filePath) });
            }
          }
        } catch {}
      }

      // Handle browser-uploaded files (actual File objects)
      for (const [key, value] of formData.entries()) {
        if (key === "files") {
          const v = value as any;
          if (v && typeof v === "object" && typeof v.arrayBuffer === "function") {
            const buffer = Buffer.from(await v.arrayBuffer());
            // Use a unique prefix to avoid name collisions
            const uniqueName = `${Date.now()}-${v.name}`;
            const tempPath = path.join(SHARE_TEMP, uniqueName);
            await writeFile(tempPath, buffer);
            files.push({
              filePath: tempPath,
              fileName: v.name,
            });
          }
        }
      }
    } else {
      const body = await request.json().catch(() => ({}));
      const rawFiles = body.files || [];

      for (const f of rawFiles) {
        // Resolve relative paths against workspace
        const filePath = f.filePath.startsWith("/")
          ? f.filePath
          : path.join(/*turbopackIgnore: true*/ WORKSPACE, f.filePath);

        // Check if file exists on disk
        if (!existsSync(filePath)) {
          // File doesn't exist at the path provided — this happens with browser file picker
          // The file data was uploaded to a temp path
          continue;
        }

        files.push({
          filePath,
          fileName: f.fileName || path.basename(filePath),
        });
      }

      // If no valid files from JSON, check if it was a JSON with inline data
      // (would need to handle that differently)
      if (files.length === 0) {
        return NextResponse.json(
          { error: "None of the specified files exist on disk. For browser files, use multipart upload." },
          { status: 400 }
        );
      }
    }

    if (files.length === 0) {
      return NextResponse.json({ error: "No files specified" }, { status: 400 });
    }

    const session = await startShareServer(files);

    // Get the actual share URL from the server status (handles port fallback correctly)
    const status = getShareStatus();

    return NextResponse.json({
      running: true,
      url: status.url || `http://127.0.0.1:53317`,
      session: {
        sessionId: session.sessionId,
        files: session.files.map((f: any) => ({
          id: f.id,
          fileName: f.fileName,
          size: f.size,
          fileType: f.fileType,
        })),
        alias: session.alias,
        createdAt: session.createdAt,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to start share server" },
      { status: 500 }
    );
  }
}
