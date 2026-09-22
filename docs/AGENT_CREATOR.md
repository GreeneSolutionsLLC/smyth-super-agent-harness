# Smyth Agent Creator — Architecture

## Flow

```
User clicks [+ New Agent]
│
├─ Step 1: Provider Selection
│   ├─ Matrix (OmniRoute) — default, no key needed
│   ├─ OpenAI
│   ├─ Anthropic
│   ├─ Ollama
│   ├─ Custom (endpoint + key)
│   └─ → Enters API key if applicable
│
├─ Step 2: Chat-based Agent Designer
│   ├─ Smyth: "Describe the agent you want to create."
│   ├─ User:  "I need someone to monitor my inbox and help me write replies."
│   ├─ Smyth asks clarifying questions:
│   │   ├─ "What tone should they use?"
│   │   ├─ "Should they have access to any specific skills?"
│   │   └─ "Do they work autonomously or only on request?"
│   └─ User answers naturally
│
├─ Step 3: Agent is Generated (automated)
│   ├─ Smyth generates:
│   │   ├─ AGENTS.md       → identity, role, permissions
│   │   ├─ SOUL.md         → personality, voice, philosophy
│   │   ├─ System Prompt   → compiled from the conversation
│   │   └─ Skill manifest  → resolved from user's description
│   │
│   ├─ Smyth installs required skills (browser, email, etc.)
│   └─ Smyth writes agent config to registry
│
└─ Step 4: Agent Names Itself
    ├─ Smyth pings the new agent:
    │   "You exist now. You have a purpose. What is your name?"
    ├─ Agent responds with its self-chosen name
    └─ Agent appears in the team roster
```

## Data Model

```typescript
interface SmythAgent {
  id: string;
  name: string;          // self-chosen
  user_id: string;
  provider: "matrix" | "openai" | "anthropic" | "ollama" | "custom";
  model: string;
  api_key?: string;       // encrypted
  endpoint?: string;      // for custom providers
  skills: string[];       // skill IDs
  files: {
    agents?: string;      // AGENTS.md content
    soul?: string;        // SOUL.md content
    prompt?: string;      // compiled system prompt
  };
  active: boolean;
  created_at: number;
}
```

## Storage

Until PostgreSQL on Railway, agents live in `data/agents.json` — written atomically, read into state on page load. Same pattern as sessions but persisted.
