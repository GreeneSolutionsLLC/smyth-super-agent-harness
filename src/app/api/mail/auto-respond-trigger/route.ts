import { NextRequest, NextResponse } from "next/server";

const AGENTICMAIL_API = process.env.NEXT_PUBLIC_AGENTICMAIL_API_URL || "http://127.0.0.1:3829/api/agenticmail";
const MASTER_KEY = process.env.AGENTICMAIL_MASTER_KEY || "";
const SMYTH_AGENT_API = "http://localhost:3000/api/agent";

const masterHeaders = () => ({
  Authorization: `Bearer ${MASTER_KEY}`,
  "Content-Type": "application/json",
});

// POST — called when new mail arrives (polled by the auto-respond watcher)
// Body: { agentId, agentName, agentApiKey, message: { uid, from, subject, text, date } }
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agentId, agentName, agentApiKey, message } = body;

    if (!agentId || !message) {
      return NextResponse.json({ error: "agentId and message are required" }, { status: 400 });
    }

    // Fetch the agent to check autoRespond state
    const accountsRes = await fetch(`${AGENTICMAIL_API}/../agenticmail/accounts`, {
      headers: masterHeaders(),
    });
    if (!accountsRes.ok) {
      return NextResponse.json({ error: "Failed to fetch accounts" }, { status: 502 });
    }
    const accountsData = await accountsRes.json();
    const agent = (accountsData.agents || []).find((a: any) => a.id === agentId);

    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    const autoRespond = agent.metadata?.autoRespond ?? false;
    const autoRespondMode = agent.metadata?.autoRespondMode ?? "draft";
    const stopped = agent.stopped ?? false;

    if (!autoRespond || stopped) {
      return NextResponse.json({ skipped: true, reason: "autoRespond disabled or agent stopped" });
    }

    // Fetch the full message content via the local bypass route
    const bypassRes = await fetch(
      `http://localhost:3000/api/mail/message-bypass?agentId=${encodeURIComponent(agentId)}&uid=${encodeURIComponent(message.uid)}`,
      { headers: masterHeaders() }
    );

    if (!bypassRes.ok) {
      return NextResponse.json({ error: "Failed to fetch message" }, { status: 502 });
    }

    const msgData = await bypassRes.json();
    const fromAddr = msgData.from?.[0]?.address || "unknown";
    const fromName = msgData.from?.[0]?.name || fromAddr;
    const subject = msgData.subject || "(no subject)";
    const textContent = msgData.text || msgData.html || "(no content)";

    // Build the prompt for Smyth to draft a reply
    const prompt = `You are Smyth, an AI assistant for Greene Solutions. A new email arrived in the sales@localhost inbox. Draft a professional, concise reply.

From: ${fromName} <${fromAddr}>
Subject: ${subject}

Email content:
${textContent.slice(0, 3000)}

Draft a brief, professional reply. Be friendly but concise. Address the sender by name if available. If this looks like spam or a marketing outreach, reply with "SKIP" only.`;

    // Call the Smyth agent API to generate a reply
    const agentRes = await fetch(SMYTH_AGENT_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: prompt,
        routeMode: "auto",
        history: [],
      }),
    });

    if (!agentRes.ok) {
      const errText = await agentRes.text();
      return NextResponse.json(
        { error: `Agent API failed: ${errText.slice(0, 200)}` },
        { status: 502 }
      );
    }

    const agentData = await agentRes.json();
    const draftReply = (agentData.reply || "").trim();

    // If the agent says SKIP, don't respond
    if (draftReply.toUpperCase().includes("SKIP") || draftReply.length < 10) {
      return NextResponse.json({ skipped: true, reason: "Agent flagged as skip/spam" });
    }

    if (autoRespondMode === "auto") {
      // Auto-send the reply
      const sendRes = await fetch(`${AGENTICMAIL_API}/mail/send`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${agentApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: fromAddr,
          subject: subject.startsWith("Re:") ? subject : `Re: ${subject}`,
          body: draftReply,
          html: `<p>${draftReply.replace(/\n/g, "</p><p>")}</p>`,
        }),
      });

      if (!sendRes.ok) {
        const errText = await sendRes.text();
        return NextResponse.json(
          { error: `Failed to send: ${errText.slice(0, 200)}` },
          { status: 502 }
        );
      }

      return NextResponse.json({
        ok: true,
        mode: "auto",
        sent: true,
        to: fromAddr,
        subject: subject.startsWith("Re:") ? subject : `Re: ${subject}`,
      });
    } else {
      // Draft mode — save as a draft in the UI
      // We'll store the draft via the AgenticMail drafts table
      // For now, return the draft so the frontend can pick it up
      return NextResponse.json({
        ok: true,
        mode: "draft",
        sent: false,
        draft: {
          to: fromAddr,
          subject: subject.startsWith("Re:") ? subject : `Re: ${subject}`,
          body: draftReply,
          originalUid: message.uid,
          originalFrom: fromAddr,
          originalSubject: subject,
        },
      });
    }
  } catch (err: any) {
    console.error("[mail/auto-respond-trigger] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}