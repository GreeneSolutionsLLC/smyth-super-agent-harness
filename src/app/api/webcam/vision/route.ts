// ── Webcam Vision Route ──
// Takes a base64 JPEG frame and returns a natural-language description of
// what's happening in the scene, using an Ollama Cloud vision model.
//
// This is the "what are people doing" layer — distinct from EchoVision's
// structural analysis (colors/edges/faces). It answers behavioral questions
// like "is someone at the counter / restocking / on their phone".
//
// Model selection: minimax-m3 is the Cloud vision model verified to return
// clean `content` (not burn tokens on `reasoning` and hit the cap).
// kimi-k3 also works but bills extra tokens outside the API plan, so it's
// deliberately excluded to keep vision calls inside the plan.

import { NextRequest, NextResponse } from "next/server";
import { getOllamaBaseUrl, getOllamaCloudApiKey } from "@/lib/runtime-keys";

const DEFAULT_MODEL = "minimax-m3";

const DEFAULT_PROMPT =
  "Describe what is happening in this image in 2-3 sentences. " +
  "What people and objects do you see, and what are they doing? " +
  "Be specific about actions and positions.";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { image, prompt, model } = body;

    if (!image || !image.data) {
      return NextResponse.json({ error: "No image data provided" }, { status: 400 });
    }

    const base64 = image.data.replace(/^data:image\/\w+;base64,/, "");
    const mime = image.mimeType || "image/jpeg";
    const text = prompt || DEFAULT_PROMPT;

    const [endpoint, apiKey] = await Promise.all([
      getOllamaBaseUrl(),
      getOllamaCloudApiKey(),
    ]);

    if (!apiKey) {
      return NextResponse.json({ error: "Ollama Cloud API key not configured" }, { status: 500 });
    }

    const models = [model, DEFAULT_MODEL].filter(Boolean) as string[];

    let lastError = "";
    for (const m of models) {
      try {
        const res = await fetch(`${endpoint}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: m,
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text },
                  { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } },
                ],
              },
            ],
            max_tokens: 400,
          }),
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          lastError = `HTTP ${res.status}: ${errText.slice(0, 200)}`;
          continue;
        }

        const data = await res.json();
        const msg = data?.choices?.[0]?.message;
        const content = (msg?.content || "").trim();

        if (content) {
          return NextResponse.json({
            status: "ok",
            model: m,
            description: content,
          });
        }

        // Model returned empty content (reasoning-only) — try next model.
        lastError = `Model ${m} returned empty content`;
      } catch (err: any) {
        lastError = err.message || "vision request failed";
      }
    }

    return NextResponse.json(
      { error: `Vision failed: ${lastError}` },
      { status: 502 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Vision analysis failed" },
      { status: 500 }
    );
  }
}
