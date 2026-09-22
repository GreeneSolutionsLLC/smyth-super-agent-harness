import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/meeting/token
 *
 * Generate a JWT token for Jitsi Meet authentication.
 * This allows authenticated users to join meetings with moderator privileges.
 *
 * Body: { roomName: string, displayName: string, isHost?: boolean }
 * Returns: { token: string, roomName: string, url: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { roomName, displayName, isHost } = body;

    if (!roomName || !displayName) {
      return NextResponse.json(
        { error: "roomName and displayName are required" },
        { status: 400 }
      );
    }

    // For now, use the public Jitsi instance (meet.jit.si) which doesn't require JWT.
    // When self-hosting, generate a proper JWT with the app secret.
    // 
    // const jwt = require('jsonwebtoken');
    // const token = jwt.sign({
    //   context: {
    //     user: {
    //       name: displayName,
    //       moderator: isHost || false,
    //     },
    //   },
    //   aud: process.env.JWT_APP_ID || 'smyth-meeting',
    //   iss: process.env.JWT_APP_ID || 'smyth-meeting',
    //   sub: process.env.JWT_DOMAIN || 'meet.smyth.app',
    //   room: roomName,
    // }, process.env.JWT_APP_SECRET || 'secret', { expiresIn: '24h' });

    // Use HTTPS public URL, not localhost
    const baseUrl = process.env.NEXT_PUBLIC_URL || "https://smythagentapp.greene-solutions.com";
    const meetingUrl = `${baseUrl}/meeting/${roomName.replace("smyth-", "")}`;

    return NextResponse.json({
      roomName,
      url: meetingUrl,
      // token, // Uncomment when self-hosting with JWT auth
      domain: process.env.NEXT_PUBLIC_JITSI_DOMAIN || "meet.jit.si",
    });
  } catch (err: any) {
    console.error("[meeting/token] Error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to generate meeting token" },
      { status: 500 }
    );
  }
}