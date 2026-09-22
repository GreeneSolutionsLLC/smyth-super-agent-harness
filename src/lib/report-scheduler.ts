/**
 * 24-hour Report Scheduler
 *
 * Runs the optimization report generator:
 *   1. Once immediately on first call (so the OpsPanel has initial data)
 *   2. Then every day at 08:00 WITA (Asia/Makassar, UTC+8) indefinitely
 *
 * The setTimeout-based approach survives as long as the Node process is alive.
 * On server restart, if the last run was <24h ago, skips the initial run.
 *
 * Usage:
 *   import { startReportScheduler } from "@/lib/report-scheduler";
 *   startReportScheduler();  // idempotent — only starts once
 */

import { generateReport, getLastRunAt } from "./optimization-report";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
let started = false;

/**
 * Compute the next 08:00 WITA (UTC+8) from a given date.
 * Returns the Date in local server time equivalent to 8am Jakarta.
 */
function next8amWITA(from: Date = new Date()): Date {
  // WITA = UTC+8. Build a date string in WITA for today at 08:00,
  // then figure out what that is in server-local time.
  const witaFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Makassar",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  // Get today's date in WITA
  const parts = witaFormatter.formatToParts(from);
  const get = (type: string) => parts.find(p => p.type === type)?.value || "00";
  const todayWITA = `${get("year")}-${get("month")}-${get("day")}`;
  const targetWITA = `${todayWITA}T08:00:00`;

  // Parse: what UTC time corresponds to 08:00 WITA?
  // WITA is UTC+8, so 08:00 WITA = 00:00 UTC
  const [y, m, d] = todayWITA.split("-").map(Number);
  const targetUTC = new Date(Date.UTC(y, m - 1, d, 0, 0, 0)); // 08:00 WITA = 00:00 UTC

  // If today's 8am WITA is already past, aim for tomorrow
  if (targetUTC.getTime() <= from.getTime()) {
    const tomorrow = new Date(targetUTC.getTime() + ONE_DAY_MS);
    return tomorrow;
  }
  return targetUTC;
}

/**
 * Generate report and log result.
 */
function runReport(): void {
  try {
    console.log("[report-scheduler] Running optimization report generation");
    const report = generateReport();
    console.log(
      `[report-scheduler] Report generated: ${report.summary.totalCalls} calls, ` +
      `$${report.summary.totalCostUsd.toFixed(2)} cost, ` +
      `${report.summary.uniqueModels} models / ${report.summary.uniqueProviders} providers`
    );
  } catch (err: any) {
    console.error("[report-scheduler] Report generation failed:", err?.message || err);
  }
}

/**
 * Schedule the next daily run at 08:00 WITA.
 * Uses setTimeout (not setInterval) so each run recalculates the correct
 * next-8am time, immune to clock drift.
 */
function scheduleNextDaily(): void {
  const next = next8amWITA();
  const delayMs = next.getTime() - Date.now();
  const nextWITA = next.toLocaleString("en-US", { timeZone: "Asia/Makassar" });

  console.log(`[report-scheduler] Next daily run at ${nextWITA} WITA (in ${Math.round(delayMs / ONE_HOUR_MS)}h ${Math.round((delayMs % ONE_HOUR_MS) / 60000)}m)`);

  if (timeoutHandle) clearTimeout(timeoutHandle);
  timeoutHandle = setTimeout(() => {
    runReport();
    scheduleNextDaily(); // reschedule for the following day
  }, delayMs);
}

/**
 * Should we run the initial (immediate) generation?
 * Skip if a report already exists and is <24h old.
 */
function shouldRunNow(): boolean {
  const lastRun = getLastRunAt();
  if (!lastRun) return true;
  const elapsed = Date.now() - new Date(lastRun).getTime();
  return elapsed > ONE_DAY_MS - ONE_HOUR_MS; // 23 hours
}

export function startReportScheduler(): void {
  if (started) return;
  started = true;

  // Run once immediately if no recent report exists
  if (shouldRunNow()) {
    console.log("[report-scheduler] Generating initial report (first call)");
    runReport();
  } else {
    console.log("[report-scheduler] Recent report exists, skipping initial run");
  }

  // Schedule the recurring daily 08:00 WITA run
  scheduleNextDaily();
}

export function stopReportScheduler(): void {
  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
    timeoutHandle = null;
  }
  started = false;
}
