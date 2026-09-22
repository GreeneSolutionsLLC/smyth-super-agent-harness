/**
 * GET /api/operator/events?sessionId=X
 *
 * Server-Sent Events stream for one Operator engagement. The page opens
 * an EventSource on this and receives tick/decision/injection events in
 * real time.
 */

import { NextRequest } from "next/server";
import { subscribe } from "@/lib/operator/event-bus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return new Response("sessionId query param required", { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: { type: string; data: any }) => {
        try {
          const payload = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
          controller.enqueue(encoder.encode(payload));
        } catch { /* stream closed */ }
      };

      // Send initial hello so the client knows the connection is live
      send({ type: "status", data: { connected: true, sessionId, timestamp: new Date().toISOString() } });

      // Subscribe to events
      const unsubscribe = subscribe(sessionId, (event) => {
        send({ type: event.type, data: event.data });
      });

      // Heartbeat every 15s to keep the connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`));
        } catch { /* stream closed */ }
      }, 15_000);

      // Cleanup on disconnect
      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        try { controller.close(); } catch {}
      };

      // Note: Next.js doesn't expose the request abort signal in this style;
      // we rely on the controller's close handling and the heartbeat to detect dead connections.
      request.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
