import { NextResponse } from "next/server";
import { getPoolStats } from "@/lib/pool-router";
import { getGovernorState } from "@/lib/rate-governor";

export async function GET() {
  const poolStats = getPoolStats();
  const governor = getGovernorState();

  return NextResponse.json({
    pools: {
      machine: {
        ...poolStats.machine,
        governor,
      },
      maetryxx: {
        ...poolStats.maetryxx,
        governor,
      },
    },
    timestamp: Date.now(),
  });
}