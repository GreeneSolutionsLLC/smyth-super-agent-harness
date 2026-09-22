import { NextRequest, NextResponse } from "next/server";

// ── OpenCut eval bridge: server → browser ──
//
// The server-side opencut_* tool handlers (in tools.ts) need to eval JS
// in the OpenCut iframe, but the iframe is client-side. This route acts
// as a bridge:
//
// 1. Browser (VideographyPanel) opens a long-poll connection: GET /api/opencut/eval?poll=1
// 2. Server-side tools POST /api/opencut/eval with { expr } → gets queued
// 3. Browser receives the expr via poll, executes via postMessage, POSTs result back
// 4. Server-side tool gets the result and returns it
//
// This is a simple in-memory queue. Only one browser connection is expected.

interface PendingRequest {
  id: string;
  expr: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

const pendingQueue: PendingRequest[] = [];
const waitingPollers: Array<{ resolve: (req: PendingRequest) => void }> = [];
const resultMap = new Map<string, unknown>();

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const isPoll = url.searchParams.get("poll") === "1";

  if (!isPoll) {
    return NextResponse.json({ status: "ok", pending: pendingQueue.length });
  }

  // Long-poll: wait for a pending request from the server side
  return new Promise<Response>((resolve) => {
    const timeout = setTimeout(() => {
      // No request came in 25s — return empty to keep the poll alive
      resolve(new Response(JSON.stringify({ empty: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    }, 25000);

    // Check if there's already a pending request
    if (pendingQueue.length > 0) {
      clearTimeout(timeout);
      const req = pendingQueue.shift()!;
      resolve(new Response(JSON.stringify({ id: req.id, expr: req.expr }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
      return;
    }

    // Wait for a request
    waitingPollers.push({
      resolve: (req: PendingRequest) => {
        clearTimeout(timeout);
        resolve(new Response(JSON.stringify({ id: req.id, expr: req.expr }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      },
    });
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { expr, result, id } = body;

  // If `result` is present, this is a browser posting back a result
  if (typeof id === "string" && result !== undefined) {
    resultMap.set(id, result);
    return NextResponse.json({ ok: true });
  }

  // Otherwise, this is a server-side tool requesting an eval
  if (typeof expr !== "string") {
    return NextResponse.json({ error: "Missing expr" }, { status: 400 });
  }

  const evalId = `eval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return new Promise<Response>((resolve) => {
    const timeout = setTimeout(() => {
      // Remove from queue if still there
      const idx = pendingQueue.findIndex((r) => r.id === evalId);
      if (idx >= 0) pendingQueue.splice(idx, 1);
      resolve(NextResponse.json({ error: "Eval timed out — browser not connected", id: evalId }, { status: 504 }));
    }, 30000);

    const request: PendingRequest = {
      id: evalId,
      expr,
      resolve: (value) => {
        clearTimeout(timeout);
        resolve(NextResponse.json({ ok: true, id: evalId, value }));
      },
      reject: (error) => {
        clearTimeout(timeout);
        resolve(NextResponse.json({ ok: false, id: evalId, error: error.message }, { status: 500 }));
      },
      timeout,
    };

    // If a poller is waiting, deliver immediately
    const poller = waitingPollers.shift();
    if (poller) {
      // We need to wait for the result to come back from the browser
      // Set up a listener for the result
      const checkResult = setInterval(() => {
        if (resultMap.has(evalId)) {
          clearInterval(checkResult);
          const value = resultMap.get(evalId);
          resultMap.delete(evalId);
          clearTimeout(timeout);
          resolve(NextResponse.json({ ok: true, id: evalId, value }));
        }
      }, 100);

      // Send the request to the poller
      poller.resolve(request);
    } else {
      // Queue it for the next poll
      pendingQueue.push(request);

      // Also set up result listener
      const checkResult = setInterval(() => {
        if (resultMap.has(evalId)) {
          clearInterval(checkResult);
          const value = resultMap.get(evalId);
          resultMap.delete(evalId);
          clearTimeout(timeout);
          resolve(NextResponse.json({ ok: true, id: evalId, value }));
        }
      }, 100);
    }
  });
}