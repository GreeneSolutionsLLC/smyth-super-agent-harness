/**
 * POST /api/agent/continue
 *
 * Continues an existing chat session with a new user message. This is the
 * integration point for the Operator (Warden) to inject a continuation prompt
 * without spawning a new session.
 *
 * Body: { sessionId, prompt }
 *   - sessionId: the chat session ID to continue
 *   - prompt: the continuation message to inject
 *
 * Returns: 200 OK on success. The actual agent response is streamed via the
 * existing /api/agent/stream endpoint; this endpoint just kicks it off.
 *
 * For v1: we re-use the same path as /api/agent/stream but inject a "system"
 * continuation message into the existing session's history. Since the existing
 * /api/agent/stream doesn't take a sessionId (it always creates a new one), we
 * need a slight variation.
 *
 * v1 approach: just POST the prompt as a normal /api/agent call but with a
 * sessionId header so the client can correlate. The "continuation" is just a
 * new user message. The session history is preserved by the client (page.tsx
 * already caches messages to localStorage and reloads them on next start).
 *
 * For real session continuity we'd need server-side session storage. v1 keeps
 * it client-side and trusts the page to merge the continuation into its
 * existing message list via a custom event.
 */

import { NextRequest, NextResponse } from "next/server";
import { routeRequest } from "@/lib/pool-router";
import { compactContext } from "@/lib/context-compactor";
import { createToolDefinitions } from "@/lib/tools";
import { SMYTH_SYSTEM_PROMPT } from "@/lib/smyth-identity";

export const maxDuration = 600;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId, prompt, history } = body || {};

    if (!sessionId || typeof sessionId !== "string") {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }
    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }
    if (!Array.isArray(history)) {
      return NextResponse.json({ error: "history must be an array" }, { status: 400 });
    }

    // Build the messages array: history + new continuation prompt
    const messages = [
      { role: "system", content: SMYTH_SYSTEM_PROMPT },
      ...history,
      { role: "user", content: prompt },
    ];

    // 2026-09-04: maetryxx/OmniRoute is dead. Continue now uses the machine
    // pool (Ollama Cloud/Pro/Cloudflare/NVIDIA/Local) instead of trying the
    // defunct OmniRoute endpoint first.
    const model = await routeRequest("machine", false, false);
    if (!model) {
      return NextResponse.json({ error: "no model available" }, { status: 503 });
    }

    const compacted = await compactContext(messages);
    const { openaiTools, handlerMap } = await createToolDefinitions();

    const res = await fetch(model.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${model.apiKey}`,
      },
      body: JSON.stringify({
        model: model.modelId,
        messages: compacted.messages,
        tools: openaiTools,
        tool_choice: "auto",
        max_tokens: 8192,
        stream: false,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `model returned ${res.status}`, details: text.slice(0, 200) }, { status: 502 });
    }

    const data = await res.json();
    const reply = data?.choices?.[0]?.message?.content || "";
    const toolCalls = data?.choices?.[0]?.message?.tool_calls || [];

    // Execute any tool calls (best-effort, single round)
    let finalReply = reply;
    for (const call of toolCalls) {
      const handler = handlerMap.get(call.function?.name);
      if (handler) {
        try {
          const args = JSON.parse(call.function?.arguments || "{}");
          const result = await handler(args);
          finalReply += `\n\n[${call.function.name}]: ${result.slice(0, 500)}`;
        } catch (e: any) {
          finalReply += `\n\n[${call.function.name} error: ${e.message?.slice(0, 100)}]`;
        }
      }
    }

    return NextResponse.json({
      sessionId,
      reply: finalReply,
      model: model.modelId,
      pool: model.pool,
      tokens: data?.usage?.total_tokens || 0,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
