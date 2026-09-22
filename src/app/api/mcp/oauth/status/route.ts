import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

const TOKEN_FILE = path.join(process.cwd(), ".mcp-oauth-tokens.json");

// GET /api/mcp/oauth/status?server=canva
export async function GET(req: NextRequest) {
  try {
    const serverName = new URL(req.url).searchParams.get("server") || "canva";
    
    if (!fs.existsSync(TOKEN_FILE)) {
      return NextResponse.json({ connected: false });
    }

    const tokens = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8"));
    const serverTokens = tokens[serverName];

    if (!serverTokens) {
      return NextResponse.json({ connected: false });
    }

    const expired = serverTokens.expires_at && Date.now() >= serverTokens.expires_at;
    const hasRefresh = !!serverTokens.refresh_token;
    // 2026-08-22: report needsRefresh distinctly from "expired".
    // expired && hasRefresh → http-client will silently refresh; no popup needed.
    // expired && !hasRefresh → forces the OAuth popup.
    // !expired && hasRefresh → healthy (green).
    // !expired && !hasRefresh → healthy long-lived (green).
    // Still useful: warn the UI if the token is within 5 minutes of expiry
    // even if a refresh_token is available, so the panel can show "refreshing".
    const expiringSoon = serverTokens.expires_at
      && Date.now() < serverTokens.expires_at
      && serverTokens.expires_at - Date.now() < 5 * 60 * 1000;

    return NextResponse.json({
      connected: true,
      expired: expired && !hasRefresh,
      // New: explicitly tells the UI when a silent refresh will happen soon
      // so users aren't surprised by sub-millisecond re-auth.
      needsRefresh: !!expired || !!expiringSoon,
      expiresAt: serverTokens.expires_at,
      hasRefreshToken: hasRefresh,
    });
  } catch (err: any) {
    return NextResponse.json({ connected: false, error: err.message });
  }
}