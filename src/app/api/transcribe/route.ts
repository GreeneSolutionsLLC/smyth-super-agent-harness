import { NextRequest, NextResponse } from "next/server";

// ── Transcription Route ──
// Tries the local Whisper server first (model pre-loaded, ~1s).
// Falls back to spawning whisper CLI, then Python whisper.

const WHISPER_SERVER = process.env.WHISPER_SERVER || "http://localhost:5100";
const WHISPER_TIMEOUT = 30_000; // 30s max

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get("audio") as File | null;
    if (!audioFile) {
      return NextResponse.json({ error: "No audio file provided" }, { status: 400 });
    }

    const buffer = Buffer.from(await audioFile.arrayBuffer());
    
    // Determine extension
    let ext = "webm";
    const contentType = audioFile.type || "";
    if (contentType.includes("wav")) ext = "wav";
    else if (contentType.includes("mp4") || contentType.includes("m4a")) ext = "m4a";
    else if (contentType.includes("ogg") || contentType.includes("opus")) ext = "ogg";
    else if (audioFile.name?.endsWith(".wav")) ext = "wav";
    else if (audioFile.name?.endsWith(".m4a")) ext = "m4a";
    
    const fileName = audioFile.name || `recording.${ext}`;

    // ── Method 1: Local Whisper server (fastest, model pre-loaded) ──
    try {
      const serverForm = new FormData();
      serverForm.append("audio", new Blob([buffer], { type: contentType }), fileName);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), WHISPER_TIMEOUT);

      const res = await fetch(`${WHISPER_SERVER}/transcribe`, {
        method: "POST",
        body: serverForm,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json();
        if (data.text !== undefined) {
          // If server returned empty text, VAD filtered silence — don't fall through.
          if (!data.text.trim()) {
            return NextResponse.json({
              text: "",
              length: 0,
              source: "whisper-server",
            });
          }
          return NextResponse.json({
            text: data.text || "",
            length: (data.text || "").length,
            source: "whisper-server",
          });
        }
      }
      // Server returned an error — fall through to fallbacks
      console.log("[transcribe] Whisper server error, trying fallbacks");
    } catch (err: any) {
      console.log("[transcribe] Whisper server not available:", err.message);
    }

    // ── Method 2: whisper CLI ──
    try {
      const { execFile } = await import("child_process");
      const { writeFileSync, unlinkSync } = await import("fs");
      const { randomUUID } = await import("crypto");
      
      const tmpPath = `/tmp/smyth-audio-${randomUUID()}.${ext}`;
      writeFileSync(tmpPath, buffer);

      const result = await new Promise<string>((resolve, reject) => {
        execFile("whisper", [
          "--model", "base",
          "--language", "en",
          "--output_format", "txt",
          "--output_dir", "/tmp",
          tmpPath,
        ], { timeout: WHISPER_TIMEOUT }, (err, stdout, stderr) => {
          if (err) reject(err);
          else resolve(stdout.trim());
        });
      });

      // Read the output text file
      const { readFileSync } = await import("fs");
      const baseName = tmpPath.split("/").pop()?.replace(/\.[^.]+$/, "") || "audio";
      const txtPath = `/tmp/${baseName}.txt`;
      
      try {
        const text = readFileSync(txtPath, "utf8").trim();
        try { unlinkSync(txtPath); } catch {}
        try { unlinkSync(tmpPath); } catch {}
        return NextResponse.json({ text, length: text.length, source: "whisper-cli" });
      } catch {
        // If file doesn't exist, use stdout
        unlinkSync(tmpPath);
        if (result) {
          return NextResponse.json({ text: result, length: result.length, source: "whisper-cli" });
        }
      }
    } catch (err: any) {
      console.log("[transcribe] Whisper CLI failed:", err.message);
    }

    // ── Method 3: Python openai-whisper (slowest, loads model each call) ──
    try {
      const { execSync } = await import("child_process");
      const { writeFileSync, unlinkSync } = await import("fs");
      const { randomUUID } = await import("crypto");
      
      const tmpPath = `/tmp/smyth-audio-${randomUUID()}.${ext}`;
      writeFileSync(tmpPath, buffer);

      const PYTHON_WHISPER = `python3 -W ignore -c "import whisper; model = whisper.load_model('base'); import sys; result = model.transcribe(sys.argv[1]); print(result['text'])"`;
      
      const result = execSync(`${PYTHON_WHISPER} "${tmpPath}"`, {
        timeout: 120_000,
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
      });

      unlinkSync(tmpPath);
      const text = result.trim();
      return NextResponse.json({ text, length: text.length, source: "python-whisper" });
    } catch (err: any) {
      console.error("[transcribe] All methods failed:", err.message);
      return NextResponse.json({
        text: "",
        error: `All transcription methods failed: ${err.message}`,
      }, { status: 500 });
    }
  } catch (err: any) {
    return NextResponse.json(
      { error: "Transcription failed", details: err.message },
      { status: 500 }
    );
  }
}