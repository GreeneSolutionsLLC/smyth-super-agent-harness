// GET /api/opencut-asset?path=<absolute path>
// Serves a local file with CORS headers so the opencut tab (on :3001) can
// fetch it. Used by opencut_insert_clip_from_url when the URL points to a
// local file the agent wants to drop on the timeline.
//
// Safety: only serves files under $SMYTH_WORKSPACE or $HOME.

import { NextRequest, NextResponse } from "next/server";
import { createReadStream, statSync, existsSync } from "fs";
import { Readable } from "stream";
import { basename, extname } from "path";
import { getWorkspacePath } from "@/lib/env";

const ALLOWED_ORIGIN = "*";

const ALLOWED_PREFIX = getWorkspacePath();

function guessContentType(filename: string): string {
  const ext = extname(filename).toLowerCase().slice(1);
  const map: Record<string, string> = {
    mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska",
    m4v: "video/x-m4v", avi: "video/x-msvideo", mp3: "audio/mpeg", wav: "audio/wav",
    m4a: "audio/mp4", ogg: "audio/ogg", flac: "audio/flac", aac: "audio/aac",
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
    webp: "image/webp", svg: "image/svg+xml",
  };
  return map[ext] || "application/octet-stream";
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const filePath = url.searchParams.get("path");
  if (!filePath) {
    return NextResponse.json({ error: "Missing ?path=<absolute path>" }, { status: 400 });
  }
  // Safety: restrict to the user's configured workspace or home dir
  if (!filePath.startsWith(ALLOWED_PREFIX)) {
    return NextResponse.json({ error: "Path not allowed" }, { status: 403 });
  }
  if (!existsSync(filePath)) {
    return NextResponse.json({ error: "File not found", path: filePath }, { status: 404 });
  }

  const stat = statSync(filePath);
  const fileName = basename(filePath);
  const contentType = guessContentType(fileName);

  const stream = Readable.toWeb(createReadStream(filePath)) as unknown as ReadableStream;
  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(stat.size),
      "Content-Disposition": `inline; filename="${fileName}"`,
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "public, max-age=300",
    },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
