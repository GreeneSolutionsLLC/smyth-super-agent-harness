/**
 * Operator LLM caller.
 *
 * Sends a structured OperatorInput to an LLM and parses the JSON decision.
 *
 * Default model: oc/deepseek-v4-flash-free via OmniRoute — fast (1s), direct,
 * low token burn. The Operator only emits small JSON decisions; it doesn't
 * need a 24-provider combo router. Per-engagement model config is stored in
 * the engagement and passed here. Custom API endpoints (OpenAI, Anthropic,
 * etc.) are also supported.
 */

import { routeRequest, selectLocalFallback, type SelectedModel } from "@/lib/pool-router";
import { OMNIROUTE_MODELS } from "@/lib/ollama-models";
import { operatorSystemPrompt, operatorUserMessage } from "./prompts";
import type { OperatorInput, OperatorLlmConfig, WardenDecision } from "./types";

const MAX_TOKENS = 400;
const TEMPERATURE = 0.1;
const MAX_ATTEMPTS = 3;

/** Status codes that mean the model is dead (not slow / not rate-limited).
 *  On these, the retry loop should rotate to a different model rather than
 *  retrying the same one. Note: 429 is NOT here, because it gets its own
 *  treatment below — on 429 we DO rotate AND we add a backoff, since
 *  hammering the same rate-limited model just returns the same 429.
 *  Previous design (only 400/401/403/404 → rotate) caused 'All OmniRoute
 *  models are rate-limited' errors on every cold-start burst, since the
 *  caller kept retrying the same model the upstream was throttling.
 */
const NON_RETRYABLE_STATUS = new Set([400, 401, 403, 404]);

/** 429 is retryable in the sense that the request can succeed later, but
 *  not with the same model within the same tick — the upstream is actively
 *  rate-limiting that endpoint and a same-model retry just gets another 429.
 *  So on 429 we rotate AND we add a backoff so the quota window has time
 *  to reset before the next attempt hits the wire.
 */
const RATE_LIMIT_BACKOFF_MS = 800; // short backoff before retrying — gives the per-minute quota window a chance to reset

// Track last response status across attempts within one callOperator call so
// the next iteration knows whether to retry the same model or rotate.
let _lastStatus = 0;

/** Resolve endpoint + key from the per-engagement LLM config. Returns the
 *  full SelectedModel so the caller can pass accurate pool/account info to
 *  recordFailure / recordSuccess. */
async function resolveModel(llm: OperatorLlmConfig): Promise<SelectedModel | null> {
  // Custom API — use endpoint/key directly
  if (llm.pool === "custom" && llm.endpoint && llm.apiKey) {
    return {
      modelId: llm.model || "custom",
      pool: "machine", // arbitrary; recordFailure guards on pool === "custom"
      endpoint: llm.endpoint,
      apiKey: llm.apiKey,
    };
  }
  // Cross-pool fallback removed: maetryxx/OmniRoute is dead. If the preferred
  // machine pool is exhausted, try local Ollama as the only fallback (no rate
  // limits) instead of flipping back to a defunct OmniRoute endpoint.
  let model = await routeRequest(preferredPool as any, false, false);
  if (!model) {
    console.warn(`[operator] preferred pool ${preferredPool} exhausted, falling back to local Ollama`);
    model = await selectLocalFallback();
  }
  if (!model) return null;
  // Use the engagement's specific model if set, otherwise whatever the pool picked
  if (llm.model && preferredPool === "machine") {
    // For Ollama Cloud/Pro models, use the pool router's endpoint + key
    // but override the model ID to the user's selection.
    return { ...model, modelId: llm.model };
  }
  return model;
}

export async function callOperator(input: OperatorInput, llm?: OperatorLlmConfig): Promise<WardenDecision> {
  const system = operatorSystemPrompt(input);
  const user = operatorUserMessage(input);
  const config: OperatorLlmConfig = llm || { model: "gpt-oss:20b", pool: "machine" };

  let lastError: Error | null = null;
  // Track which model ID we've already tried so we don't keep retrying a
  // permanently-dead model. The pool router's health tracking will also
  // mark it banned, but the in-loop check protects us within one tick.
  const tried = new Set<string>();

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // If the previous attempt failed non-retryably OR was rate-limited,
    // drop the user's pinned model and let the pool router pick a fresh one.
    // For 429 specifically we ALSO backoff below before the next request,
    // since the same upstream is throttling us across all pinned models.
    const liveConfig = lastError && _lastStatus && (NON_RETRYABLE_STATUS.has(_lastStatus) || _lastStatus === 429)
      ? { ...config, model: undefined }
      : config;

    const resolved = await resolveModel(liveConfig);
    if (!resolved) {
      throw new Error(`Operator: no model available (pool=${liveConfig.pool}, model=${liveConfig.model})`);
    }
    if (tried.has(resolved.modelId)) {
      // We've already tried this model in this tick. Bail rather than loop.
      lastError = new Error(`Operator: model ${resolved.modelId} already tried this tick, no rotation possible`);
      console.warn(`[operator] model ${resolved.modelId} already tried, stopping`);
      break;
    }
    tried.add(resolved.modelId);

    // 429 backoff: if the previous attempt hit a rate limit, give the
    // quota window a moment to reset before sending the next request. The
    // pool-router's 2s cooldown already marks the model unhealthy for a
    // short window, so resolveModel above will pick a different one if
    // any are available. The backoff here is for when ALL models are
    // throttled (cold start scenario) — pausing before hammering the
    // upstream again.
    if (_lastStatus === 429) {
      console.log(`[operator] attempt ${attempt + 1}: previous response was 429, backing off ${RATE_LIMIT_BACKOFF_MS}ms before retry`);
      await new Promise((r) => setTimeout(r, RATE_LIMIT_BACKOFF_MS));
    }

    const messages = attempt === 0
      ? [
          { role: "system" as const, content: system },
          { role: "user" as const, content: user },
        ]
      : attempt === 1
        ? [
            { role: "system" as const, content: system },
            { role: "user" as const, content: user },
            { role: "assistant" as const, content: "(invalid JSON response — please retry)" },
            { role: "user" as const, content: "Your previous response was not valid JSON. Respond with exactly one JSON object matching the schema in the system prompt. No other text." },
          ]
        : [
            { role: "system" as const, content: system + "\n\nREMINDER: Output ONLY a JSON object. No prose, no markdown, no explanation." },
            { role: "user" as const, content: user },
          ];

    let res: Response;
    try {
      res = await fetch(resolved.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${resolved.apiKey}`,
        },
        body: JSON.stringify({
          model: resolved.modelId,
          messages,
          max_tokens: MAX_TOKENS,
          temperature: TEMPERATURE,
          stream: false,
          response_format: { type: "json_object" },
        }),
      });
    } catch (e: any) {
      lastError = new Error(`Operator: fetch error: ${e.message}`);
      _lastStatus = 0;
      console.warn(`[operator] attempt ${attempt + 1} fetch error, will retry: ${e.message}`);
      continue;
    }

    _lastStatus = res.status;
    if (!res.ok) {
      const text = await res.text();
      // Record failure in pool-router. IMPORTANT: use the resolved model's
      // actual pool/account, not config.pool — the pool router keys health
      // by (pool, modelId, account) and a wrong key means the dead model
      // keeps getting picked.
      if (resolved.pool !== "machine" || resolved.account) {
        // (custom API is also handled via resolved.pool/account above; this
        //  guard skips double-recording for plain machine-pool picks that
        //  didn't go through an account)
      }
      try {
        const { recordFailure } = await import("@/lib/pool-router");
        recordFailure(resolved as any, res.status, text.slice(0, 200));
      } catch {}
      lastError = new Error(`Operator: model ${resolved.modelId} returned ${res.status}: ${text.slice(0, 200)}`);
      if (res.status === 429) {
        // Record the 429 in pool-router's health (handled inside recordFailure)
        // and note it for the rotation logic on the NEXT iteration via the
        // override below. 429 is NOT in NON_RETRYABLE_STATUS, so we need a
        // dedicated branch to force rotation.
        console.warn(`[operator] attempt ${attempt + 1} got 429 (rate-limited) from ${resolved.modelId} — rotating to different model on next attempt`);
        _lastStatus = 429;
      } else if (NON_RETRYABLE_STATUS.has(res.status)) {
        console.warn(`[operator] attempt ${attempt + 1} got ${res.status} (non-retryable) from ${resolved.modelId} — will rotate to different model`);
      } else {
        console.warn(`[operator] attempt ${attempt + 1} got ${res.status} (retryable) from ${resolved.modelId}, will retry same model`);
      }
      continue;
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      lastError = new Error("Operator: empty response from model");
      _lastStatus = 0;
      console.warn(`[operator] attempt ${attempt + 1} empty response, will retry`);
      continue;
    }

    const parsed = tryParseDecision(content);
    if (parsed) {
      // Record success in pool-router (skip for custom APIs)
      try {
        const { recordSuccess } = await import("@/lib/pool-router");
        recordSuccess(resolved as any, data?.usage?.total_tokens || 0);
      } catch {}
      console.log(`[operator] decision: ${parsed.action} (model: ${resolved.modelId}${config.model && config.model !== resolved.modelId ? `, fallback from ${config.model}` : ""})`);
      parsed.model = resolved.modelId;
      return parsed;
    }

    lastError = new Error(`Operator: failed to parse JSON on attempt ${attempt + 1}`);
    _lastStatus = 0;
    console.warn(`[operator] attempt ${attempt + 1} parse failure, will retry`);
  }

  // Last-ditch fallback: try local Ollama directly (zero rate limits).
  // By this point the pool router has burned its budget, so we don't go
  // through it. If even local Ollama fails, throw — something is very wrong.
  console.warn(`[operator] pool exhausted (${tried.size} models tried), trying local Ollama`);
  const local = await selectLocalFallback();
  if (local && !tried.has(local.modelId)) {
    tried.add(local.modelId);
    try {
      const res = await fetch(local.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${local.apiKey}` },
        body: JSON.stringify({
          model: local.modelId,
          messages: [
            { role: "system", content: system + "\n\nREMINDER: Output ONLY a JSON object. No prose, no markdown, no explanation." },
            { role: "user", content: user },
          ],
          max_tokens: MAX_TOKENS,
          temperature: TEMPERATURE,
          stream: false,
          response_format: { type: "json_object" },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const content = data?.choices?.[0]?.message?.content;
        if (content) {
          const parsed = tryParseDecision(content);
          if (parsed) {
            console.log(`[operator] decision (local Ollama): ${parsed.action} (model: ${local.modelId})`);
            parsed.model = local.modelId;
            return parsed;
          }
        }
      } else {
        const text = await res.text();
        console.warn(`[operator] local Ollama fallback failed: ${res.status} ${text.slice(0, 100)}`);
      }
    } catch (e: any) {
      console.warn(`[operator] local Ollama fallback error: ${e.message}`);
    }
  }

  throw lastError || new Error("Operator: exhausted retries");
}

function tryParseDecision(content: string): WardenDecision | null {
  // Try direct parse
  try {
    const obj = JSON.parse(content);
    return validateDecision(obj);
  } catch {
    // Try to extract JSON from a larger blob (model sometimes adds prose)
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return validateDecision(JSON.parse(match[0]));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function validateDecision(obj: any): WardenDecision | null {
  if (!obj || typeof obj !== "object") return null;
  const action = obj.action;
  if (!["no_op", "continue", "answer_dialog", "notify_user", "abort"].includes(action)) {
    return null;
  }
  const reason = typeof obj.reason === "string" ? obj.reason : "";
  const confidence = typeof obj.confidence === "number"
    ? Math.max(0, Math.min(1, obj.confidence))
    : 0.5;

  const decision: WardenDecision = { action, reason, confidence };

  if (action === "continue") {
    const p = typeof obj.suggestedPrompt === "string" ? obj.suggestedPrompt : "";
    if (p.length === 0) return null; // required
    decision.suggestedPrompt = p.slice(0, 280);
  }
  if (action === "answer_dialog") {
    const r = typeof obj.dialogResponse === "string" ? obj.dialogResponse : "";
    if (r.length === 0) return null; // required
    decision.dialogResponse = r;
  }
  if (action === "notify_user") {
    const m = typeof obj.notifiedMessage === "string" ? obj.notifiedMessage : reason;
    decision.notifiedMessage = m.slice(0, 280);
  }
  if (action === "abort") {
    const r = typeof obj.abortReason === "string" ? obj.abortReason : reason;
    decision.abortReason = r.slice(0, 280);
  }

  return decision;
}
