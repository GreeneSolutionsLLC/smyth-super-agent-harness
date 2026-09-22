"use client";

/**
 * OperatorStatus — small pill in the chat panel that shows what the
 * Operator (Warden) is doing. Polls /api/operator/status?sessionId=X
 * and shows recent decisions.
 *
 * Two states:
 *   - Idle (no engagement): nothing rendered
 *   - Active: pill + expandable list of recent decisions
 */

import { useEffect, useState, useRef } from "react";
import { Activity, ChevronDown, ChevronUp, Eye, EyeOff, Power } from "lucide-react";

interface Decision {
  action: "no_op" | "continue" | "answer_dialog" | "notify_user" | "abort";
  reason: string;
  confidence: number;
  suggestedPrompt?: string;
  dialogResponse?: string;
  notifiedMessage?: string;
  abortReason?: string;
  model?: string;
}

interface EngagementStatus {
  sessionId: string;
  chatSessionId: string;
  startedAt: string;
  status: "running" | "stopped" | "aborted" | "completed";
  stopReason?: string;
  spendSoFarUsd: number;
  autoContinuesUsed: number;
  policy: { tick_interval_ms: number; max_auto_continues: number; spend_cap_usd: number };
  decisions: Decision[];
}

const ACTION_COLORS: Record<Decision["action"], string> = {
  no_op: "text-muted",
  continue: "text-emerald-400 bg-emerald-400/10",
  answer_dialog: "text-blue-400 bg-blue-400/10",
  notify_user: "text-amber-400 bg-amber-400/10",
  abort: "text-red-400 bg-red-400/10",
};

const ACTION_LABELS: Record<Decision["action"], string> = {
  no_op: "watching",
  continue: "continued",
  answer_dialog: "answered",
  notify_user: "notified",
  abort: "aborted",
};

export function OperatorStatus({
  operatorSessionId,
  onSessionIdChange,
  onInjection,
}: {
  operatorSessionId: string | null;
  onSessionIdChange: (id: string | null) => void;
  onInjection?: (prompt: string, reply: string, model?: string) => void;
}) {
  const [status, setStatus] = useState<EngagementStatus | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep onInjection in a ref so the SSE effect doesn't reopen the connection
  // on every render of the parent.
  const onInjectionRef = useRef(onInjection);
  useEffect(() => { onInjectionRef.current = onInjection; }, [onInjection]);

  useEffect(() => {
    if (!operatorSessionId) {
      setStatus(null);
      return;
    }

    // Subscribe to SSE for real-time injection events
    const es = new EventSource(`/api/operator/events?sessionId=${operatorSessionId}`);
    es.addEventListener("injection", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data.success && onInjectionRef.current) {
          onInjectionRef.current(data.prompt, data.reply, data.model);
        }
      } catch {}
    });
    // Scheduled (delayed) injection — show as queued in the UI so the user
    // sees "waiting 45s for rate-limit to clear" before the prompt fires.
    es.addEventListener("scheduled", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        const fireAt = new Date(data.scheduledFor);
        console.log(`[operator] scheduled injection in ${data.delaySec}s (${data.prompt.slice(0, 60)}) — fires ${fireAt.toLocaleTimeString()}`);
      } catch {}
    });
    es.addEventListener("error", () => {
      // EventSource auto-reconnects; nothing to do
    });

    const fetchStatus = async () => {
      try {
        const res = await fetch(`/api/operator/status?sessionId=${operatorSessionId}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          if (res.status === 404) {
            // Engagement gone — clear it
            onSessionIdChange(null);
            setStatus(null);
            return;
          }
          throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json();
        setStatus(data);
        setError(null);
        if (data.status !== "running") {
          // Stop polling once engagement ends
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        }
      } catch (e: any) {
        setError(e.message);
      }
    };

    fetchStatus();
    pollRef.current = setInterval(fetchStatus, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      es.close();
    };
  }, [operatorSessionId, onSessionIdChange]);

  if (!operatorSessionId || !status) return null;

  const lastDecision = status.decisions[status.decisions.length - 1];
  const ageSec = lastDecision
    ? Math.max(0, Math.floor((Date.now() - new Date(status.startedAt).getTime()) / 1000))
    : 0;
  const lastTickLabel = lastDecision
    ? `${ACTION_LABELS[lastDecision.action]} · ${ageSec}s ago`
    : status.status === "running" ? "starting..." : status.status;

  const handleStop = async () => {
    if (!confirm("Stop the Operator engagement? It will not inject any more continuations.")) return;
    try {
      await fetch("/api/operator/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: operatorSessionId }),
      });
    } catch {}
  };

  return (
    <div className="border-b border-border bg-surface/40">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-2 text-xs hover:bg-muted-bg/50 transition-colors"
      >
        <Activity size={14} strokeWidth={1.5} className="text-accent shrink-0" />
        <span className={`px-1.5 py-0.5 rounded text-[10.5px] font-medium ${ACTION_COLORS[lastDecision?.action || "no_op"]}`}>
          {lastTickLabel}
        </span>
        <span className="text-muted">
          {status.autoContinuesUsed}/{status.policy.max_auto_continues} continues · ${status.spendSoFarUsd.toFixed(2)}/${status.policy.spend_cap_usd}
        </span>
        <span className="ml-auto flex items-center gap-1 text-muted">
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>
      {expanded && (
        <div className="px-4 pb-3 flex flex-col gap-2 max-h-64 overflow-y-auto">
          {error && <div className="text-xs text-red-400">Error: {error}</div>}
          <div className="text-[10.5px] text-muted">
            Session <span className="font-mono">{operatorSessionId.slice(0, 18)}</span> · started {new Date(status.startedAt).toLocaleTimeString()}
          </div>
          {status.decisions.length === 0 ? (
            <div className="text-xs text-muted italic">No decisions yet. First tick at +{status.policy.tick_interval_ms / 1000}s.</div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {status.decisions.slice().reverse().map((d, i) => (
                <div key={i} className="text-xs flex flex-col gap-0.5 border-l-2 border-border pl-2">
                  <div className="flex items-center gap-1.5">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${ACTION_COLORS[d.action]}`}>
                      {d.action}
                    </span>
                    <span className="text-[10px] text-muted">conf={d.confidence.toFixed(2)}</span>
                    {d.model && (
                      <span className="text-[10px] text-muted/70 font-mono" title="Model that produced this decision">
                        {d.model}
                      </span>
                    )}
                  </div>
                  <div className="text-muted text-[11px] leading-snug">{d.reason}</div>
                  {d.suggestedPrompt && (
                    <div className="text-[11px] text-emerald-400/80 italic">
                      → "{d.suggestedPrompt}"
                    </div>
                  )}
                  {d.dialogResponse && (
                    <div className="text-[11px] text-blue-400/80 italic">
                      → replied: "{d.dialogResponse}"
                    </div>
                  )}
                  {d.notifiedMessage && (
                    <div className="text-[11px] text-amber-400/80 italic">
                      → notify: {d.notifiedMessage}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {status.status === "running" && (
            <button
              onClick={handleStop}
              className="self-start flex items-center gap-1.5 text-[11px] text-red-400 hover:text-red-300 bg-red-400/10 hover:bg-red-400/20 px-2 py-1 rounded transition-colors"
            >
              <Power size={12} strokeWidth={1.5} />
              Stop engagement
            </button>
          )}
          {status.status !== "running" && (
            <div className="text-[11px] text-muted">
              Engagement {status.status}{status.stopReason ? `: ${status.stopReason}` : ""}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
