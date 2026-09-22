/**
 * GET /api/custom-providers/models?provider=openrouter|deepinfra
 *
 * Fetches the live model catalog for providers that expose /v1/models
 * without authentication. The list is cached in-memory for 24h.
 *
 * Why this exists: hardcoded model IDs go stale (claude-3.5-sonnet got
 * deprecated, replaced by claude-sonnet-4.5 etc.). For providers that
 * let us list models anonymously, we always pull fresh.
 *
 * Providers that gate /v1/models behind auth (Anthropic, OpenAI, etc.)
 * use the curated list in src/lib/custom-providers.ts. Users can always
 * paste a custom model ID via the UI if their preferred model isn't shown.
 */

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Provider = "openrouter" | "deepinfra";

interface LiveModel {
  id: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
}

interface CacheEntry {
  models: LiveModel[];
  fetchedAt: number;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;  // 24 hours
const cache: Partial<Record<Provider, CacheEntry>> = {};

const ENDPOINTS: Record<Provider, string> = {
  openrouter: "https://openrouter.ai/api/v1/models",
  deepinfra: "https://api.deepinfra.com/v1/openai/models",
};

async function fetchLive(provider: Provider): Promise<LiveModel[]> {
  const res = await fetch(ENDPOINTS[provider], { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Provider ${provider} returned ${res.status}`);
  }
  const data = await res.json();
  const raw: any[] = data.data || [];
  return raw
    .filter((m: any) => m.id && !m.id.startsWith("~") && !m.id.includes(":batch") && !m.id.includes(":free"))
    .map((m: any): LiveModel => {
      // OpenRouter uses top_provider.context_length or context_length
      // DeepInfra uses max_context_length
      const ctx =
        m.top_provider?.context_length ??
        m.context_length ??
        m.max_context_length ??
        0;
      // OpenRouter doesn't expose max_output_tokens cleanly; default to 4096
      const max = m.top_provider?.max_completion_tokens ?? m.max_tokens ?? 4_096;
      return {
        id: m.id,
        name: m.name || m.id,
        contextWindow: ctx,
        maxTokens: max,
      };
    });
}

export async function GET(req: NextRequest) {
  const provider = req.nextUrl.searchParams.get("provider") as Provider | null;
  if (provider !== "openrouter" && provider !== "deepinfra") {
    return NextResponse.json(
      { error: "provider must be 'openrouter' or 'deepinfra'" },
      { status: 400 }
    );
  }

  // Check cache
  const cached = cache[provider];
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json({
      provider,
      models: cached.models,
      fetchedAt: new Date(cached.fetchedAt).toISOString(),
      cached: true,
    });
  }

  // Live fetch
  try {
    const models = await fetchLive(provider);
    cache[provider] = { models, fetchedAt: Date.now() };
    return NextResponse.json({
      provider,
      models,
      fetchedAt: new Date().toISOString(),
      cached: false,
    });
  } catch (err: any) {
    // Live fetch failed — return empty + error. UI falls back to static list.
    return NextResponse.json(
      {
        provider,
        models: [],
        fetchedAt: new Date().toISOString(),
        cached: false,
        error: err?.message || "Live fetch failed",
      },
      { status: 200 }  // 200 because we want the UI to handle gracefully, not show an error page
    );
  }
}
