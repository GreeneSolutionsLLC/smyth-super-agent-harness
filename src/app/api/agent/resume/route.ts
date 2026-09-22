/**
 * POST /api/agent/resume
 *
 * Resume a paused agent loop from its on-disk checkpoint.
 *
 * Body: { sessionId, message? }
 *
 * The stream route saves loopState + history after every tool turn. When a
 * request hits the time wall, the state is left as "paused". This route loads
 * that checkpoint, injects a "resume from where you left off" system message,
 * and streams the rest of the loop exactly like the main stream route.
 *
 * If no checkpoint exists (or it's marked complete), returns 404 with a clear
 * error so the UI can fall back to a normal new-message flow.
 *
 * 2026-08-09
 */

import { NextRequest } from "next/server";
import { loadCheckpoint, checkpointSummary, CheckpointData } from "@/lib/checkpoint";
import { buildLoopSystemMessage } from "@/lib/agent-loop";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { sessionId, message } = body || {};

    if (!sessionId || typeof sessionId !== "string") {
      return Response.json({ error: "sessionId is required" }, { status: 400 });
    }

    const ck: CheckpointData | null = loadCheckpoint(sessionId);
    if (!ck) {
      return Response.json({ error: "no checkpoint found for this session", resumable: false }, { status: 404 });
    }
    if (ck.meta.status === "complete") {
      return Response.json({ error: "workflow already complete — not resumable", resumable: false }, { status: 409 });
    }

    // Build a resume directive telling the loop to pick up where it stopped.
    const resumeNote = message && typeof message === "string"
      ? message
      : `Continue the task from where you left off. ${checkpointSummary(ck)} Do NOT restart completed steps; resume from the next incomplete step.`;

    // Reconstruct the messages the loop will run with: the original history
    // plus the resume directive as the new user turn.
    const history = Array.isArray(ck.history) ? ck.history : [];
    const messages = [
      ...history,
      { role: "user" as const, content: resumeNote },
    ];

    const loopState = ck.loopState;
    // The loop picks up at loopState.turn (it iterates from loopState.turn to
    // maxTurns), so a persisted mid-chain state resumes exactly at the right
    // turn. Mark it running again.
    loopState.phase = loopState.phase === "done" || loopState.phase === "done_polling"
      ? loopState.phase
      : "planning";

    const loopDirective = buildLoopSystemMessage(loopState);

    // Mirror the stream route's SSE framing so the UI treats this like any
    // other agent response.
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (obj: unknown) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
          } catch {
            /* client gone */
          }
        };

        send({ type: "phase", phase: "resuming", turn: loopState.turn, checkpoint: checkpointSummary(ck) });

        try {
          const { runDeterministicLoop } = await import("@/lib/agent-loop");
          await runDeterministicLoop({
            messages,
            loopState,
            loopDirective,
            maxTurns: 60,
            maxTotalMs: 1_200_000,
            timeoutMs: 120_000,
            onPhase: (phase, data) => send({ type: "phase", phase, ...(data || {}) }),
            onToolCall: (tool, args) => send({ type: "tool", tool, args }),
            onToolResult: (tool, result, success) => send({ type: "tool_result", tool, result, success }),
            onComplete: (reply, tokens) => send({ type: "complete", reply, tokens, resumed: true, turn: loopState.turn }),
            onError: (error) => send({ type: "error", error }),
          });
        } catch (e: any) {
          send({ type: "error", error: e?.message || "resume loop failed" });
        } finally {
          try { controller.close(); } catch { /* already closed */ }
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e: any) {
    return Response.json({ error: e?.message || "resume failed" }, { status: 500 });
  }
}
