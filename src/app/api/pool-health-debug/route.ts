import { NextResponse } from "next/server";
import { getPoolStats, clearCooldowns, snapshotHealth } from "@/lib/pool-router";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    stats: getPoolStats(),
    snapshot: snapshotHealth(),
    note: "POST here to clear scoped cooldowns. Body: { pool?: 'maetryxx'|'machine', account?: 'cloud'|'pro'|'cloudflare'|'nvidia' }",
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    pool?: "maetryxx" | "machine";
    account?: "cloud" | "pro" | "cloudflare" | "nvidia" | "local";
  };
  clearCooldowns(body.pool, body.account);
  return NextResponse.json({ ok: true, after: getPoolStats() });
}
