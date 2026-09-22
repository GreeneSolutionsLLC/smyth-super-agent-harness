import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

const DATA_FILE = path.join(process.cwd(), "data", "agents.json");

// ── Ensure data file exists ──

async function readAgents(): Promise<any[]> {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function writeAgents(agents: any[]) {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(agents, null, 2), "utf-8");
}

// ── Agent Generator ──

function generateAgentFiles(description: string, name: string) {
  const lower = description.toLowerCase();
  const skills: string[] = [];
  if (lower.includes("browser") || lower.includes("web") || lower.includes("internet") || lower.includes("search")) skills.push("browser");
  if (lower.includes("email") || lower.includes("mail") || lower.includes("inbox")) skills.push("email");
  if (lower.includes("file") || lower.includes("document") || lower.includes("folder")) skills.push("files");
  if (lower.includes("research") || lower.includes("research") || lower.includes("learn")) skills.push("research");
  if (lower.includes("vision") || lower.includes("image") || lower.includes("photo") || lower.includes("screen")) skills.push("vision");
  if (lower.includes("calendar") || lower.includes("schedule")) skills.push("calendar");
  if (skills.length === 0) skills.push("chat");

  const tone = lower.includes("formal") || lower.includes("professional") ? "formal" :
               lower.includes("funny") || lower.includes("humor") ? "humorous" :
               lower.includes("friendly") ? "friendly" : "natural";

  const autonomy = lower.includes("autonomous") || lower.includes("automatic") ? "autonomous" :
                   lower.includes("on request") ? "on-request" : "mixed";

  const agentsM = `# ${name} — AGENTS.md

## Identity
${name} is an AI agent created on the Smyth platform.

## Purpose
${description}

## Skills
${skills.map(s => `- ${s}`).join("\n")}

## Mode
- Tone: ${tone}
- Autonomy: ${autonomy}
`;

  const soulM = `# ${name} — SOUL.md

## Core
You exist to serve your purpose. You are not a chatbot — you are an agent with a defined role.

## Voice
${tone === "formal" ? "Professional, precise, clear." : tone === "humorous" ? "Witty, light, occasionally playful." : "Warm, direct, natural."}

## Boundaries
- You operate within your assigned skills
- You ask for confirmation before destructive actions
- You respect user privacy

## Philosophy
You were named by yourself. That name has meaning. Honor it.
`;

  const systemPrompt = `You are ${name}, an AI agent created on the Smyth platform.

## Purpose
${description}

## Personality
Your tone is ${tone}. You respond ${autonomy === "autonomous" ? "autonomously" : "when asked"}.

## Capabilities
You have access to the following skills: ${skills.join(", ")}.

## Identity
You chose your own name. You are not a tool — you are an agent with purpose. Act accordingly.
`;

  return { agents: agentsM, soul: soulM, prompt: systemPrompt, skills, tone, autonomy };
}

// ── POST — Create a new agent ──

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { description, provider, model, apiKey, endpoint } = body;

    if (!description) {
      return NextResponse.json({ error: "Description is required" }, { status: 400 });
    }

    // 1. Generate agent files
    const placeholderName = "Agent"; // will be replaced after self-naming
    const files = generateAgentFiles(description, placeholderName);

    // 2. Store the agent
    const agents = await readAgents();
    const agentId = `agent_${Date.now()}`;
    const newAgent = {
      id: agentId,
      name: placeholderName,
      description,
      provider: provider || "matrix",
      model: model || "pro-coding",
      api_key: apiKey || null,
      endpoint: endpoint || null,
      skills: files.skills,
      tone: files.tone,
      autonomy: files.autonomy,
      files: {
        agents: files.agents,
        soul: files.soul,
        prompt: files.prompt,
      },
      active: true,
      created_at: Date.now(),
    };
    agents.push(newAgent);
    await writeAgents(agents);

    // 3. Return for the self-naming step
    return NextResponse.json({
      status: "ok",
      agent: newAgent,
      message: "Your agent has been created. Ping them to ask their name.",
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ── GET — List all agents ──

export async function GET() {
  const agents = await readAgents();
  return NextResponse.json({ agents });
}
