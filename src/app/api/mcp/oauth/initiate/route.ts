import { NextRequest, NextResponse } from "next/server";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

// ── Token/PKCE storage (shared with http-client.ts) ──
const OAUTH_STATE_DIR = path.join(process.cwd(), ".mcp-oauth");

function ensureStateDir() {
  if (!fs.existsSync(OAUTH_STATE_DIR)) fs.mkdirSync(OAUTH_STATE_DIR, { recursive: true });
}

// ── PKCE helpers ──
function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

function generateState(): string {
  return crypto.randomBytes(16).toString("hex");
}

// ── OAuth Metadata Discovery ──
async function discoverOAuthMetadata(serverUrl: string) {
  try {
    const baseUrl = new URL(serverUrl);
    const wellKnownUrl = `${baseUrl.origin}/.well-known/oauth-authorization-server`;
    console.log(`[mcp-oauth] Discovering OAuth metadata from ${wellKnownUrl}`);
    const res = await fetch(wellKnownUrl, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      console.warn(`[mcp-oauth] OAuth discovery failed: ${res.status}`);
      return null;
    }
    const metadata = await res.json();
    console.log(`[mcp-oauth] Discovered OAuth issuer: ${metadata.issuer}`);
    return metadata;
  } catch (err: any) {
    console.warn(`[mcp-oauth] OAuth discovery error: ${err.message}`);
    return null;
  }
}

// ── Dynamic Client Registration ──
async function registerDynamicClient(metadata: any, redirectUri: string) {
  try {
    if (!metadata.registration_endpoint) {
      console.warn(`[mcp-oauth] No registration_endpoint in OAuth metadata`);
      return null;
    }

    console.log(`[mcp-oauth] Registering dynamic client at ${metadata.registration_endpoint}`);
    const res = await fetch(metadata.registration_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Smyth Agent",
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        token_endpoint_auth_method: "none",
        response_types: ["code"],
        code_challenge_method: "S256",
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const text = await res.text();
      console.warn(`[mcp-oauth] Registration failed: ${res.status} ${text.slice(0, 200)}`);
      return null;
    }

    const client = await res.json();
    console.log(`[mcp-oauth] Registered client: ${client.client_id}`);
    return client;
  } catch (err: any) {
    console.warn(`[mcp-oauth] Registration error: ${err.message}`);
    return null;
  }
}

// ── POST /api/mcp/oauth/initiate ──
// Body: { serverName: string, serverUrl: string }
// Returns: { authUrl: string }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { serverName, serverUrl } = body;

    if (!serverName || !serverUrl) {
      return NextResponse.json({ error: "Missing serverName or serverUrl" }, { status: 400 });
    }

    // Discover OAuth metadata
    const metadata = await discoverOAuthMetadata(serverUrl);
    if (!metadata || !metadata.authorization_endpoint || !metadata.token_endpoint) {
      return NextResponse.json({ error: "OAuth metadata discovery failed" }, { status: 502 });
    }

    // Build redirect URI — public URL of this Smyth instance
    const publicUrl = process.env.NEXT_PUBLIC_APP_URL || `https://${req.headers.get("host")}`;
    const redirectUri = `${publicUrl}/api/mcp/oauth/callback`;

    // Dynamic client registration
    let clientId: string;
    let clientSecret: string | undefined;
    if (metadata.registration_endpoint) {
      const client = await registerDynamicClient(metadata, redirectUri);
      if (client) {
        clientId = client.client_id;
        clientSecret = client.client_secret;
      } else {
        clientId = "smyth-mcp-client";
      }
    } else {
      clientId = "smyth-mcp-client";
    }

    // Generate PKCE params
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = generateState();

    // Store PKCE state for the callback to retrieve
    ensureStateDir();
    const stateFile = path.join(OAUTH_STATE_DIR, `${state}.json`);
    fs.writeFileSync(stateFile, JSON.stringify({
      codeVerifier,
      codeChallenge,
      serverName,
      serverUrl,
      clientId,
      clientSecret,
      redirectUri,
      tokenEndpoint: metadata.token_endpoint,
      createdAt: Date.now(),
    }, null, 2));

    // Build authorization URL
    const authUrl = new URL(metadata.authorization_endpoint);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("code_challenge", codeChallenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("state", state);
    // Canva doesn't list scopes_supported, use default
    if (metadata.scopes_supported && metadata.scopes_supported.length > 0) {
      authUrl.searchParams.set("scope", metadata.scopes_supported.join(" "));
    }

    console.log(`[mcp-oauth] Initiated OAuth flow for "${serverName}" — redirect: ${redirectUri}`);

    return NextResponse.json({ authUrl: authUrl.toString() });
  } catch (err: any) {
    console.error(`[mcp-oauth] Initiate error: ${err.message}`);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}