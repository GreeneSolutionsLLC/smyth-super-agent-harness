// ── Smyth Design Engine API Route ──
// POST /api/design → generates a finished design PNG via design_engine.py
// Returns PNG image directly
//
// Body: { prompt, template, format, brand, bg_prompt, bg_image_url, brand_name }
// Response: image/png

import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import * as fs from "fs";
import os from "os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SCRIPT_PATH = path.join(process.cwd(), "scripts", "design_engine.py");

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      prompt,
      template = "dark_quote",
      format = "instagram_post",
      brand = "default",
      bg_prompt,
      bg_image_url,
      brand_name,
    } = body;

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'prompt' field" },
        { status: 400 }
      );
    }

    // Build the JSON input for the Python script
    const input = JSON.stringify({
      prompt,
      template,
      format,
      brand,
      bg_prompt: bg_prompt || undefined,
      bg_image_url: bg_image_url || undefined,
      brand_name: brand_name || undefined,
      output: undefined, // let the script pick a temp path
    });

    // Ensure REPLICATE_API_TOKEN is available
    const env = { ...process.env };
    if (!env.REPLICATE_API_TOKEN) {
      try {
        const envPath = path.join(process.cwd(), ".env.local");
        const envContent = fs.readFileSync(envPath, "utf-8");
        const match = envContent.match(/REPLICATE_API_TOKEN=(.+)/);
        if (match) env.REPLICATE_API_TOKEN = match[1].trim();
      } catch {}
    }

    // Generate to a temp file, then read it back
    const tmpFile = path.join(os.tmpdir(), `smyth_design_${Date.now()}.png`);

    const result = await new Promise<{ ok: boolean; path?: string; error?: string }>(
      (resolve, reject) => {
        const py = spawn("python3", [SCRIPT_PATH, "--json", "-o", tmpFile], {
          cwd: process.cwd(),
          env,
        });

        let stdout = "";
        let stderr = "";

        py.stdout.on("data", (data) => { stdout += data; });
        py.stderr.on("data", (data) => { stderr += data; });

        py.on("close", (code) => {
          if (code === 0) {
            try {
              const parsed = JSON.parse(stdout);
              resolve({ ok: true, path: parsed.path || tmpFile });
            } catch {
              resolve({ ok: true, path: tmpFile });
            }
          } else {
            resolve({ ok: false, error: stderr || `Exit code ${code}` });
          }
        });

        py.on("error", reject);
        py.stdin.write(input);
        py.stdin.end();
      }
    );

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error || "Design generation failed" },
        { status: 500 }
      );
    }

    // Read the generated PNG
    const filePath = result.path || tmpFile;
    if (!fs.existsSync(filePath)) {
      return NextResponse.json(
        { error: "Design file not found after generation" },
        { status: 500 }
      );
    }

    const imageBuffer = fs.readFileSync(filePath);

    // Clean up temp file
    try { fs.unlinkSync(filePath); } catch {}

    // Return as PNG
    return new NextResponse(imageBuffer, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Content-Disposition": 'inline; filename="design.png"',
      },
    });
  } catch (err: any) {
    console.error("[design] Error:", err);
    return NextResponse.json(
      { error: err.message || "Internal server error" },
      { status: 500 }
    );
  }
}

// GET /api/design → return available templates, formats, and brands
export async function GET() {
  return NextResponse.json({
    templates: ["grit", "dark_quote", "split_text", "gradient_quote", "minimal_quote"],
    formats: ["instagram_post", "instagram_story", "linkedin_post", "youtube_thumb", "poster", "twitter_post"],
    brands: ["unfiltered_wisdom", "smyth", "default"],
  });
}