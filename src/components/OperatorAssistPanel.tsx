"use client";

/**
 * OperatorAssistPanel — overlay panel for the Warden.
 *
 * Renders inside a fixed overlay (same pattern as EmailPanel, Social, etc).
 * User sets a goal, picks an LLM, toggles ON/OFF.
 * When ON, the Warden watches the chat and re-prompts Smyth when it stalls.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Shield,
  ShieldCheck,
  ShieldOff,
  Power,
  PowerOff,
  Send,
  Loader2,
  AlertCircle,
  Zap,
  Settings,
  X,
} from "lucide-react";

interface Decision {
  action: "no_op" | "continue" | "answer_dialog" | "notify_user" | "abort";
  reason: string;
  confidence: number;
  suggestedPrompt?: string;
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
  policy: {
    tick_interval_ms: number;
    max_auto_continues: number;
    spend_cap_usd: number;
  };
  llm?: {
    model: string;
    pool?: string;
  };
  decisions: Decision[];
}

const ACTION_COLORS: Record<string, string> = {
  no_op: "text-muted",
  continue: "text-emerald-400",
  answer_dialog: "text-blue-400",
  notify_user: "text-amber-400",
  abort: "text-red-400",
};

const ACTION_DOTS: Record<string, string> = {
  no_op: "bg-muted",
  continue: "bg-emerald-400",
  answer_dialog: "bg-blue-400",
  notify_user: "bg-amber-400",
  abort: "bg-red-400",
};

const LLM_PRESETS = [
  // 2026-09-02: OmniRoute is dead. Switched to Ollama Cloud models.
  { model: "gpt-oss:20b", pool: "machine", label: "Fast (recommended)", description: "Lightweight, fast, low token burn" },
  { model: "kimi-k2.7-code", pool: "machine", label: "Code (Pro)", description: "Code-optimized, tool-capable" },
  { model: "glm-5.2", pool: "machine", label: "Deep Reasoning", description: "1M context, complex tasks" },
  { model: "custom", pool: "custom", label: "Custom API", description: "Your own OpenAI/Anthropic/etc." },
];

export default function OperatorAssistPanel({
  operatorSessionId,
  onSessionIdChange,
  chatSessionId,
  messages,
  onInjection,
  onClose,
}: {
  operatorSessionId: string | null;
  onSessionIdChange: (id: string | null) => void;
  chatSessionId: string | null;
  messages: { role: string; content: string; timestamp?: number }[];
  onInjection?: (prompt: string, reply: string, model?: string) => void;
  onClose?: () => void;
}) {
  const [goal, setGoal] = useState("");
  const [status, setStatus] = useState<EngagementStatus | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [manualPrompt, setManualPrompt] = useState("");
  const [injecting, setInjecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [llmPreset, setLlmPreset] = useState(0);
  const [customEndpoint, setCustomEndpoint] = useState("");
  const [customApiKey, setCustomApiKey] = useState("");
  const [customModel, setCustomModel] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onInjectionRef = useRef(onInjection);
  useEffect(() => { onInjectionRef.current = onInjection; }, [onInjection]);

  // Sync running state from parent
  useEffect(() => {
    setIsRunning(!!operatorSessionId);
  }, [operatorSessionId]);

  // Poll status when running
  useEffect(() => {
    if (!operatorSessionId) {
      setStatus(null);
      return;
    }

    const es = new EventSource(`/api/operator/events?sessionId=${operatorSessionId}`);
    es.addEventListener("injection", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data.success && onInjectionRef.current) {
          onInjectionRef.current(data.prompt, data.reply, data.model);
        }
      } catch {}
    });

    const fetchStatus = async () => {
      try {
        const res = await fetch(`/api/operator/status?sessionId=${operatorSessionId}`, { cache: "no-store" });
        if (!res.ok) {
          if (res.status === 404) {
            onSessionIdChange(null);
            setStatus(null);
            setIsRunning(false);
            return;
          }
          throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json();
        setStatus(data);
        setError(null);
        if (data.status !== "running") {
          setIsRunning(false);
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        }
      } catch (e: any) {
        setError(e.message);
      }
    };

    fetchStatus();
    pollRef.current = setInterval(fetchStatus, 3000);
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      es.close();
    };
  }, [operatorSessionId, onSessionIdChange]);

  const handleToggle = useCallback(async () => {
    if (isRunning) {
      // STOP
      try {
        await fetch("/api/operator/stop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: operatorSessionId }),
        });
      } catch {}
      onSessionIdChange(null);
      setIsRunning(false);
      setStatus(null);
    } else {
      // START
      if (!goal.trim()) {
        setError("Enter a goal first");
        return;
      }
      setError(null);

      const preset = LLM_PRESETS[llmPreset];
      let llmConfig: any = { model: preset.model, pool: preset.pool };
      if (preset.pool === "custom") {
        if (!customEndpoint.trim() || !customApiKey.trim() || !customModel.trim()) {
          setError("Custom API requires endpoint, API key, and model name");
          return;
        }
        llmConfig = { model: customModel.trim(), pool: "custom", endpoint: customEndpoint.trim(), apiKey: customApiKey.trim() };
      }

      try {
        const res = await fetch("/api/operator/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            task: goal.trim(),
            // Pass the real chat session ID if we have one.  If the user
            // starts the Operator before sending a message, this will be
            // null — the tick loop will pick it up from the ingested state
            // once the user starts chatting.
            chatSessionId: chatSessionId || null,
            llm: llmConfig,
          }),
        });
        const data = await res.json();
        if (data.sessionId) {
          onSessionIdChange(data.sessionId);
          setIsRunning(true);
        } else {
          setError(data.error || "Failed to start");
        }
      } catch (e: any) {
        setError(e.message);
      }
    }
  }, [isRunning, goal, llmPreset, customEndpoint, customApiKey, customModel, operatorSessionId, onSessionIdChange]);

  const handleManualInject = useCallback(async () => {
    if (!manualPrompt.trim() || !operatorSessionId) return;
    setInjecting(true);
    try {
      // Build a compact history from the current messages array
      const history = messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .slice(-20) // last 20 messages for context
        .map((m) => ({ role: m.role, content: m.content }));
      // Use the streaming endpoint for full multi-step agent support
      const res = await fetch("/api/agent/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: manualPrompt.trim(),
          sessionId: chatSessionId || undefined,
          history,
          routeMode: "auto",
        }),
      });
      if (res.ok && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let finalReply = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const event = JSON.parse(line.slice(6).trim());
              if (event.type === "complete") finalReply = event.reply || "";
            } catch {}
          }
        }
        if (onInjectionRef.current) {
          onInjectionRef.current(manualPrompt.trim(), finalReply, "stream");
        }
        setManualPrompt("");
      }
    } catch {}
    setInjecting(false);
  }, [manualPrompt, operatorSessionId, chatSessionId, messages]);

  const continuesUsed = status?.autoContinuesUsed || 0;
  const maxContinues = status?.policy?.max_auto_continues || 5;
  const spendSoFar = status?.spendSoFarUsd || 0;
  const spendCap = status?.policy?.spend_cap_usd || 5;
  const lastDecision = status?.decisions?.[status.decisions.length - 1];

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-3 bg-surface border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Shield size={18} className="text-accent" />
          <span className="font-sans font-semibold text-sm text-foreground">Operator Assist</span>
          {isRunning && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-[10px] font-medium text-emerald-400">
              <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
              ON
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onClose && (
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
              <X size={18} />
            </button>
          )}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">

        {/* Status row (when running) */}
        {isRunning && status && (
          <div className="flex flex-col gap-2">
            <div className="flex gap-3 text-[11px]">
              <div className="flex items-center gap-1.5">
                <Zap size={12} className={continuesUsed > 0 ? "text-emerald-400" : "text-muted"} />
                <span className="text-muted">
                  <span className={continuesUsed > 0 ? "text-emerald-400 font-medium" : ""}>{continuesUsed}</span>
                  /{maxContinues} continues
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-muted">
                  ${spendSoFar.toFixed(2)}/${spendCap}
                </span>
              </div>
              {status.llm?.model && (
                <div className="flex items-center gap-1.5" title="LLM powering the Operator">
                  <Settings size={10} className="text-muted" />
                  <span className="text-muted truncate max-w-[120px]">{status.llm.model}</span>
                </div>
              )}
            </div>
            {status.status === "running" && (
              <div className="flex items-center gap-1.5 text-[11px]">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-emerald-400">watching</span>
              </div>
            )}
          </div>
        )}

        {/* Goal Input */}
        <div className="flex flex-col gap-2">
          <label className="text-[11px] text-foreground/70 font-medium">Task Goal</label>
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="What should Smyth accomplish? The operator will keep it moving until it's done."
            className="w-full bg-muted-bg border border-border rounded-md px-3 py-2 text-[12px] text-foreground placeholder:text-muted outline-none focus:border-accent transition-colors min-h-[80px] resize-none"
            disabled={isRunning}
          />
        </div>

        {/* Model selector */}
        <div className="flex flex-col gap-2">
          <label className="text-[11px] text-foreground/70 font-medium">LLM Backend</label>
          <div className="flex flex-col gap-1.5">
            {LLM_PRESETS.map((p, i) => (
              <button
                key={i}
                onClick={() => !isRunning && setLlmPreset(i)}
                disabled={isRunning}
                className={`flex items-center gap-2 w-full text-left px-3 py-2 rounded-md text-[11px] border transition-colors ${
                  llmPreset === i
                    ? "bg-accent/10 border-accent/30 text-accent"
                    : "bg-muted-bg border-border text-muted hover:bg-muted-bg/80 hover:text-foreground"
                } ${isRunning ? "opacity-60 cursor-not-allowed" : ""}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${llmPreset === i ? "bg-accent" : "bg-muted"}`} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{p.label}</div>
                  <div className="text-[9.5px] text-muted truncate">{p.description}</div>
                </div>
              </button>
            ))}
          </div>

          {/* Custom API fields */}
          {LLM_PRESETS[llmPreset]?.pool === "custom" && (
            <div className="flex flex-col gap-1.5 mt-1 pl-2 border-l border-border">
              <input
                value={customEndpoint}
                onChange={(e) => setCustomEndpoint(e.target.value)}
                placeholder="API endpoint (e.g. https://api.openai.com/v1/chat/completions)"
                disabled={isRunning}
                className="w-full bg-muted-bg border border-border rounded-md px-2.5 py-1.5 text-[11px] text-foreground placeholder:text-muted outline-none focus:border-accent transition-colors disabled:opacity-60"
              />
              <input
                value={customApiKey}
                onChange={(e) => setCustomApiKey(e.target.value)}
                placeholder="API key"
                type="password"
                disabled={isRunning}
                className="w-full bg-muted-bg border border-border rounded-md px-2.5 py-1.5 text-[11px] text-foreground placeholder:text-muted outline-none focus:border-accent transition-colors disabled:opacity-60"
              />
              <input
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                placeholder="Model name (e.g. gpt-4o-mini)"
                disabled={isRunning}
                className="w-full bg-muted-bg border border-border rounded-md px-2.5 py-1.5 text-[11px] text-foreground placeholder:text-muted outline-none focus:border-accent transition-colors disabled:opacity-60"
              />
            </div>
          )}
        </div>

        {/* Toggle Button */}
        <button
          onClick={handleToggle}
          className={`flex items-center justify-center gap-2 w-full py-2.5 rounded-md text-sm font-medium transition-colors ${
            isRunning
              ? "bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30"
              : "bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
          }`}
        >
          {isRunning ? <PowerOff size={16} /> : <Power size={16} />}
          {isRunning ? "Stop Operator" : "Start Operator"}
        </button>

        {/* Last decision (when running) */}
        {isRunning && lastDecision && (
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-foreground/70 font-medium">Last Decision</label>
            <div className="flex items-start gap-2 text-[11px] bg-muted-bg/50 rounded-md px-3 py-2">
              <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${ACTION_DOTS[lastDecision.action]}`} />
              <div className="min-w-0">
                <span className={`font-medium ${ACTION_COLORS[lastDecision.action]}`}>
                  {lastDecision.action}
                </span>
                <span className="text-muted ml-1.5">
                  {lastDecision.reason?.slice(0, 100)}
                </span>
                {lastDecision.suggestedPrompt && (
                  <div className="text-emerald-400/70 italic mt-0.5 truncate">
                    → &quot;{lastDecision.suggestedPrompt}&quot;
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Manual inject (when running) */}
        {isRunning && (
          <div className="flex flex-col gap-2">
            <label className="text-[11px] text-foreground/70 font-medium">Manual Override</label>
            <div className="flex gap-1.5">
              <input
                value={manualPrompt}
                onChange={(e) => setManualPrompt(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleManualInject()}
                placeholder="Type a prompt to inject now..."
                className="flex-1 bg-muted-bg border border-border rounded-md px-2.5 py-1.5 text-[11px] text-foreground placeholder:text-muted outline-none focus:border-accent transition-colors"
              />
              <button
                onClick={handleManualInject}
                disabled={injecting || !manualPrompt.trim()}
                className="bg-accent/10 hover:bg-accent/20 text-accent border border-accent/30 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {injecting ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
              </button>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center gap-1.5 text-[11px] text-red-400 bg-red-400/10 rounded-md px-3 py-2">
            <AlertCircle size={12} />
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
