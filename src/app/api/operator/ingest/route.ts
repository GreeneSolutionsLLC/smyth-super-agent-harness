/**
 * POST /api/operator/ingest
 *
 * The page posts its chat state here on a 5s timer. The Warden reads the latest
 * state when it ticks. This is a write-only endpoint from the page's side; the
 * Warden never calls it.
 */

import { NextRequest, NextResponse } from "next/server";
import { ingestChatState } from "@/lib/operator/chat-state";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "invalid payload" }, { status: 400 });
    }
    ingestChatState(body);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
