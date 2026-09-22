"use client";

import { useEffect, useRef } from "react";

const ECHO_VISION_PORT = 18790;
const POLL_INTERVAL = 2000;
const MAX_WAIT = 15000;

/**
 * EchoVisionDaemon — pre-warms the Echo Vision sidecar on UI boot.
 * Invisible component. Renders nothing. Spawns the Python HTTP daemon
 * on mount and keeps it alive for instant image analysis.
 */
export default function EchoVisionDaemon() {
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    // Session-level guard: only attempt once per page load, even if the
    // sidebar re-mounts this component on every state change.
    if (typeof window !== "undefined" && (window as any).__echoVisionTried) return;
    if (typeof window !== "undefined") (window as any).__echoVisionTried = true;

    let cancelled = false;

    async function ensureSidecar() {
      // Step 1: Check if already running (silent — absence is expected when
      // the sidecar isn't configured, so don't surface a console error)
      try {
        const res = await fetch(`http://127.0.0.1:${ECHO_VISION_PORT}/`);
        const data = await res.json();
        if (data.status === "ok") {
          console.log(`[EchoVision] Sidecar already running (pid ${data.pid})`);
          return;
        }
      } catch {
        // Not running yet, proceed to launch
      }

      // Step 2: Spawn the Python sidecar
      console.log("[EchoVision] Launching sidecar...");
      try {
        const resp = await fetch("/api/echovision/start", { method: "POST" });
        const data = await resp.json();
        if (data.stopPolling || data.status === "unavailable") {
          // Not configured on this machine — log once and stop.
          console.log("[EchoVision] Sidecar not configured; skipping image-analysis pre-warm.");
          return;
        }
        if (data.status !== "ok") {
          console.warn("[EchoVision] Spawn response not ok:", data);
        }
      } catch (err) {
        console.warn("[EchoVision] Spawn failed:", err);
        return; // don't keep retrying a failing spawn
      }

      // Step 3: Wait for it to come online
      const deadline = Date.now() + MAX_WAIT;
      while (Date.now() < deadline && !cancelled) {
        try {
          const res = await fetch(`http://127.0.0.1:${ECHO_VISION_PORT}/`);
          const data = await res.json();
          if (data.status === "ok") {
            console.log(`[EchoVision] Sidecar ready (pid ${data.pid})`);
            return;
          }
        } catch {
          // Still booting
        }
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
      }

      if (!cancelled) {
        console.warn("[EchoVision] Sidecar failed to start within timeout");
      }
    }

    ensureSidecar();

    return () => { cancelled = true; };
  }, []);

  return null;
}
