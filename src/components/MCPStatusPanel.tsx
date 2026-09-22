"use client";

/**
 * MCPStatusPanel — live status of all configured MCP servers
 *
 * Replaces the old CanvaConnect component. Shows every server in
 * mcp-servers.yaml (enabled or not) with its current state:
 *   - 🟢 Connected (and authenticated, if OAuth)
 *   - 🟡 Auth needed (OAuth server, no valid token)
 *   - ⚪ Disabled (enabled: false in config)
 *   - 🔴 Error (registry reports a lastError)
 *   - ⚫ Not yet connected (configured but no tool calls yet)
 *
 * Click a server to see its description and tool count.
 * Polls /api/mcp/status every 30s, refreshes on focus.
 */

import { useEffect, useState, useCallback } from "react";
import { ChevronDown, Server, Check, AlertTriangle, X, Eye, EyeOff, RefreshCw } from "lucide-react";

interface ServerStatus {
  name: string;
  description: string;
  transport: "stdio" | "sse" | "http" | "websocket";
  enabled: boolean;
  connected: boolean;
  authRequired: boolean;
  authenticated: boolean;
  toolCount: number;
  lastError?: string;
  lastChecked?: string;
  // 2026-08-22: when false, the http-client never opens OAuth popups on
  // token expiry. Toggle in the panel per server.
  autoAuth: boolean;
}

type VisualState = "connected" | "auth" | "disabled" | "error" | "configured";

function visualState(s: ServerStatus): VisualState {
  if (!s.enabled) return "disabled";
  if (s.authRequired && !s.authenticated) return "auth";
  if (s.connected) return "connected";
  if (s.lastError) return "error";
  return "configured";
}

const STATE_COLORS: Record<VisualState, { dot: string; text: string; label: string }> = {
  connected:   { dot: "bg-emerald-500", text: "text-emerald-400", label: "Connected" },
  configured:  { dot: "bg-zinc-500",    text: "text-muted",       label: "Configured" },
  auth:        { dot: "bg-amber-500",   text: "text-amber-400",   label: "Auth required" },
  disabled:    { dot: "bg-zinc-700",    text: "text-muted/60",    label: "Disabled" },
  error:       { dot: "bg-red-500",     text: "text-red-400",     label: "Error" },
};

export default function MCPStatusPanel() {
  const [servers, setServers] = useState<ServerStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/mcp/status", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setServers(data.servers || []);
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30_000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const sortedServers = [...servers].sort((a, b) => {
    // Connected first, then auth, then error, then configured, then disabled
    const order: Record<VisualState, number> = { connected: 0, auth: 1, error: 2, configured: 3, disabled: 4 };
    return order[visualState(a)] - order[visualState(b)];
  });
  const visibleServers = showAll ? sortedServers : sortedServers.filter((s) => s.enabled);
  const hiddenCount = sortedServers.length - visibleServers.length;

  const connectedCount = servers.filter((s) => visualState(s) === "connected").length;
  const totalEnabled = servers.filter((s) => s.enabled).length;
  const authNeededCount = servers.filter((s) => visualState(s) === "auth").length;

  return (
    <div className="flex flex-col gap-1.5">
      {/* Summary row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[10.5px] font-mono">
          {loading ? (
            <span className="text-muted">Loading…</span>
          ) : error ? (
            <span className="text-red-400">⚠ {error}</span>
          ) : (
            <>
              <span className="text-emerald-400">{connectedCount}</span>
              <span className="text-muted">/</span>
              <span className="text-muted">{totalEnabled}</span>
              <span className="text-muted/60">connected</span>
              {authNeededCount > 0 && (
                <>
                  <span className="text-muted/40">·</span>
                  <span className="text-amber-400">{authNeededCount}</span>
                  <span className="text-muted/60">auth</span>
                </>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          {servers.some((s) => !s.enabled) && (
            <button
              onClick={() => setShowAll(!showAll)}
              className="text-[9px] text-muted hover:text-foreground px-1.5 py-0.5 rounded hover:bg-zinc-700/50 inline-flex items-center gap-0.5"
              title={showAll ? "Show only enabled" : `Show all (${hiddenCount} disabled)`}
            >
              {showAll ? <EyeOff size={9} /> : <Eye size={9} />}
              {showAll ? "enabled" : `+${hiddenCount}`}
            </button>
          )}
          <button
            onClick={fetchStatus}
            className="p-0.5 hover:bg-zinc-700/50 rounded text-muted hover:text-foreground"
            title="Refresh now"
          >
            <RefreshCw size={10} className={loading ? "animate-spin" : ""} />
          </button>
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-0.5 hover:bg-zinc-700/50 rounded text-muted hover:text-foreground"
            title={expanded ? "Hide details" : "Show details"}
          >
            <ChevronDown size={10} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {/* Server list (when expanded) */}
      {expanded && (
        <div className="space-y-0.5">
          {visibleServers.length === 0 && !loading && (
            <div className="text-[10px] text-muted/60 font-mono py-1">No servers</div>
          )}
          {visibleServers.map((s) => {
            const state = visualState(s);
            const c = STATE_COLORS[state];
            const showAuthToggle = s.transport === "http" || s.transport === "sse";
            return (
              <div
                key={s.name}
                className="flex items-center gap-1.5 text-[10px] font-mono py-0.5"
                title={s.lastError || s.description}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${c.dot} shrink-0`} />
                <span className={`truncate ${c.text}`}>{s.name}</span>
                {s.toolCount > 0 && (
                  <span className="text-muted/60 shrink-0">{s.toolCount} tools</span>
                )}
                {state === "auth" && (
                  <span className="ml-auto text-amber-400/80">auth</span>
                )}
                {state === "error" && (
                  <span className="ml-auto text-red-400/80">!</span>
                )}
                {state === "disabled" && (
                  <span className="ml-auto text-muted/50">off</span>
                )}
                {showAuthToggle && (
                  <label
                    className={`ml-auto inline-flex items-center gap-1 cursor-pointer select-none ${
                      s.autoAuth ? "text-emerald-400/80" : "text-muted/60"
                    }`}
                    title={
                      s.autoAuth
                        ? "Auto-auth: ON — popups can fire on token expiry. Click to silence."
                        : "Auto-auth: OFF — no OAuth popups. Click to allow re-auth."
                    }
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={s.autoAuth}
                      onChange={async (e) => {
                        const next = e.target.checked;
                        // optimistic update
                        setServers((prev) =>
                          prev.map((x) => (x.name === s.name ? { ...x, autoAuth: next } : x)),
                        );
                        try {
                          await fetch("/api/mcp/auto-auth", {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ serverName: s.name, autoAuth: next }),
                          });
                        } catch {
                          // revert on failure
                          setServers((prev) =>
                            prev.map((x) => (x.name === s.name ? { ...x, autoAuth: !next } : x)),
                          );
                        }
                      }}
                      className="accent-emerald-500 cursor-pointer"
                    />
                    <span className="text-[9px]">{s.autoAuth ? "auto" : "manual"}</span>
                  </label>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
