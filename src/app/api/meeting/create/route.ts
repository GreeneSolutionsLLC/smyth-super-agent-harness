import { NextRequest, NextResponse } from "next/server";

const DAILY_API_KEY = process.env.DAILY_API_KEY;
const DAILY_DOMAIN = process.env.DAILY_DOMAIN || "smyth-meet";

/**
 * POST /api/meeting/create
 *
 * Create (or fetch if exists) a Daily.co room.
 * Body: { roomName, displayName, isHost?, bookingId? }
 * Returns: { roomUrl, roomName, domain }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { roomName, displayName, isHost, bookingId } = body;

    if (!roomName) {
      return NextResponse.json(
        { error: "roomName is required" },
        { status: 400 }
      );
    }

    if (!DAILY_API_KEY) {
      return NextResponse.json(
        { error: "Daily.co is not configured (DAILY_API_KEY missing)" },
        { status: 500 }
      );
    }

    // Sanitize roomName — Daily.co allows alphanumeric, hyphens, underscores
    const safeName = roomName.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();

    // Build room properties
    const roomProperties: Record<string, any> = {
      enable_chat: true,
      enable_knocking: true,           // host-approval lobby
      start_video_off: !isHost,
      start_audio_off: !isHost,
      exp: Math.floor(Date.now() / 1000) + 86400, // 24h expiry
    };

    // Create the room
    console.log("[meeting/create] Creating room:", { name: safeName, isHost, bookingId });
    const resp = await fetch("https://api.daily.co/v1/rooms", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DAILY_API_KEY}`,
      },
      body: JSON.stringify({
        name: safeName,
        privacy: "public",      // anyone with the URL can knock
        properties: roomProperties,
      }),
    });

    const roomData = await resp.json();
    console.log("[meeting/create] Daily.co response:", { status: resp.status, data: roomData });

    // Handle room-already-exists — Daily.co returns 400, not 409
    if (!resp.ok && roomData.info && roomData.info.includes("already exists")) {
      const getResp = await fetch(
        `https://api.daily.co/v1/rooms/${safeName}`,
        { headers: { Authorization: `Bearer ${DAILY_API_KEY}` } }
      );
      const existingRoom = await getResp.json();

      if (!getResp.ok) {
        return NextResponse.json(
          { error: existingRoom.error || "Failed to get existing room" },
          { status: getResp.status }
        );
      }

      console.log("[meeting/create] Room already exists, returning existing:", existingRoom.url);

      return NextResponse.json({
        roomUrl: existingRoom.url,
        roomName: safeName,
        domain: `${DAILY_DOMAIN}.daily.co`,
      });
    }

    if (!resp.ok) {
      console.error("[meeting/create] Daily.co error:", roomData);
      return NextResponse.json(
        { error: roomData.error || "Failed to create meeting room" },
        { status: resp.status }
      );
    }

    const roomUrl = roomData.url;

    // Persist meeting link back into Flask booking if bookingId provided
    if (bookingId) {
      try {
        await fetch(`http://localhost:5001/api/bookings/${bookingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ meeting_link: roomUrl }),
        });
      } catch (e) {
        // Non-critical — don't fail the request
        console.warn(
          "[meeting/create] Failed to save meeting_link to booking:",
          e
        );
      }
    }

    return NextResponse.json({
      roomUrl,
      roomName: safeName,
      domain: `${DAILY_DOMAIN}.daily.co`,
    });
  } catch (err: any) {
    console.error("[meeting/create] Error:", err);
    return NextResponse.json(
      { error: err.message || "Internal server error" },
      { status: 500 }
    );
  }
}
