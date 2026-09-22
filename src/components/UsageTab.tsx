"use client";

/**
 * UsageTab — OpsPanel tab for usage breakdown and optimization insights
 *
 * Shows a single summary card with the latest report data:
 *   - When was the report generated
 *   - Key stats: total calls, top model, top provider, busiest day
 *   - Cost summary (only for custom providers; Ollama is $20/mo flat)
 *   - "Download full report" button — exports the .md file
 *
 * The full report is generated once every 24 hours by a background
 * scheduler in the chat route. This component just displays it.
 */

import { useEffect, useState, useCallback } from "react";
import { Download, RefreshCw, Calendar, Hash, DollarSign, Cpu } from "lucide-react";
import type { OptimizationReport } from "@/lib/optimization-report";

export default function UsageTab() {
  const [report, setReport] = useState<OptimizationReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const fetchReport = useCallback(async () => {
    try {
      const res = await fetch("/api/usage/details", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setReport(data.report);
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReport();
    const interval = setInterval(fetchReport, 60_000);  // refresh every minute
    return () => clearInterval(interval);
  }, [fetchReport]);

  const handleDownload = useCallback(async () => {
    setDownloading(true);
    try {
      const res = await fetch("/api/usage/export");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const cd = res.headers.get("Content-Disposition") || "";
      const match = cd.match(/filename="([^"]+)"/);
      a.download = match?.[1] || "smyth-usage-report.md";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error("Download failed:", err);
    } finally {
      setDownloading(false);
    }
  }, []);

  const generatedAt = report?.generatedAt ? new Date(report.generatedAt) : null;
  const ageHours = generatedAt ? Math.round((Date.now() - generatedAt.getTime()) / (60 * 60 * 1000)) : null;
  const isStale = ageHours !== null && ageHours >= 24;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-base font-semibold text-white">Optimization Insights</h2>
        <p className="text-[11px] text-white/70 mt-1">Report generates daily at 08:00 WITA. Click the card to download.</p>
      </div>

      {/* Report card */}
      <div
        onClick={handleDownload}
        className={`
          group cursor-pointer bg-[#111] border rounded-lg p-4 transition-all
          ${downloading ? "opacity-50" : "hover:border-white/30"}
          ${isStale ? "border-amber-500/40" : "border-white/15"}
        `}
      >
        {loading && (
          <div className="text-center py-8 text-white/60 text-xs">Loading report…</div>
        )}
        {error && (
          <div className="text-red-400 text-xs">⚠ {error}</div>
        )}
        {!loading && !error && !report && (
          <div className="text-center py-8 text-white/60 text-xs">
            No usage data yet. Reports generate once every 24 hours.
          </div>
        )}
        {!loading && !error && report && (
          <>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-[10px] text-white/50 uppercase tracking-wider">
                <Calendar size={10} />
                <span>
                  {generatedAt?.toLocaleString() || "unknown"}
                  {ageHours !== null && (
                    <span className="ml-2 text-white/40">({ageHours}h ago)</span>
                  )}
                  {isStale && <span className="ml-2 text-amber-400">stale</span>}
                </span>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); fetchReport(); }}
                className="px-2 py-1 rounded text-xs bg-green-500 text-black font-medium hover:bg-green-400 transition-colors"
                title="Refresh"
              >
                <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
              </button>
            </div>

            {/* Key stats grid */}
            <div className="grid grid-cols-4 gap-3 mb-3">
              <StatCell
                icon={<Hash size={12} />}
                label="Total calls"
                value={report.summary.totalCalls.toLocaleString()}
                color="text-white"
              />
              <StatCell
                icon={<Cpu size={12} />}
                label="Top model"
                value={report.summary.mostUsedModel || "—"}
                color="text-cyan-400"
                small
              />
              <StatCell
                icon={<Cpu size={12} />}
                label="Top provider"
                value={report.summary.mostUsedProvider || "—"}
                color="text-blue-400"
                small
              />
              <StatCell
                icon={<DollarSign size={12} />}
                label="Custom cost"
                value={`$${report.summary.totalCostUsd.toFixed(2)}`}
                color="text-green-400"
              />
            </div>

            {/* Quick summary */}
            <div className="text-[11px] text-white/80 space-y-1 mb-3">
              <p>
                <span className="text-white/50">Range:</span>{" "}
                <span className="text-white">{new Date(report.rangeStart).toLocaleString()}</span> →{" "}
                <span className="text-white">{new Date(report.rangeEnd).toLocaleString()}</span>
              </p>
              <p>
                <span className="text-white/50">Models used:</span> <span className="text-white">{report.summary.uniqueModels}</span> ·{" "}
                <span className="text-white/50">Providers:</span> <span className="text-white">{report.summary.uniqueProviders}</span> ·{" "}
                <span className="text-white/50">Busiest day:</span> <span className="text-white">{report.summary.busiestDay || "—"}</span>
              </p>
              <p className="text-white/60 mt-2">
                Click anywhere on this card to download the full report (.md). Paste it into a chat and
                ask your LLM to analyze the patterns.
              </p>
            </div>

            {/* Footer: download button */}
            <div className="flex items-center justify-between pt-2 border-t border-white/10">
              <div className="text-[10px] text-white/50">
                {downloading ? "Preparing download…" : "Click to download .md"}
              </div>
              <Download size={14} className="text-white/40 group-hover:text-white" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StatCell({
  icon,
  label,
  value,
  color,
  small,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
  small?: boolean;
}) {
  return (
    <div className="bg-[#0a0a0a] border border-white/10 rounded p-2">
      <div className="flex items-center gap-1 text-[9px] text-white/50 uppercase tracking-wider mb-1">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`${small ? "text-xs" : "text-sm"} font-mono ${color} truncate`} title={value}>
        {value}
      </div>
    </div>
  );
}
