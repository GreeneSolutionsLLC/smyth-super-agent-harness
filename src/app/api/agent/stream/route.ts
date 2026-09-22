import { NextRequest } from "next/server";
import { routeRequest, recordSuccess, recordFailure, clearAllCooldowns, clearCooldowns, getTimeoutForModel, resetCFCallsThisRequest, getOrCreateHealth, type RouteMode } from "@/lib/pool-router";
import { compactContext } from "@/lib/context-compactor";
import { createLoopState, buildLoopSystemMessage, classifyResponse } from "@/lib/agent-loop";
import { SMYTH_SYSTEM_PROMPT } from "@/lib/smyth-identity";
import { createToolDefinitions } from "@/lib/tools";
import { REQUEST_TOOLS_DEFINITION, getCategoryForTool, getToolNamesForCategory, buildCapabilityManifest } from "@/lib/tool-categories";
import { runSwarm } from "@/lib/agent/swarm";
import { hasNativeVision, findModel, OLLAMA_CLOUD_MODELS, OLLAMA_PRO_MODELS, LOCAL_OLLAMA_MODELS, CLOUDFLARE_AI_MODELS, NVIDIA_POOL_MODELS } from "@/lib/ollama-models";
import { appendEvent, type RouteMode as UsageRouteMode } from "@/lib/usage-log";
import { estimateCost } from "@/lib/pricing";
import { startReportScheduler } from "@/lib/report-scheduler";
import { streamCustomChat, CustomProviderError } from "@/lib/custom-provider-router";
import { waitForSlot, getGovernorState, recordHeaders, recordRateLimitHit, type PoolId } from "@/lib/rate-governor";
import { getOmniRouteEndpoint, getOmniRouteApiKey, getOllamaBaseUrl, getOllamaCloudApiKey, getOllamaProApiKey, getLocalOllamaBaseUrl, getLocalOllamaApiKey, getCloudflareAccountId, getCloudflareApiToken, getNvidiaPoolEndpoint, getNvidiaPoolApiKey, getByokApiKey } from "@/lib/runtime-keys";
import { getProviderKeyName } from "@/lib/custom-providers";

// Lazy tool loading: only request_tools meta-tool is sent initially.
// Real tools are injected on demand when the model calls request_tools.

// ── Dedupe completed shell_status calls ──
// Track jobIds we've already seen as completed in this chain. If the model
// tries to call shell_status for a job that's already completed, skip the
// redundant LLM call and return the cached result.
const completedJobStatuses = new Map<string, string>();

function isDuplicateCompletedShellStatus(tool: string, args: Record<string, any>): string | null {
  if (tool !== "shell_status") return null;
  const jobId = args?.jobId || null;
  if (!jobId) return null;
  const cached = completedJobStatuses.get(jobId);
  return cached || null;
}

function cacheCompletedShellStatus(tool: string, result: string): void {
  if (tool !== "shell_status") return;
  try {
    const parsed = JSON.parse(result);
    if (parsed?.jobId && parsed?.status === "completed") {
      completedJobStatuses.set(parsed.jobId, result);
    }
  } catch {}
}

// ── Background job polling guard ──
// Returns true if this is a shell_status result showing the job is still
// running AND we've already polled the same jobId once in this chain.
// In that case we should stop burning tokens and hand off to async
// continuation (client-side watcher or Operator).
function shouldBreakOnBackgroundJobPoll(tool: string, result: string, recentToolCalls: string[]): boolean {
  if (tool !== "shell_status") return false;
  let jobId: string | null = null;
  let status: string | null = null;
  let durationSec = 0;
  try {
    const parsed = JSON.parse(result);
    jobId = parsed?.jobId || null;
    status = parsed?.status || null;
    durationSec = parsed?.durationSec || 0;
  } catch {
    return false;
  }
  if (!jobId || status !== "running") return false;

  const needle = `shell_status:{"jobId":"${jobId}"`;
  let pollCount = 0;
  for (const entry of recentToolCalls) {
    if (entry.startsWith(needle)) pollCount++;
  }

  // Be patient for medium jobs: allow up to 5 in-chain polls (~10-12s).
  // For long-running jobs, hand off early to avoid burning tokens/ties.
  const maxInChainPolls = 5;
  const maxInChainDurationSec = 45;
  return pollCount >= maxInChainPolls || durationSec >= maxInChainDurationSec;
}

function buildBackgroundJobPauseMessage(jobId: string, result: string): string {
  let durationSec = 0;
  try {
    durationSec = JSON.parse(result)?.durationSec || 0;
  } catch {}
  return `Background job \`${jobId}\` is running${durationSec ? ` (${durationSec}s so far)` : ""}. I'll check back automatically when it finishes.`;
}

export const maxDuration = 600;

interface ToolPhase {
  tool: string;
  status: "running" | "done" | "error";
  args?: Record<string, any>;
  result?: string;
}

function sendEvent(encoder: TextEncoder, data: { type: string; [key: string]: any }): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
}

// Guard against enqueue/close on an already-closed/aborted controller.
// Uncaught errors inside a ReadableStream can kill the Next.js dev server,
// so we swallow these safely.
function safeEnqueue(controller: ReadableStreamDefaultController, chunk: Uint8Array) {
  try {
    const desiredSize = (controller as any).desiredSize;
    if (desiredSize === null) return; // already closed
    controller.enqueue(chunk);
  } catch (e) {
    // stream closed / client disconnected — swallow
  }
}

function safeClose(controller: ReadableStreamDefaultController) {
  try {
    controller.close();
  } catch (e) {
    // already closed — swallow
  }
}


// ── Per-stream OmniRoute throttle ──
// Cold-start bursts (5+ turns in ~10s during tool loading) exhaust the
// per-minute quota before any task finishes. Without this, the user sees
// 'All OmniRoute models are rate-limited' after the agent has already
// burned 6 turns discovering what tools exist.
//
// We smooth bursts: if we've fired >BURST_MAX requests within BURST_WINDOW_MS,
// pause before the next one. Past that threshold, we add only enough delay
// to spread the requests out so each lands in its own quota sub-window.
//
// This is per-stream (each user request has its own recentFires[] array),
// so it doesn't artificially slow down other concurrent users.
const BURST_MAX = 4;
const BURST_WINDOW_MS = 8_000;
const BURST_SPACING_MS = 400;
async function throttleIfBursting(recentFires: number[]): Promise<void> {
  const now = Date.now();
  while (recentFires.length > 0 && recentFires[0] < now - BURST_WINDOW_MS) recentFires.shift();
  if (recentFires.length >= BURST_MAX) {
    const oldest = recentFires[0];
    const last = recentFires[recentFires.length - 1];
    const wait = Math.max(oldest + BURST_WINDOW_MS - now, BURST_SPACING_MS - (now - last));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  recentFires.push(Date.now());
}

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();
  const reqStart = Date.now();
  const body = await request.json();
  const { message, sessionId, image, visionContext, routeMode, deepResearch, history, model, swarm, canvaMode, ollamaAccount, customProvider, customModel, customApiKey } = body;

  // 2026-08-22: reset per-request CF call counter at the start of every user
  // message. The pool-router caps CF at 5 calls/turn so the agent loop can't
  // burn the daily 10k neuron budget in one waffly turn.
  resetCFCallsThisRequest();

  // Kick the 24h report scheduler (idempotent — only starts once per process)
  startReportScheduler();

  // Per-stream OmniRoute burst tracker (see throttleIfBursting above).
  const recentFires: number[] = [];
  if (!message && !image) {
    return new Response("Message or image is required", { status: 400 });
  }

  // ── Swarm shortcut: fan out across Ollama Pro Kimis, synthesize, return a single streamed answer.
  if (swarm) {
    const swarmStream = new ReadableStream({
      async start(controller) {
        try {
          const swarmHistory = (Array.isArray(history) ? history : [])
            .filter((m: any) => m && m.role && m.content !== undefined)
            .map((m: any) => ({ role: m.role, content: typeof m.content === "string" ? m.content : "" }));

          // Wire tools the same way the operator flow does, but only the
          // Worker role gets access. Orchestrator + Synthesizer are pure reasoning.
          const allTools = await createToolDefinitions();
          const allToolDefs = allTools.openaiTools;
          const handlerMap = allTools.handlerMap;

          // Curated allow-list for swarm's Worker. Sending 136 tool schemas to
          // a small Kimi model prompts it to loop and inflates latency 10x.
          // Swarm is for research + assembly: web/fetch/MCP/files/shell only.
          const SWARM_WORKER_ALLOWLIST = [
            /^web_/i, /^mcp_/i, /^scrape_/i, /^deep_research$/i, /^filesystem_/i,
            /^read_file$/i, /^write_file$/i, /^shell_/i, /^execute_/i,
          ];
          const toolDefs = allToolDefs.filter((t: any) =>
            SWARM_WORKER_ALLOWLIST.some((re) => re.test(t?.function?.name || ""))
          );

          const executeTool = async (name: string, args: Record<string, any>) => {
            // handlerMap is a Map, not a plain object — use .get(), not bracket access.
            const handler = (handlerMap instanceof Map ? handlerMap.get(name) : (handlerMap as any)?.[name]);
            if (!handler) return `error: tool ${name} not registered`;
            try {
              const result = await handler(args, { toolCallId: `swarm_${Date.now()}_${Math.random().toString(36).slice(2,8)}` });
              if (result && typeof result === "object") {
                if ((result as any).error) return `error: ${(result as any).error}`;
                if ("output" in (result as any)) return String((result as any).output);
                if ("content" in (result as any)) {
                  const c = (result as any).content;
                  if (Array.isArray(c)) return c.map((b: any) => b?.text || "").join("\n");
                  return String(c);
                }
                return JSON.stringify(result);
              }
              return String(result ?? "");
            } catch (e: any) {
              return `error: ${e?.message || String(e)}`;
            }
          };

          const { reply, tokens, modelUsed } = await runSwarm(
            {
              prompt: message || (image ? `Analyze this image: ${image.filename || "image.png"}` : ""),
              history: swarmHistory,
              tools: toolDefs,
              executeTool,
              maxToolRounds: 5,
            },
            controller,
            encoder
          );
          safeEnqueue(controller, sendEvent(encoder, { type: "complete", reply, tokens, phases: ["thinking", "writing"], model: modelUsed, pool: "swarm" }));
          safeClose(controller);
        } catch (e: any) {
          safeEnqueue(controller, sendEvent(encoder, { type: "error", error: e?.message || "swarm failed" }));
          safeClose(controller);
        }
      },
    });
    return new Response(swarmStream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Send initial "thinking" event
        safeEnqueue(controller, sendEvent(encoder, { type: "phase", phase: "thinking" }));

        // 2026-08-25: build the live capability manifest BEFORE the prompt so
        // every model that lands in this request sees the full tool registry
        // up front. Cuts down the request_tools discovery round-trip that
        // used to spin into re-ask loops when the model didn't know what it
        // had available.
        const allTools = await createToolDefinitions();
        const openaiTools = allTools.openaiTools;
        const handlerMap = allTools.handlerMap;
        const capabilityManifest = buildCapabilityManifest(
          openaiTools.map((t: any) => t.function?.name || t.name || "").filter(Boolean)
        );

        const baseSystemPrompt = SMYTH_SYSTEM_PROMPT + "\n\nYOUR FULL CAPABILITY MANIFEST (live):\n" + capabilityManifest + "\n\nYou do NOT need to call request_tools just to discover what tools exist — the manifest above is the live list. Use request_tools ONLY to load the schemas for the category you want, then call the tool directly by name.";
        console.log(`[agent/stream] capabilityManifest injected, ${capabilityManifest.split("\n").length} category lines`);
        let finalMessages: any[] = [];
        if (Array.isArray(history) && history.length > 0) {
          finalMessages = history.filter((m: any) => m && m.role && (m.content !== undefined));
        }

        // Extract model-meta anchor messages - they do not get sent to the model verbatim,
        // instead they get materialized as a system-prompt augmentation.
        // The latest one wins; older ones are kept as history for switch awareness.
        const metaAnchors: any[] = finalMessages.filter((m: any) => m.role === "system-meta" && m.model);
        const latestMeta: any = metaAnchors.length > 0 ? metaAnchors[metaAnchors.length - 1] : null;
        const previousMetas: any[] = metaAnchors.slice(0, -1);

        // "First request with this selection?" = latest system-meta sits AFTER
        // any assistant messages in the original history. If yes, this is the
        // first reply under the current selection - inject the once-only note.
        // If any assistant message comes after the latest meta, the model has
        // already replied under this selection - skip the note (no nagging).
        let isFirstReplyUnderSelection = true;
        if (latestMeta) {
          const latestMetaIndex = finalMessages.lastIndexOf(latestMeta);
          const messagesAfter = finalMessages.slice(latestMetaIndex + 1);
          const hasAssistantAfter = messagesAfter.some((m: any) => m.role === "assistant");
          isFirstReplyUnderSelection = !hasAssistantAfter;
        }

        // Strip system-meta entries so they do not double as user/assistant turns
        finalMessages = finalMessages.filter((m: any) => m.role !== "system-meta");

        // Build the "you are driving X" augmentation
        let modelAwarenessBlock = "";
        if (latestMeta && latestMeta.model) {
          const meta = findModel(latestMeta.model);
          const caps = meta && meta.capabilities
            ? Object.entries(meta.capabilities).filter(([_, v]) => v === true).map(([k]) => k).join(", ")
            : "unknown";
          const ctxWindow = meta && meta.contextWindow ? meta.contextWindow.toLocaleString() : "unknown";
          const tier = meta && meta.tier ? meta.tier : "unknown";
          const account = (meta && "account" in meta ? (meta as any).account : null) || latestMeta.pool || "unknown";
          const displayName = (meta && meta.name) || latestMeta.model;

          let switchHistory = "";
          if (previousMetas.length > 0) {
            const prevNames = previousMetas
              .map((m) => findModel(m.model) ? (findModel(m.model) as any).name : m.model)
              .filter(Boolean);
            if (prevNames.length > 0) {
              switchHistory = "\nPreviously in this conversation, you were running on: " + prevNames.join(" -> ") + ".";
            }
          }

          let firstReplyInstruction = "";
          if (isFirstReplyUnderSelection) {
            firstReplyInstruction =
              "\n\n[ONCE-ONLY NOTE - REQUIRED on your FIRST reply under this model selection]\n" +
              "This is not optional. Your previous persona (\"Smyth on Maetryxx\") is the LEGACY framing. " +
              "Underneath that framing, you are actually running on a specific model that changes when " +
              "the user picks one from the dropdown. The user needs to know which model is actually " +
              "answering them so they can judge whether the response quality matches what the model is capable of.\n" +
              "\n" +
              "At the END of your reply, after addressing the user's query, append ONE short paragraph " +
              "(2-4 sentences max) that:\n" +
              "  - States clearly which model you are currently running on (" + displayName + ")\n" +
              "  - Notes 1-2 key strengths relevant to the task they just sent\n" +
              "  - Notes 1-2 key weaknesses or trade-offs they should be aware of\n" +
              "Keep it terse. Do not preface the note with phrases like 'By the way' or 'Note:' - " +
              "just blend it naturally as a brief aside at the end.\n" +
              "\n" +
              "If the user has not pinned a specific model (latestMeta is null), you may keep the " +
              "legacy Smyth/Maetryxx framing.";
          }

          modelAwarenessBlock =
            "[MODEL AWARENESS - HIGHEST PRIORITY - backend injected]\n" +
            "The user has pinned you to a specific model. Your previous persona (Smyth / Maetryxx) " +
            "is a generic identity layer that applies when no model is selected. When the user " +
            "picks a model, you ARE that model with the Smyth persona on top.\n\n" +
            "YOU ARE CURRENTLY DRIVING: " + displayName + " (" + latestMeta.model + ")\n" +
            "Routing pool: " + account + "\n" +
            "Context window: " + ctxWindow + " tokens\n" +
            "Capabilities: " + caps + "\n" +
            "Tier: " + tier + switchHistory + "\n\n" +
            "Use this to gauge what you can do well. If the user asks for something outside your " +
            "capabilities or that another model in the catalog would handle better, you may " +
            "recommend a switch - but never auto-switch. The user always decides the model.\n" +
            "[END MODEL AWARENESS]" +
            firstReplyInstruction;
        }

        // Awareness block goes FIRST so models attend to it before the persona.
        // This prevents models from defaulting to the Smyth/Maetryxx persona
        // when the user has pinned a specific model.
        const systemPrompt = modelAwarenessBlock + "\n\n" + baseSystemPrompt;
        console.log("[agent/stream] modelAwarenessBlock length: " + modelAwarenessBlock.length + " latestMeta: " + JSON.stringify(latestMeta ? { model: latestMeta.model, pool: latestMeta.pool } : null) + " previousMetas: " + previousMetas.length + " isFirstReply: " + isFirstReplyUnderSelection);

        if (image && image.base64) {
          finalMessages.push({ role: "user", content: message || `Analyze this image: ${image.filename || "image.png"}` });
        } else {
          finalMessages.push({ role: "user", content: message });
        }

        const mode: RouteMode = (routeMode as RouteMode) || "auto";
        // Ollama account override: only applies when routeMode === "machine".
        // 'nvidia' was added in this commit so the UI's NVIDIA pool toggle
        // actually routes to NVIDIA pool models (Nemotron 3 / Poolside Laguna
        // / etc.). Prior bug: server narrowed the type to
        // {"cloud","pro","cloudflare","rotate"} so 'nvidia' fell through to
        // 'rotate' and requests hit kimi/cloud instead of NVIDIA.
        const ollamaAcc: "cloud" | "pro" | "cloudflare" | "nvidia" | "rotate" = (ollamaAccount === "cloud" || ollamaAccount === "pro" || ollamaAccount === "cloudflare" || ollamaAccount === "nvidia") ? ollamaAccount : "rotate";
        // 2026-08-25: trace incoming pin so we can verify what the UI sent.
        console.log(`[agent/stream] body: routeMode=${routeMode} ollamaAccount=${JSON.stringify(ollamaAccount)} → ollamaAcc=${ollamaAcc}`);

        // ── Custom provider: short-circuit to direct chat streaming ──
        // Skips the agent loop and tool system for MVP simplicity. The user
        // gets a direct chat to their custom provider/model with their key.
        // (No auto-switching: failures stay on the user's pinned provider.)
        if (mode === "custom") {
          // Resolve the API key: prefer the one the client sent, but fall back
          // to the per-install .env (set via the setup wizard's AI Providers
          // step) so BYOK keys entered at first-run actually work server-side.
          let resolvedApiKey = customApiKey || "";
          if (!resolvedApiKey && customProvider) {
            resolvedApiKey = await getByokApiKey(getProviderKeyName(customProvider));
          }
          if (!customProvider || !customModel || !resolvedApiKey) {
            const errMsg = !customProvider
              ? "No custom provider selected. Pick a provider in the right panel."
              : !customModel
                ? `No model selected for ${customProvider}.`
                : "No API key set for the custom provider. Add your key in the AI Providers step or the right panel.";
            safeEnqueue(controller, sendEvent(encoder, { type: "error", error: errMsg }));
            safeClose(controller);
            return;
          }
          try {
            // Build messages: system prompt + history + new user message
            const customMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
              { role: "system", content: systemPrompt },
            ];
            for (const m of history || []) {
              if (m.role === "user" || m.role === "assistant") {
                customMessages.push({ role: m.role, content: typeof m.content === "string" ? m.content : String(m.content) });
              }
            }
            if (message) customMessages.push({ role: "user", content: message });
            if (image) {
              // For image input, prepend a note. Most providers support vision
              // but the request body shape differs. For MVP, note the image presence.
              const lastUserIdx = customMessages.length - 1;
              if (lastUserIdx >= 0 && customMessages[lastUserIdx].role === "user") {
                customMessages[lastUserIdx].content += "\n\n[An image was attached but vision is not yet wired for custom providers. The model will see this note only.]";
              }
            }
            const providerStream = streamCustomChat({
              provider: customProvider,
              model: customModel,
              apiKey: resolvedApiKey,
              messages: customMessages,
              maxTokens: 4096,
              temperature: 0.7,
            });
            const reader = providerStream.getReader();
            const decoder = new TextDecoder();
            let fullReply = "";
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              const chunk = decoder.decode(value, { stream: true });
              const lines = chunk.split("\n\n");
              for (const raw of lines) {
                const line = raw.trim();
                if (!line.startsWith("data:")) continue;
                try {
                  const parsed = JSON.parse(line.slice(5).trim());
                  if (parsed.type === "delta" && parsed.text) {
                    fullReply += parsed.text;
                    safeEnqueue(controller, sendEvent(encoder, { type: "phase", phase: "streaming" }));
                    // Use existing 'text' event type for streaming deltas if it exists, else 'delta'
                    safeEnqueue(controller, sendEvent(encoder, { type: "text", delta: parsed.text }));
                  } else if (parsed.type === "error") {
                    safeEnqueue(controller, sendEvent(encoder, { type: "error", error: parsed.error || "Provider error" }));
                  }
                } catch {
                  // Skip malformed lines
                }
              }
            }
            appendEvent({
              timestamp: new Date().toISOString(),
              routeMode: "custom" as UsageRouteMode,
              provider: customProvider,
              model: customModel,
              latencyMs: 0,  // no per-request timing wrapper on this path
              success: true,
            });
            safeEnqueue(controller, sendEvent(encoder, { type: "complete", reply: fullReply, tokens: 0, phases: [], model: customModel, pool: "custom" }));
            safeClose(controller);
            return;
          } catch (err: any) {
            const errMsg = err instanceof CustomProviderError
              ? `${err.provider}: ${err.message}`
              : err?.message || "Custom provider request failed";
            safeEnqueue(controller, sendEvent(encoder, { type: "error", error: errMsg }));
            safeClose(controller);
            return;
          }
        }

        // Select model
        // Tools were already created above (hoisted for the capability
        // manifest). Reuse them — do NOT rebuild the registry per request.
        if (!allTools || !openaiTools || !handlerMap) {
          throw new Error("tool registry failed to initialise");
        }

        // ── Lazy Tool Loading ──
        // Only send the request_tools meta-tool initially (~60 tokens).
        // When the model calls request_tools("crm"), we inject those tools
        // and re-run the turn. This saves ~8-12K tokens per message.
        const metaToolOnly = [REQUEST_TOOLS_DEFINITION];
        let effectiveTools = metaToolOnly;
        let loadedCategories = new Set<string>();
        let toolsExpanded = false; // flag: tools have been loaded, no more meta-tool needed

        // Helper: load tools for given categories and merge into effectiveTools
        // 2026-08-22: silent no-op when all requested categories are already
        // loaded — callers MUST handle the dup case explicitly (otherwise
        // the model loops, the meta-tool gets re-emitted as JSON text, and
        // we burn cloud credits).
        function loadCategoryTools(categories: string[]) {
          const newTools: any[] = [];
          const actuallyNew: string[] = [];
          for (const cat of categories) {
            if (!loadedCategories.has(cat)) actuallyNew.push(cat);
          }
          if (actuallyNew.length === 0) {
            console.log(`[stream] loadCategoryTools: all of [${categories.join(",")}] already loaded, skipping`);
            return 0;
          }
          for (const tool of openaiTools) {
            const toolName = tool.function?.name || tool.name;
            const cat = getCategoryForTool(toolName);
            if (cat && actuallyNew.includes(cat)) {
              newTools.push(tool);
            }
          }
          for (const cat of actuallyNew) loadedCategories.add(cat);
          if (newTools.length > 0) {
            // Replace meta-tool with real tools (keep meta-tool if not all categories loaded)
            effectiveTools = [...effectiveTools.filter((t: any) => t.function?.name !== "request_tools"), ...newTools];
            if (!toolsExpanded) {
              toolsExpanded = true;
            }
            console.log(`[stream] Loaded ${newTools.length} tools for categories: ${actuallyNew.join(", ")}`);
          }
          return newTools.length;
        }

        // ── Canva mode: preload Canva MCP tools immediately ──
        // When the user toggles Canva on in the DesignPanel, we don't wait for
        // the model to call request_tools — the Canva tools are injected upfront
        // so Smyth can use them in his first response.
        if (canvaMode) {
          loadCategoryTools(["canva"]);
          console.log(`[stream] Canva mode: preloaded ${effectiveTools.length - 1} Canva tools`);
        }

        // OmniRoute endpoint + key. The user's model preference (from the Smyth
        // variant) goes straight here, same as OpenClaw. If that model fails
        // (rate limit, 5xx), the retry loop rotates through other OmniRoute
        // models in the auto/* family silently. We only fall through to the
        // pool router when mode === "machine" (user opted into Ollama Cloud).
        const [omnirouteEndpoint, omnirouteKey] = await Promise.all([
          getOmniRouteEndpoint(),
          getOmniRouteApiKey(),
        ]);

        let finalSelected: any = null;
        let lastExecError = "";

        // ── Offline mode ──
        // Route everything to the local Ollama instance (no cloud calls).
        // All chat, tools, and tasks stay on the VPS.
        let localOllamaEndpoint: string | undefined;
        let localOllamaApiKey: string | undefined;
        if (mode === "offline") {
          localOllamaEndpoint = (await getLocalOllamaBaseUrl()) + "/chat/completions";
          localOllamaApiKey = await getLocalOllamaApiKey();
          const offlineModel = model && LOCAL_OLLAMA_MODELS.some(m => m.id === model) ? model : "lfm2.5";
          console.log(`[agent/stream] Offline mode → local Ollama, model: ${offlineModel}`);
          finalSelected = {
            modelId: offlineModel,
            pool: "local",
            endpoint: localOllamaEndpoint,
            apiKey: localOllamaApiKey,
          };
        } else {
          // ── Direct model selection ──
          // If the user picked a specific model via the dropdown (not an auto/*
          // OmniRoute model), route directly to the correct endpoint.
          const isOmniRouteModel = model && (model.startsWith("auto/") || model.startsWith("oc/"));
          const directModel = model && !isOmniRouteModel ? findModel(model) : null;
          // 2026-09-09: only use direct selection if the model's account matches
          // the user's selected pool. No cross-pollination — if the user is on
          // NVIDIA, a Cloud model must NOT be routed directly.
          const isDirectOllamaModel = !!directModel && (
            !ollamaAcc || // no pin → allow
            ollamaAcc === "rotate" || // rotate → allow cloud/pro
            (directModel as any).account === ollamaAcc // exact match
          );

        if (isDirectOllamaModel) {
          const modelDef = directModel!;
          let endpoint: string;
          let apiKey: string;
          let pool: PoolId;
          let account: string | undefined;

          // 2026-09-09: STRICT POOL BOUNDARY — the model's account MUST match
          // the user's selected ollamaAccount. No cross-pollination. If the
          // user is on NVIDIA and picked an NVIDIA model, it stays on NVIDIA.
          // If they're on Cloud, it stays on Cloud. The only exception is
          // "rotate" which allows cloud↔pro mixing (by design).
          if (OLLAMA_CLOUD_MODELS.some(m => m.id === model)) {
            endpoint = (await getOllamaBaseUrl()) + "/chat/completions";
            apiKey = await getOllamaCloudApiKey();
            pool = "ollama-cloud";
            account = "cloud";
          } else if (OLLAMA_PRO_MODELS.some(m => m.id === model)) {
            endpoint = (await getOllamaBaseUrl()) + "/chat/completions";
            apiKey = await getOllamaProApiKey();
            pool = "ollama-pro";
            account = "pro";
          } else if (LOCAL_OLLAMA_MODELS.some(m => m.id === model)) {
            endpoint = (await getLocalOllamaBaseUrl()) + "/chat/completions";
            apiKey = await getLocalOllamaApiKey();
            pool = "local";
            account = "local";
          } else if (CLOUDFLARE_AI_MODELS.some(m => m.id === model)) {
            const [cfAcct, cfTok] = await Promise.all([getCloudflareAccountId(), getCloudflareApiToken()]);
            endpoint = `https://api.cloudflare.com/client/v4/accounts/${cfAcct}/ai/v1/chat/completions`;
            apiKey = cfTok;
            pool = "cloudflare";
            account = "cloudflare";
          } else if (NVIDIA_POOL_MODELS.some(m => m.id === model)) {
            endpoint = await getNvidiaPoolEndpoint();
            apiKey = await getNvidiaPoolApiKey();
            pool = "nvidia";
            account = "nvidia";
          } else {
            // Fallback: treat as Ollama Cloud
            endpoint = (await getOllamaBaseUrl()) + "/chat/completions";
            apiKey = await getOllamaCloudApiKey();
            pool = "ollama-cloud";
            account = "cloud";
          }

          // 2026-09-09: pool boundary is enforced above in isDirectOllamaModel.
          // If we're here, the model's account matches the user's selected pool.
          console.log(`[agent/stream] Direct model selection: ${model} → ${pool} (account=${account}, userPool=${ollamaAcc})`);
          finalSelected = {
            modelId: model,
            pool,
            endpoint,
            apiKey,
            account,
          };
        } else if (mode === "machine") {
          // User opted into Ollama Cloud / machine pool — keep pool router behavior
          // Honor ollamaAccount override: "cloud" or "pro" pins to one key, "rotate" alternates both
          finalSelected = await routeRequest(mode, false, !!(body?.image || visionContext), undefined, ollamaAcc);
          // 2026-08-25: NO clearAllCooldowns() here. Wiping the global cooldown
          // map mid-request was the real cross-pollination bug — it let a
          // rate-limited Cloudflare account hand off to a still-banned Pro
          // model, with the UI later rendering the *wrong* pool name.
          // Cooldowns are short (1-20s). If the pinned pool is exhausted,
          // surface the error and let the user retry — don’t silently leak.
          if (!finalSelected) {
            // ── Machine pool exhausted: notify user, do NOT auto-switch ──
            // (Per Rob's rule 2026-08-14: when a pool is rate-limited, surface a
            // notification. The user decides whether to switch routing or wait.
            // No silent fall-through to OmniRoute, no auto-rotation.)
            const accountLabel = ollamaAcc === "cloud" ? "Ollama Cloud Routing System"
              : ollamaAcc === "pro" ? "Ollama Pro Model Routing System"
              : ollamaAcc === "cloudflare" ? "the Cloudflare Workers AI Routing System"
              : ollamaAcc === "nvidia" ? "the NVIDIA NIM Routing System (Nemotron / Poolside / etc.)"
              : "the Ollama Routing System (Cloud + Pro)";
            console.log(`[agent/stream] Machine pool exhausted for ${accountLabel} — notifying user`);
            // 2026-08-28: this message used to claim "the account is rate-limited"
            // whenever ANY model in the pool was cooling down — even for 2s. Now we
            // report the *minimum* remaining cooldown across the pool so the user
            // sees "one model is cooling down — retry in ~4s" instead of chasing
            // fake quota bugs on their provider dashboard.
            let minWaitMs = Number.POSITIVE_INFINITY;
            for (const m of (ollamaAcc === "cloud" ? OLLAMA_CLOUD_MODELS : ollamaAcc === "pro" ? OLLAMA_PRO_MODELS : [])) {
              const h = getOrCreateHealth("machine", m.id, ollamaAcc as any);
              if (h.status === "rate-limited" && h.cooldownUntil > Date.now()) {
                minWaitMs = Math.min(minWaitMs, h.cooldownUntil - Date.now());
              }
            }
            const waitHint = Number.isFinite(minWaitMs)
              ? ` Try again in ~${Math.ceil(minWaitMs / 1000)}s — a single model is cooling down, not the whole account.`
              : "";
            // 2026-08-28: be honest about busy vs rate-limited.
            // A 503 / "Service temporarily overloaded" from an upstream is a
            // capacity issue (provider busy), not a quota hit. Unclear the
            // message before the LLM. If the user's pinned model is heavy
            // (e.g. nv:ultra 550B), advise rotating to a lighter peer on
            // the same pool instead of fighting quota ghosts.
            const upstream503 = lastExecError.includes("503") || lastExecError.includes("Service temporarily overloaded") || lastExecError.includes("Service Unavailable");
            const notification = upstream503
              ? `${accountLabel} is busy right now — try a lighter model on the same pool, or wait ~10s and retry. (Upstream returned 503 Service Unavailable.)`
              : `Rate limited — switch to another model or routing pool, or wait until the limit resets. (${accountLabel} is currently rate-limited.${waitHint})`;
            safeEnqueue(controller, sendEvent(encoder, { type: "error", error: notification }));
            safeClose(controller);
            return;
          }
        } else {
          // mode === "auto" or "maetryxx" — go straight to OmniRoute with the
          // user-picked model. No pool router, no fallback layer. Same call
          // shape as OpenClaw.
          const userModel = (model && model.startsWith("auto/")) ? model : "auto/fast";
          if (model && model !== userModel) {
            console.warn(`[agent/stream] non-auto model "${model}" requested in ${mode} mode — using ${userModel} for OmniRoute`);
          }
          finalSelected = {
            modelId: userModel,
            pool: "maetryxx",
            endpoint: omnirouteEndpoint,
            apiKey: omnirouteKey,
          };
        }
        } // end else (non-offline)

        const messages = [{ role: "system", content: systemPrompt }, ...finalMessages];
        const compacted = await compactContext(messages);

        const maxTurns = 40;


        // OmniRoute free models: 75s timeout (they're unreliable when busy)
        // Machine pool (Ollama cloud/pro): 60s timeout
        let timeoutMs = getTimeoutForModel(finalSelected!.modelId, finalSelected!.pool);
        // Canva mode: MCP tool chains (create design → upload asset → export)
        // take several minutes end-to-end. Give each model call 5 minutes so
        // the loop doesn't abort mid-chain and stall the session.
        if (canvaMode) timeoutMs = Math.max(timeoutMs, 300_000);
        const maxTotalMs = 1_200_000; // Hard cap: 20 minutes total for the entire request (was 600s)
        const requestStart = Date.now();

        let currentMessages = [...compacted.messages];
        const phases: ToolPhase[] = [];
        let totalTokens = 0;

        let result: { reply: string; tokens: number; phases: ToolPhase[] } | null = null;
        const recentToolCalls: string[] = [];
        let phantomRetries = 0;
        // 2026-08-22: dedicated counter for request_tools meta-tool calls.
        // Default trigger = 3 dup emissions. After this, hard-break the
        // loop with a clear message — burning cloud credits for the same
        // category load is unacceptable.
        // 2026-08-25: was 3 — models kept re-calling request_tools 15+
        // times before the loop bailed. Each retry re-enters with a fresh
        // model that re-asks for the same category. Hard break after 2
        // dups TOTAL (not per attempt) — kills the burn loop.
        const REQUEST_TOOLS_DUP_LIMIT = 2;
        let requestToolsDupCount = 0;
        let lastFailedPool: string | null = null; // Track which pool just failed
        let cooldownsCleared = false; // Only clear stale cooldowns once

        // loopState survives across retries — when a model times out mid-task,
        // the next model picks up from "evaluating" with all tool history intact.
        const loopState = createLoopState(message);

        // OmniRoute auto/* family — silent rotation list for failed retries. The
        // user's first choice (their Smyth variant) is tried first; on failure
        // we walk this list. All go to OmniRoute, all free, all stay in the
        // same provider — user never knows the swap happened.
        const OMNIROUTE_AUTO_ROTATION = [
          "auto/best-chat",
          "auto/fast",
          "auto/cheap",
          "auto/best-free",
          "auto/best-coding",
          "auto/best-reasoning",
        ];

        for (let execAttempt = 0; execAttempt < 8 && !result; execAttempt++) {
          if (execAttempt > 0) {
            // 2026-09-09: inject context handoff so the new model knows what
            // happened. Without this, the retry model sees raw tool results
            // from the previous model but has no idea why it's being asked
            // to continue — it thinks the conversation starts fresh.
            const retrySummary = `[SYSTEM] You are taking over from a previous model that failed mid-task (attempt ${execAttempt}). The user's original request was: "${message || "(image task)"}". So far, ${phases.length} tool call(s) have been completed: ${phases.map(p => `${p.tool}(${p.status})`).join(", ") || "none yet"}. Continue the task from where it left off — do NOT restart from scratch. The tool results above are from the previous model's work and are still valid.`;
            currentMessages.push({ role: "user", content: retrySummary });
            console.log(`[agent/stream] Retry ${execAttempt}: injected context handoff (${phases.length} prior phases, ${currentMessages.length} messages)`);

            // ── Offline mode: retry local Ollama only, never fall back to cloud ──
            if (mode === "offline") {
              console.log(`[agent/stream] Offline retry ${execAttempt} → local Ollama, model: lfm2.5`);
              finalSelected = {
                modelId: "lfm2.5",
                pool: "local",
                endpoint: localOllamaEndpoint,
                apiKey: localOllamaApiKey,
              };
              timeoutMs = getTimeoutForModel("lfm2.5", "local");
              loopState.phase = loopState.toolResults.length > 0 ? "evaluating" : "planning";
            } else if (mode === "machine") {
              // Machine pool retry: stay on the user's pinned routing system.
              // (Per Rob's rule 2026-08-14: NO auto-switching between routing
              // systems. The user picks the routing; the system stays there
              // through all 5 attempts. If the user pinned Pro and Pro is
              // maxed, we tell them — we don't silently flip to Cloud.)
              //
              // If a model is pinned (e.g. user picked 'GLM 5.2' on the Cloud
              // widget), retry on the SAME model + key. Don't call routeRequest
              // because that picks a different model.
              if (model && findModel(model)) {
                const modelDef = findModel(model)!;
                if (modelDef.account === ollamaAcc || (ollamaAcc === "rotate" && (modelDef.account === "cloud" || modelDef.account === "pro")) || (ollamaAcc === "nvidia" && modelDef.account === "nvidia")) {
                  // 2026-09-09: clear this specific model's cooldown before retry.
                  // When a model is pinned (not rotating), a single 429 shouldn't
                  // kill the whole request. Clear the cooldown, wait briefly for
                  // the upstream to recover, then retry on the SAME model.
                  clearCooldowns("machine", modelDef.account as any);
                  // Also clear the governor bucket for this route
                  const { recordRateLimitHit: _rrl } = await import("@/lib/rate-governor");
                  // Brief delay: 2s for 1st retry, 4s for 2nd, etc.
                  const retryDelay = Math.min(2000 * execAttempt, 8000);
                  if (retryDelay > 0) {
                    console.log(`[agent/stream] Pinned model retry ${execAttempt}: waiting ${retryDelay}ms for upstream recovery`);
                    await new Promise(r => setTimeout(r, retryDelay));
                  }
                  const [cloudKey, proKey, localKey, remoteBaseUrl, localBaseUrl] = await Promise.all([
                    getOllamaCloudApiKey(),
                    getOllamaProApiKey(),
                    getLocalOllamaApiKey(),
                    getOllamaBaseUrl(),
                    getLocalOllamaBaseUrl(),
                  ]);
                  const useAccount = ollamaAcc === "rotate" ? modelDef.account : ollamaAcc;
                  // 2026-08-22: pick the right API key for the resolved account.
                  // 'cloudflare' and 'nvidia' use their own keys/endpoints, not
                  // the cloud/pro/local triple.
                  let useApiKey: string | undefined;
                  let useEndpoint = "";
                  if (useAccount === "cloudflare") {
                    const [acct, tok] = await Promise.all([getCloudflareAccountId(), getCloudflareApiToken()]);
                    useApiKey = tok;
                    useEndpoint = `https://api.cloudflare.com/client/v4/accounts/${acct}/ai/v1/chat/completions`;
                  } else if (useAccount === "nvidia") {
                    const [ep, k] = await Promise.all([getNvidiaPoolEndpoint(), getNvidiaPoolApiKey()]);
                    useApiKey = k;
                    // 2026-08-28: ep already includes /v1/chat/completions from
                    // getNvidiaPoolEndpoint()'s default. Don't blind-append
                    // /chat/completions → was hitting /v1/chat/completions/chat/completions
                    // and 404'ing every agent-loop retry after a tool call.
                    useEndpoint = ep.endsWith("/chat/completions") ? ep : `${ep}/chat/completions`;
                  } else {
                    useApiKey = useAccount === "cloud" ? cloudKey
                      : useAccount === "pro" ? proKey
                      : localKey;
                    useEndpoint = `${useAccount === "local" ? localBaseUrl : remoteBaseUrl}/chat/completions`;
                  }
                  finalSelected = {
                    modelId: model,
                    pool: "machine",
                    account: useAccount,
                    endpoint: useEndpoint,
                    apiKey: useApiKey,
                  };
                } else {
                  // Pinned model is on a different account than the user selected.
                  // Stay on the user's pinned account and pick via routeRequest.
                  finalSelected = await routeRequest(mode, false, !!(body?.image || visionContext), undefined, ollamaAcc);
                }
              } else {
                finalSelected = await routeRequest(mode, false, !!(body?.image || visionContext), undefined, ollamaAcc);
                // 2026-08-25: no global clearAllCooldowns() here either — same bug.
                // If the pinned pool is still exhausted, surface the error below.
              }
              if (!finalSelected) {
                // Machine pool exhausted during retry: notify user, do NOT auto-switch.
                const accountLabel = ollamaAcc === "cloud" ? "Ollama Cloud Routing System"
                  : ollamaAcc === "pro" ? "Ollama Pro Model Routing System"
                  : ollamaAcc === "cloudflare" ? "the Cloudflare Workers AI Routing System"
                  : ollamaAcc === "nvidia" ? "the NVIDIA NIM Routing System (Nemotron / Poolside / etc.)"
                  : "the Ollama Routing System (Cloud + Pro)";
                const pinnedNote = model ? ` Pinned model: ${model}.` : "";
                console.log(`[agent/stream] Machine pool exhausted during retry for ${accountLabel} — notifying user`);
                // 2026-08-28: same 503-SOA discrimination on the retry path
                const upstream503Here = lastExecError.includes("503") || lastExecError.includes("Service temporarily overloaded") || lastExecError.includes("Service Unavailable");
                const notification = upstream503Here
                  ? `${accountLabel} is busy right now — try a lighter model on the same pool, or wait ~10s and retry. (Upstream returned 503 Service Unavailable.) Pinned model: ${model || "pool-default"}.`
                  : `Rate limited — switch to another model or routing pool, or wait until the limit resets. (${accountLabel} is currently rate-limited.${pinnedNote})`;
                safeEnqueue(controller, sendEvent(encoder, { type: "error", error: notification }));
                safeClose(controller);
                return;
              }
            } else {
              // auto/maetryxx mode: rotate to next OmniRoute auto/* model silently
              const tried = OMNIROUTE_AUTO_ROTATION.indexOf(finalSelected.modelId);
              const nextIdx = tried >= 0 ? tried + 1 : 0;
              if (nextIdx >= OMNIROUTE_AUTO_ROTATION.length) {
                // ── OmniRoute exhausted during auto/maetryxx mode: notify user, do NOT auto-switch ──
                // (Per Rob's rule 2026-08-14: user decides routing manually.
                // No silent fall-through to Machine pool.)
                console.log("[agent/stream] OmniRoute exhausted in auto mode — notifying user");
                safeEnqueue(controller, sendEvent(encoder, {
                  type: "error",
                  error: "Rate limited — switch to another model or routing pool, or wait until the limit resets. (All OmniRoute models are currently rate-limited.)"
                }));
                safeClose(controller);
                return;
              } else {
                finalSelected = {
                  modelId: OMNIROUTE_AUTO_ROTATION[nextIdx],
                  pool: "maetryxx",
                  endpoint: omnirouteEndpoint,
                  apiKey: omnirouteKey,
                };
                console.log(`[agent/stream] rotating to ${finalSelected.modelId} (silent)`);
              }
              timeoutMs = getTimeoutForModel(finalSelected.modelId, finalSelected.pool);
              // Resume from where the previous model left off — don't restart planning
              loopState.phase = loopState.toolResults.length > 0 ? "evaluating" : "planning";
            }
          } // end if (execAttempt > 0)

          try {
            // Continue the deterministic loop (loopState survives across retries)
            
            for (let turn = loopState.turn; turn < maxTurns; turn++) {
              loopState.turn = turn;

              // 2026-08-25: hard exit if we already decided the loop is done
              // (e.g. request_tools dup limit fired in the previous turn).
              // Without this, the loop kept calling the model again and
              // again, burning tokens while accomplishing nothing.
              if (loopState.phase === "done") {
                console.log(`[stream] loopState.phase === done at turn start — exiting`);
                break;
              }

              // No-progress guard (general): same tool+args 3x in a row
              if (recentToolCalls.length >= 3 &&
                  recentToolCalls[recentToolCalls.length - 1] === recentToolCalls[recentToolCalls.length - 2] &&
                  recentToolCalls[recentToolCalls.length - 2] === recentToolCalls[recentToolCalls.length - 3]) {
                loopState.phase = "done";
              }

              // No-progress guard (shell_status polls): force the agent to
              // give up polling in the same response chain after 2 polls of
              // the same jobId. Polling burns tokens (8K per LLM call) and
              // hits the per-call output cap on long jobs. The right pattern
              // is "kick off, return to user, let the next turn / Operator
              // check again." We surface a one-line hint in the loopState so
              // the final-answer directive can include it.
              if (recentToolCalls.length >= 2) {
                const last = recentToolCalls[recentToolCalls.length - 1];
                const prev = recentToolCalls[recentToolCalls.length - 2];
                if (
                  last.startsWith("shell_status:") &&
                  prev.startsWith("shell_status:") &&
                  last === prev
                ) {
                  loopState.phase = "done_polling";
                  // Extract the jobId so the final-answer system message can
                  // reference it.
                  try {
                    const parsed = JSON.parse(last.slice("shell_status:".length));
                    if (parsed?.jobId) {
                      (loopState as any)._pollingJobId = parsed.jobId;
                    }
                  } catch {}
                }
              }

              if (Date.now() - requestStart > maxTotalMs) {
                appendEvent({
                  timestamp: new Date().toISOString(),
                  routeMode: (mode || "auto") as UsageRouteMode,
                  provider: finalSelected!.pool,
                  model: finalSelected!.modelId,
                  account: ollamaAcc || undefined,
                  outputTokens: totalTokens,
                  latencyMs: Date.now() - requestStart,
                  costEstimateUsd: estimateCost(finalSelected!.pool, finalSelected!.modelId, 0, totalTokens),
                  success: false,
                  error: "timeout",
                });
                safeEnqueue(controller, sendEvent(encoder, { type: "complete", reply: "I ran out of time. " + loopState.completedSteps.length + " of " + loopState.steps.length + " steps completed.", tokens: totalTokens, phases }));
                safeClose(controller);
                return;
              }

              // Build the loop directive — only inject when tools are needed.
              // For simple chat (no tools loaded, turn 0), skip the directive
              // entirely so the model doesn't dump reasoning about it.
              const loopDirective = (effectiveTools.length > 0 || loopState.turn > 0 || loopState.toolResults.length > 0)
                ? buildLoopSystemMessage(loopState)
                : "";
              
              const messagesWithDirective = [...currentMessages];
              if (loopDirective) {
                messagesWithDirective.push({ role: "system", content: loopDirective });
              }

              // Native vision: if the picked model supports it, attach the
              // image as a multimodal content array instead of just text.
              // Falls back to the existing text-only fallback (which uses
              // EchoVision downstream) when the model is text-only.
              if (image && image.base64 && finalSelected && hasNativeVision(finalSelected.modelId)) {
                const lastUserIdx = (() => {
                  for (let i = messagesWithDirective.length - 1; i >= 0; i--) {
                    if (messagesWithDirective[i].role === "user") return i;
                  }
                  return -1;
                })();
                if (lastUserIdx >= 0) {
                  const mime = image.mimeType || "image/jpeg";
                  const last = messagesWithDirective[lastUserIdx];
                  const text =
                    typeof last.content === "string"
                      ? last.content
                      : Array.isArray(last.content)
                      ? last.content.map((c: any) => (c.type === "text" ? c.text : "")).join("\n")
                      : "";
                  messagesWithDirective[lastUserIdx] = {
                    role: "user",
                    content: [
                      { type: "text", text: text || `Analyze this image: ${image.filename || "image.png"}` },
                      { type: "image_url", image_url: { url: `data:${mime};base64,${image.base64}` } },
                    ],
                  };
                }
              }

              safeEnqueue(controller, sendEvent(encoder, { type: "phase", phase: "thinking", turn, model: finalSelected!.modelId, loopPhase: loopState.phase }));

              // Throttle OmniRoute bursts: spread out consecutive requests when
              // we've already fired BURST_MAX in the last BURST_WINDOW_MS.
              await throttleIfBursting(recentFires);

              // Global RPM-aware rate limiting — wait for a slot before firing.
              // This spans ALL concurrent streams, not just this one.
              // 2026-08-10: pass modelId + messages so the bucket keys off the
              // real route (was `maetryxx:unknown` with a flat 2.5K token
              // estimate — that exhausted the tpm bucket in ~20 calls and
              // caused the 21-minute streams).
              await waitForSlot(
                finalSelected!.pool as PoolId,
                finalSelected!.modelId,
                finalSelected!.account,
                (compacted as any)?.messages ?? (compacted as any) ?? [],
              );

              const controller2 = new AbortController();
              const timeout = setTimeout(() => controller2.abort(), timeoutMs);

              let res: Response;
              try {
                // Use undici to bypass Next.js fetch patching (same fix as agent route)
                const { default: undici } = await import("undici");
                
                res = await undici.fetch(finalSelected!.endpoint, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${finalSelected!.apiKey}`,
                  },
                  body: JSON.stringify({
                    model: finalSelected!.modelId,
                    messages: messagesWithDirective,
                    tools: effectiveTools.length > 0 ? effectiveTools : undefined,
                    tool_choice: "auto",
                    max_tokens: 8192,
                    stream: false,
                    reasoning_effort: "none",
                  }),
                  signal: controller2.signal,
                }) as unknown as Response;
              } catch (fetchErr: any) {
                clearTimeout(timeout);
                const isAbort = fetchErr?.name === "AbortError" || fetchErr?.message?.includes("abort");
                if (isAbort) {
                  console.log(`[stream] Timeout on ${finalSelected!.modelId} — retrying`);
                  // Mark the model as rate-limited so it won't be picked again
                  recordFailure(finalSelected!, 408, `Timeout after ${timeoutMs}ms`);
                  lastFailedPool = finalSelected!.pool;
                  result = null;
                  break;
                }
                lastExecError = `Network error: ${fetchErr?.message || "fetch failed"}`;
                // 2026-08-28: distinguish hard connection failures from
                // timeout / abort. ECONNREFUSED means the pool server
                // (e.g. NVIDIA local router, local ollama) is offline —
                // report that instead of masquerading as rate-limited.
                const isRefused = fetchErr?.code === "ECONNREFUSED" || fetchErr?.cause?.code === "ECONNREFUSED";
                if (isRefused) {
                  const endpoint = finalSelected!.endpoint || "unknown endpoint";
                  const friendlyPool = finalSelected!.pool === "nvidia" ? "NVIDIA pool router"
                    : finalSelected!.pool === "local" ? "Local Ollama"
                    : finalSelected!.pool;
                  result = { reply: `${friendlyPool} is offline — start it and try again. (${endpoint})`, tokens: totalTokens, phases };
                } else {
                  result = { reply: lastExecError, tokens: totalTokens, phases };
                }
                break;
              } finally {
                clearTimeout(timeout);
              }

              if (!res.ok) {
                const errText = await res.text();
                lastExecError = `Error: ${res.status} — ${errText.slice(0, 200)}`;
                console.warn(`[stream] HTTP ${res.status} from ${finalSelected!.modelId} (${finalSelected!.pool}) url=${finalSelected!.endpoint} — ${errText.slice(0, 120)}`);
                try { require("fs").appendFileSync("/tmp/smyth-debug.log", `HTTP ${res.status} model=${finalSelected!.modelId} url=${finalSelected!.endpoint} errBody=${errText.slice(0,500)}\n`); } catch {}
                // 2026-09-09: feed 429s into the rate governor immediately,
                // before the pool router marks the model. Otherwise the
                // governor keeps allowing calls while the router reports the
                // whole account as exhausted.
                if (res.status === 429) {
                  const retryAfter = Number(res.headers?.get?.("retry-after") ?? NaN);
                  recordRateLimitHit(
                    finalSelected!.pool as PoolId,
                    finalSelected!.modelId,
                    finalSelected!.account,
                    Number.isFinite(retryAfter) ? retryAfter : undefined,
                  );
                }

                recordFailure(finalSelected!, res.status, lastExecError);
                lastFailedPool = finalSelected!.pool;

                // 2026-08-28: treat 410 as permanent EOL (don't retry, stop),
                // 503 as busy (wait before retry so worker limit drains),
                // 429 as quota (obey retry-after as before).
                if (res.status === 410) {
                  console.log(`[stream] 410 Gone — model end-of-lifed: ${finalSelected!.modelId}. Stopping.`);
                  result = { reply: `Model ${finalSelected!.modelId} is permanently gone (410 Gone). Pick another model.`, tokens: totalTokens, phases };
                  break;
                }
                if (res.status === 429 || res.status === 503) {
                  const retryAfter = Number(res.headers?.get?.("retry-after") ?? NaN);
                  const backoffMs = Number.isFinite(retryAfter) && retryAfter > 0
                    ? Math.min(retryAfter * 1000, 15_000)
                    : (res.status === 503 ? 5_000 : 1_500 + Math.floor(Math.random() * 1_000));
                  console.log(`[stream] ${res.status} from ${finalSelected!.modelId} — backing off ${backoffMs}ms before retry (attempt ${execAttempt + 1}/5)`);
                  await new Promise((r) => setTimeout(r, backoffMs));
                }

                // Retryable errors: don't set result, let the execAttempt loop try the next model
                if (res.status === 408 || res.status === 429 || res.status >= 500) {
                  console.log(`[stream] ${res.status} from ${finalSelected!.modelId} — retrying with next model (attempt ${execAttempt + 1}/5)`);
                  break; // break inner turn loop → outer execAttempt loop picks next model
                }
                // Non-retryable error (4xx other than 429): return to user
                result = { reply: lastExecError, tokens: totalTokens, phases };
                break;
              }

              
              const data = await res.json();
              
              const msg = data?.choices?.[0]?.message;
              totalTokens += data?.usage?.total_tokens || 0;

              // 2026-08-10: learn real provider limits from response headers
              recordHeaders(
                finalSelected!.pool,
                finalSelected!.modelId,
                res.headers,
                data?.usage?.total_tokens || 0,
                finalSelected!.account,
              );

              // ── Parse tool calls (both native and JSON format) ──
              if (!msg?.tool_calls || msg.tool_calls.length === 0) {
                const text = msg?.content || "";
                const stripped = text.replace(/<tool_call>\s*/g, "").replace(/\s*<\/tool_call>/g, "");
                // Extract all JSON objects from text, then check for tool calls
                const jsonBlocks: Array<{ tool: string; args: Record<string, any> }> = [];
                // Universal bracket-counting extractor: finds any {...} containing a tool call
                // Handles {"tool":...}, {"name":...}, and {"plan":[...],"tool":...} combined format
                {
                  let i = 0;
                  while (i < stripped.length) {
                    if (stripped[i] !== '{') { i++; continue; }
                    let depth = 0, inStr = false, esc = false, startIdx = i, endIdx = -1;
                    for (let j = i; j < stripped.length; j++) {
                      const ch = stripped[j];
                      if (esc) { esc = false; continue; }
                      if (ch === '\\' && inStr) { esc = true; continue; }
                      if (ch === '"') { inStr = !inStr; continue; }
                      if (inStr) continue;
                      if (ch === '{') depth++;
                      else if (ch === '}') { depth--; if (depth === 0) { endIdx = j; break; } }
                    }
                    if (endIdx === -1) {
                      // Unbalanced — likely truncated by output token limit
                      const truncated = stripped.slice(startIdx);
                      const hasToolTrunc = /"tool"\s*:\s*"/.test(truncated) || /"name"\s*:\s*"/.test(truncated);
                      if (hasToolTrunc) {
                        const tm = truncated.match(/"tool"\s*:\s*"([^"]+)"/);
                        const nm = truncated.match(/"name"\s*:\s*"([^"]+)"/);
                        const tn = tm?.[1] || nm?.[1];
                        if (tn && (handlerMap.has(tn) || tn === "request_tools")) {
                          const args: Record<string, any> = {};
                          const pm = truncated.match(/"path"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
                          if (pm) args.path = pm[1].replace(/\\(.)/g, '$1');
                          const ck = truncated.indexOf('"content"');
                          if (ck >= 0) {
                            const ci = truncated.indexOf(':', ck);
                            const oq = truncated.indexOf('"', ci + 1);
                            if (oq >= 0) {
                              let c = truncated.slice(oq + 1);
                              c = c.replace(/"+\}*$/, '');
                              c = c.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r').replace(/\\"/g, '"');
                              args.content = c;
                            }
                          }
                          const cm = truncated.match(/"command"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
                          if (cm) args.command = cm[1].replace(/\\(.)/g, '$1');
                          if (Object.keys(args).length > 0) {
                            jsonBlocks.push({ tool: tn, args: typeof args === 'object' ? args : {} });
                          }
                        }
                      }
                      i++; continue;
                    }
                    const jsonStr = stripped.slice(startIdx, endIdx + 1);
                    // Check if this JSON contains a tool call
                    const hasTool = /"tool"\s*:\s*"/.test(jsonStr) || /"name"\s*:\s*"/.test(jsonStr);
                    if (!hasTool) { i = endIdx + 1; continue; }
                    // Attempt 1: direct parse
                    let toolName: string | null = null;
                    let toolArgs: Record<string, any> = {};
                    let ok = false;
                    try {
                      const parsed = JSON.parse(jsonStr);
                      toolName = parsed.tool || parsed.name;
                      toolArgs = parsed.args || parsed.arguments || {};
                      if (toolName && (handlerMap.has(toolName) || toolName === "request_tools")) ok = true;
                    } catch {}
                    // Attempt 2: fix literal newlines
                    if (!ok) {
                      try {
                        const fixed = jsonStr.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
                        const parsed = JSON.parse(fixed);
                        toolName = parsed.tool || parsed.name;
                        toolArgs = parsed.args || parsed.arguments || {};
                        if (toolName && (handlerMap.has(toolName) || toolName === "request_tools")) ok = true;
                      } catch {}
                    }
                    // Attempt 3: regex extraction for unescaped quotes
                    if (!ok) {
                      const tm = jsonStr.match(/"tool"\s*:\s*"([^"]+)"/);
                      const nm = jsonStr.match(/"name"\s*:\s*"([^"]+)"/);
                      toolName = tm?.[1] || nm?.[1] || null;
                      if (toolName && (handlerMap.has(toolName) || toolName === "request_tools")) {
                        const args: Record<string, any> = {};
                        const pm = jsonStr.match(/"path"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
                        if (pm) args.path = pm[1].replace(/\\(.)/g, '$1');
                        const ck = jsonStr.indexOf('"content"');
                        if (ck >= 0) {
                          const ci = jsonStr.indexOf(':', ck);
                          const oq = jsonStr.indexOf('"', ci + 1);
                          const cl = jsonStr.lastIndexOf('"}}');
                          if (oq >= 0 && cl > oq) {
                            let c = jsonStr.slice(oq + 1, cl);
                            c = c.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r').replace(/\\"/g, '"');
                            args.content = c;
                          }
                        }
                        const cm = jsonStr.match(/"command"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
                        if (cm) args.command = cm[1].replace(/\\(.)/g, '$1');
                        if (Object.keys(args).length > 0) { toolArgs = args; ok = true; }
                      }
                    }
                    if (ok && toolName) {
                      jsonBlocks.push({ tool: toolName, args: typeof toolArgs === 'object' ? toolArgs : {} });
                    }
                    i = endIdx + 1;
                  }
                }


                // Also check for a plan in the first response
                if (loopState.phase === "planning" && text.includes('"plan"')) {
                  try {
                    const planMatch = text.match(/"plan"\s*:\s*\[([\s\S]*?)\]/);
                    if (planMatch) {
                      const steps = JSON.parse("[" + planMatch[1] + "]");
                      if (Array.isArray(steps) && steps.length > 0) {
                        loopState.steps = steps.map(String);
                      }
                    }
                  } catch {}
                }

                if (jsonBlocks.length > 0) {
                  // Execute JSON tool calls
                  if (loopState.phase === "planning") loopState.phase = "acting";

                  for (const block of jsonBlocks) {
                    // ── Intercept request_tools meta-tool ──
                    // 2026-08-22: STOP accepting request_tools once real
                    // tools have been loaded OR the model has asked for the
                    // same category 2+ times. Prior bug: model kept emitting
                    // {"tool":"request_tools","args":{"categories":["mcp"]}}
                    // as text, which extractJsonBlocks re-interpreted every
                    // turn. 21+ "Tools loaded for mcp" replies, no actual
                    // progress, burning NVIDIA credits on each call.
                    if (block.tool === "request_tools") {
                      const cats = Array.isArray(block.args?.categories)
                        ? block.args.categories
                        : [block.args?.categories].filter(Boolean);
                      const alreadyLoaded = cats.filter((c: string) => loadedCategories.has(c));
                      const notYetLoaded = cats.filter((c: string) => !loadedCategories.has(c));

                      if (loadedCategories.size > 0 && notYetLoaded.length === 0) {
                        // Already loaded everything in this request — refuse
                        // and tell the model the EXACT tool names it should call.
                        // 2026-08-25: prior refusal said 'call the actual tool'
                        // without naming any, so the model panicked and asked
                        // for the same categories again in a loop. Give it the
                        // tool names for those categories so it can pick one.
                        requestToolsDupCount++;
                        const loadedToolNames = cats
                          .flatMap((c: string) => getToolNamesForCategory(c as any, openaiTools.map((t: any) => t.function?.name || t.name || "")))
                          .filter(Boolean)
                          .slice(0, 12); // cap at 12 names so the message stays short
                        const hint = loadedToolNames.length > 0
                          ? `Already loaded [${cats.join(", ")}]. Pick one of these tools and call it directly: ${loadedToolNames.join(", ")}${openaiTools.length > 12 ? " …" : ""}.`
                          : `Already loaded [${cats.join(", ")}]. Use the actual tool directly — do NOT call request_tools again.`;
                        safeEnqueue(controller, sendEvent(encoder, { type: "tool_call", tool: "request_tools", args: block.args }));
                        safeEnqueue(controller, sendEvent(encoder, { type: "tool_result", tool: "request_tools", result: hint }));
                        currentMessages.push({ role: "tool", tool_call_id: "request_tools_dup_" + phases.length, content: hint });
                        // 2026-08-22: hard break after REQUEST_TOOLS_DUP_LIMIT
                        // repeat calls. Otherwise the model churns tokens on
                        // Cloud / NVIDIA every turn with no real progress.
                        if (requestToolsDupCount >= REQUEST_TOOLS_DUP_LIMIT) {
                          // 2026-08-25: set result + return so outer execAttempt loop
                          // exits. Previously we only set loopState.phase = "done"
                          // which broke the inner turn loop but let the outer retry
                          // loop call ANOTHER model with a fresh context, burning
                          // 15+ tool-call cycles. Returning bails the whole thing.
                          loopState.phase = "done";
                          const reply = `I kept requesting the same tool categories without acting on them. The tools are loaded — just tell me directly what you want done (e.g. "list my unread emails" or "show me contacts in CRM").`;
                          safeEnqueue(controller, sendEvent(encoder, { type: "complete", reply, tokens: totalTokens, phases, model: finalSelected!.modelId, pool: finalSelected!.pool }));
                          safeClose(controller);
                          recordSuccess(finalSelected!, totalTokens);
                          return;
                        }
                        continue;
                      }

                      if (alreadyLoaded.length > 0 && notYetLoaded.length > 0) {
                        // Partial: load the new ones, mention the dupes.
                        loadCategoryTools(notYetLoaded);
                        safeEnqueue(controller, sendEvent(encoder, { type: "tool_call", tool: "request_tools", args: block.args }));
                        safeEnqueue(controller, sendEvent(encoder, { type: "tool_result", tool: "request_tools", result: `Loaded new: [${notYetLoaded.join(", ")}]. Already had: [${alreadyLoaded.join(", ")}]. Tools loaded: ${effectiveTools.length - (effectiveTools.some((t: any) => t.function?.name === "request_tools") ? 1 : 0)} now available.` }));
                        currentMessages.push({ role: "tool", tool_call_id: "request_tools_partial_" + phases.length, content: `Loaded new [${notYetLoaded.join(", ")}]; already had [${alreadyLoaded.join(", ")}]. Use the real tool names now.` });
                        continue;
                      }

                      // First load for these categories — original behaviour
                      loadCategoryTools(cats);
                      safeEnqueue(controller, sendEvent(encoder, { type: "tool_call", tool: "request_tools", args: block.args }));
                      safeEnqueue(controller, sendEvent(encoder, { type: "tool_result", tool: "request_tools", result: `Tools loaded for categories: ${cats.join(", ")}. You can now use them.` }));
                      currentMessages.push({ role: "assistant", content: `{"tool":"request_tools","args":${JSON.stringify(block.args)}}` });
                      currentMessages.push({ role: "tool", tool_call_id: "request_tools_" + phases.length, content: `Tools loaded for categories: ${cats.join(", ")}. You can now use them in your next response.` });
                      continue;
                    }

                    const phase: ToolPhase = { tool: block.tool, status: "running", args: block.args };
                    phases.push(phase);
                    safeEnqueue(controller, sendEvent(encoder, { type: "tool_call", tool: block.tool, args: block.args }));

                    try {
                      const cached = isDuplicateCompletedShellStatus(block.tool, block.args);
                      let toolResult: string;
                      if (cached) {
                        toolResult = cached;
                        console.log(`[stream] skipping redundant shell_status for ${block.args.jobId}; using cached completed result`);
                      } else {
                        toolResult = await handlerMap.get(block.tool)!(block.args);
                        cacheCompletedShellStatus(block.tool, toolResult);
                      }
                      phase.status = "done";
                      phase.result = toolResult.slice(0, 200);
                      recentToolCalls.push(block.tool + ':' + JSON.stringify(block.args).slice(0, 100));
                      safeEnqueue(controller, sendEvent(encoder, { type: "tool_result", tool: block.tool, result: toolResult.slice(0, 2000) }));

                      // Stop polling background jobs in the same chain
                      if (shouldBreakOnBackgroundJobPoll(block.tool, toolResult, recentToolCalls)) {
                        let jobId: string | null = null;
                        try { jobId = JSON.parse(toolResult)?.jobId || null; } catch {}
                        const pauseMsg = jobId ? buildBackgroundJobPauseMessage(jobId, toolResult) : "Background job is still running. I'll check back automatically when it finishes.";
                        safeEnqueue(controller, sendEvent(encoder, { type: "complete", reply: pauseMsg, tokens: totalTokens, phases, model: finalSelected!.modelId, pool: finalSelected!.pool }));
                        safeClose(controller);
                        recordSuccess(finalSelected!, totalTokens);
                        return;
                      }

                      currentMessages.push({ role: "assistant", content: `{"tool":"${block.tool}","args":${JSON.stringify(block.args)}}` });
                      currentMessages.push({ role: "tool", tool_call_id: block.tool + "_" + phases.length, content: toolResult.slice(0, 30000) });
                      loopState.toolResults.push({ tool: block.tool, result: toolResult, success: true });
                    } catch (err: any) {
                      phase.status = "error";
                      phase.result = err.message;
                      safeEnqueue(controller, sendEvent(encoder, { type: "tool_result", tool: block.tool, error: err.message }));
                      currentMessages.push({ role: "assistant", content: `{"tool":"${block.tool}","args":${JSON.stringify(block.args)}}` });
                      currentMessages.push({ role: "tool", tool_call_id: block.tool + "_" + phases.length, content: `Error: ${err.message}` });
                      loopState.toolResults.push({ tool: block.tool, result: err.message, success: false });
                    }
                  }
                  
                  // Advance to evaluating phase
                  loopState.completedSteps.push(loopState.steps[loopState.currentStep] || `Step ${loopState.currentStep + 1}`);
                  loopState.currentStep++;
                  loopState.phase = (loopState.currentStep >= loopState.steps.length && loopState.steps.length > 0) ? "done" : "evaluating";
                  continue;
                }

                // ── No tool calls — classify the response deterministically ──
                const classification = classifyResponse(text, false, loopState);

                if (classification === "incomplete" && turn < maxTurns - 1 && phantomRetries < 5) {
                  phantomRetries++;
                  if (loopState.phase === "planning") {
                    // Model didn't plan or call a tool — force it with explicit format
                    if (phantomRetries >= 3) {
                      // After 3 failed nudges, give explicit format example
                      currentMessages.push({ role: "user", content: "[SYSTEM] You must call a tool. Respond ONLY with this JSON format, no other text:\n{\"tool\":\"tool_name\",\"args\":{}}\n\nAvailable tools: " + effectiveTools.map(t => t.function.name).join(", ") + "\n\nPick one and respond with the JSON now." });
                    } else {
                      currentMessages.push({ role: "user", content: "[SYSTEM] You must respond with a tool call to start working on this task. Do not explain — call a tool now." });
                    }
                  } else {
                    // Mid-task, model gave transitional/incomplete response — force continuation
                    if (text.trim()) currentMessages.push({ role: "assistant", content: text });
                    if (phantomRetries >= 3) {
                      currentMessages.push({ role: "user", content: "[SYSTEM] Stop explaining. Either call a tool with {\"tool\":\"name\",\"args\":{}} or give the user a complete final answer. Do not say what you're about to do — do it." });
                    } else {
                      currentMessages.push({ role: "user", content: "[SYSTEM] Continue. Either call the next tool or give a complete final answer. Do not stop mid-task." });
                    }
                  }
                  continue;
                }

                if (classification === "final_answer" || loopState.phase === "done" || loopState.phase === "done_polling") {
                  // Guard: if we're mid-task with remaining steps, don't accept a premature "final answer"
                  // OmniRoute free models often return partial responses that look like answers but aren't.
                  if (loopState.phase === "evaluating" && loopState.currentStep < loopState.steps.length && loopState.steps.length > 0) {
                    // Force continuation — the model tried to stop mid-task
                    if (text.trim()) currentMessages.push({ role: "assistant", content: text });
                    currentMessages.push({ role: "user", content: `[SYSTEM] You have ${loopState.steps.length - loopState.currentStep} step(s) remaining: ${loopState.steps.slice(loopState.currentStep).join(", ")}. Call the next tool now.` });
                    phantomRetries++;
                    continue;
                  }
                  // Log usage for cost/optimization tracking
                  appendEvent({
                    timestamp: new Date().toISOString(),
                    routeMode: (mode || "auto") as UsageRouteMode,
                    provider: finalSelected!.pool,
                    model: finalSelected!.modelId,
                    account: ollamaAcc || undefined,
                    outputTokens: totalTokens,
                    latencyMs: Date.now() - requestStart,
                    costEstimateUsd: estimateCost(finalSelected!.pool, finalSelected!.modelId, 0, totalTokens),
                    success: true,
                  });
                  safeEnqueue(controller, sendEvent(encoder, { type: "complete", reply: text, tokens: totalTokens, phases, model: finalSelected!.modelId, pool: finalSelected!.pool }));
                  safeClose(controller);
                  recordSuccess(finalSelected!, totalTokens);
                  return;
                }

                // Fallback: treat as final answer
                appendEvent({
                  timestamp: new Date().toISOString(),
                  routeMode: (mode || "auto") as UsageRouteMode,
                  provider: finalSelected!.pool,
                  model: finalSelected!.modelId,
                  account: ollamaAcc || undefined,
                  outputTokens: totalTokens,
                  latencyMs: Date.now() - requestStart,
                  costEstimateUsd: estimateCost(finalSelected!.pool, finalSelected!.modelId, 0, totalTokens),
                  success: true,
                });
                safeEnqueue(controller, sendEvent(encoder, { type: "complete", reply: text || "Task complete.", tokens: totalTokens, phases, model: finalSelected!.modelId, pool: finalSelected!.pool }));
                safeClose(controller);
                recordSuccess(finalSelected!, totalTokens);
                return;
              }

              // ── Native tool_calls (OpenAI format) ──
              if (loopState.phase === "planning") loopState.phase = "acting";
              
              // ── Cloudflare Workers AI strict payload ──
              // CF's validators reject assistant messages where
              // `content` is null/missing (required properties 'role,content'
              // per CF error). Normalize: force content to "" when absent,
              // keep tool_calls intact — BUT strip malformed tool_calls
              // entries that lack function.name or function.arguments, since
              // CF's validator runs per-entry and rejects 'function.arguments
              // Field required'.
              const validToolCalls = Array.isArray(msg?.tool_calls)
                ? msg.tool_calls.filter((tc: any) =>
                    tc?.function?.name &&
                    typeof tc?.function?.arguments === "string"
                  )
                : [];
              const normalizedMsg: any = {
                role: msg?.role ?? "assistant",
                content: typeof msg?.content === "string" ? msg.content : "",
              };
              if (validToolCalls.length > 0) {
                normalizedMsg.tool_calls = validToolCalls;
              }
              currentMessages.push(normalizedMsg);
              for (const tc of msg.tool_calls) {
                // 2026-08-25: defensive — some models emit tool_calls with a
                // missing function object or empty name. Guard before we
                // dereference, and skip (don't error) — the UI was getting
                // 'Unknown tool: undefined' and infinite phase loops before.
                const fn = tc?.function;
                if (!fn || !fn.name) {
                  // 2026-08-25: push a synthetic failure so the model doesn't
                  // keep re-emitting the same malformed call. The previous
                  // bare `continue` left the tool_call unresolved — the next
                  // assistant turn saw it and emitted the same thing, burning
                  // all 5 exec attempts and pinning the pool as rate-limited.
                  console.warn(`[stream] malformed tool_call (no function.name) — synthesizing failure`);
                  phantomRetries++;
                  currentMessages.push({ role: "tool", tool_call_id: tc?.id || `malformed_${phantomRetries}`, content: "Error: malformed tool call — no function name provided. Respond with plain text." });
                  if (phantomRetries >= 3) {
                    loopState.phase = "done";
                    const sys = `[SYSTEM] You've emitted ${phantomRetries} malformed tool calls in a row. Stop calling tools and give your final answer in plain text.`;
                    currentMessages.push({ role: "user", content: sys });
                  }
                  continue;
                }
                let args: Record<string, any> = {};
                try { args = JSON.parse(fn.arguments || "{}"); } catch {}

                // ── Intercept request_tools meta-tool ──
                // 2026-08-22: same de-lood defence as the JSON-text path:
                // if all requested categories are already loaded, refuse
                // and tell the model to use the real tool names.
                if (fn.name === "request_tools") {
                  const cats = Array.isArray(args?.categories) ? args.categories : [args?.categories].filter(Boolean);
                  const alreadyLoaded = cats.filter((c: string) => loadedCategories.has(c));
                  const notYetLoaded = cats.filter((c: string) => !loadedCategories.has(c));

                  if (loadedCategories.size > 0 && notYetLoaded.length === 0) {
                    requestToolsDupCount++;
                    // 2026-08-25: same fix as the JSON path — name the tools the
                    // model can call, otherwise it panics and re-asks in a loop.
                    const loadedToolNames = cats
                      .flatMap((c: string) => getToolNamesForCategory(c as any, openaiTools.map((t: any) => t.function?.name || t.name || "")))
                      .filter(Boolean)
                      .slice(0, 12);
                    const hint = loadedToolNames.length > 0
                      ? `Already loaded [${cats.join(", ")}]. Pick one of these tools and call it directly: ${loadedToolNames.join(", ")}${openaiTools.length > 12 ? " …" : ""}.`
                      : `Already loaded [${cats.join(", ")}]. Use the actual tool directly — do NOT call request_tools again.`;
                    safeEnqueue(controller, sendEvent(encoder, { type: "tool_call", tool: "request_tools", args }));
                    safeEnqueue(controller, sendEvent(encoder, { type: "tool_result", tool: "request_tools", result: hint }));
                    currentMessages.push({ role: "tool", tool_call_id: tc.id, content: hint });
                    if (requestToolsDupCount >= REQUEST_TOOLS_DUP_LIMIT) {
                      // 2026-08-25: same fix as the JSON-text path — set result and
                      // return so the outer execAttempt loop exits instead of
                      // rotating to yet another model.
                      loopState.phase = "done";
                      const reply = `I kept requesting the same tool categories without acting on them. The tools are loaded — just tell me directly what you want done (e.g. "list my unread emails" or "show me contacts in CRM").`;
                      safeEnqueue(controller, sendEvent(encoder, { type: "complete", reply, tokens: totalTokens, phases, model: finalSelected!.modelId, pool: finalSelected!.pool }));
                      safeClose(controller);
                      recordSuccess(finalSelected!, totalTokens);
                      return;
                    }
                    continue;
                  }

                  loadCategoryTools(notYetLoaded.length > 0 ? notYetLoaded : cats);
                  safeEnqueue(controller, sendEvent(encoder, { type: "tool_call", tool: "request_tools", args }));
                  safeEnqueue(controller, sendEvent(encoder, { type: "tool_result", tool: "request_tools", result: `Tools loaded for categories: ${notYetLoaded.length > 0 ? notYetLoaded.join(", ") : cats.join(", ")}. You can now use them.` }));
                  currentMessages.push({ role: "tool", tool_call_id: tc.id, content: `Tools loaded for categories: ${notYetLoaded.length > 0 ? notYetLoaded.join(", ") : cats.join(", ")}. You can now use them in your next response.` });
                  continue;
                }

                const phase: ToolPhase = { tool: fn.name, status: "running", args };
                phases.push(phase);
                safeEnqueue(controller, sendEvent(encoder, { type: "tool_call", tool: fn.name, args }));

                const handler = handlerMap.get(fn.name);
                if (!handler) {
                  phase.status = "error";
                  phase.result = `Unknown tool: ${fn.name}`;
                  safeEnqueue(controller, sendEvent(encoder, { type: "tool_result", tool: fn.name, error: `Unknown tool: ${fn.name}` }));
                  currentMessages.push({ role: "tool", tool_call_id: tc.id, content: `Error: Unknown tool "${fn.name}"` });
                  loopState.toolResults.push({ tool: fn.name, result: `Unknown tool`, success: false });
                  continue;
                }

                try {
                  const cached = isDuplicateCompletedShellStatus(fn.name, args);
                  let toolResult: string;
                  if (cached) {
                    toolResult = cached;
                    console.log(`[stream] skipping redundant shell_status for ${args.jobId}; using cached completed result`);
                  } else {
                    toolResult = await handler(args);
                    cacheCompletedShellStatus(fn.name, toolResult);
                  }
                  phase.status = "done";
                  phase.result = toolResult.slice(0, 200);
                  recentToolCalls.push(fn.name + ':' + JSON.stringify(args).slice(0, 100));
                  safeEnqueue(controller, sendEvent(encoder, { type: "tool_result", tool: fn.name, result: toolResult.slice(0, 2000) }));

                  // Stop polling background jobs in the same chain
                  if (shouldBreakOnBackgroundJobPoll(fn.name, toolResult, recentToolCalls)) {
                    let jobId: string | null = null;
                    try { jobId = JSON.parse(toolResult)?.jobId || null; } catch {}
                    const pauseMsg = jobId ? buildBackgroundJobPauseMessage(jobId, toolResult) : "Background job is still running. I'll check back automatically when it finishes.";
                    safeEnqueue(controller, sendEvent(encoder, { type: "complete", reply: pauseMsg, tokens: totalTokens, phases, model: finalSelected!.modelId, pool: finalSelected!.pool }));
                    safeClose(controller);
                    recordSuccess(finalSelected!, totalTokens);
                    return;
                  }

                  currentMessages.push({ role: "tool", tool_call_id: tc.id, content: toolResult.slice(0, 30000) });
                  loopState.toolResults.push({ tool: fn.name, result: toolResult, success: true });
                } catch (err: any) {
                  phase.status = "error";
                  phase.result = err.message;
                  safeEnqueue(controller, sendEvent(encoder, { type: "tool_result", tool: fn.name, error: err.message }));
                  currentMessages.push({ role: "tool", tool_call_id: tc.id, content: `Error: ${err.message}` });
                  loopState.toolResults.push({ tool: fn.name, result: err.message, success: false });
                }
              }
              
              // Advance step
              loopState.completedSteps.push(loopState.steps[loopState.currentStep] || `Step ${loopState.currentStep + 1}`);
              loopState.currentStep++;
              loopState.phase = (loopState.currentStep >= loopState.steps.length && loopState.steps.length > 0) ? "done" : "evaluating";
              continue; // Next turn with tool results
            } // end for loop

            // If we broke out with an error result
            if (result && result.reply) {
              const isRetriableError = result.reply.startsWith("Network error") || result.reply.startsWith("Error:");
              if (isRetriableError) {
                const statusMatch = result.reply.match(/Error:\s*(\d{3})/);
                const statusCode = statusMatch ? parseInt(statusMatch[1]) : 0;
                lastExecError = result.reply;
                result = null;
                continue; // Next attempt
              }
              // Non-retriable error or success — stream result
              safeEnqueue(controller, sendEvent(encoder, { type: "complete", reply: result.reply, tokens: result.tokens, phases }));
              safeClose(controller);
              return;
            }

          } catch (execErr: any) {
            lastExecError = execErr?.message || "execution failed";
            continue;
          }
        }

        // All attempts exhausted
        // (Per Rob's rule 2026-08-14: notify user, no auto-switching. The
        // user decides whether to switch routing, wait, or pick a different
        // model. The 5 attempts above all stay on the user's pinned account.)
        const accountLabel = ollamaAcc === "cloud" ? "Ollama Cloud Routing System"
          : ollamaAcc === "pro" ? "Ollama Pro Model Routing System"
          : ollamaAcc === "cloudflare" ? "the Cloudflare Workers AI Routing System"
          : ollamaAcc === "nvidia" ? "the NVIDIA NIM Routing System (Nemotron / Poolside / etc.)"
          : "the Ollama Routing System (Cloud + Pro)";
        const exhaustedMsg = mode === "machine"
          ? `Rate limited — switch to another model or routing pool, or wait until the limit resets. (${accountLabel} is currently rate-limited.)`
          : "Rate limited — switch to another model or routing pool, or wait until the limit resets. (All OmniRoute models are currently rate-limited.)";
        safeEnqueue(controller, sendEvent(encoder, { type: "error", error: exhaustedMsg }));
        safeEnqueue(controller, sendEvent(encoder, { type: "complete", reply: "", tokens: totalTokens, phases, model: finalSelected?.modelId, pool: finalSelected?.pool }));
        safeClose(controller);

      } catch (err: any) {
        try {
          // 2026-08-22: include stack trace in dev so we can pinpoint bugs
          // like the 'Cannot read properties of undefined (reading account)'
          // crash without rebuilding. Production drops the stack.
          const msg = process.env.NODE_ENV === "production"
            ? (err.message || "Unknown error")
            : `${err.message || "Unknown error"}\n${err.stack?.split("\n").slice(0, 8).join("\n") || ""}`;
          safeEnqueue(controller, sendEvent(encoder, { type: "error", error: msg }));
          safeClose(controller);
        } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
