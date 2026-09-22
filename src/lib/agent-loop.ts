// Deterministic Agent Loop — drives task completion without relying on the model to "decide" to continue.
//
// State machine: PLAN → ACT → OBSERVE → EVALUATE → (ACT | DONE)
//
// The key insight: the MODEL provides the steps and executes them, but the LOOP enforces continuation.
// The model can't stall because the loop never asks "would you like to continue?" — it just feeds the
// tool result back and says "execute the next step or return your final answer."

export interface LoopState {
  phase: "planning" | "acting" | "observing" | "evaluating" | "done" | "done_polling";
  turn: number;
  steps: string[];           // Steps the model planned
  currentStep: number;       // Which step we're on
  completedSteps: string[]; // Steps that are done
  toolResults: Array<{ tool: string; result: string; success: boolean }>;
  originalTask: string;     // What the user asked for
  totalTokens: number;
}

export interface DeterministicLoopOptions {
  maxTurns: number;
  maxTotalMs: number;
  timeoutMs: number;
  onPhase?: (phase: string, data?: any) => void;
  onToolCall?: (tool: string, args: any) => void;
  onToolResult?: (tool: string, result: string, success: boolean) => void;
  onComplete?: (reply: string, tokens: number, phases: any[]) => void;
  onError?: (error: string) => void;
}

/**
 * Build a system message that enforces the deterministic loop.
 * Instead of the model deciding when to stop, the loop tells the model what phase it's in
 * and what it needs to do next.
 */
export function buildLoopSystemMessage(state: LoopState): string {
  const stepInfo = state.steps.length > 0
    ? `\n\nPLANNED STEPS:\n${state.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}\nCurrent step: ${state.currentStep + 1} (${state.steps[state.currentStep] || "all done"})\nCompleted: ${state.completedSteps.length}/${state.steps.length}`
    : "";

  const toolHistory = state.toolResults.length > 0
    ? `\n\nTOOL RESULTS SO FAR:\n${state.toolResults.map((r, i) => `${i + 1}. ${r.tool} → ${r.success ? "OK" : "ERROR"}: ${r.result.slice(0, 200)}`).join("\n")}`
    : "";

  switch (state.phase) {
    case "planning":
      return `[SYSTEM LOOP — PLANNING PHASE]
The user asked: "${state.originalTask}"

Call the appropriate tool to start working on this task. Do NOT explain what you're going to do — just call the tool directly.
If the task doesn't need a tool, respond with a direct answer to the user.${stepInfo}${toolHistory}`;

    case "acting":
      return `[SYSTEM LOOP — EXECUTING STEP ${state.currentStep + 1}/${state.steps.length}
Task: "${state.originalTask}"
Current step: ${state.steps[state.currentStep] || "finalizing"}

Call the tool needed for this step. Do NOT explain what you're about to do — just call the tool.
If this step is already complete based on tool results, call the next step's tool.
If all steps are complete, respond with your final answer to the user.${stepInfo}${toolHistory}`;

    case "evaluating":
      return `[SYSTEM LOOP — EVALUATING
Task: "${state.originalTask}"

Tool call complete. If more steps remain, call the next tool. If all steps are done, give the user a final answer. Do not explain — act.${stepInfo}${toolHistory}`;

    case "done":
      return `[SYSTEM LOOP — COMPLETE
All planned steps are done. Give the user a complete, substantive answer based on the tool results.
Do not mention the loop, steps, or system messages. Just answer the user's original question: "${state.originalTask}"
${toolHistory}`;

    case "done_polling":
      return `[SYSTEM LOOP — STOP POLLING
You have polled the same background job (jobId: ${(state as any)._pollingJobId || "unknown"}) twice in a row and it's still running.
Do NOT call shell_status again in this response — you'll burn the output token budget before the job finishes.
Instead, give the user a one-line status update that:
1. Names the jobId so the user can track it.
2. Notes the duration so far if visible in the log tail.
3. Says you'll check back when it's done (the Operator or the user will re-prompt you).
The job is registered in /tmp/smyth-jobs/<jobId>.log. Keep your reply under 60 words. Do not call any more tools.
${toolHistory}`;

    default:
      return "";
  }
}

/**
 * Determine if the model's response is a final answer or a tool call.
 * This is the deterministic part — we don't rely on the model to "decide" to stop.
 */
export function classifyResponse(
  text: string,
  hasToolCalls: boolean,
  state: LoopState
): "tool_call" | "final_answer" | "incomplete" {
  if (hasToolCalls) return "tool_call";

  const trimmed = text.trim();

  // Empty response
  if (!trimmed) return "incomplete";

  // If the model is asking the user a question, that's a final answer — it needs user input
  if (/\?\s*$/.test(trimmed) || /\b(?:what|how|which|would|could|can you|do you|are you|shall)\b.*\?/i.test(trimmed)) {
    return "final_answer";
  }

  // Check if this is a transitional statement (not a real answer)
  const transitionalPatterns = [
    /\b(?:let me|let'?s|i'?ll|i will|i need to|going to|gonna|i'?m going to|time to|next i|then i|so i|now let me)\b/i,
    /\b(?:first|let'?s start|let'?s see|let'?s check|let'?s look)\b/i,
  ];
  const isTransitional = transitionalPatterns.some(p => p.test(trimmed)) && trimmed.length < 200;
  
  if (isTransitional && state.phase !== "done" && state.phase !== "done_polling") return "incomplete";

  // If we're in planning phase and the model gave a short response without tools,
  // it might be a greeting or small talk — treat as final answer
  if (state.phase === "planning" && trimmed.length < 150) {
    const hasAnswer = /\b(?:here'?s|here is|result|summary|found|completed|done|finished|your|you have|total|count)\b/i.test(trimmed);
    if (!hasAnswer) {
      // Short response in planning phase with no tools — likely a greeting or question
      // Only mark incomplete if we actually have steps to execute
      if (state.steps.length === 0) return "final_answer";
      return "incomplete";
    }
  }

  // If we're not in the "done" phase and the text is short without substance,
  // treat it as incomplete — the loop should continue
  if (state.phase !== "done" && state.phase !== "done_polling" && trimmed.length < 100) {
    const hasAnswer = /\b(?:here'?s|here is|result|summary|found|completed|done|finished|your|you have|total|count)\b/i.test(trimmed);
    if (!hasAnswer) return "incomplete";
  }

  return "final_answer";
}

/**
 * Create initial loop state from user message
 */
export function createLoopState(userMessage: string): LoopState {
  return {
    phase: "planning",
    turn: 0,
    steps: [],
    currentStep: 0,
    completedSteps: [],
    toolResults: [],
    originalTask: userMessage,
    totalTokens: 0,
  };
}