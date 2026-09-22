import { NextRequest, NextResponse } from "next/server";
import {
  getOpenClawGatewayUrl,
  getOpenClawGatewayToken,
  getOmniRouteEndpoint,
  getOllamaBaseUrl,
  getOllamaProApiKey,
  getOllamaCloudApiKey,
} from "@/lib/runtime-keys";

/**
 * Swarm API — Parallel multi-model execution.
 *
 * Routes through BOTH the OpenClaw gateway AND OmniRoute directly,
 * because the gateway only accepts openclaw or openclaw/<agentId> models.
 *
 * POST /api/swarm
 *   {
 *     prompt: "Analyze this code...",
 *     models: ["ollama-cloud/glm-5.2:cloud", "openclaw/orion", "openclaw/knight"],
 *     system?: "Optional custom system prompt",
 *     temperature?: 0.7,
 *     synthesize?: true
 *   }
 *
 * OmniRoute models (bypass gateway):
 *   omniroute/auto/pro-coding, omniroute/oc/deepseek-v4-flash-free, etc.
 *
 * Gateway models (use openclaw or openclaw/<agentId>):
 *   openclaw, openclaw/main, openclaw/orion, openclaw/knight
 *
 * Ollama provider models (hit the provider API directly):
 *   ollama-pro/<model>, ollama-cloud/<model>
 */

// Gateways / providers are read at request time from the per-user .env.
// process.env is only used as a build/dev fallback.

async function getGatewayConfig() {
  return {
    url: await getOpenClawGatewayUrl(),
    key: await getOpenClawGatewayToken(),
  };
}

async function getOmniRouteConfig() {
  return {
    url: await getOmniRouteEndpoint(),
    key: "", // local, no auth
  };
}

async function getOllamaProConfig() {
  return {
    url: `${await getOllamaBaseUrl()}/chat/completions`,
    key: await getOllamaProApiKey(),
  };
}

async function getOllamaCloudConfig() {
  return {
    url: `${await getOllamaBaseUrl()}/chat/completions`,
    key: await getOllamaCloudApiKey(),
  };
}

// Model display names for the fleet
const MODEL_LABELS: Record<string, string> = {
  // OmniRoute models
  "omniroute/auto/pro-coding": "OmniRoute Pro Coding",
  "omniroute/oc/deepseek-v4-flash-free": "DeepSeek V4",
  "omniroute/oc/minimax-m3-free": "Max M3 (Free)",
  "omniroute/oc/nemotron-3-super-free": "Nemotron Free",
  "omniroute/auto/best-fast": "OmniRoute Best Fast",
  "omniroute/auto/best-reasoning": "OmniRoute Best Reasoning",
  "omniroute/auto/best-free": "OmniRoute Best Free",
  "omniroute/auto/cheap": "OmniRoute Cheap",
  // Gateway agents
  "openclaw": "Smyth (Default)",
  "openclaw/main": "Ash",
  "openclaw/orion": "Orion",
  "openclaw/rook": "Rook",
  "openclaw/knight": "Knight",
  "openclaw/sage": "Sage",
  "openclaw/forge": "Forge",
  "openclaw/bishop": "Bishop",
  // Ollama Pro
  "ollama-pro/kimi-k2.6": "Sage (Kimi K2.6)",
  "ollama-pro/kimi-k2.7-code": "Kimmy K27",
  "ollama-pro/minimax-m2.7": "Mini",
  "ollama-pro/minimax-m3": "Max M3",
  "ollama-pro/glm-5.1": "GLM 5.1",
  "ollama-pro/glm-5.2": "GLM 5.2",
  "ollama-pro/glm-5.3": "GLM 5.3",
  "ollama-pro/glm-5.3-flash": "GLM 5.3 Flash",
  // Ollama Cloud
  "ollama-cloud/glm-5.2": "GLM 5.2",
  "ollama-cloud/glm-5.3": "GLM 5.3",
  "ollama-cloud/glm-5.3-flash": "GLM 5.3 Flash",
  "ollama-cloud/nemotron-3-super": "Nemotron Super",
  "ollama-cloud/gpt-oss:120b": "GPT-OSS",
  "ollama-cloud/qwen3.5:397b": "Qwen 3.5 397B",
};

function getModelLabel(modelId: string): string {
  return MODEL_LABELS[modelId] || modelId.split("/").pop() || modelId;
}

// ── Determine which backend handles a model ID ──

type Backend = "gateway" | "omniroute" | "ollama-pro" | "ollama-cloud";

function classifyModel(modelId: string): Backend | null {
  if (modelId.startsWith("openclaw")) return "gateway";
  if (modelId.startsWith("omniroute/")) return "omniroute";
  if (modelId.startsWith("ollama-pro/")) return "ollama-pro";
  if (modelId.startsWith("ollama-cloud/")) return "ollama-cloud";
  return null;
}

async function getBackendConfig(backend: Backend) {
  switch (backend) {
    case "gateway":
      return getGatewayConfig();
    case "omniroute":
      return getOmniRouteConfig();
    case "ollama-pro":
      return getOllamaProConfig();
    case "ollama-cloud":
      return getOllamaCloudConfig();
  }
}

// ── Call a single model ──

async function callModel(
  modelId: string,
  prompt: string,
  systemPrompt: string,
  temperature: number,
  signal?: AbortSignal
) {
  const startTime = Date.now();
  const backend = classifyModel(modelId);

  if (!backend) {
    return {
      model: modelId,
      label: getModelLabel(modelId),
      status: "error",
      error: `Unknown model backend. Use openclaw, omniroute/, ollama-pro/, or ollama-cloud/ prefix.`,
      elapsedMs: 0,
    };
  }

  const config = await getBackendConfig(backend);
  const requestModel =
    backend === "gateway"
      ? modelId // "openclaw" or "openclaw/orion"
      : modelId.replace(/^(omniroute|ollama-pro|ollama-cloud)\//, ""); // strip prefix

  try {
    const response = await fetch(config.url, {
      signal,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.key ? { Authorization: `Bearer ${config.key}` } : {}),
      },
      body: JSON.stringify({
        model: requestModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
        temperature,
        stream: false,
        max_tokens: 16384,
      }),
    });

    const elapsed = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      return {
        model: modelId,
        label: getModelLabel(modelId),
        status: "error",
        error: `HTTP ${response.status}: ${errorText.slice(0, 300)}`,
        elapsedMs: elapsed,
      };
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || "";

    return {
      model: modelId,
      label: getModelLabel(modelId),
      status: "ok",
      content,
      usage: data?.usage || null,
      elapsedMs: elapsed,
    };
  } catch (err: any) {
    return {
      model: modelId,
      label: getModelLabel(modelId),
      status: "error",
      error: err?.message || "Request failed",
      elapsedMs: Date.now() - startTime,
    };
  }
}

// ── Synthesis ──

async function synthesizeResults(prompt: string, results: any[], signal?: AbortSignal): Promise<string> {
  const successfulResults = results.filter((r) => r.status === "ok" && r.content);
  if (successfulResults.length === 0) return "";

  const synthesisPrompt = `I asked multiple AI models the following question:

== PROMPT ==
${prompt}
== END PROMPT ==

Here are their individual responses:

${successfulResults
  .map(
    (r, i) =>
      `=== ${r.label} (${r.elapsedMs}ms) ===\n${r.content.slice(0, 4000)}`
  )
  .join("\n\n")}

---

Synthesize these responses into a single coherent answer. Distill the best insights from each, resolve any contradictions, and present the unified result clearly. Do NOT just list what each model said — merge them into one answer.`;

  try {
    const { url: gatewayUrl, key: gatewayKey } = await getGatewayConfig();
    const response = await fetch(gatewayUrl, {
      signal,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${gatewayKey}`,
      },
      body: JSON.stringify({
        model: "openclaw",
        messages: [
          {
            role: "system",
            content:
              "You are a synthesis engine. Merge multiple AI responses into one clear, coherent answer. Be concise, resolve contradictions, attribute insights only when it adds value.",
          },
          { role: "user", content: synthesisPrompt },
        ],
        temperature: 0.3,
        stream: false,
        max_tokens: 16384,
      }),
    });

    const data = await response.json();
    return data?.choices?.[0]?.message?.content || "";
  } catch {
    return "";
  }
}

// ── POST handler ──

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      prompt,
      models,
      system,
      temperature = 0.7,
      synthesize = false,
      timeout = 120000,
    } = body;

    if (!prompt) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    if (!models || !Array.isArray(models) || models.length === 0) {
      return NextResponse.json(
        { error: "At least one model is required" },
        { status: 400 }
      );
    }

    const systemPrompt =
      system ||
      "You are a specialist agent in the Smyth Fleet. Answer the user's question directly, thoroughly, and with your unique perspective. Be concise but complete.";

    // Fire all model calls in parallel with an overall timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const results = await Promise.all(
      models.map((modelId: string) =>
        callModel(modelId, prompt, systemPrompt, temperature, controller.signal)
      )
    );
    clearTimeout(timeoutId);

    // Optional synthesis
    let synthesis = "";
    if (synthesize) {
      synthesis = await synthesizeResults(prompt, results);
    }

    return NextResponse.json({
      status: "ok",
      timestamp: Date.now(),
      prompt,
      modelCount: models.length,
      results,
      synthesis: synthesis || undefined,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Swarm failed", details: err?.message || String(err) },
      { status: 500 }
    );
  }
}
