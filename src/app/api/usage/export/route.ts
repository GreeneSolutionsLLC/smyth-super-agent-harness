/**
 * GET /api/usage/export
 *
 * Generates and serves the optimization report as a downloadable .md file.
 * The user clicks "Download full report" in the OpsPanel Usage tab, this
 * endpoint formats the cached report as Markdown, returns it with a
 * Content-Disposition header for browser download.
 *
 * If no report exists yet (background hasn't run), generates one on demand
 * from the current usage log.
 */

import { NextResponse } from "next/server";
import { loadReport, generateReport, reportToMarkdown } from "@/lib/optimization-report";

export const dynamic = "force-dynamic";

export async function GET() {
  let report = loadReport();
  if (!report) {
    // No cached report — generate one on demand
    report = generateReport();
  }
  const markdown = reportToMarkdown(report);
  const filename = `smyth-usage-${report.generatedAt.slice(0, 10)}.md`;
  return new NextResponse(markdown, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
