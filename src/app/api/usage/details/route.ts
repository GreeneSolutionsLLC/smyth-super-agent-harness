/**
 * GET /api/usage/details
 *
 * Returns the current optimization report (summary + per-model + per-provider +
 * daily breakdown). The OpsPanel Usage tab reads this to show the card.
 *
 * 5s in-memory cache so rapid polling doesn't hammer the file system.
 */

import { NextResponse } from "next/server";
import { loadReport, type OptimizationReport } from "@/lib/optimization-report";

export const dynamic = "force-dynamic";

let cache: { data: OptimizationReport | null; expiresAt: number } | null = null;
const CACHE_TTL_MS = 5_000;

export async function GET() {
  if (cache && cache.expiresAt > Date.now()) {
    return NextResponse.json({ report: cache.data, cached: true });
  }
  const report = loadReport();
  cache = { data: report, expiresAt: Date.now() + CACHE_TTL_MS };
  return NextResponse.json({ report, cached: false });
}
