/**
 * AgenticMail API client (Smyth-side).
 *
 * Proxies the local AgenticMail service at http://127.0.0.1:3829/api/agenticmail.
 * Server-only — uses the master key. Do NOT import from client components.
 *
 * Multi-account support: list, create, activate, delete mailboxes. The
 * Active mailbox display only. The user does NOT control switching from
 * this UI — AgenticMail 0.9.x dropped `/system/operator-email`. Multi-account
 * orchestration happens through @agenticmail/openclaw MCP tools. We read
 * `/accounts/me` to surface "currently active" passively, never write.
 */

const AGENTICMAIL_API = process.env.NEXT_PUBLIC_AGENTICMAIL_API_URL || "http://127.0.0.1:3829/api/agenticmail";
const MASTER_KEY = process.env.AGENTICMAIL_MASTER_KEY || "";

export interface AgenticMailAccount {
  id: string;
  name: string;
  email: string;
  apiKey: string;
  stalwartPrincipal: string;
  createdAt: string;
  updatedAt: string;
  role: "secretary" | "assistant" | "researcher" | "writer" | "custom" | "bridge" | "operator" | string;
  wakeOnCc: boolean;
  stopped: boolean;
  stoppedAt: string | null;
  stoppedReason: string | null;
  metadata: Record<string, any>;
}

async function asMaster(path: string, init: RequestInit = {}): Promise<any> {
  const url = `${AGENTICMAIL_API}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${MASTER_KEY}`,
      ...(init.headers || {}),
    },
    cache: "no-store",
  });
  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const message = data?.error || `HTTP ${res.status}`;
    const err: any = new Error(message);
    (err as any).status = res.status;
    (err as any).data = data;
    throw err;
  }
  return data;
}

// ── Read ──────────────────────────────────────────────────────────────────

export async function listAccounts(): Promise<AgenticMailAccount[]> {
  const data = await asMaster("/accounts");
  // 0.9.x returns a bare array; older versions wrapped it as {agents:[...]}.
  const items = Array.isArray(data) ? data : (data?.agents || []);
  return items as AgenticMailAccount[];
}

export async function getActiveOperatorEmail(): Promise<string | null> {
  // AgenticMail 0.9.x doesn't expose /system/operator-email. The closest
  // canonical is /accounts/me (the agent identity currently active in the
  // openclaw runtime). Fall back to that route.
  try {
    const data = await asMaster("/accounts/me");
    return data?.email ?? null;
  } catch {
    return null;
  }
}

// ── Write ─────────────────────────────────────────────────────────────────

export interface CreateAccountInput {
  name: string;            // localpart (e.g. "support")
  domain: string;          // e.g. "greene-solutions.com"
  password: string;        // IMAP password
  metadata?: Record<string, any>;
  role?: string;
  persistent?: boolean;
}

export async function createAccount(input: CreateAccountInput): Promise<AgenticMailAccount> {
  const data = await asMaster("/accounts", {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      domain: input.domain,
      password: input.password,
      metadata: input.metadata || {},
      role: input.role || "operator",
      persistent: input.persistent ?? true,
    }),
  });
  return data?.agent ?? data;
}

// `setActiveOperatorEmail` was removed — AgenticMail 0.9.x doesn't expose
// `/system/operator-email` so there's no clean Smyth-side switch. The
// canonical way to switch active identity is via @agenticmail/openclaw MCP
// tools (89 of them registered through OpenClaw).

// Delete not yet exposed (AgenticMail API docs unclear if endpoint exists).
// Skipping for Tier 1+3 to avoid destructive surprises.
