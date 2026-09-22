// Ollama Cloud + Pro models
// ──────────────────────────────────────────────────────────────────────
// Verified 2026-08-14 against https://ollama.com/search?c=cloud (live catalog)
// Both API keys (Cloud + Pro) expose the same 21-model catalog today.
// The arrays are kept SEPARATE because they represent different API keys,
// different billing, different per-key quota tracking — even when the model
// IDs overlap. If Ollama ever segregates the catalogs, these would diverge.
//
// Sync history:
//   2026-09-02 — synced to current Ollama Cloud catalog (19 models, both keys)
//                Removed: deepseek-v4-flash, deepseek-v4-flash:preview,
//                         deepseek-v4-pro, deepseek-v4-pro:preview (all 404)
//                Added:   glm-5.3, glm-5.3-flash
//   2026-08-14 — synced to current Ollama Cloud catalog
//                Removed: deepseek-v3.2, deepseek-v3.1:671b, kimi-k2.5,
//                         glm-5:cloud, qwen3.5:cloud, qwen3.5:397b-cloud,
//                         glm-5.1:cloud, glm-5.2:cloud (old :cloud suffix style)
//                Added:   deepseek-v4-flash:0731, deepseek-v4-flash:preview,
//                         deepseek-v4-pro:0813, deepseek-v4-pro:preview,
//                         gpt-oss:20b, kimi-k3, minimax-m2.7,
//                         nemotron-3-super, nemotron-3-ultra
//   2026-08-10 — added deepseek-v4-flash, deepseek-v4-pro (cloud key)
//   2026-08-10 — removed qwen3-coder-next:latest (410 retired)
//   2026-08-06 — removed nemotron-3-nano:30b from cloud (was 401; now restored)
//   2026-07-06 — initial catalog (verified 200 status on both keys)

export interface OllamaModel {
  id: string;          // Model ID to send to Ollama API
  name: string;
  account: "cloud" | "pro" | "cloudflare" | "nvidia";  // Which API key to use
  contextWindow: number;
  maxTokens: number;
  capabilities: {
    vision?: boolean;
    coding?: boolean;
    reasoning?: boolean;
    tools?: boolean;
  };
  tier: "light" | "medium" | "heavy";
}

// Shared catalog: same 21 models available on both keys today.
// Centralized so future divergence is a one-line change per array.
const SHARED_OLLAMA_CATALOG: OllamaModel[] = [
  // DeepSeek V4 family
  {
    id: "deepseek-v4-flash:0731",
    name: "DeepSeek V4 Flash (0731)",
    account: "cloud",
    contextWindow: 1_000_000,
    maxTokens: 32_768,
    capabilities: { reasoning: true, coding: true, tools: true },
    tier: "light",
  },
  {
    id: "deepseek-v4-pro:0813",
    name: "DeepSeek V4 Pro (0813)",
    account: "cloud",
    contextWindow: 1_000_000,
    maxTokens: 32_768,
    capabilities: { reasoning: true, coding: true, tools: true },
    tier: "heavy",
  },
  // Gemma 4
  {
    id: "gemma4:31b",
    name: "Gemma 4 31B",
    account: "cloud",
    contextWindow: 256_000,
    maxTokens: 32_768,
    capabilities: { coding: true, tools: true },
    tier: "light",
  },
  // GLM family
  {
    id: "glm-5.1",
    name: "GLM 5.1",
    account: "cloud",
    contextWindow: 200_000,
    maxTokens: 32_768,
    capabilities: { coding: true, reasoning: true, tools: true },
    tier: "heavy",
  },
  {
    id: "glm-5.2",
    name: "GLM 5.2",
    account: "cloud",
    contextWindow: 1_000_000,
    maxTokens: 32_768,
    capabilities: { coding: true, reasoning: true, tools: true },
    tier: "heavy",
  },
  {
    id: "glm-5.3",
    name: "GLM 5.3",
    account: "cloud",
    contextWindow: 1_000_000,
    maxTokens: 32_768,
    capabilities: { coding: true, reasoning: true, tools: true },
    tier: "heavy",
  },
  {
    id: "glm-5.3-flash",
    name: "GLM 5.3 Flash",
    account: "cloud",
    contextWindow: 1_000_000,
    maxTokens: 32_768,
    capabilities: { coding: true, reasoning: true, tools: true },
    tier: "light",
  },
  // GPT-OSS
  {
    id: "gpt-oss:20b",
    name: "GPT-OSS 20B",
    account: "cloud",
    contextWindow: 256_000,
    maxTokens: 32_768,
    capabilities: { reasoning: true, coding: true, tools: true },
    tier: "light",
  },
  {
    id: "gpt-oss:120b",
    name: "GPT-OSS 120B",
    account: "cloud",
    contextWindow: 256_000,
    maxTokens: 32_768,
    capabilities: { reasoning: true, coding: true, tools: true },
    tier: "medium",
  },
  // Kimi family
  {
    id: "kimi-k2.6",
    name: "Kimi K2.6",
    account: "cloud",
    contextWindow: 131_072,
    maxTokens: 32_768,
    capabilities: { vision: true, coding: true, tools: true },
    tier: "medium",
  },
  {
    id: "kimi-k2.7-code",
    name: "Kimi K2.7 Code",
    account: "cloud",
    contextWindow: 131_072,
    maxTokens: 32_768,
    capabilities: { coding: true, tools: true },
    tier: "medium",
  },
  {
    id: "kimi-k3",
    name: "Kimi K3",
    account: "cloud",
    contextWindow: 131_072,
    maxTokens: 32_768,
    capabilities: { vision: true, coding: true, reasoning: true, tools: true },
    tier: "heavy",
  },
  // MiniMax family
  {
    id: "minimax-m2.7",
    name: "MiniMax M2.7",
    account: "cloud",
    contextWindow: 1_000_000,
    maxTokens: 32_768,
    capabilities: { vision: true, coding: true, reasoning: true, tools: true },
    tier: "heavy",
  },
  {
    id: "minimax-m3",
    name: "MiniMax M3",
    account: "cloud",
    contextWindow: 1_000_000,
    maxTokens: 32_768,
    capabilities: { vision: true, coding: true, reasoning: true, tools: true },
    tier: "heavy",
  },
  // Mistral
  {
    id: "mistral-large-3:675b",
    name: "Mistral Large 3 675B",
    account: "cloud",
    contextWindow: 256_000,
    maxTokens: 32_768,
    capabilities: { coding: true, reasoning: true, tools: true },
    tier: "heavy",
  },
  // Nemotron family
  {
    id: "nemotron-3-nano:30b",
    name: "Nemotron 3 Nano 30B",
    account: "cloud",
    contextWindow: 256_000,
    maxTokens: 32_768,
    capabilities: { tools: true },
    tier: "light",
  },
  {
    id: "nemotron-3-super",
    name: "Nemotron 3 Super",
    account: "cloud",
    contextWindow: 256_000,
    maxTokens: 32_768,
    capabilities: { coding: true, reasoning: true, tools: true },
    tier: "heavy",
  },
  {
    id: "nemotron-3-ultra",
    name: "Nemotron 3 Ultra",
    account: "cloud",
    contextWindow: 256_000,
    maxTokens: 32_768,
    capabilities: { coding: true, reasoning: true, tools: true },
    tier: "heavy",
  },
  // Qwen
  {
    id: "qwen3.5:397b",
    name: "Qwen 3.5 397B",
    account: "cloud",
    contextWindow: 256_000,
    maxTokens: 32_768,
    capabilities: { vision: true, coding: true, reasoning: true, tools: true },
    tier: "heavy",
  },
];

// ── Ollama Cloud models (key: OLLAMA_CLOUD_API_KEY) ──
// Same 21 models as Pro today. Kept separate to represent distinct API key,
// billing, and quota tracking.

export const OLLAMA_CLOUD_MODELS: OllamaModel[] = SHARED_OLLAMA_CATALOG.map((m) => ({
  ...m,
  account: "cloud" as const,
}));

// ── Ollama Pro models (key: OLLAMA_PRO_API_KEY) ──
// Same 21 models as Cloud today. Kept separate to represent distinct API key,
// billing, and quota tracking.

export const OLLAMA_PRO_MODELS: OllamaModel[] = SHARED_OLLAMA_CATALOG.map((m) => ({
  ...m,
  account: "pro" as const,
}));

// ── Cloudflare Workers AI models (account: cloudflare) ──
// Verified 2026-08-18 against the live Cloudflare API. These models
// are accessible on the Workers Free plan (10,000 neurons/day).
// Models use the @cf/* namespace as the API model ID.
// Tool-calling supported on 6/8 models; qwen2.5-coder-32b-instruct emits
// XML instead of tool_calls JSON, and qwen3-30b-a3b-fp8 was unreliable
// on tool calls during 2026-08-18 testing - kept but flagged for retry.
// NOT available on free tier: DeepSeek V4, Kimi K2.6/2.7, GLM 5.2, GPT-OSS 120b.
export const CLOUDFLARE_AI_MODELS: OllamaModel[] = [
  {
    id: "@cf/meta/llama-3.1-8b-instruct-fp8",
    name: "Llama 3.1 8B (Cloudflare)",
    account: "cloudflare",
    contextWindow: 128_000,
    maxTokens: 4_096,
    capabilities: { tools: true, coding: true },
    tier: "light",
  },
  {
    id: "@cf/mistralai/mistral-small-3.1-24b-instruct",
    name: "Mistral Small 3.1 24B (Cloudflare)",
    account: "cloudflare",
    contextWindow: 128_000,
    maxTokens: 8_192,
    capabilities: { tools: true, coding: true, reasoning: true },
    tier: "medium",
  },
  {
    id: "@cf/qwen/qwen3-30b-a3b-fp8",
    name: "Qwen 3 30B (Cloudflare)",
    account: "cloudflare",
    contextWindow: 32_000,
    maxTokens: 8_192,
    capabilities: { coding: true },
    tier: "medium",
  },
  {
    id: "@cf/qwen/qwq-32b",
    name: "QwQ 32B (Cloudflare, reasoning)",
    account: "cloudflare",
    contextWindow: 32_000,
    maxTokens: 8_192,
    capabilities: { tools: true, reasoning: true },
    tier: "medium",
  },
  {
    id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    name: "Llama 3.3 70B (Cloudflare)",
    account: "cloudflare",
    contextWindow: 128_000,
    maxTokens: 8_192,
    capabilities: { tools: true, reasoning: true, coding: true },
    tier: "heavy",
  },
  {
    id: "@cf/nvidia/nemotron-3-120b-a12b",
    name: "Nemotron 3 120B (Cloudflare)",
    account: "cloudflare",
    contextWindow: 128_000,
    maxTokens: 8_192,
    capabilities: { tools: true, reasoning: true, coding: true },
    tier: "heavy",
  },
  {
    id: "@cf/qwen/qwen2.5-coder-32b-instruct",
    name: "Qwen 2.5 Coder 32B (Cloudflare)",
    account: "cloudflare",
    contextWindow: 32_000,
    maxTokens: 8_192,
    capabilities: { coding: true },
    tier: "medium",
  },
];

// 2026-08-22: NVIDIA NIM pool (free tier, 40 RPM). Local Python server on
// port 8766 proxies to integrate.api.nvidia.com. Default to nv:super
// (Nemotron-3-Super 120B MoE, ~700ms first call). Tier mapping is rough —
// these are all MoE or large dense models.
export const NVIDIA_POOL_MODELS: OllamaModel[] = [
  {
    id: "nv:super",
    name: "Nemotron 3 Super 120B (NVIDIA, default)",
    account: "nvidia",
    contextWindow: 131_072,
    maxTokens: 16_384,
    capabilities: { tools: true, reasoning: true, coding: true },
    tier: "heavy",
  },
  {
    id: "nv:ultra",
    name: "Nemotron 3 Ultra 550B (NVIDIA, 1M ctx)",
    account: "nvidia",
    contextWindow: 1_048_576,
    maxTokens: 16_384,
    capabilities: { tools: true, reasoning: true, coding: true },
    tier: "heavy",
  },
  {
    id: "nv:laguna",
    name: "Poolside Laguna XS 2.1 (NVIDIA, agentic)",
    account: "nvidia",
    contextWindow: 131_072,
    maxTokens: 8_192,
    capabilities: { tools: true, coding: true },
    tier: "medium",
  },
  {
    id: "nv:light",
    name: "Nemotron 3.5 Lightning 30B (NVIDIA, fast MoE)",
    account: "nvidia",
    contextWindow: 131_072,
    maxTokens: 8_192,
    capabilities: { tools: true, coding: true },
    tier: "light",
  },
  // 2026-08-28: REMOVED nv:reason — Llama 3.3 Nemotron Super 49B EOL'd
  // 2026-08-26T09:00:00Z (NVIDIA 410 Gone). Removed to stop poisoning
  // the pool.
  {
    id: "nv:omni",
    name: "Nemotron 3 Nano Omni 30B (NVIDIA, multimodal)",
    account: "nvidia",
    contextWindow: 131_072,
    maxTokens: 8_192,
    capabilities: { tools: true, reasoning: true },
    tier: "medium",
  },
  // 2026-08-28: REMOVED nv:glimmer — Muse Glimmer 30B consistently
  // read-times out at 60s on the NVIDIA proxy. Removed until the
  // client timeout is fixed.
  // 2026-08-28: REMOVED nv:step — StepFun Step 3.7 Flash hit EOL on
  // 2026-08-28T08:00:00Z (NVIDIA 410 Gone). Removed to stop poisoning
  // the pool.
];

// All Machine models combined (now includes Cloudflare + NVIDIA)
export const ALL_MACHINE_MODELS = [
  ...OLLAMA_CLOUD_MODELS,
  ...OLLAMA_PRO_MODELS,
  ...CLOUDFLARE_AI_MODELS,
  ...NVIDIA_POOL_MODELS,
];

// OmniRoute models (Maetryxx pool)
// Verified 2026-07-17 — tested via curl + live agent use
// DDG: ALL 418 (anti-abuse) — excluded
// tllm: ALL 403 (forbidden) — excluded  
// oc free: ALL 401 (auth revoked) except deepseek-v4-flash-free + big-pickle
// auto/* pro-tier routers: currently failing / rotating through dead providers
//   on this IP. Removed 2026-07-23 after repeated "All model pools are
//   currently unavailable" errors. Re-add only if they become reliable.
export const OMNIROUTE_MODELS = [
  // Auto-routing models — OmniRoute picks the best available upstream
  "auto/fast",
  "auto/chat",
  "auto/best-free",
  "auto/coding",
  "auto/cheap",
  "auto/smart",
  // Direct oc/ free model — confirmed available 2026-08-04
  "oc/deepseek-v4-flash-free",
  // DDG models — currently failing (VQD token acquisition), kept for when fixed
  // "ddgw/gpt-4o-mini",
  // "ddgw/gpt-5-mini",
  // "ddgw/claude-3-5-haiku-20241022",
  // "ddgw/o3-mini",
];

// NOTE: API keys are no longer exported as constants from this file.
// Use src/lib/runtime-keys.ts getters so values can be reloaded from the
// per-user .env at runtime.
// Model lists and capability helpers remain constants.
// ── Local Ollama models (no rate limits, always available) ──
// Runs on localhost:11434, fallback when cloud is exhausted

export interface LocalOllamaModel {
  id: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
  capabilities: {
    vision?: boolean;
    coding?: boolean;
    reasoning?: boolean;
    tools?: boolean;
  };
  tier: "light" | "medium" | "heavy";
}

export const LOCAL_OLLAMA_MODELS: LocalOllamaModel[] = [
  {
    id: "lfm2.5",
    name: "LFM 2.5 8B (Local)",
    contextWindow: 125_000,
    maxTokens: 8_192,
    capabilities: { coding: true, tools: true, reasoning: true },
    tier: "light",
  },
  {
    id: "llama3.1:8b",
    name: "Llama 3.1 8B (Local)",
    contextWindow: 128_000,
    maxTokens: 8_192,
    capabilities: { coding: true, tools: true },
    tier: "light",
  },
];

// NOTE: local endpoint / key getters live in src/lib/runtime-keys.ts.

// ── Single source of truth for model capabilities ────────────────────────
// These helpers look up the model by id across all our pools (Cloud, Pro,
// local, OmniRoute) and return capability flags from the model definitions
// themselves — not from a stale hardcoded list.

export interface ModelCapabilities {
  vision: boolean;
  tools: boolean;
  coding: boolean;
  reasoning: boolean;
}

const DEFAULT_CAPS: ModelCapabilities = {
  vision: false,
  tools: false,
  coding: false,
  reasoning: false,
};

export function findModel(modelId: string): OllamaModel | LocalOllamaModel | null {
  const trimmed = modelId.trim();
  const all: Array<OllamaModel | LocalOllamaModel> = [
    ...OLLAMA_CLOUD_MODELS,
    ...OLLAMA_PRO_MODELS,
    ...LOCAL_OLLAMA_MODELS,
    ...NVIDIA_POOL_MODELS,
    ...CLOUDFLARE_AI_MODELS,
  ];
  // Exact match first; fall back to prefix match (e.g. "qwen3.5" matches
  // "qwen3.5:cloud" by stripping the size suffix).
  const exact = all.find((m) => m.id === trimmed);
  if (exact) return exact;
  const base = trimmed.split(":")[0];
  return all.find((m) => m.id.split(":")[0] === base) || null;
}

export function getModelCapabilities(modelId: string): ModelCapabilities {
  const m = findModel(modelId);
  if (!m) return DEFAULT_CAPS;
  return {
    vision: m.capabilities?.vision === true,
    tools: m.capabilities?.tools === true,
    coding: m.capabilities?.coding === true,
    reasoning: m.capabilities?.reasoning === true,
  };
}

export function hasNativeVision(modelId: string): boolean {
  // Only trust explicitly-flagged capabilities. The previous 'cloud-suffix
  // fallback' was too aggressive: it marked text-only Cloud models like
  // glm-5.2:cloud as vision-capable, so vision-aware routing picked them
  // for image uploads and the model returned 'I don't see any image'.
  // If a new Ollama Cloud model IS vision-capable but not yet defined
  // locally, add it to OLLAMA_CLOUD_MODELS with capabilities.vision=true.
  return getModelCapabilities(modelId).vision;
}

export function prefersVision(pool: "machine" | "maetryxx", excludeBusy?: boolean): string | null {
  // Find any model in the pool that has vision + tools and is healthy.
  // Caller passes excludeBusy to skip models currently in cooldown.
  const candidates = [...OLLAMA_CLOUD_MODELS, ...OLLAMA_PRO_MODELS]
    .filter((m) => (pool === "machine" || (m.account as string) === pool))
    .filter((m) => m.capabilities?.vision && m.capabilities?.tools);
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => a.tier.localeCompare(b.tier))[0].id;
}
