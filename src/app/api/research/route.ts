import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";

const RESEARCH_DIR = process.env.SMYTH_WORKSPACE
  ? `${process.env.SMYTH_WORKSPACE}/research`
  : "/tmp/smyth/research";

export async function GET(request: NextRequest) {
  const file = request.nextUrl.searchParams.get("file");
  if (!file) {
    return NextResponse.json({ error: "No file specified" }, { status: 400 });
  }

  // Security: only allow files from the configured research directory
  if (!file.startsWith(RESEARCH_DIR)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  try {
    const content = readFileSync(file, "utf-8");
    const filename = file.split("/").pop() || "download.txt";
    const ext = filename.endsWith(".md") ? "text/markdown" : "text/plain";

    return new NextResponse(content, {
      headers: {
        "Content-Type": ext,
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
