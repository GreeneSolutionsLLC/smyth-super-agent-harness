/**
 * GET /api/operator/status?sessionId=X
 *
 * Get the current state of an engagement. Returns: { sessionId, status, decisions, policy, ... }
 */

import { NextRequest, NextResponse } from "next/server";
import { getEngagement } from "@/lib/operator/engagement-store";

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId query param required" }, { status: 400 });
  }
  const engagement = getEngagement(sessionId);
  if (!engagement) {
    return NextResponse.json({ error: "engagement not found" }, { status: 404 });
  }
  return NextResponse.json(engagement);
}
