import { NextRequest, NextResponse } from "next/server";
import { DatabaseSync } from "node:sqlite";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

// Runtime node:sqlite is available in Node 22+. Types may not be present in older @types/node.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DB: any = DatabaseSync;

const AGENTICMAIL_DB = process.env.AGENTICMAIL_DB || "";
const STALWART_IMAP = {
  host: process.env.STALWART_IMAP_HOST || "localhost",
  port: parseInt(process.env.STALWART_IMAP_PORT || "143", 10),
  // Stalwart disables plain LOGIN on port 143; we must use STARTTLS.
  secure: process.env.STALWART_IMAP_SECURE === "true",
  tls: {
    rejectUnauthorized: process.env.STALWART_IMAP_TLS_REJECT_UNAUTHORIZED !== "false",
  },
};

function getAgentCredentials(agentId: string) {
  const db = new DB(AGENTICMAIL_DB, { readOnly: true, open: true });
  try {
    const row = db.prepare("SELECT id, name, stalwart_principal, metadata FROM agents WHERE id = ?").get(agentId) as
      | { id: string; name: string; stalwart_principal: string; metadata: string }
      | undefined;
    if (!row) return null;
    const metadata = JSON.parse(row.metadata || "{}") as { _password?: string };
    return {
      id: row.id,
      name: row.name,
      principal: row.stalwart_principal,
      password: metadata._password || "",
    };
  } finally {
    db.close();
  }
}

const LOCAL_DOMAIN_RE = /@localhost$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function looksLikeEmail(value?: string | null) {
  if (!value) return false;
  return EMAIL_RE.test(value.trim());
}

function correctAddressList(list: any[], localPrincipal: string) {
  const localLower = localPrincipal.toLowerCase();
  return list.map((a: any) => {
    const rawAddr = (a.address || "").toLowerCase();
    const rawName = a.name || "";
    if ((rawAddr === localLower || rawAddr === `${localLower}@localhost`) && looksLikeEmail(rawName)) {
      return { name: "", address: rawName.trim().toLowerCase() };
    }
    return { name: rawName, address: rawAddr };
  });
}

type EnvelopeAddress = { name?: string; address: string };
type MessageEnvelope = {
  uid: number;
  seq: number;
  messageId: string;
  subject: string;
  from: EnvelopeAddress[];
  to: EnvelopeAddress[];
  cc: EnvelopeAddress[];
  bcc: EnvelopeAddress[];
  date: string;
  flags: string[];
  size: number;
  text?: string;
  replyAddress?: string;
};

async function listEnvelopes(principal: string, password: string, folder = "INBOX", limit = 20, offset = 0) {
  const client = new ImapFlow({
    host: STALWART_IMAP.host,
    port: STALWART_IMAP.port,
    secure: STALWART_IMAP.secure,
    tls: { rejectUnauthorized: STALWART_IMAP.tls.rejectUnauthorized },
    auth: { user: principal, pass: password },
    logger: false,
  });

  let envelopes: MessageEnvelope[] = [];
  let total = 0;

  try {
    await client.connect();
    const lock = await client.getMailboxLock(folder);
    try {
      total = (client.mailbox as any)?.exists ?? 0;
      const allUids = await client.search({ all: true }, { uid: true });
      if (!allUids || allUids.length === 0) return { envelopes, total };
      const sorted = Array.from(allUids as number[]).sort((a, b) => b - a);
      const page = sorted.slice(offset, offset + limit);
      if (page.length === 0) return { envelopes, total };

      for (const uid of page) {
        try {
          const fetched = await client.fetchOne(String(uid), {
            uid: true,
            envelope: true,
            flags: true,
            size: true,
            source: true,
          }, { uid: true });
          if (!fetched) continue;
          const msg: any = fetched;
          if (!msg?.envelope) continue;
          const env = msg.envelope;

          // Stalwart/AgenticMail rewrite: original sender ends up in the From *name* with local principal as address.
          let from = correctAddressList((env.from ?? []).map((a: any) => ({ name: a.name, address: a.address ?? "" })), principal);
          let replyAddress = "";

          if (msg.source) {
            try {
              const parsed = await simpleParser(msg.source);
              const correctedReplyTo = correctAddressList(parsed.replyTo?.value ?? [], principal);
              const correctedFrom = correctAddressList(parsed.from?.value ?? [], principal);
              if (correctedReplyTo.length > 0 && correctedReplyTo[0]?.address) {
                replyAddress = correctedReplyTo[0].address;
              }
              if (correctedFrom.length > 0 && correctedFrom[0]?.address) {
                from = correctedFrom;
                if (!replyAddress) replyAddress = correctedFrom[0].address;
              }
            } catch (parseErr: any) {
              console.warn(`[inbox-bypass] parse UID ${uid}:`, parseErr.message);
            }
          } else if (from[0]?.address) {
            replyAddress = from[0].address;
          }

          envelopes.push({
            uid: msg.uid,
            seq: msg.seq,
            messageId: env.messageId ?? "",
            subject: env.subject ?? "",
            from,
            to: correctAddressList((env.to ?? []).map((a: any) => ({ name: a.name, address: a.address ?? "" })), principal),
            cc: correctAddressList((env.cc ?? []).map((a: any) => ({ name: a.name, address: a.address ?? "" })), principal),
            bcc: correctAddressList((env.bcc ?? []).map((a: any) => ({ name: a.name, address: a.address ?? "" })), principal),
            date: env.date ?? new Date(),
            flags: Array.from(msg.flags ?? new Set()) as string[],
            size: msg.size ?? 0,
            replyAddress,
          });
        } catch (fetchErr: any) {
          console.warn(`[inbox-bypass] fetchOne UID ${uid} failed:`, fetchErr.message);
        }
      }
      envelopes.sort((a, b) => b.uid - a.uid);
    } finally {
      lock.release();
    }
  } finally {
    try { await client.logout(); } catch {}
  }

  return { envelopes, total };
}

export async function GET(req: NextRequest) {
  const agentId = req.headers.get("x-agent-id") || req.nextUrl.searchParams.get("agentId");
  const limit = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get("limit") || "20", 10), 1), 200);
  const offset = Math.max(parseInt(req.nextUrl.searchParams.get("offset") || "0", 10), 0);
  const folder = req.nextUrl.searchParams.get("folder") || "INBOX";

  if (!agentId || typeof agentId !== "string") {
    return NextResponse.json({ error: "agentId required" }, { status: 400 });
  }

  const creds = getAgentCredentials(agentId);
  if (!creds) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }
  if (!creds.password) {
    return NextResponse.json({ error: "Agent has no local password" }, { status: 500 });
  }

  try {
    const { envelopes, total } = await listEnvelopes(creds.principal, creds.password, folder, limit, offset);
    return NextResponse.json({
      messages: envelopes,
      count: envelopes.length,
      total,
      folder,
      agentId: creds.id,
      agentName: creds.name,
      bypass: true,
    });
  } catch (err: any) {
    console.error("[inbox-bypass] error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
