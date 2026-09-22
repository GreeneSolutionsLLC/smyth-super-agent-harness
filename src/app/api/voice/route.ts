import { NextRequest } from "next/server";
import { routeRequest, recordSuccess, clearAllCooldowns, selectLocalFallback, type RouteMode } from "@/lib/pool-router";

/**
 * /api/voice — Lean voice endpoint using the same pool-router as everything else.
 * No tools, no multi-turn, no JSON-parsing tool fallbacks.
 * Just: pick a model → send messages → return reply.
 *
 * ~2-4s faster than /api/agent/stream for voice conversations.
 *
 * POST /api/voice
 *   { message, history?, routeMode? }
 * Returns: SSE stream with { type: "complete", reply: "..." }
 */

export const maxDuration = 120;

function sendEvent(encoder: TextEncoder, data: Record<string, any>): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
}

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();
  const body = await request.json();
  const { message, history, routeMode: modeParam } = body;

  if (!message?.trim()) {
    return new Response("Message is required", { status: 400 });
  }

  const mode: RouteMode = (modeParam as RouteMode) || "auto";

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Pick a model from the pool
        let model = await routeRequest(mode, false, false);
        if (!model) {
          clearAllCooldowns();
          model = await routeRequest(mode, false, false);
        }
        if (!model) {
          model = await selectLocalFallback();
        }
        if (!model) {
          controller.enqueue(sendEvent(encoder, { type: "error", error: "All models exhausted" }));
          controller.close();
          return;
        }

        // Build messages — no tools, no system prompt override (pool handles identity)
        const messages: any[] = [];

        if (Array.isArray(history)) {
          for (const m of history) {
            if (m.role && m.content) {
              messages.push({ role: m.role, content: m.content });
            }
          }
        }

        messages.push({ role: "user", content: message });

        // Single call — no tool loop, no retry spam
        const res = await fetch(model.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${model.apiKey}`,
          },
          body: JSON.stringify({
            model: model.modelId,
            messages,
            max_tokens: 1024,
            temperature: 0.7,
          }),
          signal: AbortSignal.timeout(30_000),
        });

        if (!res.ok) {
          const errText = await res.text();
          // Record failure so the pool routes around it
          try {
            const { recordFailure } = await import("@/lib/pool-router");
            const statusMatch = String(res.status).match(/\d{3}/);
            const statusCode = statusMatch ? parseInt(statusMatch[0]) : 500;
            recordFailure(model!, statusCode, errText.slice(0, 200));
          } catch {}

          controller.enqueue(sendEvent(encoder, { type: "error", error: `Model returned ${res.status}` }));
          controller.close();
          return;
        }

        const data = await res.json();
        const reply = data?.choices?.[0]?.message?.content?.trim() || "";

        if (!reply) {
          controller.enqueue(sendEvent(encoder, { type: "error", error: "Empty response" }));
          controller.close();
          return;
        }

        // Record success
        const totalTokens = data?.usage?.total_tokens || 0;
        recordSuccess(model!, totalTokens);

        controller.enqueue(sendEvent(encoder, { type: "complete", reply, model: model.modelId, pool: model.pool }));
        controller.close();

      } catch (err: any) {
        if (err.name === "TimeoutError" || err.name === "AbortError") {
          controller.enqueue(sendEvent(encoder, { type: "error", error: "Request timed out" }));
        } else {
          controller.enqueue(sendEvent(encoder, { type: "error", error: err.message || "Unknown error" }));
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
