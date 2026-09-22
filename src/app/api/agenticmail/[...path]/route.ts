/**
 * AgenticMail catch-all proxy.
 *
 * Routes ALL /api/agenticmail/* requests to the local AgenticMail API
 * at ${NEXT_PUBLIC_AGENTICMAIL_API_URL} (default http://127.0.0.1:3829/api/agenticmail).
 *
 * Why catch-all: EmailPanel uses many endpoints (mail/send, mail/inbox,
 * mail/messages/:uid/seen, gateway/status, gateway/relay, accounts, etc).
 * Building dedicated proxies for each is brittle — versions drift. Instead,
 * we forward everything and let AgenticMail be the source of truth for its
 * own surface. The "open source repo" the user pointed at defines that
 * surface; this proxy makes Smyth match it exactly.
 *
 * Auth: forwards the caller's Authorization header (agent apiKey for agent
 * routes, master key for admin routes). Falls back to MASTER_KEY env when
 * no header is present (for server-internal calls).
 *
 * Streaming: GET /mail/inbox can return large lists; we stream the response
 * body so the client can start rendering while AgenticMail still paginates.
 */

import { NextRequest } from "next/server";

const UPSTREAM = process.env.NEXT_PUBLIC_AGENTICMAIL_API_URL || "http://127.0.0.1:3829/api/agenticmail";
const MASTER_KEY = process.env.AGENTICMAIL_MASTER_KEY || "";

function forwardHeaders(req: NextRequest): HeadersInit {
  // Prefer the caller's auth header (per-agent apiKey) so server-side
  // authorization scoping is preserved. Fall back to master key if absent.
  const incoming = req.headers.get("authorization");
  return {
    "Content-Type": req.headers.get("content-type") || "application/json",
    Authorization: incoming || `Bearer ${MASTER_KEY}`,
  };
}

async function handle(req: NextRequest, path: string[]): Promise<Response> {
  const subPath = path.join("/");
  const search = req.nextUrl.search || "";
  const url = `${UPSTREAM}/${subPath}${search}`;

  // Forward request body verbatim if any (POST/PUT/PATCH).
  let body: BodyInit | undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    const buf = await req.arrayBuffer();
    if (buf.byteLength) body = buf;
  }

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(url, {
      method: req.method,
      headers: forwardHeaders(req),
      body,
      // Don't let a slow upstream hang the route — 25s ceiling matches agenticmail's own timeouts.
      signal: AbortSignal.timeout(25_000),
    });
  } catch (e: any) {
    // Upstream is down (service not running). Return a 502 with a clear
    // shape so the UI can show "agent mail is offline" instead of an
    // opaque TypeError.
    if (e?.name === "AbortError" || e?.name === "TimeoutError") {
      return new Response(
        JSON.stringify({ error: "agenticmail_timeout", message: "AgenticMail did not respond in time" }),
        { status: 504, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(
      JSON.stringify({ error: "agenticmail_offline", message: e?.message || "AgenticMail API is unreachable" }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  // Stream the response body back. Preserve status + relevant headers.
  const responseHeaders = new Headers();
  const ct = upstreamRes.headers.get("content-type");
  if (ct) responseHeaders.set("Content-Type", ct);
  // Cache is up to the agent route — no-store.
  responseHeaders.set("Cache-Control", "no-store");

  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers: responseHeaders,
  });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return handle(req, path);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return handle(req, path);
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return handle(req, path);
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return handle(req, path);
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return handle(req, path);
}

export const dynamic = "force-dynamic";
