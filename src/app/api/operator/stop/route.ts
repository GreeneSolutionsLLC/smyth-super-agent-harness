/**
 * POST /api/operator/stop
 *
 * Stop a running Warden engagement. Body: { sessionId, reason? }
 * Returns: { sessionId, status, stopReason }
 */

import { NextRequest, NextResponse } from "next/server";
import { stopEngagement, getEngagement } from "@/lib/operator/engagement-store";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId, reason } = body || {};

    if (!sessionId || typeof sessionId !== "string") {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }

    const existing = getEngagement(sessionId);
    if (!existing) {
      return NextResponse.json({ error: "engagement not found" }, { status: 404 });
    }

    const updated = stopEngagement(sessionId, reason || "stopped by user");
    return NextResponse.json({
      sessionId,
      status: updated?.status,
      stopReason: updated?.stopReason,
      totalDecisions: updated?.decisions.length,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
