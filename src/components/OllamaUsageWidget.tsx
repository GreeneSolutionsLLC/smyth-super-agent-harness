"use client";

/**
 * OllamaUsageWidget — per-account live monitor + routing toggle
 *
 * Renders two gauges (Session, Weekly) for a single Ollama account
 * (cloud or pro). The widget is also a routing toggle: clicking it
 * sets the parent routing state to exclusive-this-account.
 *
 * Props:
 *   account        — "cloud" | "pro"
 *   label          — display name (e.g. "Ollama Cloud")
 *   active         — is this account currently the exclusive routing target?
 *   onSelect       — callback when user clicks the widget
 *   refreshTrigger — increment this after a chat turn to force a refresh
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, RefreshCw, AlertTriangle, Cloud, Sparkles } from "lucide-react";

type Account = "cloud" | "pro";

interface OllamaUsage {
  account: Account;
  fetchedAt: string;
  stale: boolean;
  source: "live" | "cache" | "store";
  session: { usage: number; isMaxed: boolean; models: Array<{ name: string; request_count: number }> };
  weekly: { usage: number; isMaxed: boolean; models: Array<{ name: string; request_count: number }> };
  activity: { cost: string; periodStart: string; periodEnd: string };
}

interface Props {
  account: Account;
  label: string;
  icon: "cloud" | "pro";   // lucide icon variant
  active: boolean;
  onSelect: () => void;
  refreshTrigger?: number;
  availableModels: Array<{ id: string; name: string }>;
  selectedModelId: string | null;   // null = "Routing Pool" (rotate across this key's models)
  onModelChange: (modelId: string | null) => void;
}

const POLL_INTERVAL_MS = 60_000;

function colorForUsage(usage: number): string {
  if (usage >= 0.91) return "bg-red-500";
  if (usage >= 0.71) return "bg-amber-500";
  if (usage >= 0.01) return "bg-emerald-500";
  return "bg-zinc-600";
}

function textColorForUsage(usage: number): string {
  if (usage >= 0.91) return "text-red-400";
  if (usage >= 0.71) return "text-amber-400";
  if (usage >= 0.01) return "text-emerald-400";
  return "text-zinc-500";
}

function pct(usage: number): string {
  return `${Math.round(usage * 100)}%`;
}

function Gauge({ label, usage, isMaxed }: { label: string; usage: number; isMaxed: boolean }) {
  const pctValue = Math.min(100, Math.max(0, usage * 100));
  const barColor = colorForUsage(usage);
  const textColor = textColorForUsage(usage);
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-muted font-mono uppercase tracking-wide">{label}</span>
        <span className={`font-mono font-semibold ${textColor}`}>
          {pct(usage)}
          {isMaxed && <span className="ml-1 text-red-400">●</span>}
        </span>
      </div>
      <div className="h-1.5 w-full bg-zinc-800 rounded-sm overflow-hidden">
        <div
          className={`h-full ${barColor} transition-all duration-500`}
          style={{ width: `${pctValue}%` }}
        />
      </div>
    </div>
  );
}

export default function OllamaUsageWidget({
  account,
  label,
  icon,
  active,
  onSelect,
  refreshTrigger = 0,
  availableModels,
  selectedModelId,
  onModelChange,
}: Props) {
  const [data, setData] = useState<OllamaUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState<number>(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchUsage = useCallback(async () => {
    try {
      const res = await fetch(`/api/ollama/usage?account=${account}`, { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || `HTTP ${res.status}`);
        setData(null);
        return;
      }
      const json = await res.json();
      setData(json);
      setError(null);
      setLastRefreshAt(Date.now());
    } catch (err: any) {
      setError(err?.message || "Network error");
    } finally {
      setLoading(false);
    }
  }, [account]);

  // Initial fetch + polling
  useEffect(() => {
    fetchUsage();
    intervalRef.current = setInterval(fetchUsage, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchUsage]);

  // Refresh after each chat turn (parent bumps refreshTrigger)
  useEffect(() => {
    if (refreshTrigger > 0) fetchUsage();
  }, [refreshTrigger, fetchUsage]);

  const isAnyMaxed = data?.session.isMaxed || data?.weekly.isMaxed;
  const sessionUsage = data?.session.usage ?? 0;
  const weeklyUsage = data?.weekly.usage ?? 0;
  const sessionModels = data?.session.models ?? [];
  const weeklyModels = data?.weekly.models ?? [];

  // Show top 5 by request_count
  const topWeekly = [...weeklyModels].sort((a, b) => b.request_count - a.request_count).slice(0, 5);

  return (
    <div
      onClick={(e) => {
        // Don't trigger onSelect when clicking the expand toggle
        if ((e.target as HTMLElement).closest("[data-expand-toggle]")) return;
        onSelect();
      }}
      className={`
        group cursor-pointer rounded-md border transition-all px-2.5 py-2
        ${active
          ? "border-accent bg-accent/10"
          : isAnyMaxed
            ? "border-red-500/50 bg-red-500/5"
            : "border-zinc-700 bg-zinc-900/40 hover:border-zinc-500"
        }
      `}
      title={
        isAnyMaxed
          ? `${label} is at limit. Click to route exclusively (will fail until reset).`
          : `Click to route all traffic to ${label}`
      }
    >
      {/* Header row */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          {icon === "cloud" ? (
            <Cloud size={12} className={active ? "text-accent" : "text-muted"} />
          ) : (
            <Sparkles size={12} className={active ? "text-accent" : isAnyMaxed ? "text-red-400" : "text-amber-400"} />
          )}
          <span className={`text-[11.5px] font-medium ${active ? "text-accent" : "text-foreground"}`}>
            {label}
          </span>
          {active && <span className="text-accent text-[10px]">●</span>}
          {isAnyMaxed && !active && <AlertTriangle size={10} className="text-red-400" />}
          {data?.stale && <span className="text-[9px] text-amber-500 font-mono">stale</span>}
        </div>
        <div className="flex items-center gap-1">
          <button
            data-expand-toggle
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            className="p-0.5 hover:bg-zinc-700/50 rounded text-muted hover:text-foreground transition-colors"
            title={expanded ? "Hide details" : "Show details"}
          >
            <ChevronDown
              size={12}
              className={`transition-transform ${expanded ? "rotate-180" : ""}`}
            />
          </button>
          <button
            data-expand-toggle
            onClick={(e) => {
              e.stopPropagation();
              fetchUsage();
            }}
            className="p-0.5 hover:bg-zinc-700/50 rounded text-muted hover:text-foreground transition-colors"
            title="Refresh now"
          >
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Gauges */}
      {error ? (
        <div className="text-[10px] text-red-400 font-mono py-1">⚠ {error}</div>
      ) : !data ? (
        <div className="text-[10px] text-muted py-1">Loading…</div>
      ) : (
        <div className="space-y-1">
          <Gauge label="Session" usage={sessionUsage} isMaxed={data.session.isMaxed} />
          <Gauge label="Weekly" usage={weeklyUsage} isMaxed={data.weekly.isMaxed} />
        </div>
      )}

      {/* Per-widget model pin (scoped to this routing system's models) */}
      <div
        className="mt-2 flex items-center gap-1.5"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-[9px] text-muted font-mono uppercase tracking-wide shrink-0">Model</span>
        <div className="relative flex-1 min-w-0">
          <select
            value={selectedModelId ?? ""}
            onChange={(e) => onModelChange(e.target.value === "" ? null : e.target.value)}
            className="w-full appearance-none bg-zinc-900/60 border border-zinc-700/60 hover:border-zinc-500 rounded-sm pl-1.5 pr-5 py-0.5 text-[10px] text-foreground font-mono cursor-pointer outline-none focus:border-accent"
          >
            <option value="">Routing Pool (rotate all)</option>
            {availableModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <ChevronDown size={10} className="absolute right-1 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && data && (
        <div className="mt-2 pt-2 border-t border-zinc-700/50 space-y-1.5" onClick={(e) => e.stopPropagation()}>
          {topWeekly.length > 0 && (
            <div>
              <div className="text-[9px] text-muted font-mono uppercase tracking-wide mb-0.5">
                Top models this week
              </div>
              {topWeekly.map((m) => (
                <div key={m.name} className="flex items-center justify-between text-[10px] font-mono">
                  <span className="text-foreground/80 truncate max-w-[140px]" title={m.name}>
                    {m.name}
                  </span>
                  <span className="text-muted">{m.request_count}×</span>
                </div>
              ))}
            </div>
          )}
          {sessionModels.length > 0 && (
            <div>
              <div className="text-[9px] text-muted font-mono uppercase tracking-wide mb-0.5">
                Session activity
              </div>
              {sessionModels.slice(0, 3).map((m) => (
                <div key={m.name} className="flex items-center justify-between text-[10px] font-mono">
                  <span className="text-foreground/80 truncate max-w-[140px]" title={m.name}>
                    {m.name}
                  </span>
                  <span className="text-muted">{m.request_count}×</span>
                </div>
              ))}
            </div>
          )}
          <div className="text-[9px] text-muted/60 font-mono pt-1">
            {lastRefreshAt > 0
              ? `Updated ${Math.round((Date.now() - lastRefreshAt) / 1000)}s ago`
              : ""}
            {data.stale && " · from cache"}
          </div>
        </div>
      )}
    </div>
  );
}
