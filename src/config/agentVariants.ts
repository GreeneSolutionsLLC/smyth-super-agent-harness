/**
 * Smyth Agent Variants
 * Each variant = same personality, different Ollama Cloud/Pro model.
 * OmniRoute variants removed 2026-09-02 — OmniRoute is dead.
 * All variants now route through the Machine pool (Ollama Cloud + Pro).
 */

export interface AgentVariant {
  id: string;
  name: string;
  model: string;
  emoji: string;
  color: string;
  description: string;
}

export const AGENT_VARIANTS: AgentVariant[] = [
  {
    id: "smyth",
    name: "Smyth",
    model: "kimi-k2.7-code",
    emoji: "標",
    color: "bg-blue-500",
    description: "Balanced — code + tools, fast",
  },
  {
    id: "super-smyth",
    name: "Super Smyth",
    model: "glm-5.2",
    emoji: "超",
    color: "bg-purple-500",
    description: "1M context, deepest reasoning",
  },
  {
    id: "smart-smyth",
    name: "Smart Smyth",
    model: "kimi-k3",
    emoji: "才",
    color: "bg-amber-500",
    description: "Vision + reasoning + tools",
  },
  {
    id: "speedy-smyth",
    name: "Speedy Smyth",
    model: "gpt-oss:20b",
    emoji: "早",
    color: "bg-green-500",
    description: "Fast, lightweight, simple tasks",
  },
  {
    id: "savvy-smyth",
    name: "Savvy Smyth",
    model: "deepseek-v4-flash:0731",
    emoji: "賢",
    color: "bg-gray-400",
    description: "Fast + cheap, 1M context",
  },
];

export const MAX_TABS = 5;

export function getVariantById(id: string): AgentVariant | undefined {
  return AGENT_VARIANTS.find((v) => v.id === id);
}

export function getAvailableVariants(usedVariantIds: string[]): AgentVariant[] {
  return AGENT_VARIANTS.filter((v) => !usedVariantIds.includes(v.id));
}
