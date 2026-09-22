/**
 * GET /api/ollama/usage?account=cloud|pro
 *
 * Returns the latest Ollama usage snapshot for the given account.
 * Reads from history store first (instant), falls back to a live fetch
 * from https://ollama.com/api/usage if the store is empty or stale.
 *
 * In-process 30s cache per account to avoid hammering Ollama when both
 * the widget and OpsPanel poll at the same time.
 */

import { NextRequest, NextResponse } from "next/server";
import { getOllamaCloudApiKey, getOllamaProApiKey } from "@/lib/runtime-keys";
import {
  appendSnapshot,
  getLatestSnapshot,
  type Account,
  type UsageSnapshot,
} from "@/lib/ollama-usage-store";
import { observeUsage } from "@/lib/ollama-usage-poller";

export const dynamic = "force-dynamic";

// ── Cache ──
// Per-account in-memory cache, 30s TTL. Survives across requests in the
// same Node process. Resets on server restart (fine — first request refills).
type CacheEntry = {
  data: OllamaUsageResponse;
  expiresAt: number;
};
const cache: Partial<Record<Account, CacheEntry>> = {};
const CACHE_TTL_MS = 30_000;

// ── Types matching Ollama's /api/usage response ──
interface OllamaUsageResponse {
  account: Account;
  fetchedAt: string;
  stale: boolean;          // true if served from cache or store, not live
  source: "live" | "cache" | "store";
  session: {
    usage: number;
    isMaxed: boolean;      // usage >= 0.99
    models: Array<{ name: string; request_count: number }>;
  };
  weekly: {
    usage: number;
    isMaxed: boolean;
    models: Array<{ name: string; request_count: number }>;
  };
  activity: {
    cost: string;
    periodStart: string;
    periodEnd: string;
  };
}

async function fetchFromOllama(account: Account, apiKey: string): Promise<OllamaUsageResponse> {
  const res = await fetch("https://ollama.com/api/usage", {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
    // No cache — we manage our own.
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Ollama /api/usage returned ${res.status} for ${account}`);
  }
  const data = await res.json();
  return shapeResponse(account, data, "live");
}

function shapeResponse(account: Account, raw: any, source: "live" | "store"): OllamaUsageResponse {
  const sessionUsage = raw?.limits?.session?.usage ?? 0;
  const weeklyUsage = raw?.limits?.weekly?.usage ?? 0;
  const sessionModels: Array<{ name: string; request_count: number }> =
    raw?.limits?.session?.models ?? [];
  const weeklyModels: Array<{ name: string; request_count: number }> =
    raw?.limits?.weekly?.models ?? [];
  return {
    account,
    fetchedAt: new Date().toISOString(),
    stale: source === "store",
    source,
    session: {
      usage: sessionUsage,
      isMaxed: sessionUsage >= 0.99,
      models: sessionModels,
    },
    weekly: {
      usage: weeklyUsage,
      isMaxed: weeklyUsage >= 0.99,
      models: weeklyModels,
    },
    activity: {
      cost: raw?.activity?.cost ?? "0.00000",
      periodStart: raw?.activity?.period?.starting_at ?? "",
      periodEnd: raw?.activity?.period?.ending_at ?? "",
    },
  };
}

function snapshotToResponse(snap: UsageSnapshot, account: Account): OllamaUsageResponse {
  return {
    account,
    fetchedAt: snap.fetchedAt,
    stale: true,
    source: "store",
    session: {
      usage: snap.window === "session" ? snap.usage : 0,
      isMaxed: snap.window === "session" ? snap.usage >= 0.99 : false,
      models: snap.window === "session" ? snap.modelBreakdown : [],
    },
    weekly: {
      usage: snap.window === "weekly" ? snap.usage : 0,
      isMaxed: snap.window === "weekly" ? snap.usage >= 0.99 : false,
      models: snap.window === "weekly" ? snap.modelBreakdown : [],
    },
    activity: {
      cost: "0.00000",
      periodStart: "",
      periodEnd: "",
    },
  };
}

export async function GET(req: NextRequest) {
  const account = req.nextUrl.searchParams.get("account") as Account | null;
  if (account !== "cloud" && account !== "pro") {
    return NextResponse.json(
      { error: "account must be 'cloud' or 'pro'" },
      { status: 400 }
    );
  }

  // 1. Check in-memory cache
  const cached = cache[account];
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.data);
  }

  // 2. Get API key
  let apiKey: string;
  try {
    apiKey = account === "cloud"
      ? await getOllamaCloudApiKey()
      : await getOllamaProApiKey();
  } catch (err: any) {
    return NextResponse.json(
      { error: `Failed to read API key: ${err?.message || "unknown"}` },
      { status: 500 }
    );
  }
  if (!apiKey) {
    return NextResponse.json(
      { error: `No API key configured for ${account}. Set OLLAMA_${account.toUpperCase()}_API_KEY in .env.local.` },
      { status: 503 }
    );
  }

  // 3. Live fetch from Ollama
  try {
    const live = await fetchFromOllama(account, apiKey);
    cache[account] = { data: live, expiresAt: Date.now() + CACHE_TTL_MS };

    // 4. Persist both windows to history (fire-and-forget — don't block response)
    const fetchedAt = new Date().toISOString();
    const fetchedAtMs = Date.now();
    if (live.session.usage > 0 || live.session.models.length > 0) {
      const totalSession = live.session.models.reduce((s, m) => s + m.request_count, 0);
      appendSnapshot({
        id: `${account}-session-${fetchedAt}`,
        account,
        window: "session",
        usage: live.session.usage,
        requestCount: totalSession,
        modelBreakdown: live.session.models,
        fetchedAt,
      });
    }
    if (live.weekly.usage > 0 || live.weekly.models.length > 0) {
      const totalWeekly = live.weekly.models.reduce((s, m) => s + m.request_count, 0);
      appendSnapshot({
        id: `${account}-weekly-${fetchedAt}`,
        account,
        window: "weekly",
        usage: live.weekly.usage,
        requestCount: totalWeekly,
        modelBreakdown: live.weekly.models,
        fetchedAt,
      });
    }

    // 5. Notify poller — may trigger background polling if this gauge is maxed
    observeUsage(account, "session", live.session.usage, fetchedAtMs);
    observeUsage(account, "weekly", live.weekly.usage, fetchedAtMs);

    return NextResponse.json(live);
  } catch (err: any) {
    // 5. Live failed — fall back to latest stored snapshot
    const latestSession = getLatestSnapshot(account, "session");
    const latestWeekly = getLatestSnapshot(account, "weekly");
    if (latestSession || latestWeekly) {
      const fallback: OllamaUsageResponse = {
        account,
        fetchedAt: (latestWeekly?.fetchedAt || latestSession?.fetchedAt || new Date().toISOString()),
        stale: true,
        source: "store",
        session: {
          usage: latestSession?.usage ?? 0,
          isMaxed: (latestSession?.usage ?? 0) >= 0.99,
          models: latestSession?.modelBreakdown ?? [],
        },
        weekly: {
          usage: latestWeekly?.usage ?? 0,
          isMaxed: (latestWeekly?.usage ?? 0) >= 0.99,
          models: latestWeekly?.modelBreakdown ?? [],
        },
        activity: { cost: "0.00000", periodStart: "", periodEnd: "" },
      };
      return NextResponse.json(fallback);
    }
    return NextResponse.json(
      { error: `Ollama unreachable and no cached data: ${err?.message || "unknown"}` },
      { status: 502 }
    );
  }
}
