"use client";

// Wraps /api/agent/stream. Streams SSE events, accumulating the agent's reply
// text and invoking callbacks for phase/stream/chunk/complete. Used by the
// design studio's Smyth chat, prompt assist, and vision iteration.

export interface AgentStreamHandlers {
  onPhase?: (phase: string) => void;
  onText?: (accumulated: string) => void;
  onComplete?: (reply: string) => void;
  onError?: (error: string) => void;
}

export interface AgentStreamBody {
  message: string;
  history?: { role: string; content: string }[];
  image?: { base64: string; filename?: string };
  routeMode?: string;
  model?: string;
  /** canvaMode: preload Canva MCP tools and use a longer per-call timeout */
  canvaMode?: boolean;
}

export function streamAgent(
  body: AgentStreamBody,
  handlers: AgentStreamHandlers = {},
  timeoutMs = 120000
): { promise: Promise<string>; abort: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const promise = new Promise<string>((resolve, reject) => {
    fetch("/api/agent/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "design-studio", ...body }),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let finalReply = "";

        const finish = () => {
          clearTimeout(timer);
          if (finalReply) {
            handlers.onComplete?.(finalReply);
            resolve(finalReply);
          } else {
            const err = "Agent returned no output";
            handlers.onError?.(err);
            reject(new Error(err));
          }
        };

        const pump = (): Promise<void> =>
          reader.read().then(({ done, value }) => {
            if (done) {
              finish();
              return;
            }
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split("\n");
            buf = lines.pop() || "";
            for (const line of lines) {
              const t = line.trim();
              if (!t.startsWith("data:")) continue;
              let evt: any;
              try {
                evt = JSON.parse(t.slice(5).trim());
              } catch {
                continue;
              }
              if (evt.type === "phase" && evt.phase) handlers.onPhase?.(evt.phase);
              if (evt.type === "error") {
                clearTimeout(timer);
                const msg = evt.error || "agent error";
                handlers.onError?.(msg);
                reject(new Error(msg));
                return;
              }
              if (evt.type === "complete" && evt.reply) {
                finalReply = evt.reply;
              }
            }
            return pump();
          });

        try {
          await pump();
        } catch (e: any) {
          clearTimeout(timer);
          const msg = e?.name === "AbortError" ? "Request timed out" : e?.message || "stream failed";
          handlers.onError?.(msg);
          reject(new Error(msg));
        }
      })
      .catch((e: any) => {
        clearTimeout(timer);
        const msg = e?.name === "AbortError" ? "Request timed out" : e?.message || "network error";
        handlers.onError?.(msg);
        reject(new Error(msg));
      });
  });

  return { promise, abort: () => { clearTimeout(timer); controller.abort(); } };
}
