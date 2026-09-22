/**
 * Optimization Report — generated once every 24 hours
 *
 * Reads the usage log, computes summary stats, and writes a report
 * to data/optimization-report.json. The OpsPanel Usage tab reads
 * this report and offers it as a downloadable .md file.
 *
 * Auto-runs on server start, then every 24 hours via setInterval.
 * The setInterval survives as long as the Node process is alive.
 * On server restart, the next 24h tick is computed from lastRunAt.
 */

import * as fs from "fs";
import * as path from "path";
import { getEventsLastNDays, type UsageEvent, countBy, sumBy } from "./usage-log";
import { getPricing } from "./pricing";

const DATA_DIR = process.env.USAGE_LOG_DATA_DIR || path.join(process.cwd(), "data");
const REPORT_FILE = path.join(DATA_DIR, "optimization-report.json");

export interface ModelStats {
  model: string;
  calls: number;
  pct: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  avgLatencyMs: number;
  pricingNote: string;        // "estimated at list price" or "included in Ollama plan"
}

export interface ProviderStats {
  provider: string;
  calls: number;
  models: string[];            // unique models in this provider
  costUsd: number;
  pct: number;
}

export interface DailyPoint {
  date: string;               // YYYY-MM-DD
  calls: number;
  costUsd: number;
}

export interface OptimizationReport {
  generatedAt: string;         // ISO
  rangeStart: string;          // ISO (24h ago from generatedAt)
  rangeEnd: string;            // ISO
  summary: {
    totalCalls: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostUsd: number;       // 0 if everything is Ollama
    uniqueModels: number;
    uniqueProviders: number;
    mostUsedModel: string | null;
    mostUsedProvider: string | null;
    busiestDay: string | null;  // YYYY-MM-DD
  };
  byModel: ModelStats[];
  byProvider: ProviderStats[];
  byDay: DailyPoint[];
  notes: string[];              // static notes appended to the report
}

const STATIC_NOTES: string[] = [
  "Ollama Cloud and Ollama Pro are $20/month flat — no per-token costs. The cost column shows $0 for those models.",
  "Auto routing (OmniRoute) uses free-tier public proxies; quota is not exposed but circuit-breakers can fail over.",
  "Cost estimates for custom providers use rough public list prices as of Aug 2025. Your actual rate may differ.",
  "To get personalized recommendations, paste this report into a chat and ask your LLM to analyze your usage patterns.",
];

// ── Cache management ──

export function loadReport(): OptimizationReport | null {
  if (!fs.existsSync(REPORT_FILE)) return null;
  try {
    const raw = fs.readFileSync(REPORT_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveReport(report: OptimizationReport): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), "utf-8");
}

export function getLastRunAt(): string | null {
  const report = loadReport();
  return report?.generatedAt ?? null;
}

// ── Report generation ──

function pricingNoteFor(provider: string, model: string): string {
  const pricing = getPricing(provider, model);
  if (!pricing) return "Included in plan";
  return "Estimated at list price";
}

function buildReport(events: UsageEvent[]): OptimizationReport {
  const totalCalls = events.length;
  const totalInput = sumBy(events, "inputTokens");
  const totalOutput = sumBy(events, "outputTokens");
  const totalCost = sumBy(events, "costEstimateUsd");

  // Per-model breakdown
  const modelCounts = countBy(events, "model");
  const sortedModels = Object.entries(modelCounts)
    .sort((a, b) => b[1] - a[1]);

  const byModel: ModelStats[] = sortedModels.map(([model, calls]) => {
    const modelEvents = events.filter((e) => e.model === model);
    const inputTokens = sumBy(modelEvents, "inputTokens");
    const outputTokens = sumBy(modelEvents, "outputTokens");
    const costUsd = sumBy(modelEvents, "costEstimateUsd");
    const totalLatency = sumBy(modelEvents, "latencyMs");
    const avgLatency = modelEvents.length > 0 ? Math.round(totalLatency / modelEvents.length) : 0;
    // Pick the first event's provider for pricing note
    const sampleEvent = modelEvents[0];
    return {
      model,
      calls,
      pct: totalCalls > 0 ? Math.round((calls / totalCalls) * 1000) / 10 : 0,
      inputTokens,
      outputTokens,
      costUsd: Math.round(costUsd * 100) / 100,
      avgLatencyMs: avgLatency,
      pricingNote: pricingNoteFor(sampleEvent.provider, model),
    };
  });

  // Per-provider breakdown
  const providerCounts = countBy(events, "provider");
  const byProvider: ProviderStats[] = Object.entries(providerCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([provider, calls]) => {
      const providerEvents = events.filter((e) => e.provider === provider);
      const models = Array.from(new Set(providerEvents.map((e) => e.model)));
      const costUsd = sumBy(providerEvents, "costEstimateUsd");
      return {
        provider,
        calls,
        models,
        costUsd: Math.round(costUsd * 100) / 100,
        pct: totalCalls > 0 ? Math.round((calls / totalCalls) * 1000) / 10 : 0,
      };
    });

  // Daily breakdown
  const byDayMap: Record<string, { calls: number; costUsd: number }> = {};
  for (const e of events) {
    const day = e.timestamp.slice(0, 10);  // YYYY-MM-DD
    if (!byDayMap[day]) byDayMap[day] = { calls: 0, costUsd: 0 };
    byDayMap[day].calls += 1;
    byDayMap[day].costUsd += e.costEstimateUsd ?? 0;
  }
  const byDay: DailyPoint[] = Object.entries(byDayMap)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, data]) => ({
      date,
      calls: data.calls,
      costUsd: Math.round(data.costUsd * 100) / 100,
    }));

  // Summary
  const uniqueModels = new Set(events.map((e) => e.model));
  const uniqueProviders = new Set(events.map((e) => e.provider));
  const mostUsedModel = sortedModels[0]?.[0] ?? null;
  const mostUsedProvider = Object.entries(providerCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const busiestDay = byDay.length > 0
    ? byDay.sort((a, b) => b.calls - a.calls)[0].date
    : null;

  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  return {
    generatedAt: now.toISOString(),
    rangeStart: yesterday.toISOString(),
    rangeEnd: now.toISOString(),
    summary: {
      totalCalls,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalCostUsd: Math.round(totalCost * 100) / 100,
      uniqueModels: uniqueModels.size,
      uniqueProviders: uniqueProviders.size,
      mostUsedModel,
      mostUsedProvider,
      busiestDay,
    },
    byModel,
    byProvider,
    byDay,
    notes: STATIC_NOTES,
  };
}

export function generateReport(): OptimizationReport {
  const events = getEventsLastNDays(1);
  const report = buildReport(events);
  saveReport(report);
  return report;
}

// ── Markdown export ──

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function reportToMarkdown(report: OptimizationReport): string {
  const lines: string[] = [];
  lines.push("# Smyth Usage Report");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Range: ${report.rangeStart} → ${report.rangeEnd}`);
  lines.push("");

  // Summary
  lines.push("## Summary");
  lines.push("");
  lines.push(`- **Total calls:** ${report.summary.totalCalls.toLocaleString()}`);
  lines.push(`- **Input tokens:** ${report.summary.totalInputTokens.toLocaleString()}`);
  lines.push(`- **Output tokens:** ${report.summary.totalOutputTokens.toLocaleString()}`);
  lines.push(`- **Total cost (custom providers):** $${report.summary.totalCostUsd.toFixed(2)}`);
  lines.push(`- **Unique models:** ${report.summary.uniqueModels}`);
  lines.push(`- **Unique providers:** ${report.summary.uniqueProviders}`);
  if (report.summary.mostUsedModel) {
    lines.push(`- **Most used model:** ${report.summary.mostUsedModel}`);
  }
  if (report.summary.mostUsedProvider) {
    lines.push(`- **Most used provider:** ${report.summary.mostUsedProvider}`);
  }
  if (report.summary.busiestDay) {
    lines.push(`- **Busiest day:** ${report.summary.busiestDay}`);
  }
  lines.push("");

  // Per-model table
  lines.push("## Per-model breakdown");
  lines.push("");
  lines.push("| Model | Calls | % | Input | Output | Cost (USD) | Avg latency | Pricing |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---|");
  for (const m of report.byModel) {
    lines.push(`| ${m.model} | ${m.calls} | ${m.pct}% | ${fmtNum(m.inputTokens)} | ${fmtNum(m.outputTokens)} | $${m.costUsd.toFixed(2)} | ${m.avgLatencyMs}ms | ${m.pricingNote} |`);
  }
  lines.push("");

  // Per-provider table
  lines.push("## Per-provider breakdown");
  lines.push("");
  lines.push("| Provider | Calls | % | Models | Cost (USD) |");
  lines.push("|---|---:|---:|---|---:|");
  for (const p of report.byProvider) {
    lines.push(`| ${p.provider} | ${p.calls} | ${p.pct}% | ${p.models.join(", ")} | $${p.costUsd.toFixed(2)} |`);
  }
  lines.push("");

  // Daily breakdown
  if (report.byDay.length > 0) {
    lines.push("## Daily breakdown");
    lines.push("");
    lines.push("| Date | Calls | Cost (USD) |");
    lines.push("|---|---:|---:|");
    for (const d of report.byDay) {
      lines.push(`| ${d.date} | ${d.calls} | $${d.costUsd.toFixed(2)} |`);
    }
    lines.push("");
  }

  // Notes
  if (report.notes.length > 0) {
    lines.push("## Notes");
    lines.push("");
    for (const note of report.notes) {
      lines.push(`- ${note}`);
    }
    lines.push("");
  }

  // Footer
  lines.push("## How to use this report");
  lines.push("");
  lines.push("Paste this report into your chat and ask:");
  lines.push("");
  lines.push("> Based on this usage data, what patterns do you see? What should I consider");
  lines.push("> when planning my usage? Any models I should switch to, or times of day I should");
  lines.push("> avoid heavy usage?");
  lines.push("");
  lines.push("The LLM will give you a personalized recommendation. You decide what to do with it.");
  lines.push("");

  return lines.join("\n");
}
