// ── Webcam Frame Route ──
// Saves a single frame from the browser (base64 JPEG) and returns its ID.
// Used by the continuous watch loop — browser captures frame, sends here,
// backend analyzes it and returns structured observations.

import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir, unlink, readFile } from "fs/promises";
import { execSync } from "child_process";
import { randomUUID } from "crypto";
import path from "path";

const ECHO_VISION = process.env.ECHO_VISION_PATH || "/";
const TEMP_DIR = "/tmp/smyth-webcam";

// GET — retrieve a previously captured frame by ID
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const frameId = url.searchParams.get("id");

  if (!frameId) {
    return NextResponse.json({ error: "Missing frame id" }, { status: 400 });
  }

  const framePath = path.join(TEMP_DIR, `webcam-${frameId}.jpg`);
  try {
    const data = await readFile(framePath);
    return new Response(data, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "no-cache",
      },
    });
  } catch {
    return NextResponse.json({ error: "Frame not found" }, { status: 404 });
  }
}

// POST — upload a frame from browser camera for analysis (lightweight version)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { image, mode = "capture" } = body;

    if (!image?.data) {
      return NextResponse.json({ error: "No image data" }, { status: 400 });
    }

    const base64Data = image.data.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");

    await mkdir(TEMP_DIR, { recursive: true });

    const frameId = randomUUID().slice(0, 8);
    const framePath = path.join(TEMP_DIR, `webcam-${frameId}.jpg`);
    await writeFile(framePath, buffer);

    // Run lightweight analysis for watch mode (fast)
    let result = "";
    try {
      const cmd = `python3 "${ECHO_VISION}" "${framePath}" --grid 12 --json --no-svg --no-semantic --no-ascii --no-creative`;
      const output = execSync(cmd, { encoding: "utf-8", timeout: 15000, maxBuffer: 5 * 1024 * 1024 });
      const analysis = JSON.parse(output.trim());

      if (!analysis.error) {
        const parts: string[] = [];
        parts.push(`[WEBCAM ${mode.toUpperCase()}]`);

        const stats = analysis.statistics || {};
        const dims = stats.dimensions || {};
        parts.push(`${dims.width || "?"}×${dims.height || "?"}`);

        const colors = analysis.dominant_colors || [];
        if (colors.length > 0) {
          parts.push(colors.slice(0, 4).map((c: any) => `${c.name}(${(c.coverage_pct || 0).toFixed(0)}%)`).join(" "));
        }

        const text = (analysis.text?.full_text || "").trim();
        if (text) {
          parts.push(`Text: "${text.slice(0, 200)}"`);
        }

        const shapes = analysis.contours?.total_shapes || 0;
        parts.push(`Objects: ~${shapes}`);

        const density = analysis.edges?.edge_density_pct || 0;
        parts.push(`Density: ${density.toFixed(0)}%`);

        const faces = analysis.semantic?.faces || 0;
        if (faces > 0) parts.push(`Faces: ${faces}`);

        result = parts.join(" | ");
      } else {
        result = `[WEBCAM ERROR] ${analysis.error}`;
      }
    } catch (err: any) {
      result = `[WEBCAM ERROR] Analysis failed: ${err.message?.slice(0, 100)}`;
    }

    // Clean up frame
    try { await unlink(framePath); } catch {}

    return NextResponse.json({
      status: "ok",
      mode,
      text: result,
      frameId,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Frame analysis failed" },
      { status: 500 }
    );
  }
}