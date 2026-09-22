// ── MCP HTTP Client ──
// Real MCP client for Streamable HTTP transport (the standard MCP protocol over HTTP).
// Full OAuth 2.0 PKCE support for remote MCP servers (like Canva).
// Supports auth tokens, session management, tool discovery, and tool calling.
//
// Works with any MCP server that uses the Streamable HTTP transport:
//   - OpenPencil (http://127.0.0.1:7600/mcp)
//   - Twenty CRM (http://localhost:4000/mcp, SSE)
//   - Canva (https://mcp.canva.com/mcp, OAuth PKCE)
//   - Any future HTTP-based MCP server

import * as crypto from "crypto";
import * as http from "http";
import * as url from "url";
import * as path from "path";
import * as fs from "fs";

export interface MCPHttpServerConfig {
  name: string;
  url: string;
  authToken?: string | null;
  headers?: Record<string, string>;
  enabled: boolean;
  description?: string;
}

interface MCPTool {
  name: string;
  description: string;
  inputSchema: any;
}

interface MCPSession {
  sessionId: string | null;
  initialized: boolean;
  tools: MCPTool[];
  lastUsed: number;
  // 2026-08-22: keep the resolved Bearer here so we don't ship
  // the stale disk token on every call. Refreshed proactively via
  // getValidToken() and updated after every successful OAuth flow.
  accessToken?: string | null;
  // When we proactively refreshed this token (epoch ms). Used so we
  // refresh again ~60s before expires_at instead of waiting for a 401.
  tokenRefreshedAt?: number;
}

interface OAuthMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
  response_types_supported?: string[];
  grant_types_supported?: string[];
  code_challenge_methods_supported?: string[];
}

// 2026-08-22: explicit error for the auto-auth-off case so callers
// can render a precise "Re-enable in MCP status panel" message instead
// of leaking the OAuth popup mechanics.
export class McpAuthRequiredError extends Error {
  readonly serverName: string;
  readonly code = "MCP_AUTH_REQUIRED";
  constructor(serverName: string, message: string) {
    super(message);
    this.name = "McpAuthRequiredError";
    this.serverName = serverName;
  }
}

interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  scope?: string;
  token_type?: string;
}

interface DynamicClient {
  client_id: string;
  client_secret?: string;
  client_id_issued_at?: number;
  client_secret_expires_at?: number;
}

// ── Token storage ──
const TOKEN_FILE = path.join(process.cwd(), ".mcp-oauth-tokens.json");

// 2026-08-22: per-server "auto-auth on token expiry" kill switch.
// When false, the http-client never opens the OAuth browser popup —
// expired-token tool calls throw a clear error instead. Rob clicks a
// toggle in the MCP status panel to flip it back on when he actually
// wants to re-auth. File format: { "<server-name>": { autoAuth: false } }.
// Default is false (opt-in) so the popups stop by default.
const AUTO_AUTH_FILE = path.join(process.cwd(), ".mcp-auto-auth.json");

function loadAutoAuthMap(): Record<string, { autoAuth: boolean }> {
  try {
    if (fs.existsSync(AUTO_AUTH_FILE)) {
      return JSON.parse(fs.readFileSync(AUTO_AUTH_FILE, "utf-8"));
    }
  } catch (e) {
    console.warn("[mcp-oauth] Failed to read auto-auth file:", e);
  }
  return {};
}

function isAutoAuthAllowed(serverName: string): boolean {
  const map = loadAutoAuthMap();
  const entry = map[serverName];
  // Default false — opt-in only. Rob saw too many surprise popups.
  return entry?.autoAuth === true;
}

function loadStoredTokens(): Record<string, OAuthTokens> {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8"));
    }
  } catch (e) {
    console.error(`[mcp-oauth] Failed to load token file:`, e);
  }
  return {};
}

function storeTokens(serverName: string, tokens: OAuthTokens): void {
  const all = loadStoredTokens();
  all[serverName] = tokens;
  try {
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(all, null, 2));
    console.log(`[mcp-oauth] Stored tokens for "${serverName}"`);
  } catch (e) {
    console.error(`[mcp-oauth] Failed to store tokens:`, e);
  }
}

function getStoredTokens(serverName: string): OAuthTokens | null {
  const all = loadStoredTokens();
  return all[serverName] || null;
}

function clearStoredTokens(serverName: string): void {
  const all = loadStoredTokens();
  delete all[serverName];
  try {
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(all, null, 2));
  } catch {}
}

// ── PKCE helpers ──
function base64URLEncode(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function sha256(buffer: string): Buffer {
  return crypto.createHash("sha256").update(buffer).digest();
}

function generateCodeVerifier(): string {
  return base64URLEncode(crypto.randomBytes(32));
}

function generateCodeChallenge(verifier: string): string {
  return base64URLEncode(sha256(verifier));
}

function generateState(): string {
  return base64URLEncode(crypto.randomBytes(16));
}

// ── OAuth Metadata Discovery ──
async function discoverOAuthMetadata(serverUrl: string): Promise<OAuthMetadata | null> {
  try {
    const baseUrl = new URL(serverUrl);
    const wellKnownUrl = `${baseUrl.origin}/.well-known/oauth-authorization-server`;
    console.log(`[mcp-oauth] Discovering OAuth metadata from ${wellKnownUrl}`);
    const res = await fetch(wellKnownUrl);
    if (!res.ok) {
      console.warn(`[mcp-oauth] OAuth discovery failed: ${res.status}`);
      return null;
    }
    const metadata = await res.json() as OAuthMetadata;
    console.log(`[mcp-oauth] Discovered OAuth issuer: ${metadata.issuer}`);
    return metadata;
  } catch (err: any) {
    console.warn(`[mcp-oauth] OAuth discovery error: ${err.message}`);
    return null;
  }
}

// ── Dynamic Client Registration ──
async function registerDynamicClient(
  metadata: OAuthMetadata,
  redirectUri: string,
): Promise<DynamicClient | null> {
  if (!metadata.registration_endpoint) {
    console.warn(`[mcp-oauth] No registration_endpoint in OAuth metadata`);
    return null;
  }

  try {
    console.log(`[mcp-oauth] Registering dynamic client at ${metadata.registration_endpoint}`);
    const res = await fetch(metadata.registration_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Smyth MCP Agent",
        redirect_uris: [redirectUri],
        response_types: ["code"],
        grant_types: ["authorization_code", "refresh_token"],
        token_endpoint_auth_method: "none",
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.warn(`[mcp-oauth] Registration failed: ${res.status} ${text.slice(0, 200)}`);
      return null;
    }

    const client = await res.json() as DynamicClient;
    console.log(`[mcp-oauth] Registered client: ${client.client_id}`);
    return client;
  } catch (err: any) {
    console.warn(`[mcp-oauth] Registration error: ${err.message}`);
    return null;
  }
}

// ── Start local HTTP callback server ──
function startCallbackServer(port: number): Promise<{ code: string; state: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const parsed = url.parse(req.url || "", true);
      
      if (parsed.pathname === "/callback") {
        const code = parsed.query.code as string;
        const state = parsed.query.state as string;
        
        if (code) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`
            <html><body style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;background:#111;color:#0f0;">
              <div style="text-align:center;">
                <h1>✓ Authorized</h1>
                <p>Smyth is now connected. You can close this tab.</p>
              </div>
            </body></html>
          `);
          server.close();
          resolve({ code, state });
        } else {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end("<html><body><h1>Authorization failed</h1><p>No code received.</p></body></html>");
          server.close();
          reject(new Error("No code in callback"));
        }
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    server.listen(port, "127.0.0.1", () => {
      console.log(`[mcp-oauth] Callback server listening on http://127.0.0.1:${port}/callback`);
    });

    server.on("error", (err) => {
      reject(err);
    });
  });
}

// ── Find a free port ──
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as any).port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

// ── Open browser ──
function openBrowser(url: string): void {
  const { execSync } = require("child_process");
  const platform = process.platform;
  try {
    if (platform === "darwin") {
      execSync(`open "${url}"`, { timeout: 5000, shell: "/bin/zsh" });
    } else if (platform === "win32") {
      execSync(`start "" "${url}"`, { timeout: 5000, shell: "cmd.exe" });
    } else {
      execSync(`xdg-open "${url}"`, { timeout: 5000, shell: "/bin/bash" });
    }
  } catch (err: any) {
    console.warn(`[mcp-oauth] Failed to open browser: ${err.message}`);
    console.log(`[mcp-oauth] Please open this URL manually:\n${url}`);
  }
}

// ── Exchange authorization code for tokens ──
async function exchangeCodeForTokens(
  tokenEndpoint: string,
  clientId: string,
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<OAuthTokens | null> {
  try {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: codeVerifier,
    });

    const res = await fetch(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      console.warn(`[mcp-oauth] Token exchange failed: ${res.status} ${text.slice(0, 200)}`);
      return null;
    }

    const data = await res.json();
    const tokens: OAuthTokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
      scope: data.scope,
      token_type: data.token_type || "Bearer",
    };

    console.log(`[mcp-oauth] Token exchange succeeded (expires: ${tokens.expires_at ? new Date(tokens.expires_at).toISOString() : "never"})`);
    return tokens;
  } catch (err: any) {
    console.warn(`[mcp-oauth] Token exchange error: ${err.message}`);
    return null;
  }
}

// ── Refresh an access token ──
async function refreshAccessToken(
  tokenEndpoint: string,
  clientId: string,
  refreshToken: string,
): Promise<OAuthTokens | null> {
  try {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
    });

    const res = await fetch(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      console.warn(`[mcp-oauth] Token refresh failed: ${res.status} ${text.slice(0, 200)}`);
      return null;
    }

    const data = await res.json();
    const tokens: OAuthTokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || refreshToken,
      expires_at: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
      scope: data.scope,
      token_type: data.token_type || "Bearer",
    };

    console.log(`[mcp-oauth] Token refresh succeeded`);
    return tokens;
  } catch (err: any) {
    console.warn(`[mcp-oauth] Token refresh error: ${err.message}`);
    return null;
  }
}

// ── Full OAuth PKCE flow ──
async function performOAuthFlow(config: MCPHttpServerConfig): Promise<OAuthTokens | null> {
  // 2026-08-22: respect the per-server auto-auth kill switch. If Rob has
  // turned this off, NEVER open the browser. Surface a clear error so
  // he knows what to do.
  if (!isAutoAuthAllowed(config.name)) {
    console.warn(
      `[mcp-oauth] Refusing OAuth flow for "${config.name}" — auto-auth is OFF in the MCP status panel.`,
    );
    throw new McpAuthRequiredError(
      config.name,
      `Auto-auth disabled for "${config.name}". Enable it in the MCP status panel to re-authenticate.`,
    );
  }

  // 2026-08-22: dedup. If a flow is already in-flight for this server, await it.
  const existing = oauthFlowsInFlight.get(config.name);
  if (existing) {
    console.log(`[mcp-oauth] OAuth flow already in progress for "${config.name}" — joining`);
    return existing;
  }

  // If we just succeeded for this server within the debounce window, refuse to re-prompt.
  const lastOk = oauthLastSuccess.get(config.name) ?? 0;
  if (Date.now() - lastOk < OAUTH_DEBOUNCE_MS) {
    console.log(`[mcp-oauth] OAuth debounced for "${config.name}" (last success ${Math.round((Date.now() - lastOk) / 1000)}s ago)`);
    return null;
  }

  // Mark in-flight and run the actual flow
  const flowPromise = runOAuthFlow(config).finally(() => {
    oauthFlowsInFlight.delete(config.name);
  });
  oauthFlowsInFlight.set(config.name, flowPromise);

  const tokens = await flowPromise;
  if (tokens) {
    oauthLastSuccess.set(config.name, Date.now());
  }
  return tokens;
}

async function runOAuthFlow(config: MCPHttpServerConfig): Promise<OAuthTokens | null> {
  console.log(`[mcp-oauth] Starting OAuth PKCE flow for "${config.name}"`);

  const metadata = await discoverOAuthMetadata(config.url);
  if (!metadata) {
    console.error(`[mcp-oauth] Cannot proceed: no OAuth metadata for "${config.name}"`);
    return null;
  }

  if (!metadata.authorization_endpoint || !metadata.token_endpoint) {
    console.error(`[mcp-oauth] Missing auth/token endpoints for "${config.name}"`);
    return null;
  }

  // Find a free port for the callback
  const callbackPort = await findFreePort();
  const redirectUri = `http://127.0.0.1:${callbackPort}/callback`;

  // Dynamic client registration (no client ID needed)
  let clientId: string;
  if (metadata.registration_endpoint) {
    const client = await registerDynamicClient(metadata, redirectUri);
    if (!client) {
      // Fallback: try with a placeholder client ID (some servers accept it)
      console.warn(`[mcp-oauth] Registration failed, trying with placeholder client_id`);
      clientId = "smyth-mcp-client";
    } else {
      clientId = client.client_id;
    }
  } else {
    // No registration endpoint — use a placeholder
    console.warn(`[mcp-oauth] No registration endpoint, using placeholder client_id`);
    clientId = "smyth-mcp-client";
  }

  // Generate PKCE params
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();

  // Build authorization URL
  const authUrl = new URL(metadata.authorization_endpoint);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("scope", (metadata.scopes_supported || ["openid", "profile", "email"]).join(" "));

  // Start callback server and open browser simultaneously
  const callbackPromise = startCallbackServer(callbackPort);
  
  console.log(`[mcp-oauth] Opening browser for authorization...`);
  openBrowser(authUrl.toString());

  // Wait for the callback
  let authCode: string;
  try {
    const result = await callbackPromise;
    if (result.state !== state) {
      console.warn(`[mcp-oauth] State mismatch! Possible CSRF.`);
      return null;
    }
    authCode = result.code;
  } catch (err: any) {
    console.error(`[mcp-oauth] Callback error: ${err.message}`);
    return null;
  }

  // Exchange code for tokens
  const tokens = await exchangeCodeForTokens(
    metadata.token_endpoint,
    clientId,
    authCode,
    codeVerifier,
    redirectUri,
  );

  if (!tokens) {
    console.error(`[mcp-oauth] Failed to exchange code for tokens`);
    return null;
  }

  // Store tokens
  storeTokens(config.name, tokens);
  console.log(`[mcp-oauth] OAuth flow complete for "${config.name}"`);
  return tokens;
}

// ── Get valid token for a server (auto-refresh if needed) ──
async function getValidToken(config: MCPHttpServerConfig): Promise<string | null> {
  // Check if we have stored tokens
  const stored = getStoredTokens(config.name);
  if (!stored) return null;

  // Check if token is still valid (> 60s buffer)
  if (stored.expires_at && Date.now() < stored.expires_at - 60000) {
    return stored.access_token;
  }

  // Token expired or about to expire — try refresh
  if (stored.refresh_token) {
    console.log(`[mcp-oauth] Token expired, refreshing for "${config.name}"`);
    const metadata = await discoverOAuthMetadata(config.url);
    if (metadata?.token_endpoint) {
      const newTokens = await refreshAccessToken(
        metadata.token_endpoint,
        "smyth-mcp-client", // Will be overwritten if we have a stored client_id
        stored.refresh_token,
      );
      if (newTokens) {
        storeTokens(config.name, newTokens);
        console.log(`[mcp-oauth] Token refreshed silently for "${config.name}"`);
        return newTokens.access_token;
      }
    }
  }

  // Refresh failed — clear tokens (UI/API will surface "auth required")
  console.warn(`[mcp-oauth] Token refresh failed, clearing stored tokens for "${config.name}"`);
  clearStoredTokens(config.name);
  return null;
}

// 2026-08-22: Resolve a Bearer token for a server, with proactive refresh.
// Prior bug: loadHttpServerConfigs() returned the raw disk token verbatim
// even when it was expired. We then shipped that stale Bearer with every
// tools/call, got 401s, fired the OAuth browser popup, repeated 5x during
// a single Canva workflow. This helper refreshes transparently first.
async function resolveAuthToken(config: MCPHttpServerConfig): Promise<string | null> {
  // 2026-08-22: respect the per-server auto-auth kill switch. If Rob has
  // turned auto-auth off for this server, NEVER silently refresh and
  // NEVER trigger an OAuth popup. Surface a clear error so he can choose
  // when to re-auth.
  if (!isAutoAuthAllowed(config.name) && looksLikeOAuthServer(config)) {
    const stored = getStoredTokens(config.name);
    if (!stored) return config.authToken ?? null;
    const expired = stored.expires_at && Date.now() >= stored.expires_at;
    if (!expired && stored.access_token) {
      // Still valid — use it, but don't refresh.
      return stored.access_token;
    }
    // Expired and auto-auth is off. Bail out so the caller throws instead
    // of opening a popup.
    throw new McpAuthRequiredError(
      config.name,
      `Auto-auth disabled for "${config.name}". Re-enable in the MCP status panel to refresh.`,
    );
  }

  // Fire-and-forget warmer (proactive refresh of other servers' tokens).
  maybeRunWarmer();

  // 1. If the in-memory session already has a fresh Bearer, reuse it.
  const session = sessions.get(config.name);
  if (session?.accessToken) {
    const stored = getStoredTokens(config.name);
    if (stored?.expires_at) {
      const refreshedAt = session.tokenRefreshedAt ?? 0;
      const tokenLifetime = stored.expires_at - refreshedAt;
      const elapsed = Date.now() - refreshedAt;
      // If we still have >2min of validity vs the original lifetime, reuse.
      if (tokenLifetime > 0 && elapsed < tokenLifetime - 120_000) {
        return session.accessToken;
      }
    } else {
      // No expiry on disk — trust the cached token unless it's >12h old.
      if (Date.now() - (session.tokenRefreshedAt ?? 0) < 12 * 3600 * 1000) {
        return session.accessToken;
      }
    }
  }

  // 2. If we have a stored OAuth token (with refresh), refresh it
  //    transparently and use the new access_token. Covers both flagged
  //    OAuth servers (canva) and unflagged servers we've authed once
  //    before via OAuth (twenty).
  if (looksLikeOAuthServer(config)) {
    const stored = getStoredTokens(config.name);
    const oauthStale = stored?.expires_at && Date.now() >= stored.expires_at - 60_000;
    const oauthUncached = !session?.accessToken;
    if (oauthStale || oauthUncached) {
      const fresh = await getValidToken(config);
      if (fresh) {
        if (session) {
          session.accessToken = fresh;
          session.tokenRefreshedAt = Date.now();
        }
        return fresh;
      }
    }
  }

  // 3. Use whatever authToken was loaded from YAML/manual Bearer.
  if (config.authToken) return config.authToken;

  // 4. Last resort: nothing worked. Caller will get a 401 and trigger OAuth.
  return null;
}

function looksLikeOAuthServer(config: MCPHttpServerConfig): boolean {
  // Same heuristic as loadHttpServerConfigs.
  // 2026-08-22: ALSO consider a server OAuth-capable if we have a stored
  // OAuth token for it on disk. Twenty's YAML has no `oauth: true` flag
  // (the JWT lives in headers), but we ran the OAuth flow once and have a
  // refresh_token stored. Without this, the resolver skipped Twenty's
  // stored token and shipped the stale YAML Bearer → 401 → browser popup.
  if (Boolean((config as any).oauth || (config as any).oauth_enabled)) return true;
  return Boolean(getStoredTokens(config.name)?.refresh_token);
}

// Inline Bearer pull used by initializeServer for the very first handshake
// (sessions map may be empty). Same refresh logic as resolveAuthToken.
async function freshTokenFor(config: MCPHttpServerConfig): Promise<string | null> {
  if (looksLikeOAuthServer(config)) {
    return await getValidToken(config);
  }
  return config.authToken ?? null;
}

// ── Is this a 401 error that indicates OAuth is needed? ──
function isAuthError(error: any): boolean {
  const errStr = JSON.stringify(error).toLowerCase();
  return (
    error?.code === 401 ||
    errStr.includes("unauthorized") ||
    errStr.includes("invalid_token") ||
    errStr.includes("missing token") ||
    errStr.includes("authentication required")
  );
}

// Session TTL: 24 hours. Was 10 min (2026-08-22). The short TTL caused
// Canva's MCP session to be recreated frequently, and any transient 401
// during re-initialize opened the OAuth browser popup — interrupting the
// user mid-workflow. 24h is well within typical OAuth refresh-token lifetimes.
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

// Track initialization in progress to prevent concurrent session creation
const initPromises = new Map<string, Promise<MCPSession | null>>();

// 2026-08-22: dedup OAuth PKCE flows. Without this, a 401 on Canva triggers
// a fresh browser popup every few minutes (every model switch, every session
// expiry). With dedup: only one in-flight OAuth per server; subsequent 401s
// within the debounce window just refresh the token silently.
const oauthFlowsInFlight = new Map<string, Promise<OAuthTokens | null>>();
const oauthLastSuccess = new Map<string, number>(); // server name → epoch ms
// 2026-08-22: 60s was too short. After one popup, Rob was seeing more
// popups within the same workflow because tool-call chains passed through
// the 60s window repeatedly. Bumped to 10 minutes — Canva/Claude MCP
// refresh tokens are valid for ~24h, so a successful auth guarantees
// fresh access for the next 10 minutes with no UI interruption.
const OAUTH_DEBOUNCE_MS = 10 * 60 * 1000;

// ── Send a session DELETE to clean up server-side ──
async function deleteSession(url: string, sessionId: string, authToken?: string | null, extraHeaders?: Record<string, string>) {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...extraHeaders,
    };
    if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
    headers["Mcp-Session-Id"] = sessionId;
    await fetch(url, { method: "DELETE", headers, signal: AbortSignal.timeout(5000) });
  } catch {
    // Best effort — ignore errors
  }
}

// Load HTTP-type MCP server configs from mcp-servers.yaml
export function loadHttpServerConfigs(): MCPHttpServerConfig[] {
  try {
    const { readFileSync, existsSync } = require("fs");
    const { join } = require("path");
    const yaml = require("js-yaml");
    const configPath = join(process.cwd(), "mcp-servers.yaml");
    if (!existsSync(configPath)) return [];

    const rawYaml = readFileSync(configPath, "utf-8");
    // Replace ${VAR} placeholders so disabled servers don't break YAML parsing.
    const substitutedYaml = rawYaml.replace(/\$\{([A-Za-z0-9_]+)\}/g, (_match: string, varName: string) => process.env[varName] ?? "");
    const config = yaml.load(substitutedYaml) as any;
    const servers = config?.servers || {};
    const result: MCPHttpServerConfig[] = [];

    for (const [name, serverConfig] of Object.entries(servers) as [string, any]) {
      // Include both "http" and "sse" transport servers that have a URL
      if ((serverConfig.transport === "http" || serverConfig.transport === "sse") && serverConfig.url) {
        // Extract auth token from headers if present
        let authToken: string | null = null;
        if (serverConfig.headers) {
          for (const [key, value] of Object.entries(serverConfig.headers)) {
            if (key.toLowerCase() === "authorization" && typeof value === "string" && value.startsWith("Bearer ")) {
              authToken = value.slice("Bearer ".length);
            }
          }
        }

        // 2026-08-22: ALWAYS consult stored OAuth tokens, even when the
        // YAML entry has no `oauth: true` flag. Twenty's JWT lived in
        // headers.Authorization but we ran an OAuth flow against it
        // before, so .mcp-oauth-tokens.json has a fresher token + a
        // refresh_token. Without this branch, Twenty kept shipping the
        // stale YAML JWT, hit 401, and opened the OAuth popup.
        //
        // Precedence: stored token wins if (a) it has a refresh_token OR
        // (b) its expires_at is in the future. Otherwise we keep the
        // YAML Bearer as a fallback for non-OAuth hardcoded tokens.
        const stored = loadStoredTokens();
        const storedForServer = stored[name];
        if (storedForServer) {
          const stillFresh = !storedForServer.expires_at
            || Date.now() < storedForServer.expires_at - 60_000;
          const hasRefresh = !!storedForServer.refresh_token;
          if (hasRefresh || stillFresh) {
            authToken = storedForServer.access_token;
          }
        }

        // Also check for explicit OAuth flag in server config (legacy path)
        if ((serverConfig.oauth_enabled || serverConfig.oauth) && !authToken && storedForServer) {
          authToken = storedForServer.access_token;
        }

        result.push({
          name,
          url: serverConfig.url,
          authToken,
          headers: serverConfig.headers || {},
          enabled: serverConfig.enabled !== false,
          description: serverConfig.description || "",
        });
      }
    }

    return result;
  } catch (err: any) {
    console.error(`[mcp-http] Failed to load configs:`, err.message);
    return [];
  }
}

// In-memory session store (per server)
const sessions = new Map<string, MCPSession>();

function getSession(serverName: string): MCPSession | null {
  const session = sessions.get(serverName);
  if (!session) return null;
  // Check TTL
  if (Date.now() - session.lastUsed > SESSION_TTL_MS) {
    sessions.delete(serverName);
    return null;
  }
  return session;
}

function touchSession(serverName: string) {
  const session = sessions.get(serverName);
  if (session) session.lastUsed = Date.now();
}

// ── JSON-RPC helper ──
async function rpcCall(
  url: string,
  method: string,
  params: any,
  authToken?: string | null,
  sessionId?: string | null,
  extraHeaders?: Record<string, string>,
): Promise<{ result?: any; error?: any; sessionId?: string | null; status?: number }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
    ...extraHeaders,
  };
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }
  if (sessionId) {
    headers["Mcp-Session-Id"] = sessionId;
  }

  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: Date.now(),
    method,
    params: params || {},
  });

  const res = await fetch(url, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(10000),
  });

  // Extract session ID from response headers
  const responseSessionId = res.headers.get("mcp-session-id") || sessionId || null;

  if (!res.ok) {
    const text = await res.text();
    return { error: { code: res.status, message: text.slice(0, 500) }, sessionId: responseSessionId, status: res.status };
  }

  const contentType = res.headers.get("content-type") || "";

  if (contentType.includes("text/event-stream")) {
    // Parse SSE — read the full body and extract data lines
    const text = await res.text();
    const lines = text.split("\n");
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const data = JSON.parse(line.slice(6));
          return { result: data.result, error: data.error, sessionId: responseSessionId };
        } catch {}
      }
    }
    return { error: { code: 0, message: "No data in SSE response" }, sessionId: responseSessionId };
  }

  // JSON response
  const data = await res.json();
  return { result: data.result, error: data.error, sessionId: responseSessionId };
}

// ── Auto-discover auth token from health endpoint (for OpenPencil) ──
async function discoverAuthToken(url: string, existingToken?: string | null): Promise<string | null> {
  try {
    const healthUrl = new URL("/health", url).origin + "/health";
    const res = await fetch(healthUrl, { method: "GET" });
    if (!res.ok) return existingToken || null;
    const data = await res.json() as any;
    if (data.authRequired && data.token) {
      console.log(`[mcp-http] Auto-discovered auth token from ${healthUrl}`);
      return data.token;
    }
    return existingToken || null;
  } catch {
    return existingToken || null;
  }
}

// ── Initialize a session with an MCP server ──
// Uses a singleton pattern: only one session per server, ever.
// If a session exists, we try to reuse it. If it's dead, we DELETE it first.
async function initializeServer(config: MCPHttpServerConfig): Promise<MCPSession | null> {
  // Prevent concurrent initializations for the same server
  const existing = initPromises.get(config.name);
  if (existing) return existing;

  const promise = (async () => {
    try {
      // Clean up any existing session before creating a new one
      const oldSession = sessions.get(config.name);
      if (oldSession?.sessionId) {
        console.log(`[mcp-http] Cleaning up old session for "${config.name}"`);
        await deleteSession(config.url, oldSession.sessionId, config.authToken, config.headers);
        sessions.delete(config.name);
      }

      // Auto-discover auth token — OpenPencil generates a new one on every launch,
      // so always prefer the live token over whatever is hardcoded in the YAML.
      let authToken = await discoverAuthToken(config.url, config.authToken);
      
      // If no local token found, try OAuth stored tokens
      if (!authToken) {
        authToken = await getValidToken(config);
      }

      if (authToken) {
        config.authToken = authToken;
        if (!config.headers) config.headers = {};
        config.headers["Authorization"] = `Bearer ${authToken}`;
      }

      const { result, error, sessionId, status } = await rpcCall(
        config.url,
        "initialize",
        {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "smyth", version: "1.0.0" },
        },
        authToken,
        undefined,
        config.headers,
      );

      // ── Handle 401 / auth errors → trigger OAuth PKCE flow ──
      if (error && (isAuthError(error) || status === 401)) {
        console.log(`[mcp-http] Auth required for "${config.name}", starting OAuth PKCE flow...`);
        
        const tokens = await performOAuthFlow(config);
        if (!tokens) {
          console.error(`[mcp-http] OAuth flow failed for "${config.name}"`);
          return null;
        }

        // Retry with the new token
        config.authToken = tokens.access_token;
        if (!config.headers) config.headers = {};
        config.headers["Authorization"] = `Bearer ${tokens.access_token}`;

        const retryResult = await rpcCall(
          config.url,
          "initialize",
          {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "smyth", version: "1.0.0" },
          },
          tokens.access_token,
          undefined,
          config.headers,
        );

        if (retryResult.error) {
          console.error(`[mcp-http] Initialize failed for "${config.name}" after OAuth:`, JSON.stringify(retryResult.error));
          return null;
        }

        // Send initialized notification
        await rpcCall(config.url, "notifications/initialized", {}, tokens.access_token, retryResult.sessionId, config.headers);

        const session: MCPSession = {
          sessionId: retryResult.sessionId ?? null,
          initialized: true,
          tools: [],
          lastUsed: Date.now(),
        };

        sessions.set(config.name, session);
        console.log(`[mcp-http] Initialized "${config.name}" via OAuth (session: ${retryResult.sessionId})`);
        return session;
      }

      if (error) {
        // Handle "Too many active MCP sessions" — wait and retry once
        const errStr = JSON.stringify(error);
        if (errStr.includes("Too many active MCP sessions")) {
          console.log(`[mcp-http] Session limit reached for "${config.name}", waiting 2s and retrying...`);
          await new Promise(r => setTimeout(r, 2000));
          // Try again after waiting
          const retry = await rpcCall(
            config.url,
            "initialize",
            {
              protocolVersion: "2025-03-26",
              capabilities: {},
              clientInfo: { name: "smyth", version: "1.0.0" },
            },
            authToken,
            undefined,
            config.headers,
          );
          if (retry.error) {
            console.error(`[mcp-http] Initialize failed for "${config.name}" after retry:`, JSON.stringify(retry.error));
            return null;
          }
          // Use retry session
          const session: MCPSession = {
            sessionId: retry.sessionId ?? null,
            initialized: true,
            tools: [],
            lastUsed: Date.now(),
            accessToken: config.authToken ?? null,
            tokenRefreshedAt: Date.now(),
          };
          sessions.set(config.name, session);
          // Send initialized notification
          await rpcCall(config.url, "notifications/initialized", {}, config.authToken, session.sessionId, config.headers);
          console.log(`[mcp-http] Initialized "${config.name}" (session: ${session.sessionId})`);
          return session;
        }
        console.error(`[mcp-http] Initialize failed for "${config.name}":`, JSON.stringify(error));
        return null;
      }

      // Send initialized notification (no response expected)
      await rpcCall(config.url, "notifications/initialized", {}, config.authToken, sessionId, config.headers);

      const session: MCPSession = {
        sessionId: sessionId ?? null,
        initialized: true,
        tools: [],
        lastUsed: Date.now(),
        accessToken: config.authToken ?? null,
        tokenRefreshedAt: Date.now(),
      };

      sessions.set(config.name, session);
      console.log(`[mcp-http] Initialized "${config.name}" (session: ${sessionId})`);
      return session;
    } catch (err: any) {
      console.error(`[mcp-http] Failed to initialize "${config.name}":`, err.message);
      return null;
    } finally {
      initPromises.delete(config.name);
    }
  })();

  initPromises.set(config.name, promise);
  return promise;
}

// ── Discover tools from an MCP HTTP server ──
export async function discoverHttpTools(serverName: string): Promise<MCPTool[]> {
  const configs = loadHttpServerConfigs();
  const config = configs.find(c => c.name === serverName);
  if (!config || !config.enabled) return [];

  let session = getSession(serverName);
  if (!session) {
    session = await initializeServer(config);
    if (!session) return [];
  }

  // 2026-08-22: resolve a fresh Bearer (silent refresh if expired).
  const token = await resolveAuthToken(config);
  if (token && (!session.accessToken || session.accessToken !== token)) {
    session.accessToken = token;
    session.tokenRefreshedAt = Date.now();
    config.authToken = token;
    if (!config.headers) config.headers = {};
    config.headers["Authorization"] = `Bearer ${token}`;
  }

  const { result, error } = await rpcCall(
    config.url,
    "tools/list",
    {},
    session.accessToken ?? config.authToken,
    session.sessionId,
    config.headers,
  );

  if (error) {
    // If auth error, try OAuth flow and retry
    if (isAuthError(error)) {
      console.log(`[mcp-http] tools/list auth error for "${serverName}", re-authenticating...`);
      const tokens = await performOAuthFlow(config);
      if (tokens) {
        config.authToken = tokens.access_token;
        if (!config.headers) config.headers = {};
        config.headers["Authorization"] = `Bearer ${tokens.access_token}`;
        session.accessToken = tokens.access_token;
        session.tokenRefreshedAt = Date.now();
        sessions.delete(serverName);
        session = await initializeServer(config);
        if (!session) return [];
        const retry = await rpcCall(config.url, "tools/list", {}, session.accessToken ?? config.authToken, session.sessionId, config.headers);
        if (retry.error) return [];
        const tools = retry.result?.tools || [];
        session.tools = tools;
        touchSession(serverName);
        return tools;
      }
    }

    console.error(`[mcp-http] tools/list failed for "${serverName}":`, JSON.stringify(error));
    // Try re-initializing
    sessions.delete(serverName);
    session = await initializeServer(config);
    if (!session) return [];
    const token2 = await resolveAuthToken(config);
    if (token2) {
      session.accessToken = token2;
      session.tokenRefreshedAt = Date.now();
      config.authToken = token2;
    }
    const retry = await rpcCall(config.url, "tools/list", {}, session.accessToken ?? config.authToken, session.sessionId, config.headers);
    if (retry.error) return [];
    const tools = retry.result?.tools || [];
    session.tools = tools;
    touchSession(serverName);
    return tools;
  }

  const tools = result?.tools || [];
  session.tools = tools;
  touchSession(serverName);
  return tools;
}

// ── Discover tools from ALL enabled HTTP MCP servers ──
export async function discoverAllHttpTools(): Promise<Array<MCPTool & { serverName: string }>> {
  const configs = loadHttpServerConfigs();
  const enabled = configs.filter(c => c.enabled);

  const results = await Promise.allSettled(
    enabled.map(async (config) => {
      const tools = await discoverHttpTools(config.name);
      return tools.map(t => ({ ...t, serverName: config.name }));
    })
  );

  const allTools: Array<MCPTool & { serverName: string }> = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      allTools.push(...result.value);
    }
  }

  // Update shared tool state if available
  if (typeof globalThis !== "undefined") {
    const g = globalThis as any;
    if (g.__mcp_tool_cache) {
      g.__mcp_tool_cache.http = allTools;
    }
  }

  return allTools;
}

// ── Call a tool on an MCP HTTP server ──
export async function callHttpTool(
  serverName: string,
  toolName: string,
  args: Record<string, any> = {},
): Promise<any> {
  const configs = loadHttpServerConfigs();
  const config = configs.find(c => c.name === serverName);
  if (!config || !config.enabled) {
    throw new Error(`Server "${serverName}" not found or disabled`);
  }

  let session = getSession(serverName);
  if (!session) {
    session = await initializeServer(config);
    if (!session) throw new Error(`Failed to initialize session for "${serverName}"`);
  }

  // 2026-08-22: resolve a fresh Bearer (silent refresh if expired).
  // Prior bug: we shipped the stale disk token verbatim, triggering OAuth
  // popups every few minutes during long Canva/Twenty workflows.
  const token = await resolveAuthToken(config);
  if (token && (!session.accessToken || session.accessToken !== token)) {
    session.accessToken = token;
    session.tokenRefreshedAt = Date.now();
    config.authToken = token;
    if (!config.headers) config.headers = {};
    config.headers["Authorization"] = `Bearer ${token}`;
  }

  const { result, error } = await rpcCall(
    config.url,
    "tools/call",
    { name: toolName, arguments: args },
    session.accessToken ?? config.authToken,
    session.sessionId,
    config.headers,
  );

  if (error) {
    // If auth error, try OAuth flow and retry once
    if (isAuthError(error)) {
      console.log(`[mcp-http] tools/call auth error for "${serverName}", re-authenticating...`);
      const tokens = await performOAuthFlow(config);
      if (tokens) {
        config.authToken = tokens.access_token;
        if (!config.headers) config.headers = {};
        config.headers["Authorization"] = `Bearer ${tokens.access_token}`;
        session.accessToken = tokens.access_token;
        session.tokenRefreshedAt = Date.now();
        sessions.delete(serverName);
        session = await initializeServer(config);
        if (session) {
          const retry = await rpcCall(
            config.url, "tools/call",
            { name: toolName, arguments: args },
            session.accessToken ?? config.authToken,
            session.sessionId,
            config.headers,
          );
          if (!retry.error) return retry.result;
        }
      }
    }
    throw new Error(`Tool call failed for "${toolName}" on "${serverName}": ${JSON.stringify(error)}`);
  }

  touchSession(serverName);
  return result;
}

// ── Discover HTTP MCP tools and create handlers ──
// Called by tools.ts → createToolDefinitions() during agent startup.
// Returns OpenAI-compatible tool definitions and handler functions.

// 2026-08-22: Background token warmer. Proactively refresh any OAuth MCP
// server whose token is within 10 minutes of expiry, OR whose token has
// already expired but has a refresh_token. Triggered at the first MCP call
// (deferred so the server-side module init doesn't block startup) and then
// every 5 minutes. Stops popup-on-every-call: we refresh BEFORE the user
// touches the workflow, not in the middle of one.
let warmerStarted = false;
let warmerNextRun = 0;
function maybeRunWarmer(): void {
  if (warmerStarted) return;
  if (typeof window !== "undefined") return; // never schedule in browser code
  warmerStarted = true;
  const tick = async () => {
    try {
      const configs = loadHttpServerConfigs();
      for (const config of configs) {
        if (!config.enabled) continue;
        // 2026-08-22: kill switch — skip servers where Rob disabled auto-auth.
        if (!isAutoAuthAllowed(config.name)) continue;
        const isOAuth = looksLikeOAuthServer(config);
        if (!isOAuth) continue;
        const stored = getStoredTokens(config.name);
        if (!stored) continue;
        const expiresAt = stored.expires_at ?? 0;
        const msLeft = expiresAt - Date.now();
        if (msLeft < 10 * 60 * 1000) {
          const fresh = await getValidToken(config);
          if (fresh) {
            const session = sessions.get(config.name);
            if (session) {
              session.accessToken = fresh;
              session.tokenRefreshedAt = Date.now();
            }
            config.authToken = fresh;
            if (!config.headers) config.headers = {};
            config.headers["Authorization"] = `Bearer ${fresh}`;
            console.log(`[mcp-warm] Refreshed "${config.name}" token (was ${Math.round(msLeft / 1000)}s from expiry)`);
          }
        }
      }
    } catch (err: any) {
      console.warn(`[mcp-warm] pass failed: ${err.message}`);
    }
    warmerNextRun = Date.now() + 5 * 60 * 1000;
  };
  // Run once after a short delay (so it doesn't race the very first MCP call)
  setTimeout(tick, 2000);
  setInterval(() => { if (Date.now() >= warmerNextRun) tick(); }, 60_000);
}

export function startMcpTokenWarmer(): void {
  maybeRunWarmer();
}


export async function discoverAndCreateHandlers(): Promise<{
  tools: any[];
  handlers: Map<string, (args: Record<string, any>) => Promise<string>>;
}> {
  const configs = loadHttpServerConfigs();
  const enabled = configs.filter(c => c.enabled);

  const tools: any[] = [];
  const handlers = new Map<string, (args: Record<string, any>) => Promise<string>>();

  for (const config of enabled) {
    try {
      const mcpTools = await discoverHttpTools(config.name);

      // Sync the in-memory MCP registry so the right-panel MCP status
      // panel reflects actual connection state. (Without this, canva
      // and twenty show as 'not connected' even after successful tool
      // discovery, because the HTTP client and the registry are two
      // separate MCP subsystems.)
      try {
        const { getRegistry } = await import("./registry");
        const registry = getRegistry();
        // Ensure the registry has a config entry for this HTTP server
        registry.loadConfig();
        registry.cacheTools(
          config.name,
          mcpTools.map((t) => ({
            serverName: config.name,
            name: t.name,
            description: t.description || "",
            inputSchema: t.inputSchema || {},
          }))
        );
        if (mcpTools.length > 0) {
          console.log(`[mcp-http] Registry updated: ${mcpTools.length} tools from "${config.name}"`);
        }
      } catch (regErr: any) {
        // Don't fail discovery if the registry update fails
        console.warn(`[mcp-http] Registry sync failed for ${config.name}: ${regErr?.message || regErr}`);
      }

      for (const tool of mcpTools) {
        const handlerKey = `mcp_${config.name}_${tool.name}`;
        
        // OpenAI-compatible tool definition
        tools.push({
          type: "function" as const,
          function: {
            name: handlerKey,
            description: `[MCP:${config.name}] ${tool.description || tool.name}`,
            parameters: tool.inputSchema || { type: "object", properties: {} },
          },
        });

        // Handler that calls the HTTP tool
        const serverName = config.name;
        const toolName = tool.name;
        handlers.set(handlerKey, async (args: Record<string, any>) => {
          try {
            const result = await callHttpTool(serverName, toolName, args);
            return typeof result === "string" ? result : JSON.stringify(result);
          } catch (err: any) {
            return `Error calling MCP tool ${toolName} on ${serverName}: ${err.message}`;
          }
        });
      }

      if (mcpTools.length > 0) {
        console.log(`[mcp-http] Exposed ${mcpTools.length} tools from "${config.name}"`);
      }
    } catch (err: any) {
      console.error(`[mcp-http] Failed to discover tools from "${config.name}":`, err.message);
    }
  }

  return { tools, handlers };
}
