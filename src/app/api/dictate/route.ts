import { NextRequest } from "next/server";
import {
  getOllamaCloudApiKey,
  getOllamaBaseUrl,
} from "@/lib/runtime-keys";

/**
 * /api/dictate — Voice dictation that produces a REAL prompt, not raw text.
 *
 * Flow:
 *   1. Receive audio blob from the browser mic
 *   2. Transcribe via local Whisper sidecar (localhost:5100), with CLI fallback
 *   3. Send the raw transcript through the same LLM pool as the rest of the app,
 *      instructing it to rewrite the dictation into a clear, complete, actionable
 *      prompt — removing filler words, fixing grammar, keeping intent/domain intact.
 *   4. Return { transcript, prompt, source } — the client sends `prompt` to the
 *      agent as the actual message.
 *
 * If the LLM refinement step fails, we fall back to the raw transcript so the
 * mic never dead-ends.
 */

// Pinned refinement model — small, fast, consistent.
// gemma4:31b returns clean completions with think:false (no reasoning tokens,
// no 200-token burn on "thinking"). Avoids the pool-router entirely so the
// dictation path never competes with agent traffic or model cooldowns.
const REFINE_MODEL = "gemma4:31b";

const WHISPER_SERVER = process.env.WHISPER_SERVER || "http://localhost:5100";
const WHISPER_TIMEOUT = 30_000;

const REFINE_SYSTEM = `You are a prompt engineer inside a voice-dictation UI. The user dictated the text below while speaking naturally — it will contain filler words, false starts, and conversational grammar. Rewrite it into ONE clean, specific, actionable prompt that the user would have typed. Rules:
- Preserve the user's intent, domain, names, numbers, and technical terms EXACTLY (do not invent facts or drop specifics).
- Remove filler ("um", "like", "you know", "sort of"), repetition, and false starts.
- Fix grammar and word order; output plain natural written English, NOT command-style keywords.
- If the dictation is already a clean prompt, return it nearly verbatim.
- Keep it a single paragraph unless the content genuinely needs structure.
- Output ONLY the rewritten prompt. No preamble, no quotes, no explanation.`;

async function transcribe(buffer: Buffer, fileName: string, contentType: string): Promise<string> {
  // Method 1: local Whisper sidecar (fast path, model pre-loaded)
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
      if (data.text !== undefined && data.text.trim()) {
        return data.text.trim();
      }
    }
    console.log("[dictate] Whisper server failed, trying CLI fallback");
  } catch (err: any) {
    console.log("[dictate] Whisper server error:", err.message);
  }

  // Method 2: whisper CLI
  const { execFile } = await import("child_process");
  const { writeFileSync, unlinkSync } = await import("fs");
  const os = await import("os");
  const path = await import("path");

  const tmpPath = path.join(os.tmpdir(), `dictate-${Date.now()}.${fileName.split(".").pop() || "webm"}`);
  writeFileSync(tmpPath, buffer);
  try {
    const result = await new Promise<string>((resolve, reject) => {
      execFile("/opt/homebrew/bin/whisper", [tmpPath, "--model", "base", "--output_format", "txt", "--output_dir", os.tmpdir()], { timeout: 120_000 }, (err, stdout, stderr) => {
        if (err) return reject(err);
        resolve(stdout || stderr || "");
      });
    });
    // CLI writes a .txt next to the input when output_dir is set; read it back
    const txtPath = path.join(os.tmpdir(), `${path.basename(tmpPath, path.extname(tmpPath))}.txt`);
    try {
      const { readFileSync } = await import("fs");
      const txt = readFileSync(txtPath, "utf8").trim();
      if (txt) return txt;
    } catch {}
    return result.trim();
  } finally {
    unlinkSync(tmpPath);
    const { readFileSync, existsSync } = await import("fs");
    const txtPath = path.join(os.tmpdir(), `${path.basename(tmpPath, path.extname(tmpPath))}.txt`);
    if (existsSync(txtPath)) unlinkSync(txtPath);
  }
}

export const maxDuration = 120;

async function getCloudKey(): Promise<string | null> {
  try {
    return await getOllamaCloudApiKey();
  } catch {
    return null;
  }
}

async function getBaseUrl(): Promise<string> {
  try {
    return await getOllamaBaseUrl();
  } catch {
    return "https://ollama.com/v1";
  }
}

async function refinePrompt(transcript: string): Promise<string> {
  const apiKey = await getCloudKey();
  if (!apiKey) {
    throw new Error("No Ollama Cloud API key available");
  }
  const baseUrl = await getBaseUrl();

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: REFINE_MODEL,
      stream: false,
      think: false,
      messages: [
        { role: "system", content: REFINE_SYSTEM },
        { role: "user", content: transcript },
      ],
      max_tokens: 300,
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Refinement model returned ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const reply = data?.choices?.[0]?.message?.content?.trim() || "";
  if (!reply) {
    throw new Error("Empty refinement response");
  }

  return reply;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get("audio") as File | null;
    const routeMode = (formData.get("routeMode") as string) || "auto";

    if (!audioFile) {
      return Response.json({ error: "No audio file provided" }, { status: 400 });
    }

    const buffer = Buffer.from(await audioFile.arrayBuffer());

    let ext = "webm";
    const contentType = audioFile.type || "";
    if (contentType.includes("wav")) ext = "wav";
    else if (contentType.includes("mp4") || contentType.includes("m4a")) ext = "m4a";
    else if (contentType.includes("ogg") || contentType.includes("opus")) ext = "ogg";
    else if (audioFile.name?.endsWith(".wav")) ext = "wav";
    else if (audioFile.name?.endsWith(".m4a")) ext = "m4a";

    const fileName = audioFile.name || `recording.${ext}`;

    // Step 1: transcribe
    const transcript = await transcribe(buffer, fileName, contentType);
    if (!transcript) {
      return Response.json({ error: "No speech detected" }, { status: 422 });
    }

    // Step 2: refine into a real prompt (fallback to raw transcript)
    let prompt = transcript;
    let refined = false;
    try {
      prompt = await refinePrompt(transcript);
      refined = prompt.length > 0;
      console.log("[dictate] Refined:", JSON.stringify(prompt));
    } catch (err: any) {
      console.warn("[dictate] Refinement failed, using raw transcript:", err.message);
    }

    return Response.json({
      transcript,
      prompt,
      refined,
      source: refined ? "whisper+llm" : "whisper-raw",
    });
  } catch (err: any) {
    console.error("[dictate] Failed:", err.message);
    return Response.json({ error: "Dictation failed", details: err.message }, { status: 500 });
  }
}
