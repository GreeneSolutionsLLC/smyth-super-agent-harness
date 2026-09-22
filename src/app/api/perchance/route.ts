// ── Perchance Image Generation API Route ──
// POST /api/perchance → generates an AI image via Perchance Python library
// Returns base64 image data + metadata

import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import * as fs from "fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SCRIPT_PATH = path.join(process.cwd(), "scripts", "perchance_gen.py");

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { prompt, negativePrompt, seed, shape, guidanceScale, style, numImages } = body;

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'prompt' field" },
        { status: 400 }
      );
    }

    const input = JSON.stringify({
      prompt,
      negativePrompt: negativePrompt || undefined,
      seed: typeof seed === "number" ? seed : -1,
      shape: shape === "portrait" || shape === "landscape" ? shape : "square",
      guidanceScale: typeof guidanceScale === "number" ? guidanceScale : 7.0,
      style: typeof style === "string" ? style : "none",
      numImages: typeof numImages === "number" && numImages >= 1 && numImages <= 4 ? numImages : 1,
    });

    // Call the Python script
    const result = await new Promise<string>((resolve, reject) => {
      // Explicitly pass REPLICATE_API_TOKEN since Next.js may not forward all .env.local vars
      const env = { ...process.env };
      if (!env.REPLICATE_API_TOKEN) {
        // Try reading from .env.local directly
        try {
          const envPath = path.join(process.cwd(), ".env.local");
          const envContent = fs.readFileSync(envPath, "utf-8");
          const match = envContent.match(/REPLICATE_API_TOKEN=(.+)/);
          if (match) env.REPLICATE_API_TOKEN = match[1].trim();
        } catch {}
      }

      const py = spawn("python3", [SCRIPT_PATH], {
        cwd: process.cwd(),
        env,
      });

      let stdout = "";
      let stderr = "";

      py.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      py.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      py.on("close", (code) => {
        if (code !== 0) {
          console.error("[api/perchance] Python exit code:", code, stderr);
          reject(new Error(stderr || `Python script exited with code ${code}`));
        } else {
          resolve(stdout);
        }
      });

      py.on("error", (err) => {
        console.error("[api/perchance] Spawn error:", err);
        reject(new Error(`Failed to run image generation: ${err.message}`));
      });

      // Send input via stdin
      py.stdin.write(input);
      py.stdin.end();
    });

    // Parse the Python script output
    let parsed: any;
    try {
      parsed = JSON.parse(result);
    } catch {
      console.error("[api/perchance] Failed to parse output:", result.substring(0, 500));
      return NextResponse.json(
        { error: "Image generation returned invalid output" },
        { status: 500 }
      );
    }

    if (parsed.error) {
      console.error("[api/perchance] Generation error:", parsed.error);
      return NextResponse.json(
        { error: parsed.error },
        { status: 500 }
      );
    }

    return NextResponse.json(parsed);
  } catch (error: any) {
    console.error("[api/perchance] Error:", error);
    return NextResponse.json(
      { error: error.message || "Image generation failed" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "perchance",
    description: "AI image generation via Perchance (Python library)",
  });
}