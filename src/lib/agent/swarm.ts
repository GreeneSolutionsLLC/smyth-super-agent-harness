import { waitForSlot, type PoolId } from "@/lib/rate-governor";

/**
 * Agent Swarm — role-based multi-agent pipeline.
 *
 * Three sequential roles, each played by a different Kimi variant chosen for
 * fit. This is NOT three parallel Kimis all called with the same prompt —
 * that wastes tokens, races on tool calls, and gives 3 redundant answers.
 *
 *   ┌─────────────────────┐
 *   │ ORCHESTRATOR  K2.6  │  Pure reasoning. Produces a Plan: complexity +
 *   │ (no tools)          │  subtask list + per-subtask "needs_tools" flag.
 *   └──────────┬──────────┘
 *              │ Plan JSON
 *   ┌──────────▼──────────┐
 *   │ WORKER      K2.7-code│  Only role with tool access. Executes the
 *   │ (tools if needed)   │  plan's subtasks via the executor callback.
 *   └──────────┬──────────┘
 *              │ WorkerOutputs
 *   ┌──────────▼──────────┐
 *   │ SYNTHESIZER   K2.5  │  Assembles the final user-facing answer.
 *   │ (no tools, streamed)│  STREAMED to the chat bubble.
 *   └─────────────────────┘
 *
 * Design constraints (Rob, 2026-07-30):
 *   - User sees no model names; one answer in one bubble.
 *   - Scale-aware: simple prompts skip the worker entirely.
 *   - Errors hidden (matches OpenClaw UX): failures at any role degrade
 *     silently — last-resort OmniRoute fallback if everything fails.
 *   - Only ONE role touches tools. No parallel tool races.
 *
 * Roles & model fit:
 *   - Orchestrator  → kimi-k2.6  (flagship, planning/reasoning strength)
 *   - Worker        → kimi-k2.7-code (code-tuned, tool execution)
 *   - Synthesizer   → kimi-k2.5  (lighter, good at writing/assembly)
 */

import {
  getOllamaBaseUrl,
  getOllamaProApiKey,
} from "@/lib/runtime-keys";
import { routeRequest } from "@/lib/pool-router";

// ── Public types ──────────────────────────────────────────────────────────

export type SwarmToolDef = {
  type: "function";
  function: { name: string; description?: string; parameters: any };
};
export type SwarmToolExecutor = (
  toolName: string,
  args: Record<string, any>
) => Promise<string>;

interface SwarmExecuteOpts {
  prompt: string;
  history?: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  signal?: AbortSignal;
  /** Tools available to the Worker. Orchestrator + Synthesizer get none. */
  tools?: SwarmToolDef[];
  /** Executor for any tool calls the Worker emits. Required when tools set. */
  executeTool?: SwarmToolExecutor;
  /** Hard cap on tool rounds per Worker call. Default 3. */
  maxToolRounds?: number;
}

// ── Role → Model mapping ──────────────────────────────────────────────────

const ORCHESTRATOR_MODEL = "kimi-k2.6" as const;
const WORKER_MODEL       = "kimi-k2.7-code" as const;
const SYNTHESIZER_MODEL  = "kimi-k2.6" as const; // flagship matches orchestrator — K2.5 had refusal hallucinations on tool outputs

// ── Plan shape (orchestrator output) ──────────────────────────────────────

interface PlanSubtask {
  id: number;
  description: string;
  needs_tools: boolean;
}
interface Plan {
  complexity: "simple" | "medium" | "complex";
  subtasks: PlanSubtask[];
  rationale: string;
}

const PLAN_SYSTEM_PROMPT = `You are an orchestrator agent. Given a user request, decide:

1. complexity: "simple" | "medium" | "complex"
   - simple:     factual / conversational, no research or computation
   - medium:     needs 1-2 lookups or computations
   - complex:    needs multiple distinct subtasks, possibly tools
2. subtasks: an array of {id, description, needs_tools}
   - For simple questions, return an EMPTY array (synthesizer handles it).
   - Each subtask should be independently executable. Be granular.
3. rationale: one sentence explaining the plan.

Respond ONLY with valid JSON. No markdown fences, no commentary.
Example:
{"complexity":"medium","subtasks":[{"id":1,"description":"find current Bitcoin price","needs_tools":true},{"id":2,"description":"compute 5-day moving average","needs_tools":false}],"rationale":"Need a price lookup then a tiny computation."}`;

const WORKER_SYSTEM_PROMPT = `You are a worker agent. Execute the given subtasks using the available tools. Be precise, return concrete raw data. Do not editorialize. Output a JSON object with one field "outputs" — an array of {subtask_id, result: string}. If a tool fails, record the error string as the result. Pure JSON, no markdown.`;

const SYNTHESIZER_SYSTEM_PROMPT = `You are a synthesizer agent. You receive the user's original request plus the worker's outputs. Produce ONE clean, direct answer to the user. Do NOT mention tools, agents, models, or that synthesis occurred. Just produce the final answer. Match the user's tone and language.

Important: if the worker outputs contain the requested data (numbers, prices, weather, etc.), USE THAT DATA DIRECTLY in your answer — do not decline or refer the user elsewhere. The worker just fetched it; trust it.`;


// ── Internal Ollama helpers ───────────────────────────────────────────────

interface OllamaMsg {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  name?: string;
  tool_calls?: any[];
}

async function ollamaCompletion(
  model: string,
  messages: OllamaMsg[],
  opts: {
    tools?: SwarmToolDef[];
    signal?: AbortSignal;
    temperature?: number;
    max_tokens?: number;
  } = {}
): Promise<{ ok: true; message: any } | { ok: false; error: string }> {
  try {
    const [baseUrl, apiKey] = await Promise.all([
      getOllamaBaseUrl(),
      getOllamaProApiKey(),
    ]);
    const body: any = {
      model,
      messages,
      stream: false,
      temperature: opts.temperature ?? 0.4,
      reasoning_effort: "none",  // Kimi: output directly to content, not reasoning
    };
    if (opts.tools && opts.tools.length) body.tools = opts.tools;
    if (opts.max_tokens) body.max_tokens = opts.max_tokens;
    await waitForSlot("machine" as PoolId, model);
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    const message = data?.choices?.[0]?.message;
    if (!message) return { ok: false, error: "no message in response" };
    // Kimi models put output in reasoning instead of content — fall back.
    if (!message.content && message.reasoning) {
      message.content = message.reasoning;
      message.reasoning = undefined;
    }
    return { ok: true, message };
  } catch (e: any) {
    return {
      ok: false,
      error: e?.name === "AbortError" ? "aborted" : e?.message || "fetch failed",
    };
  }
}

async function ollamaStreaming(
  model: string,
  messages: OllamaMsg[],
  signal: AbortSignal | undefined,
  onToken: (delta: string) => void,
  opts: { temperature?: number; max_tokens?: number } = {}
): Promise<{ ok: boolean; error?: string }> {
  let res;
  try {
    const [baseUrl, apiKey] = await Promise.all([
      getOllamaBaseUrl(),
      getOllamaProApiKey(),
    ]);
    await waitForSlot("machine" as PoolId, model);
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        temperature: opts.temperature ?? 0.4,
        reasoning_effort: "none",  // Kimi: output directly to content
        ...(opts.max_tokens ? { max_tokens: opts.max_tokens } : {}),
      }),
      signal,
    });
  } catch (e: any) {
    return { ok: false, error: e?.message || "fetch failed" };
  }
  if (!res.ok || !res.body) return { ok: false, error: `HTTP ${res.status}` };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const payload = line.trim();
        if (!payload.startsWith("data:")) continue;
        const body = payload.slice(5).trim();
        if (body === "[DONE]") continue;
        try {
          const parsed = JSON.parse(body);
          const d = parsed?.choices?.[0]?.delta;
          const delta = d?.content || d?.reasoning;  // Kimi puts text in reasoning
          if (typeof delta === "string" && delta.length) onToken(delta);
        } catch {
          /* ignore heartbeats / malformed */
        }
      }
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "stream error" };
  } finally {
    try { reader.releaseLock(); } catch { /* noop */ }
  }
}

// ── JSON extraction (orchestrator output is text + JSON, may include junk) ──

function extractJsonObject(text: string): any | null {
  // Try strict: starts with { ends with }.
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  const candidate = text.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

// ── Orchestrator role ──────────────────────────────────────────────────────

async function runOrchestrator(
  prompt: string,
  history: SwarmExecuteOpts["history"],
  signal: AbortSignal | undefined
): Promise<{ ok: true; plan: Plan; planText: string } | { ok: false; error: string; raw: string }> {
  const messages: OllamaMsg[] = [
    { role: "system", content: PLAN_SYSTEM_PROMPT },
    ...(history || []).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: prompt },
  ];
  const r = await ollamaCompletion(ORCHESTRATOR_MODEL, messages, {
    signal,
    temperature: 0.2,
    max_tokens: 1500,
  });
  if (!r.ok) return { ok: false, error: r.error, raw: "" };
  const text = (r.message.content || "").trim();
  const json = extractJsonObject(text);
  if (!json || typeof json !== "object") {
    // Salvage: if it starts with `{` but is truncated, fill in safe defaults.
    if (text.startsWith("{") && !text.endsWith("}")) {
      const salvaged: Plan = {
        complexity: "medium",
        subtasks: [],
        rationale: "Orchestrator response was truncated; proceeding with a default plan.",
      };
      return { ok: true, plan: salvaged, planText: text };
    }
    return { ok: false, error: "plan parse failed", raw: text };
  }
  const plan: Plan = {
    complexity: ["simple", "medium", "complex"].includes(json.complexity) ? json.complexity : "medium",
    subtasks: Array.isArray(json.subtasks)
      ? json.subtasks
          .map((s: any, i: number) => ({
            id: typeof s?.id === "number" ? s.id : i + 1,
            description: String(s?.description || "").trim(),
            needs_tools: s?.needs_tools === true,
          }))
          .filter((s: PlanSubtask) => s.description.length > 0)
      : [],
    rationale: typeof json.rationale === "string" ? json.rationale : "",
  };
  return { ok: true, plan, planText: text };
}

// ── Worker role (only role with tools) ────────────────────────────────────

interface WorkerOutput {
  subtask_id: number;
  result: string;
}
interface WorkerOutputs {
  outputs: WorkerOutput[];
  raw: string;
  toolCallsMade: number;
}

async function runWorker(
  prompt: string,
  plan: Plan,
  history: SwarmExecuteOpts["history"],
  tools: SwarmToolDef[] | undefined,
  executeTool: SwarmToolExecutor | undefined,
  maxToolRounds: number,
  signal: AbortSignal | undefined,
  onProgress: (e: { type: "tool_call" | "tool_result"; tool: string; ok?: boolean }) => void
): Promise<{ ok: true; outputs: WorkerOutputs } | { ok: false; error: string }> {
  if (!plan.subtasks.length) {
    return { ok: true, outputs: { outputs: [], raw: "", toolCallsMade: 0 } };
  }
  if (!tools || !executeTool) {
    return { ok: false, error: "worker needs tools + executor but got none" };
  }

  // Tell worker the plan + original prompt. Worker executes and returns
  // JSON {outputs: [{subtask_id, result}, …]}.
  const workerPrompt = [
    `User request: ${prompt}`,
    ``,
    `Plan:`,
    JSON.stringify(plan, null, 2),
    ``,
    `Execute each subtask. Use tools when needed. Return raw outputs as JSON.`,
  ].join("\n");

  const messages: OllamaMsg[] = [
    { role: "system", content: WORKER_SYSTEM_PROMPT },
    ...(history || []).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: workerPrompt },
  ];

  let toolCallsMade = 0;
  for (let round = 0; round <= maxToolRounds; round++) {
    const r = await ollamaCompletion(WORKER_MODEL, messages, {
      tools,
      signal,
      temperature: 0.3,
    });
    if (!r.ok) return { ok: false, error: r.error };
    const msg = r.message;
    const toolCalls: any[] = msg?.tool_calls || [];

    if (!toolCalls.length) {
      // Final answer — try to parse as JSON {outputs: [...]}.
      const text = (msg.content || "").trim();
      const json = extractJsonObject(text);
      if (json && Array.isArray(json.outputs)) {
        const outputs = json.outputs
          .map((o: any) => ({
            subtask_id: typeof o?.subtask_id === "number" ? o.subtask_id : 0,
            result: String(o?.result ?? ""),
          }))
          .filter((o: WorkerOutput) => o.subtask_id > 0 || o.result.length > 0);
        return { ok: true, outputs: { outputs, raw: text, toolCallsMade } };
      }
      // Not JSON — wrap as a single-output response using the first subtask.
      return {
        ok: true,
        outputs: {
          outputs: [{ subtask_id: plan.subtasks[0]?.id ?? 1, result: text }],
          raw: text,
          toolCallsMade,
        },
      };
    }

    // Has tool_calls — execute and continue.
    messages.push(msg);
    for (const tc of toolCalls) {
      const fnName = tc?.function?.name || "";
      let args: any = {};
      try {
        args = typeof tc?.function?.arguments === "string"
          ? JSON.parse(tc.function.arguments)
          : (tc?.function?.arguments || {});
      } catch { /* ignore */ }
      onProgress({ type: "tool_call", tool: fnName });
      let result: string;
      try {
        result = await executeTool(fnName, args);
        onProgress({ type: "tool_result", tool: fnName, ok: true });
      } catch (e: any) {
        result = `error: ${e?.message || String(e)}`;
        onProgress({ type: "tool_result", tool: fnName, ok: false });
      }
      toolCallsMade++;
      messages.push({
        role: "tool",
        tool_call_id: tc?.id || `worker_${round}_${fnName}`,
        name: fnName,
        content: result,
      });
    }
  }
  return { ok: false, error: `worker exceeded ${maxToolRounds} tool rounds` };
}

// ── Synthesizer role (streams the final user-visible answer) ──────────────

async function runSynthesizer(
  prompt: string,
  plan: Plan,
  workerOutputs: WorkerOutputs | null,
  workerError: string | null,
  signal: AbortSignal | undefined,
  onToken: (delta: string) => void
): Promise<{ ok: boolean; error?: string }> {
  const blocks: string[] = [];
  blocks.push(`User request: ${prompt}`);
  blocks.push(`\nPlan: ${plan.rationale || "(no rationale)"} (${plan.complexity})`);
  if (plan.subtasks.length) {
    blocks.push("Subtasks:");
    for (const s of plan.subtasks) blocks.push(`  ${s.id}. ${s.description}${s.needs_tools ? " [tools]" : ""}`);
  }
  if (workerOutputs && workerOutputs.outputs.length) {
    blocks.push("\nWorker outputs:");
    for (const o of workerOutputs.outputs) {
      blocks.push(`[Subtask ${o.subtask_id}] ${o.result}`);
    }
  } else if (workerError) {
    blocks.push(`\n(Worker was unavailable: ${workerError} — synthesize from the plan and your own knowledge.)`);
  } else {
    blocks.push("\n(No worker phase needed for this request — synthesize directly.)");
  }

  return ollamaStreaming(
    SYNTHESIZER_MODEL,
    [
      { role: "system", content: SYNTHESIZER_SYSTEM_PROMPT },
      { role: "user", content: blocks.join("\n") },
    ],
    signal,
    onToken,
    { temperature: 0.1, max_tokens: 2048 }
  );
}

// ── Public entry: route handler calls this ────────────────────────────────

export async function runSwarm(
  opts: SwarmExecuteOpts,
  controller: ReadableStreamDefaultController<any>,
  encoder: TextEncoder
): Promise<{ reply: string; tokens: number; modelUsed: string }> {
  const send = (data: { type: string; [key: string]: any }) =>
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

  // ── Phase 1: Orchestrator ─────────────────────────────────────────────
  send({ type: "phase", phase: "thinking", swarm_role: "orchestrator", model: ORCHESTRATOR_MODEL });

  const planResult = await runOrchestrator(opts.prompt, opts.history, opts.signal);

  if (!planResult.ok) {
    // Orchestrator failed completely — skip the whole pipeline, fall back
    // straight to OmniRoute. User gets a normal-mode answer.
    send({ type: "swarm_meta", role: "orchestrator", error: planResult.error, raw_head: (planResult.raw || "").slice(0, 200) });
    return omniFallback(opts, send);
  }
  const { plan, planText } = planResult;

  // Track orchestrator's decision for debug visibility (silent in chat UI).
  send({
    type: "swarm_meta",
    role: "orchestrator",
    plan: { complexity: plan.complexity, subtaskCount: plan.subtasks.length, rationale: plan.rationale },
  });

  // ── Phase 2: Worker (scale-dependent) ─────────────────────────────────
  let workerOutputs: WorkerOutputs | null = null;
  let workerError: string | null = null;
  const tasksNeedTools = plan.subtasks.some((s) => s.needs_tools);
  const shouldRunWorker = plan.subtasks.length > 0;
  const workerEnabled = shouldRunWorker && tasksNeedTools;

  if (shouldRunWorker) {
    if (workerEnabled) {
      send({ type: "phase", phase: "thinking", swarm_role: "worker", model: WORKER_MODEL, plan: { complexity: plan.complexity, subtasks: plan.subtasks.length } });
      const wr = await runWorker(
        opts.prompt,
        plan,
        opts.history,
        opts.tools,
        opts.executeTool,
        opts.maxToolRounds ?? 3,
        opts.signal,
        (e) => send({ type: "swarm_meta", role: "worker", event: e })
      );
      if (wr.ok) {
        workerOutputs = wr.outputs;
        send({ type: "swarm_meta", role: "worker", done: true, toolCallsMade: wr.outputs.toolCallsMade, outputs: wr.outputs.outputs.length });
      } else {
        workerError = wr.error;
        send({ type: "swarm_meta", role: "worker", error: wr.error });
      }
    } else {
      // Orchestrator returned subtasks but none needed tools — skip worker
      // entirely (synthesizer can answer from the plan + general knowledge).
      send({ type: "swarm_meta", role: "worker", skipped: true, reason: "no subtasks need tools" });
    }
  } else {
    send({ type: "swarm_meta", role: "worker", skipped: true, reason: "orchestrator returned empty subtasks" });
  }

  // ── Phase 3: Synthesizer (the only thing the user actually sees) ─────
  send({ type: "phase", phase: "writing", swarm_role: "synthesizer", model: SYNTHESIZER_MODEL });

  let fullText = "";
  const sr = await runSynthesizer(
    opts.prompt,
    plan,
    workerOutputs,
    workerError,
    opts.signal,
    (delta) => {
      fullText += delta;
      send({ type: "token", delta });
    }
  );

  if (!sr.ok || !fullText.trim()) {
    // Synthesizer failed — give the user whatever we DO have.
    const fallback =
      (workerOutputs?.outputs || []).map((o) => o.result).join("\n\n").trim() ||
      plan.rationale ||
      "I couldn't generate a final answer right now.";
    send({ type: "token", delta: fallback });
    return {
      reply: fallback,
      tokens: estimateTokens(fallback),
      modelUsed: `swarm:orchestrator=${ORCHESTRATOR_MODEL}+fallback`,
    };
  }

  return {
    reply: fullText,
    tokens: estimateTokens(fullText),
    modelUsed: `swarm:orchestrator=${ORCHESTRATOR_MODEL},worker=${WORKER_MODEL}${workerOutputs ? `:${workerOutputs.outputs.length}out` : ":skipped"},synth=${SYNTHESIZER_MODEL}`,
  };
}

// ── OmniRoute fallback (last resort — same as before) ─────────────────────

async function omniFallback(
  opts: SwarmExecuteOpts,
  send: (data: { type: string; [key: string]: any }) => void
): Promise<{ reply: string; tokens: number; modelUsed: string }> {
  const choice = await routeRequest('auto', false, false);
  if (!choice) {
    const apology = "Swarm is unavailable across all routes. Try again shortly.";
    send({ type: "token", delta: apology });
    return { reply: apology, tokens: estimateTokens(apology), modelUsed: "swarm:unavailable" };
  }
  send({ type: "swarm_meta", fallback: "omni", model: choice.modelId });
  try {
    await waitForSlot(choice.pool as PoolId, choice.modelId);
    const res = await fetch(choice.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${choice.apiKey}` },
      body: JSON.stringify({
        model: choice.modelId,
        messages: [
          ...(opts.history || []),
          { role: "user", content: opts.prompt },
        ],
        stream: true,
        temperature: 0.5,
        reasoning_effort: "none",  // Kimi: output directly to content
      }),
      signal: opts.signal,
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let final = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          const payload = line.trim();
          if (!payload.startsWith("data:")) continue;
          const body = payload.slice(5).trim();
          if (body === "[DONE]") continue;
          try {
            const parsed = JSON.parse(body);
            const d = parsed?.choices?.[0]?.delta;
            const delta = d?.content || d?.reasoning;  // Kimi puts text in reasoning
            if (typeof delta === "string" && delta.length) {
              final += delta;
              send({ type: "token", delta });
            }
          } catch { /* ignore */ }
        }
      }
    } finally {
      try { reader.releaseLock(); } catch {}
    }
    return { reply: final, tokens: estimateTokens(final), modelUsed: `omni:${choice.modelId}` };
  } catch {
    const apology = "Swarm temporarily unavailable. Try again in a moment.";
    send({ type: "token", delta: apology });
    return { reply: apology, tokens: estimateTokens(apology), modelUsed: "swarm:failed" };
  }
}

function estimateTokens(text: string): number {
  // ≈ 4 chars per token — good enough for the UI counter.
  return Math.ceil(text.length / 4);
}
