import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

// ── Token storage (same path as http-client.ts) ──
const TOKEN_FILE = path.join(process.cwd(), ".mcp-oauth-tokens.json");
const OAUTH_STATE_DIR = path.join(process.cwd(), ".mcp-oauth");

function loadStoredTokens(): Record<string, any> {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8"));
    }
  } catch (e) {
    console.error(`[mcp-oauth] Failed to load token file:`, e);
  }
  return {};
}

function storeTokens(serverName: string, tokens: any) {
  try {
    const existing = loadStoredTokens();
    existing[serverName] = tokens;
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(existing, null, 2));
    console.log(`[mcp-oauth] Stored tokens for "${serverName}"`);
  } catch (e) {
    console.error(`[mcp-oauth] Failed to store tokens:`, e);
  }
}

// ── GET /api/mcp/oauth/callback ──
// Canva redirects here with ?code=...&state=...
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");

    if (error) {
      const errorDesc = searchParams.get("error_description") || error;
      console.error(`[mcp-oauth] OAuth error: ${errorDesc}`);
      return new NextResponse(renderResult(false, errorDesc), {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (!code || !state) {
      return new NextResponse(renderResult(false, "Missing code or state parameter"), {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // Load PKCE state
    const stateFile = path.join(OAUTH_STATE_DIR, `${state}.json`);
    if (!fs.existsSync(stateFile)) {
      return new NextResponse(renderResult(false, "Invalid or expired OAuth state"), {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    const stateData = JSON.parse(fs.readFileSync(stateFile, "utf-8"));

    // Clean up state file
    try { fs.unlinkSync(stateFile); } catch {}

    // Check expiry (10 min)
    if (Date.now() - stateData.createdAt > 10 * 60 * 1000) {
      return new NextResponse(renderResult(false, "OAuth state expired"), {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // Exchange code for tokens
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: stateData.redirectUri,
      client_id: stateData.clientId,
      code_verifier: stateData.codeVerifier,
    });

    // Add client_secret if we have one
    if (stateData.clientSecret) {
      body.set("client_secret", stateData.clientSecret);
    }

    const tokenRes = await fetch(stateData.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(15000),
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      console.error(`[mcp-oauth] Token exchange failed: ${tokenRes.status} ${text.slice(0, 300)}`);
      return new NextResponse(renderResult(false, `Token exchange failed: ${tokenRes.status}`), {
        status: 502,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    const tokenData = await tokenRes.json();
    const tokens = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: tokenData.expires_in ? Date.now() + tokenData.expires_in * 1000 : undefined,
      scope: tokenData.scope,
      token_type: tokenData.token_type || "Bearer",
    };

    // Store tokens
    storeTokens(stateData.serverName, tokens);

    console.log(`[mcp-oauth] OAuth flow complete for "${stateData.serverName}" — tokens stored`);

    return new NextResponse(renderResult(true, stateData.serverName), {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (err: any) {
    console.error(`[mcp-oauth] Callback error: ${err.message}`);
    return new NextResponse(renderResult(false, err.message), {
      status: 500,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
}

// ── HTML result page ──
function renderResult(success: boolean, info: string): string {
  const status = success ? "✅ Connected" : "❌ Failed";
  const message = success
    ? `Canva MCP is now connected. You can close this tab and return to Smyth.`
    : `Connection failed: ${info}`;
  const color = success ? "#22c55e" : "#ef4444";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Smyth MCP — ${status}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #0a0a0a;
    color: #fafafa;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
  }
  .card {
    background: #141414;
    border: 1px solid #262626;
    border-radius: 16px;
    padding: 48px 40px;
    max-width: 440px;
    text-align: center;
  }
  .icon { font-size: 48px; margin-bottom: 16px; }
  h1 { font-size: 20px; font-weight: 600; margin-bottom: 12px; }
  p { font-size: 14px; color: #a3a3a3; line-height: 1.5; }
  .server { color: ${color}; font-weight: 500; margin-top: 8px; }
</style>
</head>
<body>
  <div class="card">
    <div class="icon">${success ? "✅" : "❌"}</div>
    <h1>${status}</h1>
    <p>${message}</p>
    ${success ? `<p class="server">${info}</p>` : ""}
  </div>
</body>
</html>`;
}