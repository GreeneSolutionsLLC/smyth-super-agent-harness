import { NextRequest, NextResponse } from "next/server";
export const maxDuration = 600;
import { execSync } from "child_process";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import { randomUUID } from "crypto";
import { join } from "path";
import { routeRequest, selectPool, recordSuccess, recordFailure, clearAllCooldowns, getTimeoutForModel, type RouteMode } from "@/lib/pool-router";
import { waitForSlot, recordRateLimitHit, type PoolId } from "@/lib/rate-governor";
import { compactContext, getContextStats, emergencyHardCompact, isContextLimitError } from "@/lib/context-compactor";
import { SMYTH_SYSTEM_PROMPT } from "@/lib/smyth-identity";
import { createToolDefinitions } from "@/lib/tools";
import { LOCAL_OLLAMA_MODELS } from "@/lib/ollama-models";
import { REQUEST_TOOLS_DEFINITION, getCategoryForTool } from "@/lib/tool-categories";
import { wrapWithEnhancements } from "@/lib/agent-loop-enhancements";
import { applyMiddlewareToHandlerMap } from "@/lib/middleware";
import { runSwarm } from "@/lib/agent/swarm";
import { getOmniRouteEndpoint, getOmniRouteApiKey, getLocalOllamaBaseUrl, getLocalOllamaApiKey } from "@/lib/runtime-keys";
import { getWorkspacePath } from "@/lib/env";
// Contextual tool filtering disabled — all tools always available

const ECHO_VISION_SIDECAR = "http://127.0.0.1:18790";

const VISION_CAPABLE = ["gpt-4o", "claude-3.5-sonnet", "gemini-2.0-pro", "qwen3.5", "minimax-m3", "kimi-k2.5", "kimi-k2.6", "gemini-3-flash", "qwen3-vl"];

function hasNativeVision(modelId: string): boolean {
  return VISION_CAPABLE.some((v) => modelId.toLowerCase().includes(v.toLowerCase()));
}

async function runEchoVision(buffer: Buffer): Promise<any> {
  // Preferred: sidecar HTTP daemon (pre-warmed, no per-call spawn).
  try {
    const res = await fetch(ECHO_VISION_SIDECAR, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: buffer as unknown as BodyInit,  // raw bytes — no base64 round-trip
    });
    if (res.ok) {
      const data = await res.json();
      if (data.status === "ok" && data.analysis) return data.analysis;
    }
  } catch {}
  // Fallback: run the CLI directly (cold spawn). Resolve echovision.py
  // relative to the repo/standalone root so it works without env config.
  const cliPath =
    process.env.ECHO_VISION_PATH ||
    join(process.cwd(), "echovision", "echovision.py");
  if (!existsSync(cliPath)) throw new Error(`echovision.py not found at ${cliPath}`);
  const tmpPath = `/tmp/smyth-vision-${randomUUID()}.png`;
  writeFileSync(tmpPath, buffer);
  try {
    const result = execSync(`python3 "${cliPath}" "${tmpPath}" --grid 16 --json --compact --no-svg --no-semantic --no-ascii`, {
      timeout: 30000,
      encoding: "utf8",
    });
    return JSON.parse(result);
  } finally {
    try { unlinkSync(tmpPath); } catch {}
  }
}

function buildEchoVisionContext(analysis: any): string {
  const stats = analysis.statistics || {};
  const colors = analysis.dominant_colors || [];
  const edges = analysis.edges || {};
  const contours = analysis.contours || {};
  const text = analysis.text || {};
  const creative = analysis.creative_vision || {};
  return [
    `[Echo Vision Analysis]`,
    `Dimensions: ${stats?.dimensions?.width || "?"}\u00d7${stats?.dimensions?.height || "?"}`,
    `Brightness: ${stats?.brightness?.label || "?"} (${stats?.brightness?.value || "?"})`,
    `Contrast: ${stats?.contrast?.label || "?"}`,
    `Orientation: ${stats?.orientation || "?"}`,
    "",
    `Dominant colors: ${colors.slice(0, 4).map((c: any) => c.name + " (" + c.hex + ") " + c.coverage_pct + "%").join(", ")}`,
    `Edge detail: ${edges?.interpretation || "?"} (${edges?.edge_density_pct || "?"}%)`,
    `Contours: ${contours?.total_shapes || 0} shapes detected`,
    `OCR text: "${(text?.full_text || "").slice(0, 200)}"`,
    "",
    `Lighting: ${creative?.lighting_mood?.mood || "?"}`,
    `Palette: ${creative?.color_harmony?.scheme || "?"}`,
    `Composition: ${creative?.composition?.rule_of_thirds || "?"}`,
    `Texture: ${creative?.texture?.character || "?"}`,
  ].join("\n");
}

// ── Native tool_calls execution ──

let { openaiTools, handlerMap } = await createToolDefinitions();

// Phase 2: Apply middleware to handlers (env-gated)
handlerMap = applyMiddlewareToHandlerMap(handlerMap);

interface ToolPhase {
  tool: string;
  status: "running" | "done" | "error";
  args?: Record<string, any>;
  result?: string;
}

async function executeNativeToolLoop(
  messages: any[],
  endpoint: string,
  apiKey: string,
  modelId: string,
  timeoutMs: number,
  maxTurns: number = 20,
  requestStart: number = 0,
  maxTotalMs: number = 240_000,
  onToolResult?: (toolName: string, result: string, messages: any[]) => void | Promise<void>,
  toolsRef?: { current: any[] },
  loadCategoryTools?: (categories: string[]) => void,
  pool?: string,
  account?: string,
): Promise<{ reply: string; tokens: number; phases: ToolPhase[] }> {
  let currentMessages = [...messages];
  const phases: ToolPhase[] = [];
  let totalTokens = 0;
  // No-progress guard: detect stuck tool loops (track tool name + args hash, not just name)
  const recentToolCalls: string[] = [];
  let phantomRetries = 0;

  for (let turn = 0; turn < maxTurns; turn++) {
    // No-progress guard: if the same tool+args repeated 3x in a row, break
    // (3 strikes — legitimate workflows sometimes call the same tool twice with same args)
    if (recentToolCalls.length >= 3 &&
        recentToolCalls[recentToolCalls.length - 1] === recentToolCalls[recentToolCalls.length - 2] &&
        recentToolCalls[recentToolCalls.length - 2] === recentToolCalls[recentToolCalls.length - 3]) {
      // Stuck loop — ask the model to summarize what it has so far
      currentMessages.push({ role: 'user', content: '[SYSTEM] You have already gathered information from tools. Based on the tool results above, give the user a complete answer now. Do not call any more tools.' });
      break;
    }

    // Hard time check: if we've exceeded the total request budget, stop the loop
    if (Date.now() - requestStart > maxTotalMs) {
      // Return whatever we have so far
      const lastAssistantMsg = currentMessages.filter(m => m.role === "assistant").pop();
      const lastContent = typeof lastAssistantMsg?.content === "string" ? lastAssistantMsg.content : "";
      if (lastContent.trim()) {
        return { reply: lastContent, tokens: totalTokens, phases };
      }
      return { reply: "I ran out of time processing this request. Please try again or simplify your question.", tokens: totalTokens, phases };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      // Rate-limit: enforce spacing between LLM calls to avoid 429s
      await waitForSlot(pool as PoolId, modelId, account, currentMessages);
      console.log(`[agent] Fetching ${endpoint} model=${modelId} msgs=${currentMessages.length} tools=${toolsRef?.current?.length || 0}`);
      // Use undici directly to bypass Next.js fetch patching which hangs on response bodies
      const { default: undici } = await import("undici");
      res = await undici.fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelId,
          messages: currentMessages,
          tools: toolsRef && toolsRef.current.length > 0 ? toolsRef.current : undefined,
          tool_choice: toolsRef && toolsRef.current.length > 0 ? "auto" : undefined,
          max_tokens: 8192,
          stream: false,
        }),
        signal: controller.signal,
      }) as unknown as Response;
    } catch (fetchErr: any) {
      clearTimeout(timeout);
      // Network error (DNS, connect refused, etc) — return so pool router can retry
      console.log(`[agent] Network error for ${modelId}: ${fetchErr?.message || "fetch failed"}`);
      return {
        reply: `Network error connecting to ${modelId}: ${fetchErr?.message || "fetch failed"}`,
        tokens: totalTokens,
        phases,
      };
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      const errText = await res.text();
      // 2026-09-09: feed 429s back into the rate governor so the next retry
      // waits, instead of immediately hammering the same exhausted route.
      if (res.status === 429) {
        const retryAfter = Number(res.headers?.get?.("retry-after") ?? NaN);
        recordRateLimitHit(pool as PoolId, modelId, account, Number.isFinite(retryAfter) ? retryAfter : undefined);
      }
      console.log(`[agent] ${modelId} returned ${res.status}: ${errText.slice(0, 300)}`);
      return { reply: `Error: ${res.status} — ${errText.slice(0, 200)}`, tokens: totalTokens, phases };
    }

    let data: any;
    try {
      const rawBody = await res.text();
      console.log(`[agent] ${modelId} response OK, body length=${rawBody.length}, preview=${rawBody.slice(0, 200)}`);
      data = JSON.parse(rawBody);
    } catch (jsonErr: any) {
      console.log(`[agent] ${modelId} JSON parse error: ${jsonErr.message}`);
      return { reply: `Error: JSON parse failed for ${modelId}: ${jsonErr.message}`, tokens: totalTokens, phases };
    }

    const msg = data?.choices?.[0]?.message;
    const usageTokens = data?.usage?.total_tokens || 0;
    totalTokens += usageTokens;

    // No native tool_calls → check for JSON-format tool calls in text (fallback for models without function calling)
    if (!msg?.tool_calls || msg.tool_calls.length === 0) {
      const text = msg?.content || "";
      // Strip <tool_call> wrappers that some models emit
      const stripped = text.replace(/<tool_call>\s*/g, "").replace(/\s*<\/tool_call>/g, "");
      // Find ALL sequential JSON tool blocks using bracket-counting (handles nested braces in content).
      // Supports two formats:
      //   1. {"tool":"name","args":{...}}
      //   2. {"name":"tool_name","arguments":{...}}  (OpenAI/Qwen style)
      const jsonBlocks: Array<{ tool: string; args: Record<string, any>; raw: string }> = [];

      // Bracket-counting JSON extractor: finds balanced {...} objects containing tool calls.
      // Handles: {"tool":"name","args":{...}}, {"name":"tool","arguments":{...}},
      // and {"plan":[...],"tool":"name","args":{...}} (combined plan+tool format)
      function extractJsonBlocks(s: string): void {
        let toolCount = 0;
        let i = 0;
        while (i < s.length && toolCount < 20) {
          // Look for any opening brace that might start a tool call
          if (s[i] !== '{') { i++; continue; }

          // Find the outermost balanced braces (with string tracking)
          let depth = 0;
          let inString = false;
          let escape = false;
          let start = i;
          let end = -1;

          for (let j = i; j < s.length; j++) {
            const ch = s[j];
            if (escape) { escape = false; continue; }
            if (ch === '\\' && inString) { escape = true; continue; }
            if (ch === '"') { inString = !inString; continue; }
            if (inString) continue;
            if (ch === '{') depth++;
            else if (ch === '}') {
              depth--;
              if (depth === 0) { end = j; break; }
            }
          }

          if (end === -1) {
            // Unbalanced braces — likely truncated by output token limit.
            // Check if this looks like a tool call and try to salvage it.
            const truncated = s.slice(start);
            const hasToolCall = /"tool"\s*:\s*"/.test(truncated) || /"name"\s*:\s*"/.test(truncated);
            if (hasToolCall && toolCount < 20) {
              const toolMatch = truncated.match(/"tool"\s*:\s*"([^"]+)"/);
              const nameMatch = truncated.match(/"name"\s*:\s*"([^"]+)"/);
              const toolName = toolMatch?.[1] || nameMatch?.[1];
              if (toolName && handlerMap.has(toolName)) {
                const args: Record<string, any> = {};
                // Extract path
                const pathMatch = truncated.match(/"path"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
                if (pathMatch) args.path = pathMatch[1].replace(/\\(.)/g, '$1');
                // Extract content: grab from "content":" to the END of the string (truncated, no closing }})
                const contentKey = truncated.indexOf('"content"');
                if (contentKey >= 0) {
                  const colonIdx = truncated.indexOf(':', contentKey);
                  const openQuote = truncated.indexOf('"', colonIdx + 1);
                  if (openQuote >= 0) {
                    // For truncated content, grab everything after the opening quote to end of string
                    let content = truncated.slice(openQuote + 1);
                    // Remove trailing partial JSON like "}} or "} or " that got cut
                    content = content.replace(/"+\}*$/, '');
                    content = content.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r').replace(/\\"/g, '"');
                    args.content = content;
                  }
                }
                // Extract command
                const cmdMatch = truncated.match(/"command"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
                if (cmdMatch) args.command = cmdMatch[1].replace(/\\(.)/g, '$1');
                if (Object.keys(args).length > 0) {
                  jsonBlocks.push({ tool: toolName, args, raw: truncated });
                  toolCount++;
                }
              }
            }
            i++; continue;
          }
          const rawJson = s.slice(start, end + 1);

          // Check if this JSON contains a tool call (anywhere in the object)
          const hasTool = /"tool"\s*:\s*"/.test(rawJson) || /"name"\s*:\s*"/.test(rawJson);
          if (!hasTool) { i = end + 1; continue; }

          // Try parsing
          let parsedTool: string | null = null;
          let parsedArgs: Record<string, any> = {};
          let success = false;

          // Attempt 1: direct JSON.parse
          try {
            const parsed = JSON.parse(rawJson);
            parsedTool = parsed.tool || parsed.name;
            parsedArgs = parsed.args || parsed.arguments || {};
            if (parsedTool && handlerMap.has(parsedTool)) {
              success = true;
            }
          } catch {}

          // Attempt 2: fix literal newlines/tabs
          if (!success) {
            try {
              const fixed = rawJson.replace(/\n/g, '\\\n').replace(/\r/g, '\\\r').replace(/\t/g, '\\\t');
              const parsed = JSON.parse(fixed);
              parsedTool = parsed.tool || parsed.name;
              parsedArgs = parsed.args || parsed.arguments || {};
              if (parsedTool && handlerMap.has(parsedTool)) {
                success = true;
              }
            } catch {}
          }

          // Attempt 3: regex extraction for unescaped quotes in content (e.g. <html lang="en">)
          if (!success) {
            const toolMatch = rawJson.match(/"tool"\s*:\s*"([^"]+)"/);
            const nameMatch = rawJson.match(/"name"\s*:\s*"([^"]+)"/);
            parsedTool = toolMatch?.[1] || nameMatch?.[1] || null;
            if (parsedTool && handlerMap.has(parsedTool)) {
              const args: Record<string, any> = {};
              // Extract path
              const pathMatch = rawJson.match(/"path"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
              if (pathMatch) args.path = pathMatch[1].replace(/\\(.)/g, '$1');
              // Extract content: grab from "content":" to the last "}} in the string
              const contentKey = rawJson.indexOf('"content"');
              if (contentKey >= 0) {
                const colonIdx = rawJson.indexOf(':', contentKey);
                const openQuote = rawJson.indexOf('"', colonIdx + 1);
                const closeIdx = rawJson.lastIndexOf('"}}');
                if (openQuote >= 0 && closeIdx > openQuote) {
                  let content = rawJson.slice(openQuote + 1, closeIdx);
                  content = content.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r').replace(/\\"/g, '"');
                  args.content = content;
                }
              }
              // Extract command (for shell tool)
              const cmdMatch = rawJson.match(/"command"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
              if (cmdMatch) args.command = cmdMatch[1].replace(/\\(.)/g, '$1');
              if (Object.keys(args).length > 0) {
                parsedArgs = args;
                success = true;
              }
            }
          }

          if (success && parsedTool) {
            jsonBlocks.push({ tool: parsedTool, args: parsedArgs, raw: rawJson });
            toolCount++;
            i = end + 1; // skip past this block
          } else {
            i++; // move forward and try again
          }
        }
      }
      extractJsonBlocks(stripped);

      // Empty text stall: model returned nothing — nudge it
      if (jsonBlocks.length === 0 && (!text || !text.trim()) && turn < maxTurns - 1 && phantomRetries < 4) {
        phantomRetries++;
        currentMessages.push({ role: "user", content: "[SYSTEM] Your last response was empty. Either call a tool to continue working, or give the user a complete answer based on the tool results above. Do not return empty text." });
        continue;
      }

      // Phantom tool call detection: model said "let me check/read/look" but emitted no tool calls
      if (jsonBlocks.length === 0 && turn < maxTurns - 1) {
        const phantomPatterns1 = /\b(?:let me|i'?ll|i will|i need to|i should|let'?s|going to|gonna|i'?m going to|now|just)\b.*\b(?:check|re-?read|re-?check|look|search|find|fetch|run|execute|open|scan|review|inspect|verify|confirm|get|pull|load|explore|investigate|re-?scan|re-?fetch)\b/i;
        const phantomPatterns2 = /\b(?:check|read|look|search|find|fetch|scan|review|inspect|verify|pull|load)\b(?:ing|s)\s+(?:your|the|my|this|that|inbox|mail|email|file|code|script|data|log|system|status|config)\b/i;
        if ((phantomPatterns1.test(text) || phantomPatterns2.test(text)) && phantomRetries < 4) {
          phantomRetries++;
          // Nudge the model to actually call the tool instead of just talking about it
          currentMessages.push({ role: "assistant", content: text });
          currentMessages.push({ role: "user", content: "[SYSTEM] You mentioned checking/looking/reading something but did not emit a tool call. Do it now — emit the actual tool call JSON to proceed. Do not explain, just call the tool." });
          continue;
        }
      }

      if (jsonBlocks.length > 0) {
        // Strip all tool JSON blocks from text to get the conversational parts
        let cleanText = text;
        for (const block of jsonBlocks) {
          cleanText = cleanText.replace(block.raw, "");
        }
        cleanText = cleanText.replace(/\n{3,}/g, "\n\n").trim();
        if (cleanText) {
          currentMessages.push({ role: "assistant", content: cleanText });
        }

        // Execute all tool calls
        for (const block of jsonBlocks) {
          // ── Intercept request_tools meta-tool ──
          // 2026-08-22: refuse duplicate category loads and force a final
          // answer after 3 dups. See stream/route.ts for the long version.
          if (block.tool === "request_tools") {
            const cats = Array.isArray(block.args?.categories) ? block.args.categories : [block.args?.categories].filter(Boolean);
            const alreadyLoaded = cats.filter((c: string) => loadedCategories?.has(c));
            const notYetLoaded = cats.filter((c: string) => !loadedCategories?.has(c));
            if (loadedCategories && loadedCategories.size > 0 && notYetLoaded.length === 0) {
              currentMessages.push({ role: "tool", tool_call_id: "request_tools_dup_" + phases.length, content: `Categories [${cats.join(", ")}] are already loaded. Call the actual tool directly — do NOT call request_tools again.` });
              phases.push({ tool: "request_tools", status: "done", args: block.args, result: `Categories [${cats.join(", ")}] already loaded` });
              // Mirror stream-route: hard-cap on dups to stop the credit burn.
              const dupKey = "request_tools_dup_count";
              const dupCount = ((currentMessages as any)._dupCount ||= 0) + 1;
              (currentMessages as any)._dupCount = dupCount;
              if (dupCount >= 3) {
                return { reply: `I called request_tools for [${cats.join(", ")}] ${dupCount} times in a row \u2014 the tools are already loaded. Stopping the loop; please re-prompt me with a concrete action.`, tokens: totalTokens, phases };
              }
              continue;
            }
            loadCategoryTools?.(notYetLoaded.length > 0 ? notYetLoaded : cats);
            currentMessages.push({ role: "tool", tool_call_id: "request_tools_" + phases.length, content: `Tools loaded for categories: ${(notYetLoaded.length > 0 ? notYetLoaded : cats).join(", ")}. You can now use them in your next response.` });
            continue; // skip normal execution
          }

          const phase: ToolPhase = { tool: block.tool, status: "running", args: block.args };
          phases.push(phase);
          try {
            const result = await handlerMap.get(block.tool)!(block.args);
            phase.status = "done";
            phase.result = result.slice(0, 200);
            recentToolCalls.push(block.tool + ':' + JSON.stringify(block.args).slice(0, 100));
            currentMessages.push({ role: "tool", tool_call_id: block.tool + "_" + phases.length, content: result.slice(0, 30000) });
            if (onToolResult) await onToolResult(block.tool, result, currentMessages);
          } catch (err: any) {
            phase.status = "error";
            phase.result = err.message;
            currentMessages.push({ role: "tool", tool_call_id: block.tool + "_" + phases.length, content: `Error: ${err.message}` });
          }
        }
        continue; // Go to next turn with tool results in context
      }
      // Post-tool continuation: if tools were executed and model returns text without a new tool call,
      // check if this is a transitional statement (not a real final answer) and nudge to continue
      if (phases.filter(p => p.status === "done").length > 0 && turn < maxTurns - 1 && phantomRetries < 3) {
        const isTransitional = /\b(?:let me|let'?s|i'?ll|i will|i need to|going to|now i|first|let'?s start|let'?s see|let'?s check|let'?s look|i'?m going to|time to|next i|then i|so i|now let me)\b/i.test(text) ||
                               (/^.{0,150}$/.test(text.trim()) && !/[.!?]\s*$/.test(text.trim()) && text.trim().length < 100);
        const hasSubstance = text.trim().length > 200 || /\b(?:here'?s|here is|result|summary|found|completed|done|finished|your|you have)\b/i.test(text);
        if (isTransitional && !hasSubstance) {
          phantomRetries++;
          currentMessages.push({ role: "assistant", content: text });
          currentMessages.push({ role: "user", content: "[SYSTEM] You started working on this task and used tools. Don't stop to explain what you're about to do — just do it. Call the next tool or give the user a complete answer. The task isn't done until you've actually completed it." });
          continue;
        }
      }

      // No JSON tool calls found — this is the final answer
      return { reply: text, tokens: totalTokens, phases };
    }

    // Add assistant message to history (has tool_calls)
    currentMessages.push(msg);

    // Execute each tool call
    for (const tc of msg.tool_calls) {
      const fn = tc.function;
      let args: Record<string, any> = {};
      try { args = JSON.parse(fn.arguments); } catch {}

      // ── Intercept request_tools meta-tool ──
      if (fn.name === "request_tools") {
        const cats = Array.isArray(args?.categories) ? args.categories : [args?.categories].filter(Boolean);
        loadCategoryTools?.(cats);
        currentMessages.push({ role: "tool", tool_call_id: tc.id, content: `Tools loaded for categories: ${cats.join(", ")}. You can now use them in your next response.` });
        continue; // skip normal execution
      }

      const phase: ToolPhase = { tool: fn.name, status: "running", args };
      phases.push(phase);

      const handler = handlerMap.get(fn.name);
      if (!handler) {
        phase.status = "error";
        phase.result = `Unknown tool: ${fn.name}`;
        currentMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: `Error: Unknown tool "${fn.name}"`,
        });
        continue;
      }

      try {
        const result = await handler(args);
        phase.status = "done";
        phase.result = result.startsWith("[DEEP_RESEARCH_RESULT]") ? result : result.slice(0, 200);
        recentToolCalls.push(fn.name + ':' + JSON.stringify(args).slice(0, 100));
        currentMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: result.slice(0, 30000),
        });
        if (onToolResult) await onToolResult(fn.name, result, currentMessages);
      } catch (err: any) {
        phase.status = "error";
        phase.result = err.message;
        currentMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: `Error: ${err.message}`,
        });
      }
    }

    // Native tool_calls executed — loop back so the model sees the results
    continue;
  }

  // Either max turns reached or no-progress guard broke the loop.
  // If we have tool results, do one final model call to get a proper summary.
  if (phases.filter(p => p.status === "done").length > 0) {
    try {
      const summaryRes = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: modelId,
          messages: currentMessages,
          max_tokens: 8192,
          stream: false,
          // No tools — force a text answer
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (summaryRes.ok) {
        const summaryData = await summaryRes.json();
        const summaryText = summaryData?.choices?.[0]?.message?.content || "";
        if (summaryText.trim()) {
          return { reply: summaryText, tokens: totalTokens + (summaryData?.usage?.total_tokens || 0), phases };
        }
      }
    } catch {}
  }

  // Max turns reached — be honest about incomplete work
  let fallbackReply = "I reached my turn limit while working on this. Here's what I completed:";
  const completedTools = phases
    .filter(p => p.status === "done")
    .map(p => `- ${p.tool}${p.result ? `: ${p.result.slice(0, 120)}` : ""}`);
  if (completedTools.length > 0) {
    fallbackReply += "\n" + completedTools.join("\n");
  } else {
    fallbackReply += " (no tools completed yet)";
  }
  fallbackReply += "\n\nI did not finish the full task. Tell me to continue and I'll pick up where I left off.";

  return {
    reply: fallbackReply,
    tokens: totalTokens,
    phases,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, sessionId, image, visionContext, routeMode, deepResearch, history, model } = body;

    if (!message && !image) {
      return NextResponse.json({ error: "Message or image is required" }, { status: 400 });
    }

    // ── Swarm dispatch (Orchestrator → Worker → Synthesizer) ─────────
    if (body.swarm === true && message) {
      let fullReply = "";
      const swarmResult = await runSwarm(
        {
          prompt: message,
          history: (history || []).map((m: any) => ({ role: m.role, content: m.content })),
        },
        // Pass a no-op controller — we only need the final reply
        {
          enqueue: () => {},
          close: () => {},
          error: () => {},
        } as any,
        new TextEncoder()
      );

      return NextResponse.json({
        reply: swarmResult.reply,
        imageUrl: null,
        sessionId: sessionId || "new",
        model: model || "kimi-k2.6",
        pool: "machine",
        deepResearch: false,
        usage: { total_tokens: swarmResult.tokens },
        toolPhases: [],
        compaction: null,
        swarm: { modelUsed: swarmResult.modelUsed },
      });
    }

    const systemPrompt = SMYTH_SYSTEM_PROMPT;

    // Build messages
    let finalMessages: any[] = [];

    if (image && image.base64) {
      if (message) finalMessages.push({ role: "user", content: message });
    } else if (visionContext) {
      if (visionContext.nativeVision && visionContext.image) {
        finalMessages.push({
          role: "user",
          content: [
            { type: "text", text: `[Image: ${visionContext.image.filename}]\n${message}` },
            { type: "image_url", image_url: { url: visionContext.image.dataUrl, detail: "high" } },
          ],
        });
      } else if (visionContext.analysis) {
        const ctx = buildEchoVisionContext(visionContext.analysis);
        finalMessages.push({ role: "user", content: [ctx, "", message].join("\n") });
      } else {
        finalMessages.push({ role: "user", content: message });
      }
    } else {
      finalMessages.push({ role: "user", content: message });
    }

    const mode: RouteMode = (routeMode as RouteMode) || "auto";

    // Select initial model from pool router — skip pre-flight ping
    // (the ping was causing false 502s and wasting rate limits on reasoning models)
    // ── Lazy Tool Loading ──
    // Only send the request_tools meta-tool initially (~60 tokens).
    // Real tools are injected on demand when the model calls request_tools.
    const metaToolOnly = [REQUEST_TOOLS_DEFINITION];
    // Use a mutable container so executeNativeToolLoop sees updates
    const toolsContainer = { current: metaToolOnly as any[] };
    let loadedCategories = new Set<string>();

    // Helper: load tools for given categories
    const loadCategoryTools = (categories: string[]) => {
      const newTools: any[] = [];
      for (const tool of openaiTools) {
        const toolName = tool.function?.name || tool.name;
        const cat = getCategoryForTool(toolName);
        if (cat && categories.includes(cat) && !loadedCategories.has(cat)) {
          newTools.push(tool);
        }
      }
      for (const cat of categories) loadedCategories.add(cat);
      if (newTools.length > 0) {
        toolsContainer.current = [...toolsContainer.current.filter((t: any) => t.function?.name !== "request_tools"), ...newTools];
        console.log(`[route] Loaded ${newTools.length} tools for categories: ${categories.join(", ")}`);
      }
    };

    // OmniRoute endpoint + key. User-picked model goes straight here, same
    // as OpenClaw. machine mode keeps using the pool router (Ollama Cloud).
    let finalSelected: any = null;
    const [omnirouteEndpoint, omnirouteKey] = await Promise.all([
      getOmniRouteEndpoint(),
      getOmniRouteApiKey(),
    ]);
    if (mode === "offline") {
      // Route to local Ollama — no cloud calls
      const localEndpoint = await getLocalOllamaBaseUrl();
      const localApiKey = await getLocalOllamaApiKey();
      const offlineModel = model && LOCAL_OLLAMA_MODELS.some(m => m.id === model) ? model : "lfm2.5";
      console.log(`[route] Offline mode → local Ollama, model: ${offlineModel}`);
      finalSelected = {
        modelId: offlineModel,
        pool: "local",
        endpoint: localEndpoint,
        apiKey: localApiKey,
      };
    } else if (mode === "machine") {
      finalSelected = await routeRequest(mode, false, !!(body?.image || visionContext));
      if (!finalSelected) {
        clearAllCooldowns();
        finalSelected = await routeRequest(mode, false, !!(body?.image || visionContext));
      }
    } else {
      // Auto mode: pool router still selects machine only. OmniRoute is dead.
      finalSelected = await routeRequest(mode, false, !!(body?.image || visionContext));
      if (!finalSelected) {
        clearAllCooldowns();
        // Engine keep-alive: if the first pick came up empty, try machine again
        // (cooldowns have been cleared). We no longer flip to maetryxx.
        console.log(`[keep-alive] machine pool empty after cooldown clear — retrying machine`);
        finalSelected = await routeRequest(mode, false, !!(body?.image || visionContext), "machine");
      }
      // maetryxx branch removed — OmniRoute is defunct.
    }
    if (!finalSelected) {
      const exhaustedMsg = mode === "machine" || mode === "auto"
        ? "Machine pool exhausted. Try again in a moment."
        : "Model pool unavailable. Wait a moment and try again.";
      return NextResponse.json({ error: exhaustedMsg }, { status: 503 });
    }

    // Handle image with vision-capable check.
    // `visionAnalysis` / `visionImageRef` are captured so we can return a lean
    // visionContext for follow-up questions (previously never returned, so
    // follow-ups about an image lost all context).
    let visionAnalysis: any = null;
    let visionImageRef: any = null;
    if (image && image.base64) {
      const nativeV = hasNativeVision(finalSelected.modelId);
      if (nativeV) {
        const mimeType = image.mimeType || "image/png";
        const dataUrl = `data:${mimeType};base64,${image.base64}`;
        visionImageRef = { filename: image.filename || "image.png", mimeType };
        finalMessages = [{
          role: "user",
          content: [
            { type: "text", text: message || `Analyze this image: ${image.filename || "image.png"}` },
            { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
          ],
        }];
      } else {
        try {
          const buffer = Buffer.from(image.base64, "base64");
          const analysis = await runEchoVision(buffer);
          visionAnalysis = analysis;
          const ctx = buildEchoVisionContext(analysis);
          finalMessages = [{
            role: "user",
            content: [ctx, "", message || "Describe what's in this image."].join("\n"),
          }];
        } catch (evErr: any) {
          finalMessages = [{
            role: "user",
            content: `[Image: ${image.filename || "image.png"}] Analysis failed. ${message || ""}`,
          }];
        }
      }
    }

    // When deep research mode is active, force tool usage to Parallel Web
    const drPreamble = deepResearch
      ? `\n\n=== DEEP RESEARCH MODE ===\nIMPORTANT: The user has enabled Deep Research mode. You MUST use the deep_research tool to gather real-time web data via Parallel Web API. Do NOT rely on your training data alone. Do NOT use write_file or read_file to simulate research — use deep_research to fetch current, live information from the web. The tool will return file paths to the saved results. After calling deep_research, present a brief summary and let the user know files are available for download. Do NOT chain additional tools after deep_research completes.`
      : "";

    const messages = [{ role: "system", content: systemPrompt + drPreamble }, ...finalMessages];

    // Compact context
    const compacted = await compactContext(messages);
    if (compacted.wasCompacted) {
      console.log(`[compactor] ${compacted.techniques.join(", ")}: ${compacted.originalTokens} → ${compacted.finalTokens} tokens`);
    }



    const timeoutMs = getTimeoutForModel(finalSelected.modelId, finalSelected.pool);
    const maxTotalMs = 1_080_000; // Hard cap: 18 minutes total for the entire request (was 9 min)

    // ── Execute with native tool_calls loop ──
    // Wrap in a try-catch so network failures retry the next model
    // Engine keep-alive: track which pool is active so a 429/503 on one pool
    // flips routing to the OTHER pool for the remainder of this request,
    // instead of re-rolling the same dice. (Compacted context is reused —
    // compactContext already ran above, so no extra cost.)
    let lastExecError = "";
    let activePool: PoolId | null = finalSelected?.pool ?? null;
    let result: { reply: string; tokens: number; phases: ToolPhase[] } | null = null;
    const requestStart = Date.now();

    for (let execAttempt = 0; execAttempt < 3 && !result; execAttempt++) {
      if (execAttempt > 0) {
        // Previous model failed — pick a different one, flipping pools if
        // the failure smells like rate-limiting on the current pool.
        recordFailure(finalSelected!, 0, lastExecError);

        const isThrottle = /429|503|408|rate\s*limit|too\s*many|timeout|ECONNRESET|ENOTFOUND/i.test(lastExecError);
        const preferPool: PoolId | null = isThrottle && activePool
          ? (activePool === "machine" ? null : "machine")
          : null;
        if (preferPool) {
          console.log(`[keep-alive] pool ${activePool} throttled — flipping to ${preferPool}`);
        }

        finalSelected = await routeRequest(mode, false, !!(body?.image || visionContext), preferPool);
        if (!finalSelected) {
          clearAllCooldowns();
          finalSelected = await routeRequest(mode, false, !!(body?.image || visionContext), preferPool);
        }
        if (!finalSelected) {
          return NextResponse.json(
            { error: "All model pools are currently unavailable (rate-limited or unauthorized). Wait a moment and try again." },
            { status: 503 }
          );
        }
        activePool = finalSelected.pool;
      }

      const maxTurns = 24;
      try {
        // Engine keep-alive: tell the model which pool it's running on so a
        // mid-request failover doesn't surprise it (sibling pool, same job).
        const attemptMessages = execAttempt === 0
          ? compacted.messages
          : compacted.messages.map((m: any, i: number) =>
              i === 0
                ? { ...m, content: m.content + `\n\n[system] This attempt is running on the Machine pool after a failover. Continue the current job normally.` }
                : m
            );
        const enhancedExecute = wrapWithEnhancements(executeNativeToolLoop);
        const enhancedResult = await enhancedExecute(
          attemptMessages,
          finalSelected.endpoint,
          finalSelected.apiKey,
          finalSelected.modelId,
          timeoutMs,
          maxTurns,
          requestStart,
          maxTotalMs,
          sessionId || "unknown",
          message || "",
          toolsContainer,
          loadCategoryTools,
          finalSelected.pool,
          finalSelected.account,
        );
        result = {
          reply: enhancedResult.reply,
          tokens: enhancedResult.tokens,
          phases: enhancedResult.phases,
        };

        // Telemetry logging for Phase 1 enhancements
        if (enhancedResult.telemetry.tokenjuiceSavings > 0) {
          console.log(`[tokenjuice] Saved ${enhancedResult.telemetry.tokenjuiceSavings}% on tool results`);
        }
        if (enhancedResult.telemetry.microcompactCleared > 0) {
          console.log(`[microcompact] Cleared ${enhancedResult.telemetry.microcompactCleared} old tool results, ${enhancedResult.telemetry.microcompactBytesSaved} bytes`);
        }
        if (enhancedResult.telemetry.episodicFile) {
          console.log(`[episodic] Archived to ${enhancedResult.telemetry.episodicFile}`);
        }
      } catch (execErr: any) {
        console.log(`[agent] Execution error for ${finalSelected?.modelId}: ${execErr?.message || "execution failed"}`);
        console.log(`[agent] Stack: ${execErr?.stack?.split("\n").slice(0, 3).join(" | ")}`);
        lastExecError = execErr?.message || "execution failed";
        continue; // Try next model
      }

      // Check if the result is an error message (network failure or HTTP error)
      // Retriable errors: network failures, 4xx/5xx responses from model providers
      console.log(`[agent] Result check: reply starts with "${result.reply.slice(0, 80)}"`, 'isError:', result.reply.startsWith('Error:') || result.reply.startsWith('Network error'));
      const isRetriableError = result.reply.startsWith("Network error") || result.reply.startsWith("Error:");
      if (isRetriableError) {
        // Extract status code for better failure tracking
        const statusMatch = result.reply.match(/Error:\s*(\d{3})/);
        const statusCode = statusMatch ? parseInt(statusMatch[1]) : 0;
        if (statusCode >= 400) {
          recordFailure(finalSelected!, statusCode, result.reply);
        }
        lastExecError = result.reply;
        result = null;
        // Try next model
      }
    }

    if (!result) {
      return NextResponse.json(
        { error: "All model pools are currently unavailable (rate-limited or unauthorized). Wait a moment and try again." },
        { status: 503 }
      );
    }

    recordSuccess(finalSelected!, result.tokens);

    // Clean up reply — strip tool JSON leaks, detect generated files
    let cleanReply = (result.reply || "").trim();
    try {
      cleanReply = cleanReply
        .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "")
        .replace(/\{\s*"tool"\s*:\s*"[^" ]+"\s*,\s*"args"\s*:\s*\{[\s\S]*?\}\s*\}/g, "")
        .replace(/\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*\{[\s\S]*?\}\s*\}/g, "")
        .replace(/\[Tool:?\s*\w+\][^\n]*\n?/g, "")
        .replace(/^Running.*now\.*\.*\n*/i, "")
        .replace(/<think>[\s\S]*?<\/think>/g, "")
        .replace(/Shell\([^)]*\)/g, "")
        // Strip broken markdown images with bare filenames (not valid URLs)
        .replace(/!\[([^\]]*)\]\((?!https?:\/\/|data:)[^)]+\)/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    } catch {}
    
    let imageUrl = null;
    let fileUrls: { name: string; ext: string }[] = [];
    if (result.phases) {
      for (const phase of result.phases) {
        if (phase.status === "done" && phase.result) {
          const resultText = phase.result || "";
          
          // Extract MEDIA: directives (OpenClaw inline rendering)
          const mediaMatch = resultText.match(/MEDIA:(\S+)/);
          if (mediaMatch) {
            const mediaPath = mediaMatch[1];
            const mediaName = mediaPath.split("/").pop() || "";
            if (/\.(png|jpg|jpeg|gif|webp|svg|mp4|mp3|wav)$/i.test(mediaName)) {
              imageUrl = "/api/workspace?file=" + encodeURIComponent(mediaName);
            }
          }
          
          // Extract workspace file URLs: /api/workspace?file=XXX
          const workspaceMatch = resultText.match(/\/api\/workspace\?file=([^&\s"]+)/);
          if (workspaceMatch) {
            const fileName = workspaceMatch[1];
            if (/\.(png|jpg|jpeg|gif|webp|svg|mp4|mp3|wav)$/i.test(decodeURIComponent(fileName))) {
              imageUrl = "/api/workspace?file=" + fileName;
            } else {
              fileUrls.push({ name: decodeURIComponent(fileName), ext: (decodeURIComponent(fileName).split(".").pop() || "").toLowerCase() });
            }
            continue;
          }
          
          // Extract Replicate delivery URLs: https://replicate.delivery/...
          const replicateMatch = resultText.match(/(https:\/\/replicate\.delivery\/[^\s"]+\.(?:png|jpg|jpeg|gif|webp|mp4))/i);
          if (replicateMatch) {
            imageUrl = replicateMatch[1];
            continue;
          }
          
          // Extract any direct image URL: https://.../*.png|jpg|jpeg|gif|webp
          const directImgMatch = resultText.match(/(https?:\/\/[^\s"]+\.(?:png|jpg|jpeg|gif|webp)(?:\?[^\s"]*)?)/i);
          if (directImgMatch) {
            imageUrl = directImgMatch[1];
            continue;
          }
          
          // Extract "Saved to /path/file.ext" or "Written N bytes to /path/file.ext"
          const savedMatch = resultText.match(/(?:saved|written|to)\s+(\S+\.[a-z]{2,4})/i);
          if (savedMatch) {
            const name = savedMatch[1].trim().split("/").pop() || "file";
            if (/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(name)) {
              imageUrl = "/api/workspace?file=" + encodeURIComponent(name);
            } else {
              fileUrls.push({ name, ext: (name.split(".").pop() || "txt").toLowerCase() });
            }
          }
        }
      }
    }
    
    // Append MEDIA: directive for OpenClaw inline rendering if we have a local image
    if (imageUrl && imageUrl.startsWith("/api/workspace?file=")) {
      const mediaFile = decodeURIComponent(imageUrl.replace("/api/workspace?file=", ""));
      cleanReply = cleanReply.trimEnd() + "\nMEDIA:" + getWorkspacePath() + "/workspace/" + mediaFile;
    }
    
    // Append tool results to the reply so the user can see what happened
    // Only include results that aren't already mentioned in the reply text
    if (result.phases && result.phases.length > 0) {
      const toolResultLines: string[] = [];
      for (const phase of result.phases) {
        if (phase.status === "done" && phase.result) {
          const result = phase.result;
          // Skip if this result is already in the reply
          if (cleanReply.includes(result.slice(0, 50))) continue;
          // Skip MEDIA: lines (already handled above)
          if (result.startsWith("MEDIA:")) continue;
          // Skip empty or error-only results
          if (!result.trim() || result.startsWith("[Error]")) continue;
          // Skip long results (>500 chars) — just note the tool ran
          if (result.length > 500) {
            toolResultLines.push(`[${phase.tool}] completed`);
          } else {
            toolResultLines.push(result);
          }
        }
      }
      if (toolResultLines.length > 0) {
        // Only append if the reply doesn't already contain the key info
        const summary = toolResultLines.join("\n");
        if (!cleanReply.includes(summary.slice(0, 80))) {
          cleanReply = cleanReply.trimEnd() + "\n" + summary;
        }
      }
    }
    
    return NextResponse.json({
      reply: cleanReply,
      imageUrl,
      fileUrls: fileUrls.length > 0 ? fileUrls : undefined,
      sessionId: sessionId || "new",
      model: finalSelected!.modelId,
      pool: finalSelected!.pool,
      deepResearch: deepResearch || false,
      usage: { total_tokens: result.tokens },
      toolPhases: result.phases,
      // Lean vision context for follow-up questions: EchoVision analysis text
      // (cheap, local) or a thumbnail-only dataUrl for native-vision models.
      // Full base64 is NOT persisted here — it bloats context/messages.
      visionContext: visionAnalysis ? { analysis: visionAnalysis } : visionImageRef ? { nativeVision: true, image: { filename: visionImageRef.filename, mimeType: visionImageRef.mimeType, dataUrl: `data:${visionImageRef.mimeType};base64,${image.base64.slice(0, 512)}` } } : undefined,
      compaction: compacted.wasCompacted ? {
        original: compacted.originalTokens,
        final: compacted.finalTokens,
        techniques: compacted.techniques,
        summarizer: compacted.summarizerUsed,
      } : null,
    });

  } catch (err) {
    console.error(`[agent/route] 500: ${err}`);
    if (err instanceof Error && err.stack) {
      console.error(`[agent/route] stack: ${err.stack.split('\n').slice(0,5).join('\n')}`);
    }
    return NextResponse.json(
      { error: "Failed to process request", details: String(err) },
      { status: 500 }
    );
  }
}
