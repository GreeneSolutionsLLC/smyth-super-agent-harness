import { NextRequest, NextResponse } from "next/server";

const FLASK_URL = "http://localhost:5001";

/**
 * GET /api/scheduling/transcript?booking_id=xxx
 * POST /api/scheduling/transcript  { booking_id, transcript, summary, action_items, key_decisions, duration_seconds }
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const bookingId = searchParams.get("booking_id");

  if (!bookingId) {
    return NextResponse.json({ error: "booking_id is required" }, { status: 400 });
  }

  try {
    const res = await fetch(`${FLASK_URL}/api/bookings/${bookingId}/transcript`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return NextResponse.json(data, { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: any) {
    console.error("[scheduling/transcript] GET error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { booking_id, transcript, summary, action_items, key_decisions, duration_seconds } = body;

    if (!booking_id) {
      return NextResponse.json({ error: "booking_id is required" }, { status: 400 });
    }

    const res = await fetch(`${FLASK_URL}/api/bookings/${booking_id}/transcript`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transcript: transcript || [],
        summary: summary || "",
        action_items: action_items || [],
        key_decisions: key_decisions || [],
        duration_seconds: duration_seconds || 0,
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return NextResponse.json(data, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data, { status: 201 });
  } catch (err: any) {
    console.error("[scheduling/transcript] POST error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}