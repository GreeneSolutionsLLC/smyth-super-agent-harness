"use client";

import { useEffect, useRef } from "react";

// ── OpenCut eval bridge: browser side ──
//
// Polls /api/opencut/eval?poll=1 for pending eval requests from the server.
// When one arrives, forwards it to the OpenCut iframe via postMessage,
// waits for the result, and POSTs it back to /api/opencut/eval.
//
// This is the browser half of the server→iframe bridge. The server half
// is in /api/opencut/eval/route.ts.

export function useOpencutBridge(
  iframeRef: React.RefObject<HTMLIFrameElement | null>,
  enabled: boolean
) {
  const pendingEvals = useRef(new Map<string, { timeout: ReturnType<typeof setTimeout> }>());
  const polling = useRef(false);

  // Listen for eval results from the iframe
  useEffect(() => {
    if (!enabled) return;

    const handler = async (e: MessageEvent) => {
      const data = e.data;
      if (!data || typeof data !== "object" || data.type !== "opencut:eval-result") return;
      const { id, ok, value, error } = data;
      if (typeof id !== "string") return;

      // POST the result back to the server bridge
      try {
        await fetch("/api/opencut/eval", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id,
            result: ok ? { ok: true, value } : { ok: false, error },
          }),
        });
      } catch {
        // ignore — server may have timed out already
      }

      pendingEvals.current.delete(id);
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [enabled]);

  // Poll the server for pending eval requests
  useEffect(() => {
    if (!enabled || polling.current) return;
    polling.current = true;

    let cancelled = false;

    const poll = async () => {
      while (!cancelled) {
        try {
          const res = await fetch("/api/opencut/eval?poll=1", {
            signal: AbortSignal.timeout(30000),
          });
          if (!res.ok) {
            await new Promise((r) => setTimeout(r, 2000));
            continue;
          }
          const data = await res.json();
          if (data.empty || !data.id || !data.expr) continue;

          // Forward to iframe via postMessage
          const iframe = iframeRef.current;
          if (!iframe || !iframe.contentWindow) {
            // No iframe — POST error back
            await fetch("/api/opencut/eval", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                id: data.id,
                result: { ok: false, error: "OpenCut iframe not available" },
              }),
            });
            continue;
          }

          // Set a timeout for this eval
          const timeout = setTimeout(() => {
            pendingEvals.current.delete(data.id);
            fetch("/api/opencut/eval", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                id: data.id,
                result: { ok: false, error: "Eval timed out in iframe" },
              }),
            }).catch(() => {});
          }, 15000);

          pendingEvals.current.set(data.id, { timeout });

          // Send to iframe
          iframe.contentWindow.postMessage(
            { type: "opencut:eval", id: data.id, expr: data.expr },
            "*"
          );
        } catch (err) {
          // Network error or timeout — wait and retry
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    };

    poll();

    return () => {
      cancelled = true;
      polling.current = false;
    };
  }, [enabled, iframeRef]);
}