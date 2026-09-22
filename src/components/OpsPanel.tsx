"use client";

import { useState, useEffect, useCallback } from "react";
import UsageTab from "@/components/UsageTab";
import {
  X,
  Activity,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Pause,
  Play,
  RefreshCw,
  TrendingUp,
  Mail,
  Users,
  Calendar,
  Film,
  Server,
  MemoryStick,
  HardDrive,
  Trash2,
  Zap,
  Eye,
  Heart,
  MessageCircle,
  UserPlus,
  Send,
  Snowflake,
  RotateCcw,
} from "lucide-react";

const ICON_MAP: Record<string, any> = {
  mail: Mail,
  server: Server,
  memory: MemoryStick,
  disk: HardDrive,
  users: Users,
  calendar: Calendar,
  film: Film,
  trending: TrendingUp,
};

const ACTION_ICONS: Record<string, any> = {
  profile_visit: Eye,
  like: Heart,
  comment: MessageCircle,
  dm: Send,
  invite: UserPlus,
  connect: UserPlus,
};

const ACTION_COLORS: Record<string, string> = {
  profile_visit: "text-blue-400",
  like: "text-pink-400",
  comment: "text-amber-400",
  dm: "text-green-400",
  invite: "text-purple-400",
  connect: "text-cyan-400",
};

interface OpsPanelProps {
  onClose: () => void;
}

interface JobStatus {
  name: string;
  displayName: string;
  status: "running" | "idle" | "error" | "stopped";
  lastRun: string | null;
  nextRun: string | null;
  schedule: string;
  description: string;
  lastError: string | null;
  enabled: boolean;
}

interface MetricCard {
  label: string;
  value: string;
  subValue?: string;
  icon: any;
  color: string;
}

interface FleetAction {
  type: string;
  name: string;
  status: string;
  scheduledFor?: string;
  doneAt?: string;
  result?: { object: string };
}

interface FleetAccount {
  accountId: string;
  name: string;
  queued: number;
  done: number;
  failed: number;
  retries: Record<string, number>;
  recentActions: FleetAction[];
}

interface FleetData {
  report: string | null;
  reportDate: string | null;
  accounts: FleetAccount[];
  inviteFreezeUntil: string | null;
  recentLogLines: string[];
  batchInfo: { running: boolean; startedAt: string | null };
}

export default function OpsPanel({ onClose }: OpsPanelProps) {
  const [view, setView] = useState<"metrics" | "jobs" | "fleet" | "usage">("fleet");
  const [jobs, setJobs] = useState<JobStatus[]>([]);
  const [metrics, setMetrics] = useState<MetricCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activities, setActivities] = useState<any[]>([]);
  const [fleetData, setFleetData] = useState<FleetData | null>(null);
  const [fleetLoading, setFleetLoading] = useState(false);

  const fetchJobs = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/ops/jobs");
      if (res.ok) {
        const data = await res.json();
        setJobs(data.jobs || []);
      }
    } catch (e) {
      setJobs(getFallbackJobs());
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, []);

  const fetchMetrics = useCallback(async () => {
    try {
      const res = await fetch("/api/ops/metrics");
      if (res.ok) {
        const data = await res.json();
        setMetrics(data.metrics || []);
      }
    } catch (e) {
      setMetrics(getFallbackMetrics());
    }
  }, []);

  const fetchActivity = useCallback(async () => {
    try {
      const res = await fetch("/api/ops/activity");
      if (res.ok) {
        const data = await res.json();
        setActivities(data.activities || []);
      }
    } catch (e) {}
  }, []);

  const fetchFleet = useCallback(async () => {
    setFleetLoading(true);
    try {
      const res = await fetch("/api/ops/fleet");
      if (res.ok) {
        const data = await res.json();
        setFleetData(data);
      }
    } catch (e) {
      console.error("Failed to fetch fleet data:", e);
    } finally {
      setFleetLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
    fetchMetrics();
    fetchActivity();
    fetchFleet();
    const interval = setInterval(() => {
      fetchJobs();
      fetchMetrics();
      fetchActivity();
      fetchFleet();
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchJobs, fetchMetrics, fetchActivity, fetchFleet]);

  const toggleJob = async (name: string) => {
    try {
      await fetch("/api/ops/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, action: "toggle" }),
      });
      fetchJobs();
    } catch (e) {
      console.error("Failed to toggle job:", e);
    }
  };

  const runJobNow = async (name: string) => {
    try {
      await fetch("/api/ops/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, action: "run" }),
      });
      fetchJobs();
    } catch (e) {
      console.error("Failed to run job:", e);
    }
  };

  const deleteJob = async (name: string, displayName: string) => {
    if (!confirm(`Delete "${displayName}"?\n\nThis will unload and remove the launchd plist.`)) return;
    try {
      await fetch("/api/ops/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, action: "delete" }),
      });
      fetchJobs();
    } catch (e) {
      console.error("Failed to delete job:", e);
    }
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case "running": return <Activity size={14} className="text-green-400 animate-pulse" />;
      case "idle": return <CheckCircle2 size={14} className="text-blue-400" />;
      case "error": return <XCircle size={14} className="text-red-400" />;
      case "stopped": return <Pause size={14} className="text-gray-500" />;
      default: return <Clock size={14} className="text-gray-500" />;
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "running": return "text-green-400";
      case "idle": return "text-blue-400";
      case "error": return "text-red-400";
      case "stopped": return "text-gray-500";
      default: return "text-gray-500";
    }
  };

  const formatTime = (ts: string | null | undefined) => {
    if (!ts) return "—";
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch { return ts; }
  };

  const logLineIcon = (line: string) => {
    if (line.includes("❌") || line.includes("FAILED")) return <XCircle size={12} className="text-red-400 shrink-0" />;
    if (line.includes("⏳") || line.includes("retry")) return <RotateCcw size={12} className="text-amber-400 shrink-0" />;
    if (line.includes("💤") || line.includes("not connected")) return <Snowflake size={12} className="text-blue-300 shrink-0" />;
    if (line.includes("✅") || line.includes("done") || line.includes("DONE")) return <CheckCircle2 size={12} className="text-green-400 shrink-0" />;
    return <Activity size={12} className="text-white/60 shrink-0" />;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-[95vw] h-[95vh] max-w-[1200px] bg-[#0a0a0a] border border-[#222] rounded-lg shadow-2xl flex flex-col overflow-hidden z-10">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#111] border-b border-[#222] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-[#0066ff] animate-pulse" />
            <span className="font-sans font-semibold text-sm text-white">Mission Control</span>
            <span className="text-[10px] text-white/60">Ops & Analytics</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex bg-[#1a1a1a] rounded-md p-0.5">
              <button onClick={() => setView("fleet")} className={`px-3 py-1 rounded text-xs font-medium transition-all ${view === "fleet" ? "bg-green-500 text-black" : "text-white/80 hover:text-white"}`}>
                <span className="flex items-center gap-1.5"><Zap size={10} />Fleet</span>
              </button>
              <button onClick={() => setView("jobs")} className={`px-3 py-1 rounded text-xs font-medium transition-all ${view === "jobs" ? "bg-green-500 text-black" : "text-white/80 hover:text-white"}`}>
                Background Jobs
              </button>
              <button onClick={() => setView("metrics")} className={`px-3 py-1 rounded text-xs font-medium transition-all ${view === "metrics" ? "bg-green-500 text-black" : "text-white/80 hover:text-white"}`}>
                Metrics
              </button>
              <button onClick={() => setView("usage")} className={`px-3 py-1 rounded text-xs font-medium transition-all ${view === "usage" ? "bg-green-500 text-black" : "text-white/80 hover:text-white"}`}>
                Usage
              </button>
            </div>
            <button
              onClick={() => { fetchJobs(); fetchMetrics(); fetchActivity(); fetchFleet(); }}
              className="p-1.5 rounded bg-green-500 text-black hover:bg-green-400 transition-colors"
              title="Refresh"
            >
              <RefreshCw size={14} className={refreshing || fleetLoading ? "animate-spin" : ""} />
            </button>
            <button onClick={onClose} className="p-1.5 rounded bg-green-500 text-black hover:bg-green-400 transition-colors" title="Close">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* ── FLEET VIEW ── */}
          {view === "fleet" && (
            <div className="space-y-4">
              {fleetLoading && !fleetData && (
                <div className="text-center py-20 text-white/60 text-sm">Loading fleet data...</div>
              )}

              {fleetData && (
                <>
                  {/* Account Cards */}
                  <div className="text-[10px] text-white/60 uppercase tracking-widest mb-2">
                    Outreach Accounts
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    {fleetData.accounts.map((acct) => {
                      const total = acct.queued + acct.done + acct.failed;
                      const pct = total > 0 ? Math.round((acct.done / total) * 100) : 0;
                      return (
                        <div key={acct.accountId} className="bg-[#111] border border-[#222] rounded-lg p-4">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded-full bg-[#1a1a2e] border border-[#333] flex items-center justify-center text-[10px] font-bold text-white uppercase">
                                {acct.name.charAt(0)}
                              </div>
                              <span className="text-sm font-medium text-white capitalize">{acct.name}</span>
                            </div>
                            <span className="text-[10px] px-2 py-0.5 rounded bg-[#1a1a1a] border border-[#222] text-white/80">
                              {acct.queued > 0 ? `${acct.queued} queued` : "idle"}
                            </span>
                          </div>

                          {/* Progress bar */}
                          <div className="w-full h-1.5 bg-[#1a1a1a] rounded-full mb-3 overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-[#0066ff] to-[#00cc88] rounded-full transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>

                          {/* Stats row */}
                          <div className="grid grid-cols-3 gap-2 text-center">
                            <div>
                              <div className="text-lg font-bold text-green-400">{acct.done}</div>
                              <div className="text-[9px] text-white/60 uppercase">Done</div>
                            </div>
                            <div>
                              <div className="text-lg font-bold text-amber-400">{acct.queued}</div>
                              <div className="text-[9px] text-white/60 uppercase">Queued</div>
                            </div>
                            <div>
                              <div className="text-lg font-bold text-red-400">{acct.failed}</div>
                              <div className="text-[9px] text-white/60 uppercase">Failed</div>
                            </div>
                          </div>

                          {/* Retry warnings */}
                          {Object.keys(acct.retries).length > 0 && (
                            <div className="mt-3 pt-2 border-t border-[#1a1a1a]">
                              <div className="text-[9px] text-amber-400/60 uppercase tracking-wider mb-1">Retries</div>
                              {Object.entries(acct.retries).slice(0, 3).map(([key, count]: [string, any]) => {
                                const name = key.split("|")[1] || key;
                                return (
                                  <div key={key} className="flex items-center gap-1.5 text-[10px] text-white/80">
                                    <RotateCcw size={9} className="text-amber-400" />
                                    <span className="truncate">{name}</span>
                                    <span className="text-white/60">×{count}</span>
                                  </div>
                                );
                              })}
                              {Object.keys(acct.retries).length > 3 && (
                                <div className="text-[9px] text-white/60">+{Object.keys(acct.retries).length - 3} more</div>
                              )}
                            </div>
                          )}

                          {/* Recent actions */}
                          {acct.recentActions.length > 0 && (
                            <div className="mt-3 pt-2 border-t border-[#1a1a1a]">
                              <div className="text-[9px] text-white/60 uppercase tracking-wider mb-1">Recent</div>
                              <div className="space-y-1 max-h-32 overflow-y-auto">
                                {acct.recentActions.slice(0, 8).map((action, i) => {
                                  const Icon = ACTION_ICONS[action.type] || Activity;
                                  const color = ACTION_COLORS[action.type] || "text-white/80";
                                  const resultLabel = action.result?.object === "ReactionAdded" ? "liked"
                                    : action.result?.object === "CommentSent" ? "commented"
                                    : action.result?.object === "UserProfile" ? "visited"
                                    : action.result?.object === "MessageSent" ? "DM sent"
                                    : action.status === "done" ? "done" : action.status;
                                  return <div key={i} className="flex items-center gap-1.5 text-[10px]">
                                      <Icon size={10} className={color} />
                                      <span className="text-white/90 truncate flex-1">{action.name}</span>
                                      <span className={`text-[9px] ${action.status === "done" ? "text-green-500/60" : "text-red-400/60"}`}>
                                        {resultLabel}
                                      </span>
                                    </div>;
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Invite Freeze Banner */}
                  {fleetData.inviteFreezeUntil && new Date(fleetData.inviteFreezeUntil) > new Date() && (
                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 flex items-center gap-2">
                      <Snowflake size={16} className="text-amber-400" />
                      <div>
                        <span className="text-xs text-amber-300">Invite freeze active until </span>
                        <span className="text-xs text-amber-200 font-medium">
                          {new Date(fleetData.inviteFreezeUntil).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Batch Status */}
                  <div className="flex items-center gap-3">
                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs ${fleetData.batchInfo.running ? "bg-green-500/10 border border-green-500/30 text-green-400" : "bg-[#111] border border-[#222] text-white/60"}`}>
                      <div className={`w-1.5 h-1.5 rounded-full ${fleetData.batchInfo.running ? "bg-green-400 animate-pulse" : "bg-[#333]"}`} />
                      {fleetData.batchInfo.running ? "Batch running" : "No active batch"}
                    </div>
                    {fleetData.reportDate && (
                      <span className="text-[10px] text-white/60">
                        Last report: {new Date(fleetData.reportDate).toLocaleString()}
                      </span>
                    )}
                  </div>

                  {/* Report */}
                  {fleetData.report && (
                    <div>
                      <div className="text-[10px] text-white/60 uppercase tracking-widest mb-2">
                        Latest Batch Report
                      </div>
                      <div className="bg-[#111] border border-[#222] rounded-lg p-4 font-mono text-[11px] text-white/80 whitespace-pre-wrap max-h-48 overflow-y-auto">
                        {fleetData.report}
                      </div>
                    </div>
                  )}

                  {/* Live Runner Log */}
                  {fleetData.recentLogLines.length > 0 && (
                    <div>
                      <div className="text-[10px] text-white/60 uppercase tracking-widest mb-2">
                        Runner Log (live)
                      </div>
                      <div className="bg-[#0d0d0d] border border-[#222] rounded-lg p-3 font-mono text-[10px] max-h-64 overflow-y-auto space-y-1">
                        {fleetData.recentLogLines.map((line, i) => (
                          <div key={i} className="flex items-start gap-1.5">
                            {logLineIcon(line)}
                            <span className={`${
                              line.includes("❌") || line.includes("FAILED") ? "text-red-400" :
                              line.includes("⏳") || line.includes("retry") ? "text-amber-400" :
                              line.includes("💤") || line.includes("not connected") ? "text-blue-300" :
                              line.includes("✅") ? "text-green-400" :
                              "text-white/70"
                            }`}>
                              {line.replace(/^[^\]]*\]\s*/, "")}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── JOBS VIEW ── */}
          {view === "jobs" && (
            <div className="space-y-3">
              <div className="text-[10px] text-white/60 uppercase tracking-widest mb-2">
                System Services & Scheduled Jobs
              </div>
              {loading ? (
                <div className="text-center py-20 text-white/60 text-sm">Loading jobs...</div>
              ) : (
                jobs.map((job) => (
                  <div key={job.name} className="bg-[#111] border border-[#222] rounded-lg p-4 hover:border-[#333] transition-colors">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          {statusIcon(job.status)}
                          <span className="text-sm font-medium text-white">{job.displayName}</span>
                          <span className={`text-[10px] ${statusColor(job.status)} uppercase`}>{job.status}</span>
                        </div>
                        <p className="text-xs text-white/70 mb-2">{job.description}</p>
                        <div className="flex items-center gap-4 text-[10px] text-white/60">
                          {job.schedule && <span className="flex items-center gap-1"><Clock size={10} />{job.schedule}</span>}
                          {job.lastRun && <span>Last: {job.lastRun}</span>}
                          {job.nextRun && <span>Next: {job.nextRun}</span>}
                        </div>
                        {job.lastError && (
                          <div className="mt-2 flex items-start gap-1.5 text-[10px] text-red-400/80">
                            <AlertTriangle size={10} className="mt-0.5 shrink-0" />
                            <span className="font-mono">{job.lastError}</span>
                          </div>
                        )}
                        <button onClick={() => deleteJob(job.name, job.displayName)} className="p-1.5 rounded bg-green-500 text-black hover:bg-green-400 transition-colors" title="Delete">
                          <Trash2 size={12} />
                        </button>
                      </div>
                      <div className="flex items-center gap-1 ml-4">
                        {job.enabled && job.status !== "running" && (
                          <button onClick={() => runJobNow(job.name)} className="p-1.5 rounded bg-green-500 text-black hover:bg-green-400 transition-colors" title="Run now">
                            <Play size={12} />
                          </button>
                        )}
                        <button
                          onClick={() => toggleJob(job.name)}
                          className="p-1.5 rounded bg-green-500 text-black hover:bg-green-400 transition-colors"
                          title={job.enabled ? "Disable" : "Enable"}
                        >
                          {job.enabled ? <Pause size={12} /> : <Play size={12} />}
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* ── METRICS VIEW ── */}
          {view === "metrics" && (
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-3">
                {metrics.map((m, i) => (
                  <div key={i} className="bg-[#111] border border-[#222] rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      {(() => { const Icon = ICON_MAP[m.icon] || Activity; return <Icon size={14} className={m.color} />; })()}
                      <span className="text-[10px] text-white/60 uppercase tracking-wider">{m.label}</span>
                    </div>
                    <div className="text-2xl font-bold text-white">{m.value}</div>
                    {m.subValue && <div className="text-[10px] text-white/60 mt-1">{m.subValue}</div>}
                  </div>
                ))}
              </div>

              <div>
                <div className="text-[10px] text-white/60 uppercase tracking-widest mb-2">Recent Activity</div>
                <div className="bg-[#111] border border-[#222] rounded-lg p-4">
                  <div className="space-y-2">
                    {activities.length === 0 ? (
                      <div className="text-center py-8 text-white/60 text-xs">No recent activity</div>
                    ) : (
                      activities.map((a, i) => {
                        const Icon = ICON_MAP[a.icon] || Activity;
                        return (
                          <div key={i} className="flex items-center gap-3 py-1.5">
                            <Icon size={14} className={a.color} />
                            <span className="text-xs text-white/90 flex-1">{a.text}</span>
                            <span className="text-[10px] text-white/60">{a.time}</span>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>

              <div>
                <div className="text-[10px] text-white/60 uppercase tracking-widest mb-2">Sales Funnel</div>
                <div className="bg-[#111] border border-[#222] rounded-lg p-4">
                  <div className="flex items-center gap-2">
                    <FunnelStage label="Leads" value={47} color="bg-blue-500" pct={100} />
                    <FunnelArrow />
                    <FunnelStage label="Contacted" value={32} color="bg-cyan-500" pct={68} />
                    <FunnelArrow />
                    <FunnelStage label="Replied" value={11} color="bg-amber-500" pct={23} />
                    <FunnelArrow />
                    <FunnelStage label="Booked" value={5} color="bg-green-500" pct={11} />
                    <FunnelArrow />
                    <FunnelStage label="Closed" value={2} color="bg-purple-500" pct={4} />
                  </div>
                </div>
              </div>
            </div>
          )}
          {view === "usage" && (
            <UsageTab />
          )}
        </div>
      </div>
    </div>
  );
}

function FunnelStage({ label, value, color, pct }: { label: string; value: number; color: string; pct: number }) {
  return (
    <div className="flex flex-col items-center gap-1 flex-1">
      <div className={`w-full h-12 rounded flex items-center justify-center ${color} bg-opacity-20`}>
        <span className="text-lg font-bold text-white">{value}</span>
      </div>
      <span className="text-[10px] text-white/70">{label}</span>
      <span className="text-[9px] text-white/40">{pct}%</span>
    </div>
  );
}

function FunnelArrow() {
  return <div className="text-white/50 text-sm">→</div>;
}

function getFallbackJobs(): JobStatus[] {
  return [
    { name: "agenticmail-relay", displayName: "Email Relay", status: "running", lastRun: "just now", nextRun: "every 30s", schedule: "continuous", description: "Polls external IMAP and delivers inbound emails", lastError: null, enabled: true },
    { name: "velorn-electron", displayName: "Velorn Video Editor", status: "running", lastRun: "running", nextRun: null, schedule: "always on", description: "Electron + Xvfb + noVNC video editor", lastError: null, enabled: true },
    { name: "robbi-browser", displayName: "Robbi Operator Browser", status: "running", lastRun: "running", nextRun: null, schedule: "always on", description: "Headless browser automation server", lastError: null, enabled: true },
    { name: "cloudflared", displayName: "Cloudflare Tunnel", status: "running", lastRun: "running", nextRun: null, schedule: "always on", description: "Tunnels subdomains to VPS services", lastError: null, enabled: true },
    { name: "zernio-scheduler", displayName: "Social Scheduler", status: "idle", lastRun: "2 hours ago", nextRun: "tomorrow 09:00", schedule: "daily 09:00", description: "Posts scheduled social media content", lastError: null, enabled: true },
  ];
}

function getFallbackMetrics(): MetricCard[] {
  return [
    { label: "Emails Sent", value: "—", subValue: "loading…", icon: Mail, color: "text-blue-400" },
    { label: "Open Rate", value: "—", subValue: "tracking pending", icon: TrendingUp, color: "text-green-400" },
    { label: "Active Clients", value: "—", subValue: "via CRM", icon: Users, color: "text-amber-400" },
    { label: "Scheduled Posts", value: "—", subValue: "via Zernio", icon: Calendar, color: "text-purple-400" },
  ];
}
