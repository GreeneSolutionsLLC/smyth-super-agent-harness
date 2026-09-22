import { NextRequest, NextResponse } from "next/server";
import { DatabaseSync } from "node:sqlite";
import { ImapFlow } from "imapflow";
import { simpleParser, AddressObject } from "mailparser";

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
  const db = new DatabaseSync(AGENTICMAIL_DB, { readOnly: true, open: true });
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

function looksLikeEmail(value?: string | null) {
  if (!value) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function correctAddresses(addrs?: AddressObject | AddressObject[], localPrincipal?: string | null) {
  const list = Array.isArray(addrs)
    ? addrs.flatMap((a) => (a?.value ? a.value : []))
    : (addrs?.value ?? []);
  const localLower = (localPrincipal || "").toLowerCase();
  return list.map((a: any) => {
    const rawAddr = (a.address || "").toLowerCase();
    const rawName = a.name || "";
    // AgenticMail rewrite bug: the From header becomes "Original Sender" <local-principal@localhost>
    if ((rawAddr === localLower || rawAddr === `${localLower}@localhost`) && looksLikeEmail(rawName)) {
      return { name: "", address: rawName.trim().toLowerCase() };
    }
    return { name: rawName, address: rawAddr };
  });
}

export async function GET(req: NextRequest) {
  const uid = parseInt(req.nextUrl.searchParams.get("uid") || "0", 10);
  const agentId = req.nextUrl.searchParams.get("agentId");
  const folder = req.nextUrl.searchParams.get("folder") || "INBOX";

  if (!uid || !agentId) {
    return NextResponse.json({ error: "uid and agentId required" }, { status: 400 });
  }

  const creds = getAgentCredentials(agentId);
  if (!creds?.password) {
    return NextResponse.json({ error: "Agent not found or no password" }, { status: 404 });
  }

  const client = new ImapFlow({
    host: STALWART_IMAP.host,
    port: STALWART_IMAP.port,
    secure: STALWART_IMAP.secure,
    tls: { rejectUnauthorized: STALWART_IMAP.tls.rejectUnauthorized },
    auth: { user: creds.principal, pass: creds.password },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock(folder);
    try {
      const result = await client.download(String(uid), undefined, { uid: true });
      if (!result?.content) {
        return NextResponse.json({ error: `Message UID ${uid} not found`, code: "MESSAGE_NOT_FOUND" }, { status: 404 });
      }
      const raw = await result.content;
      const parsed = await simpleParser(raw);

      const correctedFrom = correctAddresses(parsed.from, creds.principal);
      const correctedReplyTo = correctAddresses(parsed.replyTo, creds.principal);
      const correctedTo = correctAddresses(parsed.to, creds.principal);
      const correctedCc = correctAddresses(parsed.cc, creds.principal);
      const correctedBcc = correctAddresses(parsed.bcc, creds.principal);

      // The address we should reply to is replyTo if present, otherwise corrected from.
      const replyAddress = correctedReplyTo[0]?.address || correctedFrom[0]?.address || "";
      const replyName = correctedReplyTo[0]?.name || correctedFrom[0]?.name || "";

      const attachments = (parsed.attachments || []).map((a: any, index: number) => ({
        index,
        filename: a.filename || "unnamed",
        contentType: a.contentType || "application/octet-stream",
        size: typeof a.size === "number" ? a.size : a.content?.length ?? 0,
        contentDisposition: a.contentDisposition || "attachment",
        cid: a.cid,
        related: a.related,
      }));

      return NextResponse.json({
        uid,
        folder,
        messageId: parsed.messageId ?? "",
        subject: parsed.subject ?? "",
        from: correctedFrom,
        replyTo: correctedReplyTo,
        replyAddress,
        replyName,
        to: correctedTo,
        cc: correctedCc,
        bcc: correctedBcc,
        date: parsed.date ?? new Date(),
        text: parsed.text ?? "",
        html: parsed.html ?? undefined,
        inReplyTo: parsed.inReplyTo ?? undefined,
        references: Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : undefined,
        attachments,
        bypass: true,
      });
    } finally {
      lock.release();
    }
  } catch (err: any) {
    console.error("[message-bypass] error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 502 });
  } finally {
    try { await client.logout(); } catch {}
  }
}
