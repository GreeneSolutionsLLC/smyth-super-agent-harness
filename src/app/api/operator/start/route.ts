/**
 * POST /api/operator/start
 *
 * Start a new Warden engagement. Body: { task, chatSessionId, policyOverrides? }
 * Returns: { sessionId, policy, status }
 *
 * GET /api/operator/start
 *
 * List active engagements.
 */

import { NextRequest, NextResponse } from "next/server";
import { buildPolicy } from "@/lib/operator/policy";
import { createEngagement, listEngagements } from "@/lib/operator/engagement-store";
import { runTick, ensureIngestSubscription } from "@/lib/operator/tick";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { task, chatSessionId: rawChatSessionId, policyOverrides, llm } = body || {};

    if (!task || typeof task !== "string") {
      return NextResponse.json({ error: "task is required" }, { status: 400 });
    }
    // chatSessionId is optional — the tick loop will sync it from ingested
    // state once the user starts chatting.  This lets the user start the
    // Operator before sending the first message.
    const chatSessionId = typeof rawChatSessionId === "string" ? rawChatSessionId : null;

    const basePolicy = buildPolicy(task);
    const policy = policyOverrides ? { ...basePolicy, ...policyOverrides } : basePolicy;
    const engagement = createEngagement(chatSessionId, policy, llm);

    // Subscribe this engagement to chat-state ingests NOW (not on first tick).
    // Fixes the circular dependency: tick #1 needs chat state to decide, but
    // the subscription that feeds it chat state was only created inside tick.
    ensureIngestSubscription(engagement.sessionId, engagement.chatSessionId);

    // Kick off the first tick after a short delay so the page has time to
    // POST its initial state
    setTimeout(() => {
      runTick(engagement.sessionId, { source: "first" }).catch((e) => {
        console.error(`[operator] first tick error: ${e}`);
      });
    }, 5000);

    return NextResponse.json({
      sessionId: engagement.sessionId,
      policy,
      status: engagement.status,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ engagements: listEngagements() });
}
