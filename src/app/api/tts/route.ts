import { NextRequest, NextResponse } from "next/server";

// ── Hume TTS API Route ──
// Uses Hume's Octave TTS to generate expressive speech.
// POST /api/tts with { text, voice?, description?, speed? }
//
// Default voice: Deep Male Conversational Voice (Smyth's voice)
// Voices with IDs bypass description-based generation for faster, more consistent output.

const API_KEY = process.env.HUME_API_KEY || "";
const SECRET_KEY = process.env.HUME_SECRET_KEY || "";
const BASE_URL = "https://api.hume.ai/v0/tts";

// Voice catalog — use name for lookup, include Hume IDs for guaranteed consistency
const VOICES: Record<string, { name: string; id?: string; provider: string }> = {
  // ── Smyth's default ──
  smyth:       { name: "Deep Male Conversational Voice", id: "9c5a3d53-4a8c-4fa2-adad-8e61a830d0e8", provider: "HUME_AI" },
  
  // ── Other masculine/empathetic options ──
  sebastian:   { name: "Sebastian Lockwood", id: "522fc367-1fbd-4ea7-a27a-3e8c49b2f19f", provider: "HUME_AI" },
  donovan:     { name: "Donovan Sinclair", id: "f042c0be-bafe-4f87-88e7-1dc3c569e9ff", provider: "HUME_AI" },
  comforting:  { name: "Comforting Male Conversationalist", id: "99d2cb9c-3e34-4b9b-83b4-2d9b8a37e531", provider: "HUME_AI" },
  brooding:    { name: "Brooding Intellectual Man", id: "15f594d3-c8b8-4e98-8617-4ec7e5bf6e1a", provider: "HUME_AI" },
  inspiring:   { name: "Inspiring Older Guy", id: "de314f2f-b5e2-4c88-8b25-2e3db8e0b477", provider: "HUME_AI" },
  terrence:    { name: "Terrence Bentley", id: "7f633ac4-0fc5-4e6a-b8c4-31e7f6a6c6e1", provider: "HUME_AI" },
  tough:       { name: "Tough Guy", id: "6a42908a-d7c4-4daa-a4e5-c8e5f5a6f5e7", provider: "HUME_AI" },
  
  // ── Dynamic voice (no preset, description-only) ──
  dynamic:     { name: "", provider: "HUME_AI" },
};

// Default description for Smyth's personality when using dynamic voice
const SMYTH_DESCRIPTION = "Deep, resonant male voice. Calm authority with genuine warmth. Direct and precise, never robotic. Conversational and empathetic — like talking to someone who actually listens. Slightly gravelly, confident without being cold.";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text, voice: voiceName, description, speed } = body;

    if (!text?.trim()) {
      return NextResponse.json({ error: "Text is required" }, { status: 400 });
    }
    if (text.length > 5000) {
      return NextResponse.json({ error: "Text too long (max 5000 chars)" }, { status: 400 });
    }
    if (!API_KEY) {
      return NextResponse.json(
        { error: "HUME_API_KEY not configured" },
        { status: 500 }
      );
    }

    // Build utterance
    const utterance: Record<string, any> = { text };

    // Resolve voice — default to Smyth's voice
    const voiceKey = (voiceName || "smyth").toLowerCase();
    const voice = VOICES[voiceKey];

    if (voice && voice.name) {
      // Named voice from catalog
      utterance.voice = { name: voice.name, provider: voice.provider };
      // Use provided description or voice-specific default
      utterance.description = description || SMYTH_DESCRIPTION;
    } else {
      // Dynamic voice — description acts as the voice prompt
      utterance.description = description || SMYTH_DESCRIPTION;
    }

    if (speed && speed >= 0.25 && speed <= 3) {
      utterance.speed = speed;
    }

    const response = await fetch(BASE_URL, {
      method: "POST",
      headers: {
        "X-Hume-Api-Key": API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        utterances: [utterance],
        format: { type: "wav" },
        num_generations: 1,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[tts] Hume API error:", response.status, errText.slice(0, 200));
      // If rate limited, return a helpful error
      if (response.status === 429 || errText.includes("Rate limit")) {
        return NextResponse.json(
          { error: "Rate limited — Hume TTS quota exceeded. Wait a moment and try again.", status: 429 },
          { status: 429 }
        );
      }
      return NextResponse.json(
        { error: "TTS generation failed", details: errText, status: response.status },
        { status: response.status }
      );
    }

    const data = await response.json();
    const gen = data.generations?.[0];

    if (!gen?.audio) {
      return NextResponse.json({ error: "No audio in response" }, { status: 500 });
    }

    const audioBuffer = Buffer.from(gen.audio, "base64");

    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": audioBuffer.length.toString(),
        "Cache-Control": "no-cache",
      },
    });
  } catch (err: any) {
    console.error("[tts] Error:", err.message);
    return NextResponse.json(
      { error: "TTS generation failed", details: err.message },
      { status: 500 }
    );
  }
}

export const maxDuration = 120;