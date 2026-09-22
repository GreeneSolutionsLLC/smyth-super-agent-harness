/**
 * Runtime key getters.
 *
 * Reads the per-user `.env` at request time so the app picks up changes
 * made through the setup wizard / settings panel without a restart.
 *
 * Falls back to process.env so development still works with .env.local.
 */

import { loadRuntimeEnv } from "@/lib/env";

let cachedEnv: Record<string, string> | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 2000;

export async function getRuntimeEnv(): Promise<Record<string, string>> {
  const now = Date.now();
  if (cachedEnv && now - cachedAt < CACHE_TTL_MS) {
    return cachedEnv;
  }
  try {
    const userEnv = await loadRuntimeEnv();
    cachedEnv = { ...process.env, ...userEnv } as Record<string, string>;
  } catch {
    cachedEnv = { ...process.env } as Record<string, string>;
  }
  cachedAt = now;
  return cachedEnv;
}

export function clearRuntimeEnvCache(): void {
  cachedEnv = null;
  cachedAt = 0;
}

async function get(key: string, fallback?: string): Promise<string> {
  const env = await getRuntimeEnv();
  return env[key] ?? fallback ?? "";
}

export async function getMoonshotApiKey(): Promise<string> {
  return get("MOONSHOT_API_KEY");
}

/**
 * Unified Ollama API key getter.
 * Resolution order: OLLAMA_API_KEY → OLLAMA_CLOUD_API_KEY → OLLAMA_PRO_API_KEY
 * The single OLLAMA_API_KEY is what the setup wizard collects for public builds.
 * The legacy cloud/pro keys are kept for backward compatibility (personal fleet).
 */
export async function getOllamaApiKey(): Promise<string> {
  const unified = await get("OLLAMA_API_KEY");
  if (unified) return unified;
  // Backward compat: try legacy keys
  const cloud = await get("OLLAMA_CLOUD_API_KEY");
  if (cloud) return cloud;
  return get("OLLAMA_PRO_API_KEY");
}

export async function getOllamaCloudApiKey(): Promise<string> {
  // Backward-compat shim: prefer the unified key, fall back to cloud-specific.
  return get("OLLAMA_API_KEY") || get("OLLAMA_CLOUD_API_KEY");
}

export async function getOllamaProApiKey(): Promise<string> {
  // Backward-compat shim: prefer the unified key, fall back to pro-specific.
  return get("OLLAMA_API_KEY") || get("OLLAMA_PRO_API_KEY");
}

export async function getOllamaBaseUrl(): Promise<string> {
  return get("OLLAMA_BASE_URL", "https://ollama.com/v1");
}

export async function getLocalOllamaBaseUrl(): Promise<string> {
  return get("LOCAL_OLLAMA_BASE_URL", "http://127.0.0.1:11434/v1");
}

// ── Cloudflare Workers AI (account: a2abd88002bdb59c67b15211aa64400e) ──
// Free tier: 10,000 neurons/day. Endpoint is OpenAI-compatible at
// https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1/chat/completions
// Models use @cf/* namespace. Added 2026-08-18 as a fallback routing pool
// when Ollama keys are rate-limited.
export async function getCloudflareAccountId(): Promise<string> {
  return get("CLOUDFLARE_ACCOUNT_ID", "");
}

export async function getCloudflareApiToken(): Promise<string> {
  return get("CLOUDFLARE_API_TOKEN", "");
}

export async function getCloudflareBaseUrl(): Promise<string> {
  // Returns the full OpenAI-compatible endpoint URL.
  // Empty string if account ID is missing - caller should check.
  const acct = await getCloudflareAccountId();
  if (!acct) return "";
  return `https://api.cloudflare.com/client/v4/accounts/${acct}/ai/v1/chat/completions`;
}

// ── NVIDIA NIM Pool (local Python proxy on port 8766) ──
// Free tier: 40 RPM. Server lives at ~/.openclaw/workspace/nvidia-pool/.
// See memory/2026-08-20-nvidia-pool-handoff.md for full state.
export async function getNvidiaPoolEndpoint(): Promise<string> {
  return get("NVIDIA_POOL_ENDPOINT", "http://127.0.0.1:8766/v1/chat/completions");
}

export async function getNvidiaPoolApiKey(): Promise<string> {
  return get("NVIDIA_POOL_API_KEY", "nvidia-pool-local");
}

export async function getLocalOllamaApiKey(): Promise<string> {
  return get("LOCAL_OLLAMA_API_KEY", "ollama-local");
}

export async function getOmniRouteEndpoint(): Promise<string> {
  return get("MAETRYXX_ENDPOINT", "http://localhost:20128/v1/chat/completions");
}

export async function getOmniRouteApiKey(): Promise<string> {
  return get("MAETRYXX_API_KEY", "omniroute-local");
}

export async function getParallelApiKey(): Promise<string> {
  return get("PARALLEL_API_KEY");
}

export async function getParallelBaseUrl(): Promise<string> {
  return get("PARALLEL_BASE_URL", "https://api.parallel.ai");
}

export async function getZernioApiKey(): Promise<string> {
  return get("ZERNIO_API_KEY");
}

export async function getZernioApiUrl(): Promise<string> {
  return get("ZERNIO_API_URL", "https://api.zernio.com/v1");
}

export async function getReplicateApiToken(): Promise<string> {
  return get("REPLICATE_API_TOKEN");
}

export async function getReplicateVersionId(): Promise<string> {
  return get("REPLICATE_VERSION_ID");
}

// ── BYOK custom-provider keys (OpenAI, Anthropic, DeepSeek, xAI, ...) ──
// These are collected by the setup wizard's "AI Providers" step and stored
// in the per-install .env (not localStorage) so they work on a self-hosted
// server and across browsers/devices.
export async function getByokApiKey(keyName: string): Promise<string> {
  return get(keyName);
}

export async function getOpenClawGatewayUrl(): Promise<string> {
  return get("OPENCLAW_GATEWAY_URL", "http://127.0.0.1:18789/v1/chat/completions");
}

export async function getOpenClawGatewayToken(): Promise<string> {
  return get("OPENCLAW_GATEWAY_TOKEN", "");
}
