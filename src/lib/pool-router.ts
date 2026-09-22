  import {
  OLLAMA_CLOUD_MODELS,
  OLLAMA_PRO_MODELS,
  CLOUDFLARE_AI_MODELS,
  NVIDIA_POOL_MODELS,
  OMNIROUTE_MODELS,
  LOCAL_OLLAMA_MODELS,
  hasNativeVision,
  type OllamaModel,
} from "@/lib/ollama-models";
import {
  getOllamaCloudApiKey,
  getOllamaProApiKey,
  getOllamaBaseUrl,
  getLocalOllamaBaseUrl,
  getLocalOllamaApiKey,
  getOmniRouteEndpoint,
  getOmniRouteApiKey,
  getCloudflareAccountId,
  getCloudflareApiToken,
  getNvidiaPoolEndpoint,
  getNvidiaPoolApiKey,
} from "@/lib/runtime-keys";

export type PoolId = "maetryxx" | "machine";
export type RouteMode = "auto" | "maetryxx" | "machine" | "offline" | "custom";

// Models that return 502/timeout when tools array is in the payload.
// Models that return 502/timeout when tools array is in the payload.
// These free OmniRoute providers don't support function calling reliably.
const TOOL_INCOMPATIBLE_MODELS = new Set([
  "oc/deepseek-v4-flash-free",
  "auto/cheap",
]);

// Internal sub-pool for Machine (user doesn't see this)
type MachineAccount = "cloud" | "pro" | "local" | "cloudflare" | "nvidia";

interface ModelHealth {
  modelId: string;
  pool: PoolId;
  account?: MachineAccount; // Only for Machine pool
  status: "healthy" | "rate-limited" | "banned";
  cooldownUntil: number;
  failureCount: number;
  lastUsed: number;
  tokensUsed: number;
}

interface PoolHealth {
  poolId: PoolId;
  tokensToday: number;
  requestsToday: number;
  recent429s: number;
  consecutiveRequests: number;
}

// OmniRoute endpoint/key are loaded at request time via runtime-keys.ts.
// These defaults are only used until the first refresh and match the
// local OmniRoute default so dev works before setup is completed.
let currentMaetryxxEndpoint = "http://localhost:20128/v1/chat/completions";
let currentMaetryxxApiKey = "omniroute-local"; // Must match OmniRoute's REQUIRE_API_KEY

async function refreshMaetryxxEndpoint(): Promise<void> {
  try {
    const [endpoint, apiKey] = await Promise.all([
      getOmniRouteEndpoint(),
      getOmniRouteApiKey(),
    ]);
    currentMaetryxxEndpoint = endpoint;
    currentMaetryxxApiKey = apiKey;
  } catch (e) {
    console.error("[pool-router] failed to refresh OmniRoute endpoint:", e);
  }
}

// ── In-memory state ──

const modelHealthMap = new Map<string, ModelHealth>();

const poolHealth: Record<PoolId, PoolHealth> = {
  maetryxx: {
    poolId: "maetryxx",
    tokensToday: 0,
    requestsToday: 0,
    recent429s: 0,
    consecutiveRequests: 0,
  },
  machine: {
    poolId: "machine",
    tokensToday: 0,
    requestsToday: 0,
    recent429s: 0,
    consecutiveRequests: 0,
  },
};

// Round-robin index per sub-pool
const rotationIndex: Record<string, number> = {
  maetryxx: 0,
  "machine:cloud": 0,
  "machine:pro": 0,
  "machine:cloudflare": 0,
  "machine:nvidia": 0,
  "machine:local": 0,
};

// 2026-08-22: Cloudflare's free tier is 10k neurons/account/day. A waffly
// tool-call loop can burn that in one user message. Two caps:
//  1. Per-request: max CF_CALLS_PER_REQUEST calls per user turn (default 5)
//     Once hit, refuse to pick another CF model this turn so the agent loop
//     bails out and falls through to Ollama.
//  2. Per-account-day: soft cap (default 80) tracking total CF calls today.
//     When hit, ban the whole CF account until midnight UTC.
// The stream/route.ts code is responsible for calling resetCFCallsThisRequest()
// at the start of each new user message.
const CF_CALLS_PER_REQUEST = 5;
const CF_CALLS_PER_DAY_SOFT_CAP = 80;
let cfCallsThisRequest = 0;
let cfCallsThisDay = 0;
let cfCallsDayResetAt = 0;

export function resetCFCallsThisRequest() {
  cfCallsThisRequest = 0;
}

function checkCFCaps(account: MachineAccount): boolean {
  if (account !== "cloudflare") return true;
  // Daily reset window (next midnight UTC)
  const now = Date.now();
  const nextMidnight = (() => {
    const d = new Date();
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0);
  })();
  if (now >= cfCallsDayResetAt) {
    cfCallsThisDay = 0;
    cfCallsDayResetAt = nextMidnight;
  }
  if (cfCallsThisDay >= CF_CALLS_PER_DAY_SOFT_CAP) {
    console.log(`[pool-router] CF daily call cap hit (${cfCallsThisDay}/${CF_CALLS_PER_DAY_SOFT_CAP}) — refusing to route to cloudflare`);
    return false;
  }
  if (cfCallsThisRequest >= CF_CALLS_PER_REQUEST) {
    console.log(`[pool-router] CF per-request cap hit (${cfCallsThisRequest}/${CF_CALLS_PER_REQUEST}) — falling through to other pools`);
    return false;
  }
  return true;
}

function recordCFCall() {
  cfCallsThisRequest += 1;
  cfCallsThisDay += 1;
}

// ── Snapshot of in-memory health for debug endpoints ──

export function snapshotHealth() {
  const out: Record<string, { status: string; cooldownUntil: number; failureCount: number; pool: PoolId }> = {};
  for (const [key, h] of Array.from(modelHealthMap.entries())) {
    out[key] = {
      status: h.status,
      cooldownUntil: h.cooldownUntil,
      failureCount: h.failureCount,
      pool: h.pool,
    };
  }
  return out;
}

// Alternate between Cloud and Pro within Machine pool
let machineAccountToggle: MachineAccount = "pro";

// ── Constants ──

// Tier-aware timeouts (ms) — heavy models get more time
const TIMEOUT_BY_TIER: Record<string, number> = {
  heavy: 120_000,
  medium: 90_000,
  light: 60_000,
};

// Separate timeout from rate-limit: models that are just slow shouldn't be banned
const SLOW_COOLDOWN_MS = 5_000; // 5s for timeouts (was mixed with rate-limit cooldowns)

export function getTimeoutForModel(modelId: string, pool: PoolId): number {
  if (pool === "maetryxx") return 90_000; // OmniRoute gets 90s regardless
  // Machine pool: check model tier
  const cloudModel = OLLAMA_CLOUD_MODELS.find(m => m.id === modelId);
  const proModel = OLLAMA_PRO_MODELS.find(m => m.id === modelId);
  const tier = cloudModel?.tier || proModel?.tier || "medium";
  return TIMEOUT_BY_TIER[tier] || 90_000;
}

const BASE_COOLDOWN_MS = 500;    // 500ms base cooldown (was 2s) — just skip to next model
const MAX_COOLDOWN_MS = 5_000;    // 5s max cooldown (was 30s) — don't lock models out
const QUOTA_COOLDOWN_MS = 10_000; // 10s for 403/banned (was 30s) — 403s are often transient
const ROTATION_THRESHOLD = 5; // rotate pools after this many consecutive requests
const POOL_HEALTH_THRESHOLD = 0.5; // If <=50% models healthy, switch pools

// ── Helpers ──

function getModelKey(pool: PoolId, modelId: string, account?: MachineAccount): string {
  return account ? `${pool}:${account}:${modelId}` : `${pool}:${modelId}`;
}

export function getOrCreateHealth(pool: PoolId, modelId: string, account?: MachineAccount): ModelHealth {
  const key = getModelKey(pool, modelId, account);
  let h = modelHealthMap.get(key);
  if (!h) {
    h = {
      modelId,
      pool,
      account,
      status: "healthy",
      cooldownUntil: 0,
      failureCount: 0,
      lastUsed: 0,
      tokensUsed: 0,
    };
    modelHealthMap.set(key, h);
  }
  return h;
}

function isModelAvailable(h: ModelHealth): boolean {
  if (h.status === "banned") return false;
  if (h.status === "rate-limited" && Date.now() < h.cooldownUntil) return false;
  // Check if cooldown expired → restore
  if (h.status === "rate-limited" && Date.now() >= h.cooldownUntil) {
    h.status = "healthy";
    return true;
  }
  return true;
}

function getMachineModels(account: MachineAccount): string[] {
  if (account === "cloud") return OLLAMA_CLOUD_MODELS.map((m) => m.id);
  if (account === "pro") return OLLAMA_PRO_MODELS.map((m) => m.id);
  if (account === "cloudflare") return CLOUDFLARE_AI_MODELS.map((m) => m.id);
  if (account === "nvidia") return NVIDIA_POOL_MODELS.map((m) => m.id);
  return LOCAL_OLLAMA_MODELS.map((m) => m.id);
}

function getPoolModels(pool: PoolId): string[] {
  if (pool === "maetryxx") return OMNIROUTE_MODELS;
  return [...OLLAMA_CLOUD_MODELS, ...OLLAMA_PRO_MODELS, ...LOCAL_OLLAMA_MODELS].map((m) => m.id);
}

function getMachineModelAccount(modelId: string): MachineAccount {
  const cloud = OLLAMA_CLOUD_MODELS.find((m) => m.id === modelId);
  return cloud ? "cloud" : "pro";
}

function getHealthyModels(pool: PoolId): { modelId: string; account?: MachineAccount }[] {
  if (pool === "maetryxx") {
    return OMNIROUTE_MODELS.filter((id) =>
      isModelAvailable(getOrCreateHealth("maetryxx", id))
    ).map((modelId) => ({ modelId }));
  }

  // Machine pool: check both accounts
  const healthy: { modelId: string; account?: MachineAccount }[] = [];
  for (const m of OLLAMA_CLOUD_MODELS) {
    if (isModelAvailable(getOrCreateHealth("machine", m.id, "cloud"))) {
      healthy.push({ modelId: m.id, account: "cloud" });
    }
  }
  for (const m of OLLAMA_PRO_MODELS) {
    if (isModelAvailable(getOrCreateHealth("machine", m.id, "pro"))) {
      healthy.push({ modelId: m.id, account: "pro" });
    }
  }
  for (const m of CLOUDFLARE_AI_MODELS) {
    if (isModelAvailable(getOrCreateHealth("machine", m.id, "cloudflare"))) {
      healthy.push({ modelId: m.id, account: "cloudflare" });
    }
  }
  for (const m of NVIDIA_POOL_MODELS) {
    if (isModelAvailable(getOrCreateHealth("machine", m.id, "nvidia"))) {
      healthy.push({ modelId: m.id, account: "nvidia" });
    }
  }
  for (const m of LOCAL_OLLAMA_MODELS) {
    if (isModelAvailable(getOrCreateHealth("machine", m.id, "local"))) {
      healthy.push({ modelId: m.id, account: "local" });
    }
  }
  return healthy;
}

function getPoolHealthRatio(pool: PoolId): number {
  if (pool === "maetryxx") {
    const total = OMNIROUTE_MODELS.length;
    const healthy = OMNIROUTE_MODELS.filter((id) =>
      isModelAvailable(getOrCreateHealth("maetryxx", id))
    ).length;
    return total > 0 ? healthy / total : 0;
  }

  const total = OLLAMA_CLOUD_MODELS.length + OLLAMA_PRO_MODELS.length + LOCAL_OLLAMA_MODELS.length;
  const healthy = getHealthyModels("machine").length;
  return total > 0 ? healthy / total : 0;
}

function getCooldownMs(failureCount: number, status?: number): number {
  if (status === 403) return QUOTA_COOLDOWN_MS;
  const cooldown = BASE_COOLDOWN_MS * Math.pow(2, Math.min(failureCount - 1, 4));
  return Math.min(cooldown, MAX_COOLDOWN_MS);
}

// ── Core: pick which pool to use ──

export function selectPool(mode: RouteMode, needsTools: boolean = false, preferPool?: PoolId | null): PoolId {
  if (mode === "maetryxx") return "maetryxx";
  if (mode === "machine") return "machine";

  // Engine keep-alive: if the caller explicitly prefers a pool (because the
  // other one just rate-limited), honor it when it's healthy.
  if (preferPool) {
    const prefHealth = getPoolHealthRatio(preferPool);
    if (prefHealth > POOL_HEALTH_THRESHOLD) {
      return preferPool;
    }
  }

  // Auto mode: if tools are needed, prefer Machine pool (real models with tool support)
  // OmniRoute free models (deepseek-v4-flash-free, big-pickle) can't handle tool calling reliably
  if (needsTools) {
    // Always prefer Machine pool for tool-use — OmniRoute free models can't do tool calling
    const machineHealth = getPoolHealthRatio("machine");
    if (machineHealth > 0) {  // Any healthy machine model is better than OmniRoute for tools
      return "machine";
    }
    // Machine pool completely exhausted — fall through to try maetryxx
  }

  // Auto mode: proactive rotation
  const maetryxxHealth = getPoolHealthRatio("maetryxx");
  const machineHealth = getPoolHealthRatio("machine");

  // If one pool is critically unhealthy, use the other
  if (maetryxxHealth <= POOL_HEALTH_THRESHOLD && machineHealth > POOL_HEALTH_THRESHOLD) {
    return "machine";
  }
  if (machineHealth <= POOL_HEALTH_THRESHOLD && maetryxxHealth > POOL_HEALTH_THRESHOLD) {
    return "maetryxx";
  }

  // If both unhealthy, pick the better one
  if (maetryxxHealth <= POOL_HEALTH_THRESHOLD && machineHealth <= POOL_HEALTH_THRESHOLD) {
    return maetryxxHealth >= machineHealth ? "maetryxx" : "machine";
  }

  // Both healthy: rotate after ROTATION_THRESHOLD consecutive requests
  const mState = poolHealth.maetryxx;
  const machineState = poolHealth.machine;

  // Default to Machine pool first (Ollama Cloud/Pro are more reliable than OmniRoute free)
  // OmniRoute's upstream providers are frequently down — only use as fallback
  if (mState.consecutiveRequests === 0 && machineState.consecutiveRequests === 0) {
    return "machine";
  }

  if (mState.consecutiveRequests >= ROTATION_THRESHOLD && machineHealth > POOL_HEALTH_THRESHOLD) {
    mState.consecutiveRequests = 0;
    machineState.consecutiveRequests = 0;
    return "machine";
  }
  if (machineState.consecutiveRequests >= ROTATION_THRESHOLD && maetryxxHealth > POOL_HEALTH_THRESHOLD) {
    mState.consecutiveRequests = 0;
    machineState.consecutiveRequests = 0;
    return "maetryxx";
  }

  // Continue with current pool
  const lastPool = mState.consecutiveRequests > machineState.consecutiveRequests ? "maetryxx" : "machine";
  return lastPool;
}

// Helper: check if a model supports tool calling well
function supportsTools(modelId: string, pool: PoolId): boolean {
  if (pool === "machine") {
    // All machine models support tools (checked in ollama-models.ts capabilities)
    return true;
  }
  // Maetryxx: only non-free, non-combo models support tools reliably
  // Free models (deepseek-v4-flash-free, big-pickle) and combo routers (auto/*) struggle
  return !TOOL_INCOMPATIBLE_MODELS.has(modelId);
}

// ── Pick a model within a pool (round-robin among healthy) ──

export interface SelectedModel {
  modelId: string;
  pool: PoolId;
  account?: MachineAccount;
  endpoint: string;
  apiKey: string;
}

export async function selectModel(pool: PoolId, needsTools: boolean = false, needsVision: boolean = false, ollamaAccount?: "cloud" | "pro" | "cloudflare" | "nvidia" | "rotate"): Promise<SelectedModel | null> {

  // Vision-aware routing: when the request carries an image, the picked
  // model MUST be vision-capable, otherwise the model returns the silent
  // "you didn't attach a file" reply. We filter the healthy-model list
  // by hasNativeVision() (which has a cloud-suffix fallback for Ollama
  // Cloud models). If no vision-capable model is healthy in this pool,
  // return null so the caller (routeRequest) can fall through to OmniRoute
  // or a different pool.
  if (needsVision && pool === "machine") {
    const all = getHealthyModels("machine");
    let visionOk = all.filter((m) => hasNativeVision(m.modelId));
    // If user pinned a specific Ollama account, restrict to that account
    if (ollamaAccount && ollamaAccount !== "rotate") {
      visionOk = visionOk.filter((m) => m.account === ollamaAccount);
    }
    if (visionOk.length === 0) {
      console.log(`[pool-router] no vision-capable model healthy in machine pool (account=${ollamaAccount || "any"})`);
      return null;
    }
    // Prefer cloud first (faster + handles multimodal natively), then pro, then local
    const cloudFirst = visionOk.filter((m) => m.account === "cloud");
    const pool2 = cloudFirst.length > 0 ? cloudFirst : visionOk.filter((m) => m.account === "pro");
    const pool3 = pool2.length > 0 ? pool2 : visionOk.filter((m) => m.account === "local");
    const picked = pool3[0];
    if (!picked) return null;
    const [cloudKey, proKey, localKey, remoteBaseUrl, localBaseUrl] = await Promise.all([
      getOllamaCloudApiKey(),
      getOllamaProApiKey(),
      getLocalOllamaApiKey(),
      getOllamaBaseUrl(),
      getLocalOllamaBaseUrl(),
    ]);
    const apiKey = picked.account === "cloud" ? cloudKey
      : picked.account === "pro" ? proKey
      : localKey;
    const targetBaseUrl = picked.account === "local" ? localBaseUrl : remoteBaseUrl;
    console.log(`[pool-router] vision-aware pick: ${picked.modelId} (account=${picked.account})`);
    return {
      modelId: picked.modelId,
      pool: "machine",
      account: picked.account,
      endpoint: `${targetBaseUrl}/chat/completions`,
      apiKey,
    };
  }

  if (pool === "maetryxx") {
    const healthy = OMNIROUTE_MODELS.filter((id) =>
      isModelAvailable(getOrCreateHealth("maetryxx", id)) &&
      (!needsTools || !TOOL_INCOMPATIBLE_MODELS.has(id))
    );
    console.log(`[pool-router] maetryxx: ${healthy.length}/${OMNIROUTE_MODELS.length} models healthy`);
    if (healthy.length === 0) {
      console.log(`[pool-router] ALL MAETRYXX MODELS EXHAUSTED`);
      for (const id of OMNIROUTE_MODELS) {
        const h = getOrCreateHealth("maetryxx", id);
        if (h.status !== "healthy") {
          console.log(`  ${id}: ${h.status} until ${new Date(h.cooldownUntil).toISOString()} (failures: ${h.failureCount})`);
        }
      }
      return null;
    }

    const idx = rotationIndex.maetryxx % healthy.length;
    rotationIndex.maetryxx = (rotationIndex.maetryxx + 1) % healthy.length;

    await refreshMaetryxxEndpoint();

    console.log(`[pool-router] picked ${healthy[idx]} (${idx+1}/${healthy.length})`);
    return {
      modelId: healthy[idx],
      pool: "maetryxx",
      endpoint: currentMaetryxxEndpoint,
      apiKey: currentMaetryxxApiKey,
    };
  }

  // Machine pool: alternate between Cloud and Pro accounts (local is emergency only)
  const healthy = getHealthyModels("machine");
  if (healthy.length === 0) return null;

  // If user pinned a specific Ollama account, restrict candidates to it
  let cloudPro = healthy.filter((m) => m.account === "cloud" || m.account === "pro" || m.account === "cloudflare" || m.account === "nvidia");
  if (ollamaAccount && ollamaAccount !== "rotate") {
    cloudPro = cloudPro.filter((m) => m.account === ollamaAccount);
    if (cloudPro.length === 0) {
      console.log(`[pool-router] no healthy models in pinned account=${ollamaAccount}`);
      return null;
    }
  }
  const localOnly = healthy.filter((m) => m.account === "local");

  // Build the candidate pool. When ollamaAccount is "rotate" (or unset),
  // treat Cloud, Pro, and Cloudflare as ONE pool of 50 unique slots — each
  // model + each key is independent in rate-limit accounting, so we MUST
  // interleave them so 2 rapid tool calls land on different keys.
  // Cloudflare uses neurons, not rate-limit tokens, so we restrict it to
  // light/medium tiers to avoid burning the 10k neuron/day free budget.
  // Bug fix 2026-08-18: previous code alternated whole-account, causing
  // back-to-back tool calls to hit different models on the SAME key.
  let candidates: typeof cloudPro;
  if (ollamaAccount === "cloud" || ollamaAccount === "pro" || ollamaAccount === "cloudflare" || ollamaAccount === "nvidia") {
    // Pinned to a single key — restrict to that account's models
    candidates = cloudPro.filter((m) => m.account === ollamaAccount);
  } else {
    // rotate / unset — Cloud + Pro only. Cloudflare and NVIDIA are separate
    // pools (UI: "Flare" / "NVIDIA") and are NOT merged into rotation.
    // Opt-in only via ollamaAccount="cloudflare" or "nvidia". Per operator
    // rule 2026-08-18: pools stay separate, no cross-pollination.
    candidates = cloudPro.filter((m) => m.account === "cloud" || m.account === "pro");
  }
  // machineAccountToggle is no longer used here; left in place for legacy
  // sanity checks elsewhere. Round-robin index advances per call.

  if (candidates.length === 0) return null;

  const firstRaw = candidates[0];
  const firstAccount = firstRaw?.account;
  if (!firstAccount) {
    console.error("[pool-router] candidates[0] has no account:", JSON.stringify(firstRaw));
    return null;
  }

  const subPoolKey = `machine:${firstAccount}`;
  // 2026-08-28: default to 0 when the sub-pool key isn't in rotationIndex
  // (e.g. "machine:local", "machine:nvidia" before default entries were
  // added). Prior bug: missing key → `undefined % N` → NaN → candidates[NaN]
  // → picked undefined → pool reported as exhausted → fake quota-bug message.
  const idx = (rotationIndex[subPoolKey] ?? 0) % candidates.length;
  rotationIndex[subPoolKey] = ((rotationIndex[subPoolKey] ?? 0) + 1) % candidates.length;

  const picked = candidates[idx];
  // 2026-08-22: defensive guard. With the nvidia/cloudflare sub-pools
  // bolted on, a malformed health record (missing `account`) or empty
  // candidates after filtering could leave `picked` undefined and crash
  // downstream at `picked.account`. We log and bail rather than 500.
  if (!picked) {
    console.warn(`[pool-router] picked is undefined after candidate pick (idx=${idx}, candidates.length=${candidates.length})`);
    return null;
  }
  if (!picked.account) {
    console.warn(`[pool-router] picked has no account: ${JSON.stringify(picked)}`);
    return null;
  }
  // 2026-08-22: cap Cloudflare call count to prevent the agent loop from
  // burning the 10k neuron/day free budget in a single user message.
  if (picked.account === "cloudflare" && !checkCFCaps("cloudflare")) {
    console.log(`[pool-router] refusing CF pick — cap exceeded (req=${cfCallsThisRequest}/${CF_CALLS_PER_REQUEST}, day=${cfCallsThisDay}/${CF_CALLS_PER_DAY_SOFT_CAP})`);
    return null;
  }
  const [cloudKey, proKey, localKey, remoteBaseUrl, localBaseUrl] = await Promise.all([
    getOllamaCloudApiKey(),
    getOllamaProApiKey(),
    getLocalOllamaApiKey(),
    getOllamaBaseUrl(),
    getLocalOllamaBaseUrl(),
  ]);
  // Resolve auth based on which sub-pool the picked model belongs to.
  let apiKey: string;
  let targetBaseUrl: string;
  if (picked.account === "cloudflare") {
    const [cfToken, cfAccount] = await Promise.all([
      getCloudflareApiToken(),
      getCloudflareAccountId(),
    ]);
    if (!cfToken || !cfAccount) {
      console.log("[pool-router] cloudflare model picked but CF creds missing - skipping");
      return null;
    }
    apiKey = cfToken;
    targetBaseUrl = `https://api.cloudflare.com/client/v4/accounts/${cfAccount}/ai/v1/chat/completions`;
  } else if (picked.account === "nvidia") {
    // Local Python proxy on port 8766 (server.py in ~/.openclaw/workspace/nvidia-pool/)
    apiKey = await getNvidiaPoolApiKey();
    targetBaseUrl = await getNvidiaPoolEndpoint();
  } else if (picked.account === "local") {
    apiKey = localKey;
    targetBaseUrl = localBaseUrl;
  } else {
    apiKey = picked.account === "cloud" ? cloudKey : proKey;
    targetBaseUrl = remoteBaseUrl;
  }

  return {
    modelId: picked.modelId,
    pool: "machine",
    account: picked.account,
    endpoint: targetBaseUrl.includes("/chat/completions") ? targetBaseUrl : targetBaseUrl + "/chat/completions",
    apiKey,
  };
}



// ── Main: route a request ──

// ── Emergency local fallback (last resort) ──
// Exported so callers (e.g. stream route) can force it when all other pools are exhausted.
export async function selectLocalFallback(): Promise<SelectedModel | null> {
  const healthy = LOCAL_OLLAMA_MODELS.filter((m) =>
    isModelAvailable(getOrCreateHealth("machine", m.id, "local"))
  );
  if (healthy.length === 0) return null;
  const [localKey, localBaseUrl] = await Promise.all([
    getLocalOllamaApiKey(),
    getLocalOllamaBaseUrl(),
  ]);
  return {
    modelId: healthy[0].id,
    pool: "machine",
    account: "local",
    endpoint: `${localBaseUrl}/chat/completions`,
    apiKey: localKey,
  };
}

// ── Real-time pool health logging ──
export function logPoolHealth(label: string) {
  console.log(`[pool-router] ${label}`);
  for (const id of OMNIROUTE_MODELS) {
    const h = getOrCreateHealth("maetryxx", id);
    console.log(`  maetryxx:${id} -> ${h.status} (failures: ${h.failureCount}, cooldown: ${h.cooldownUntil ? new Date(h.cooldownUntil).toISOString() : "none"})`);
  }
  for (const m of OLLAMA_CLOUD_MODELS) {
    const h = getOrCreateHealth("machine", m.id, "cloud");
    console.log(`  machine:cloud:${m.id} -> ${h.status} (failures: ${h.failureCount}, cooldown: ${h.cooldownUntil ? new Date(h.cooldownUntil).toISOString() : "none"})`);
  }
  for (const m of OLLAMA_PRO_MODELS) {
    const h = getOrCreateHealth("machine", m.id, "pro");
    console.log(`  machine:pro:${m.id} -> ${h.status} (failures: ${h.failureCount}, cooldown: ${h.cooldownUntil ? new Date(h.cooldownUntil).toISOString() : "none"})`);
  }
  for (const m of LOCAL_OLLAMA_MODELS) {
    const h = getOrCreateHealth("machine", m.id, "local");
    console.log(`  machine:local:${m.id} -> ${h.status} (failures: ${h.failureCount}, cooldown: ${h.cooldownUntil ? new Date(h.cooldownUntil).toISOString() : "none"})`);
  }
  const stats = getPoolStats();
  console.log(`  stats -> maetryxx ${stats.maetryxx.healthyModels}/${stats.maetryxx.totalModels} healthy, machine ${stats.machine.healthyModels}/${stats.machine.totalModels} healthy`);
}

// ── Main: route a request ──

export async function routeRequest(mode: RouteMode, excludeBusy: boolean = false, needsVision: boolean = false, preferPool?: PoolId | null, ollamaAccount?: "cloud" | "pro" | "cloudflare" | "nvidia" | "rotate"): Promise<SelectedModel | null> {
  console.log(`[pool-router] routeRequest called with mode=${mode} excludeBusy=${excludeBusy} preferPool=${preferPool || "none"} ollamaAccount=${ollamaAccount || "default"}`);
  const pool = selectPool(mode, excludeBusy, preferPool);
  console.log(`[pool-router] selected pool: ${pool}`);
  const model = await selectModel(pool, false, needsVision, ollamaAccount);

  if (model) {
    console.log(`[pool-router] selected model: ${model.modelId} from pool ${model.pool}`);
    return model;
  }

  console.log(`[pool-router] no healthy model in pool ${pool}, trying other pool...`);

  // 2026-08-22 (Rob, hard rule): POOLS DO NOT CROSS. If the user pinned
  // ollamaAccount (cloud/pro/cloudflare/nvidia), no fallback to other
  // machine-account models or to maetryxx — ever. Even in mode="auto".
  // The only rotation that interleaves is rotate (cloud↔pro within the
  // same vendor family). Pinned = sticky = error on exhaustion.
  const userPinned = ollamaAccount && ollamaAccount !== "rotate";
  if (userPinned) {
    console.log(`[pool-router] ollamaAccount=${ollamaAccount} pinned — no cross-pool fallback`);
    // Single retry with the same pick. If still null, return null and
    // let the caller surface 'Pinned pool exhausted'.
  } else if (mode === "auto") {
    // No pin → auto mode may interleave machine ↔ maetryxx.
    const otherPool: PoolId = pool === "maetryxx" ? "machine" : "maetryxx";
    const otherModel = await selectModel(otherPool, excludeBusy, needsVision);
    if (otherModel) {
      console.log(`[pool-router] fallback model: ${otherModel.modelId} from pool ${otherModel.pool}`);
      return otherModel;
    }
  }

  console.log(`[pool-router] ALL POOLS EXHAUSTED — waiting briefly for cooldowns to clear`);
  logPoolHealth("final health snapshot");

  // Wait briefly (up to 2.5s) for a model to come out of cooldown. Many models
  // hit 429 simultaneously when a tool batch explodes; without this wait, the
  // caller gets a transient "rate-limited" error that resolves itself a
  // second later. With it, the user sees one answer, no error.
  const waitDeadline = Date.now() + 2_500;
  while (Date.now() < waitDeadline) {
    const waited = Date.now();
    await new Promise(r => setTimeout(r, 250));
    // 2026-08-22: keep ollamaAccount pinned across the cooldown wait.
    // Prior bug: retried without the pin, which silently fell through
    // to the rotate path even though the user explicitly pinned nvidia/
    // cloudflare/cloud/pro. Surface a 504 to the caller instead.
    // Same discipline: no cross-pool fallback in the wait retry if
    // the user pinned a specific account.
    const retryModel = await selectModel(pool, excludeBusy, needsVision, ollamaAccount) || (userPinned
      ? null
      : (mode === "auto"
          ? await selectModel(pool === "maetryxx" ? "machine" : "maetryxx", excludeBusy, needsVision, ollamaAccount)
          : null));
    if (retryModel) {
      console.log(`[pool-router] recovered after ${Date.now() - waited}ms: ${retryModel.modelId}`);
      return retryModel;
    }
  }

  // After 2.5s of waiting, give up. Clear cooldowns so the *next* request
  // starts fresh (avoid the lockstep problem on subsequent failures).
  clearAllCooldowns();
  return null;
}

// ── Record success ──

export function recordSuccess(model: SelectedModel, tokensUsed: number) {
  if (!model) { console.error("[pool-router] recordSuccess called with undefined model"); return; }
  if (model.account === "cloudflare") recordCFCall();
  const h = getOrCreateHealth(model.pool, model.modelId, model.account);
  h.status = "healthy";
  h.failureCount = 0;
  h.cooldownUntil = 0;
  h.lastUsed = Date.now();
  h.tokensUsed += tokensUsed;

  poolHealth[model.pool].tokensToday += tokensUsed;
  poolHealth[model.pool].requestsToday += 1;
  poolHealth[model.pool].consecutiveRequests += 1;
}

// ── Record failure ──

export function recordFailure(model: SelectedModel, status: number, errorText?: string) {
  if (!model) { console.error("[pool-router] recordFailure called with undefined model"); return; }
  if (model.account === "cloudflare") recordCFCall();
  const h = getOrCreateHealth(model.pool, model.modelId, model.account);
  h.failureCount += 1;
  h.lastUsed = Date.now();

  // Timeouts (408) get a short cooldown — model is slow, not broken
  if (status === 408) {
    h.status = "rate-limited";
    h.cooldownUntil = Date.now() + SLOW_COOLDOWN_MS;
    return;
  }

  // 2026-08-28: distinguish failure modes.
  //   410 (Gone / EOL)  → permanently banned, never retried. One dead model
  //                       (e.g. nv:step EOL'd by NVIDIA on 2026-08-28) was
  //                       poisoning the whole pool because every retry
  //                       hit it again and stamped a new failure.
  //   503 (busy)        → short cooldown (5s), not "rate-limited". Upstream
  //                       is overloaded, not quota-exhausted.
  //   429 (quota)       → exponential backoff as before.
  //   401/403           → banned as before (auth/model gone).
  //   408 (timeout)     → short cooldown, model is slow not broken.
  if (status === 410) {
    h.status = "banned";
    h.cooldownUntil = Number.MAX_SAFE_INTEGER; // never comes back
    return;
  }
  if (status === 503) {
    h.status = "rate-limited";
    h.cooldownUntil = Date.now() + 5_000; // short — upstream busy, not quota
    return;
  }

  const cooldownMs = getCooldownMs(h.failureCount, status);

  // 401 (auth revoked) / 403 (forbidden) / 404 (model gone) all mean the
  // model is dead from our PoV — not rate-limited, not slow. Mark banned
  // with the quota cooldown so the pool router skips it for a while.
  if (status === 401 || status === 403 || status === 404) {
    h.status = "banned";
    h.cooldownUntil = Date.now() + cooldownMs;
  } else if (status === 429) {
    // 429 = rate limited. Exponential backoff: 2s → 4s → 8s per consecutive 429.
    // 2026-08-10: scale by context size — a 429 on an 80K-token request is
    // more about total token pressure than request count, so back off longer
    // when the call was heavy (and give the provider time to drain).
    const ctxHint = errorText?.length ? Math.min(errorText.length, 2000) : 0;
    const ctxScale = 1 + Math.min(ctxHint / 800, 2.0); // up to 3x for heavy calls
    const backoff = Math.min(2_000 * Math.pow(2, Math.min(h.failureCount - 1, 3)) * ctxScale, 20_000);
    h.status = "rate-limited";
    h.cooldownUntil = Date.now() + backoff;
    poolHealth[model.pool].recent429s += 1;
    console.log(`[pool-router] 429 on ${model.modelId} — cooldown ${backoff}ms (failure #${h.failureCount}, ctxScale ${ctxScale.toFixed(2)})`);
  } else if (status >= 500) {
    h.status = "rate-limited";
    h.cooldownUntil = Date.now() + Math.min(cooldownMs, 10_000);
  } else {
    h.status = "rate-limited";
    h.cooldownUntil = Date.now() + cooldownMs;
  }
}

// ── Get pool stats for UI ──

export function getPoolStats() {
  return {
    maetryxx: {
      tokensToday: poolHealth.maetryxx.tokensToday,
      requestsToday: poolHealth.maetryxx.requestsToday,
      healthyModels: OMNIROUTE_MODELS.filter((id) =>
        isModelAvailable(getOrCreateHealth("maetryxx", id))
      ).length,
      totalModels: OMNIROUTE_MODELS.length,
      recent429s: poolHealth.maetryxx.recent429s,
    },
    machine: {
      tokensToday: poolHealth.machine.tokensToday,
      requestsToday: poolHealth.machine.requestsToday,
      healthyModels: getHealthyModels("machine").length,
      // Machine pool counts every sub-account including CF/NVIDIA/local,
      // not just Cloud+Pro — so the UI widget shows the real denominator.
      totalModels: OLLAMA_CLOUD_MODELS.length + OLLAMA_PRO_MODELS.length + LOCAL_OLLAMA_MODELS.length + CLOUDFLARE_AI_MODELS.length + NVIDIA_POOL_MODELS.length,
      recent429s: poolHealth.machine.recent429s,
    },
  };
}

// ── Daily reset ──

export function resetDailyStats() {
  poolHealth.maetryxx.tokensToday = 0;
  poolHealth.maetryxx.requestsToday = 0;
  poolHealth.maetryxx.recent429s = 0;
  poolHealth.machine.tokensToday = 0;
  poolHealth.machine.requestsToday = 0;
  poolHealth.machine.recent429s = 0;
}

// ── Scoped cooldown reset ──
// Only resets rate-limited models, NOT genuinely banned (403) ones.
// If pool/account are provided, limit the reset to that bucket so a pinned
// "cloudflare" reset never un-bans "pro" or "maetryxx" entries.
export function clearCooldowns(pool?: PoolId, account?: MachineAccount) {
  for (const h of Array.from(modelHealthMap.values())) {
    if (pool && h.pool !== pool) continue;
    if (account && h.account !== account) continue;
    if (h.status === "rate-limited") {
      h.status = "healthy";
      h.cooldownUntil = 0;
      h.failureCount = 0;
    }
    // Banned models stay banned — don't retry 403s
  }
}

// Back-compat alias so existing callers keep working; prefer clearCooldowns()
// with a pool/account arg from new code.
export function clearAllCooldowns() {
  clearCooldowns();
}
