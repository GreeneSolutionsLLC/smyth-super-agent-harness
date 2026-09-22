import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
const uuidv4 = () => crypto.randomUUID();

// --- Configuration ---
const GATEWAY_URL = process.env.OPENCLAW_GATEWAY || 'http://127.0.0.1:18789/v1/chat/completions';
const DATA_DIR = path.join(process.cwd(), 'data');

// --- Helper: extract a field from a section header in AGENTS.md ---
function extractField(content: string, field: string): string {
  const regex = new RegExp(`## ${field}\\n([^#]+)`, 'i');
  const match = content.match(regex);
  return match ? match[1].trim() : '';
}

// --- Helper: validate that the name is 1‑2 words, no special characters ---
function isValidName(name: string): boolean {
  const words = name.trim().split(/\s+/);
  if (words.length < 1 || words.length > 2) return false;
  return /^[a-zA-Z0-9]+(?: [a-zA-Z0-9]+)?$/.test(name.trim());
}

// --- Helper: fallback name based on purpose keywords ---
function fallbackName(purpose: string): string {
  const lower = purpose.toLowerCase();
  if (/code|develop|program/.test(lower)) return 'Forge';
  if (/analysis|analytics|data/.test(lower)) return 'Oracle';
  if (/creative|write|art/.test(lower)) return 'Muse';
  if (/security|protect|threat/.test(lower)) return 'Sentinel';
  if (/search|research/.test(lower)) return 'Seeker';
  if (/chat|conversation/.test(lower)) return 'Echo';
  if (/assistant|help/.test(lower)) return 'Aide';
  if (/manage|organize/.test(lower)) return 'Steward';
  return 'Agent';
}

// --- Helper: call the VLM to let the agent name itself ---
async function generateAgentName(
  purpose: string,
  personality: string,
  nameStyle?: string
): Promise<string> {
  const systemPrompt = `You are a newly-spawned AI agent. Based on your purpose and personality (described below), give yourself a short name (1-2 words). Respond with ONLY the name. No punctuation, no explanation.`;
  const userPrompt = `My purpose: ${purpose}\nMy personality: ${personality}${nameStyle ? `\nName style: ${nameStyle}` : ''}`;

  const response = await fetch(GATEWAY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENCLAW_GATEWAY_TOKEN || ''}`,
    },
    body: JSON.stringify({
      model: 'openclaw',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 10,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    throw new Error(`VLM request failed with status ${response.status}`);
  }

  const data = await response.json();
  const name = data.choices?.[0]?.message?.content?.trim();
  if (!name) throw new Error('Empty name from VLM');

  return name;
}

// --- Main POST handler: create agent, write files, self-name, persist ---
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { provider, purpose, personality, nameStyle } = body;

    if (!provider || !purpose) {
      return NextResponse.json(
        { success: false, error: 'Provider and purpose are required' },
        { status: 400 }
      );
    }

    // 1. Create agent directory
    const agentId = uuidv4();
    const agentDir = path.join(DATA_DIR, 'agents', agentId);
    await fs.mkdir(agentDir, { recursive: true });

    // 2. Write AGENTS.md, SOUL.md, prompt.txt
    const agentsMDContent = `# Agent ${agentId.slice(0, 8)}

## Purpose
${purpose}

## Personality
${personality || 'Not specified'}

## Name Style
${nameStyle || 'default'}

## Created
${new Date().toISOString()}
`;
    await fs.writeFile(path.join(agentDir, 'AGENTS.md'), agentsMDContent);

    const soulMDContent = `# Soul of Agent ${agentId.slice(0, 8)}

This agent was created with the purpose: ${purpose}
Its personality is: ${personality || 'Not specified'}.
`;
    await fs.writeFile(path.join(agentDir, 'SOUL.md'), soulMDContent);

    const promptContent = `You are an AI agent specialized in: ${purpose}. You behave with the following personality: ${personality || 'Helpful'}.`;
    await fs.writeFile(path.join(agentDir, 'prompt.txt'), promptContent);

    // --- TASK 5: Agent Self-Naming via VLM ---
    let agentName: string;
    try {
      // Re-read AGENTS.md to extract the fields exactly as persisted
      const fileContent = await fs.readFile(path.join(agentDir, 'AGENTS.md'), 'utf-8');
      const extractedPurpose = extractField(fileContent, 'Purpose');
      const extractedPersonality = extractField(fileContent, 'Personality');
      const extractedNameStyle = extractField(fileContent, 'Name Style');

      agentName = await generateAgentName(
        extractedPurpose,
        extractedPersonality,
        extractedNameStyle
      );
    } catch (nameError) {
      console.warn('VLM naming failed, using fallback:', nameError);
      agentName = fallbackName(purpose);
    }

    // Validate the name
    if (!isValidName(agentName)) {
      console.warn(`VLM returned invalid name "${agentName}", using fallback`);
      agentName = fallbackName(purpose);
    }

    // 3. Write/update agent record in data/agents.json
    const agentsPath = path.join(DATA_DIR, 'agents.json');
    let agents: any[] = [];
    try {
      const existing = await fs.readFile(agentsPath, 'utf-8');
      agents = JSON.parse(existing);
    } catch {
      // File doesn't exist yet – start empty
      agents = [];
    }

    const agentRecord = {
      id: agentId,
      name: agentName,
      provider,
      purpose,
      personality: personality || '',
    };

    const existingIndex = agents.findIndex((a: any) => a.id === agentId);
    if (existingIndex !== -1) {
      agents[existingIndex] = agentRecord;
    } else {
      agents.push(agentRecord);
    }

    await fs.writeFile(agentsPath, JSON.stringify(agents, null, 2));

    // 4. Return the agent with the new name (frontend will update immediately)
    return NextResponse.json({ success: true, agent: agentRecord });
  } catch (error) {
    console.error('Agent creation error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create agent' },
      { status: 500 }
    );
  }
}
