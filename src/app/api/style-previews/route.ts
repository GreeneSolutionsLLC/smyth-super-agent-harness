import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { ART_STYLES } from "@/lib/perchance-styles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Generates + caches a square preview thumbnail for each Perchance art style.
//   GET ?all=1            → { ok, previews: {name:url}, missing: [...] }
//   GET ?style=Name       → generate+return one (cached if present)
//   POST { style: Name }  → force-regenerate one
// Previews are written to public/style-previews/<slug>.png and served statically.

const PREVIEW_DIR = path.join(process.cwd(), "public", "style-previews");
const PREVIEW_PROMPT = "a majestic fox, centered, detailed";
const SCRIPT_PATH = path.join(process.cwd(), "scripts", "perchance_gen.py");

// Map display-name style → the python script's slug-style key (they match: lowercase + dashes).
function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function ensureDir() {
  if (!fs.existsSync(PREVIEW_DIR)) fs.mkdirSync(PREVIEW_DIR, { recursive: true });
}
function previewPath(name: string): string {
  return path.join(PREVIEW_DIR, `${slug(name)}.png`);
}
function previewUrl(name: string): string {
  return `/style-previews/${slug(name)}.png`;
}
function hasPreview(name: string): boolean {
  return fs.existsSync(previewPath(name));
}

function runPython(styleName: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const input = JSON.stringify({
      prompt: PREVIEW_PROMPT,
      seed: -1,
      shape: "square",
      guidanceScale: 7.0,
      style: slug(styleName), // python resolves style via its own STYLES dict (slug keys)
      numImages: 1,
    });
    const py = spawn("python3", [SCRIPT_PATH], { cwd: process.cwd(), env: process.env });
    let stdout = "";
    let stderr = "";
    py.stdout.on("data", (d) => (stdout += d.toString()));
    py.stderr.on("data", (d) => (stderr += d.toString()));
    py.on("error", reject);
    py.on("close", (code) => {
      if (code !== 0) return reject(new Error(stderr || `exit ${code}`));
      let parsed: any;
      try {
        parsed = JSON.parse(stdout.trim());
      } catch {
        return reject(new Error("bad script output: " + stdout.slice(0, 200)));
      }
      if (parsed.error) return reject(new Error(parsed.error));
      const dataUrl: string = parsed.image || "";
      const b64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
      if (!b64) return reject(new Error("no image payload"));
      resolve(Buffer.from(b64, "base64"));
    });
    py.stdin.write(input);
    py.stdin.end();
  });
}

async function generateOne(name: string): Promise<{ url: string }> {
  const style = ART_STYLES.find(
    (s) => s.name.toLowerCase() === name.toLowerCase() || slug(s.name) === slug(name)
  );
  if (!style) throw new Error(`unknown style: ${name}`);
  ensureDir();
  const buf = await runPython(style.name);
  fs.writeFileSync(previewPath(style.name), buf);
  return { url: previewUrl(style.name) };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const style = searchParams.get("style");
  const all = searchParams.get("all");

  if (all) {
    const previews: Record<string, string> = {};
    const missing: string[] = [];
    for (const s of ART_STYLES) {
      if (hasPreview(s.name)) previews[s.name] = previewUrl(s.name);
      else missing.push(s.name);
    }
    return NextResponse.json({ ok: true, previews, missing, total: ART_STYLES.length });
  }

  if (style) {
    if (hasPreview(style)) {
      const name = ART_STYLES.find((s) => slug(s.name) === slug(style))?.name ?? style;
      return NextResponse.json({ ok: true, url: previewUrl(name), cached: true });
    }
    try {
      const { url } = await generateOne(style);
      return NextResponse.json({ ok: true, url, cached: false });
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e?.message || "generation failed" }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: false, error: "pass ?style=Name or ?all=1" }, { status: 400 });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const style = body?.style;
    if (!style) return NextResponse.json({ ok: false, error: "style required" }, { status: 400 });
    const { url } = await generateOne(style);
    return NextResponse.json({ ok: true, url, cached: false });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "generation failed" }, { status: 500 });
  }
}
