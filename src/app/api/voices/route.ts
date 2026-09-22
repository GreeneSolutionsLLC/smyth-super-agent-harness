// ── GET /api/voices — returns the available TTS voice catalog ──

export async function GET() {
  const voices = [
    { key: "smyth", name: "Deep Male Conversational Voice" },
    { key: "sebastian", name: "Sebastian Lockwood" },
    { key: "donovan", name: "Donovan Sinclair" },
    { key: "comforting", name: "Comforting Male Conversationalist" },
    { key: "brooding", name: "Brooding Intellectual Man" },
    { key: "inspiring", name: "Inspiring Older Guy" },
    { key: "terrence", name: "Terrence Bentley" },
    { key: "tough", name: "Tough Guy" },
    { key: "dynamic", name: "✨ Dynamic (generate per response)" },
  ];

  return Response.json({ voices });
}
