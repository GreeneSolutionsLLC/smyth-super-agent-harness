// ── Webcam Capture Route ──
// Receives a base64 JPEG frame from the browser's getUserMedia,
// saves it to disk, runs EchoVision analysis, returns structured text.
// The latest frame is kept at /tmp/smyth-webcam/latest.jpg for tool access.

import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir, unlink, copyFile } from "fs/promises";
import { execSync } from "child_process";
import { randomUUID } from "crypto";
import path from "path";

const ECHO_VISION = process.env.ECHO_VISION_PATH || "/";
const VISION_PY = process.env.VISION_SKILL_PATH || "";
const TEMP_DIR = "/tmp/smyth-webcam";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { image, detail = "balanced", analyze = true, visionProvider } = body;

    if (!image || !image.data) {
      return NextResponse.json({ error: "No image data provided" }, { status: 400 });
    }

    // Decode base64 — strip data URL prefix if present
    const base64Data = image.data.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");

    // Ensure temp dir
    await mkdir(TEMP_DIR, { recursive: true });

    // Save frame to temp file
    const frameId = randomUUID().slice(0, 8);
    const framePath = path.join(TEMP_DIR, `webcam-${frameId}.jpg`);
    await writeFile(framePath, buffer);

    // Also save as "latest.jpg" so the webcam_capture tool can find it
    const latestPath = path.join(TEMP_DIR, "latest.jpg");
    await copyFile(framePath, latestPath);

    if (!analyze) {
      // Just save, don't analyze — return the path
      return NextResponse.json({
        status: "captured",
        path: framePath,
        size: buffer.length,
      });
    }

    // Run EchoVision structural analysis
    let structuralAnalysis: any = null;
    try {
      const gridOpt = detail === "high" ? "--grid 32" : detail === "low" ? "--grid 8" : "--grid 16";
      const cmd = `python3 "${ECHO_VISION}" "${framePath}" ${gridOpt} --json --no-svg --no-semantic --no-ascii`;
      const result = execSync(cmd, { encoding: "utf-8", timeout: 30000, maxBuffer: 10 * 1024 * 1024 });
      structuralAnalysis = JSON.parse(result.trim());
    } catch (err: any) {
      console.error("[webcam] EchoVision error:", err.message?.slice(0, 200));
    }

    // Optionally run AI vision for natural language description
    let visionDescription = "";
    if (visionProvider) {
      try {
        const provider = visionProvider === "openrouter" ? "--provider openrouter" : "--provider ollama-pro";
        const cmd = `python3 "${VISION_PY}" "${framePath}" ${provider}`;
        const result = execSync(cmd, { encoding: "utf-8", timeout: 60000, maxBuffer: 10 * 1024 * 1024 });
        visionDescription = result.trim();
      } catch (err: any) {
        console.error("[webcam] Vision AI error:", err.message?.slice(0, 200));
      }
    }

    // Build structured text response
    const parts: string[] = [];
    parts.push("[WEBCAM CAPTURE — Live Camera Feed]");

    if (structuralAnalysis) {
      if (structuralAnalysis.error) {
        parts.push(`Analysis error: ${structuralAnalysis.error}`);
      } else {
        const stats = structuralAnalysis.statistics || {};
        const dims = stats.dimensions || {};
        parts.push(`Frame: ${dims.width || "?"}×${dims.height || "?"}`);

        const brightness = stats.brightness || {};
        const contrast = stats.contrast || {};
        parts.push(`Brightness: ${brightness.label || "?"} (${brightness.value || "?"})`);
        parts.push(`Contrast: ${contrast.label || "?"}`);

        const colors = structuralAnalysis.dominant_colors || [];
        if (colors.length > 0) {
          const colorDesc = colors.slice(0, 6).map((c: any) =>
            `${c.name || "?"} (${(c.coverage_pct || 0).toFixed(0)}%)`
          ).join(", ");
          parts.push(`Colors: ${colorDesc}`);
        }

        const edges = structuralAnalysis.edges || {};
        const density = edges.edge_density_pct || 0;
        if (density > 30) parts.push("Layout: Dense (many visual elements)");
        else if (density > 15) parts.push("Layout: Moderate content");
        else parts.push("Layout: Sparse/minimal");

        const contours = structuralAnalysis.contours || {};
        const shapeCount = contours.total_shapes || 0;
        if (shapeCount > 20) parts.push(`Objects detected: ~${shapeCount} (complex scene)`);
        else if (shapeCount > 5) parts.push(`Objects detected: ~${shapeCount}`);
        else parts.push("Objects detected: Few");

        const semantic = structuralAnalysis.semantic || {};
        if (semantic.faces) parts.push(`Faces: ${semantic.faces}`);
        if (semantic.people) parts.push(`People: ${semantic.people}`);

        const text = structuralAnalysis.text || {};
        const fullText = (text.full_text || "").trim();
        if (fullText) {
          parts.push(`\nVisible text:\n${fullText.slice(0, 800)}`);
        }

        const creative = structuralAnalysis.creative_vision || {};
        const mood = creative.lighting_mood || {};
        if (mood.mood) parts.push(`Visual mood: ${mood.mood}`);
      }
    }

    if (visionDescription) {
      parts.push(`\nAI Vision: ${visionDescription}`);
    }

    // Clean up the timestamped frame (keep latest.jpg)
    try { await unlink(framePath); } catch {}

    return NextResponse.json({
      status: "analyzed",
      analysis: structuralAnalysis,
      description: visionDescription,
      text: parts.join("\n"),
      frameId,
    });

  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Webcam capture failed" },
      { status: 500 }
    );
  }
}