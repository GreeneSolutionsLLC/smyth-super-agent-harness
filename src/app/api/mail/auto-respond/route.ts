import { NextRequest, NextResponse } from "next/server";

const AGENTICMAIL_API = process.env.NEXT_PUBLIC_AGENTICMAIL_API_URL || "http://127.0.0.1:3829/api/agenticmail";
const MASTER_KEY = process.env.AGENTICMAIL_MASTER_KEY || "";

const masterHeaders = () => ({
  Authorization: `Bearer ${MASTER_KEY}`,
  "Content-Type": "application/json",
});

// GET — fetch auto-respond state for all agents
export async function GET() {
  try {
    const res = await fetch(`${AGENTICMAIL_API}/../agenticmail/accounts`, {
      headers: masterHeaders(),
    });
    if (!res.ok) return NextResponse.json({ error: "Failed to fetch accounts" }, { status: 502 });
    const data = await res.json();
    const states = (data.agents || []).map((a: any) => ({
      id: a.id,
      name: a.name,
      email: a.email,
      autoRespond: a.metadata?.autoRespond ?? false,
      autoRespondMode: a.metadata?.autoRespondMode ?? "draft", // "draft" | "auto"
      stopped: a.stopped ?? false,
    }));
    return NextResponse.json({ agents: states });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST — toggle auto-respond for a specific agent
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agentId, enabled, mode } = body;

    if (!agentId) {
      return NextResponse.json({ error: "agentId is required" }, { status: 400 });
    }

    // Fetch current agent to get existing metadata
    const res = await fetch(`${AGENTICMAIL_API}/../agenticmail/accounts`, {
      headers: masterHeaders(),
    });
    if (!res.ok) return NextResponse.json({ error: "Failed to fetch accounts" }, { status: 502 });
    const data = await res.json();
    const agent = (data.agents || []).find((a: any) => a.id === agentId);
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    // Merge autoRespond into existing metadata
    const existingMetadata = agent.metadata || {};
    const updatedMetadata = {
      ...existingMetadata,
      autoRespond: enabled !== undefined ? enabled : !(existingMetadata.autoRespond ?? false),
      autoRespondMode: mode || existingMetadata.autoRespondMode || "draft",
    };

    // Use the agent's own API key to update metadata via PATCH /accounts/me
    // Since that endpoint requires agent auth, we'll use a direct DB approach via the master key
    // The AgenticMail API doesn't have a master-level PATCH /accounts/:id/metadata,
    // but we can use the stop/resume pattern + metadata via the accounts endpoint

    // Actually, let's use the agent's API key to PATCH /accounts/me
    const agentApiKey = agent.apiKey;
    const patchRes = await fetch(`${AGENTICMAIL_API}/../agenticmail/accounts/me`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${agentApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ metadata: updatedMetadata }),
    });

    if (!patchRes.ok) {
      const errText = await patchRes.text();
      return NextResponse.json(
        { error: `Failed to update metadata: ${errText.slice(0, 200)}` },
        { status: 502 }
      );
    }

    const updated = await patchRes.json();

    return NextResponse.json({
      ok: true,
      agentId,
      autoRespond: updatedMetadata.autoRespond,
      autoRespondMode: updatedMetadata.autoRespondMode,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}