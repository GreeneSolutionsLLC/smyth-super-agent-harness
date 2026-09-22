/**
 * Post-engagement review.
 *
 * One-shot LLM call after an engagement ends. Takes the decision log + final
 * outcome and produces a markdown review that Rob can read in the morning.
 * Output goes to `operator/reviews/{engagement-id}.md`.
 *
 * This is the actual self-improving loop: review the decisions, find patterns,
 * propose policy improvements. The improvements aren't auto-applied; Rob reviews
 * and accepts/rejects.
 */

import { callOperator } from "./llm";
import { getEngagement } from "./engagement-store";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import type { OperatorEngagement, WardenDecision } from "./types";

const REVIEW_SYSTEM_PROMPT = `You are a post-engagement reviewer for the Smyth Operator (Warden).

You will receive:
- The engagement policy (what the Operator was supposed to do)
- The full decision log (every tick + the action it took + the reason)
- The final status (stopped/aborted/completed + reason)

Your job: produce a markdown review with these sections:

1. **Summary** — 1-2 sentences. What was the engagement about, how did it end?
2. **Decision count by action** — table of how many times each action was taken.
3. **Notable decisions** — 2-5 decisions worth highlighting. Either because they
   were correct and important, or because they look wrong and worth investigating.
4. **Patterns** — any repeated signals that consistently led to the same action,
   or any decisions that look inconsistent.
5. **Policy improvement proposals** — concrete, testable suggestions for
   changes to the engagement policy that would have made the Operator better.
   Be specific. "Reduce X" is useless; "Reduce max_auto_continues from 5 to 3
   because no engagement used more than 2" is useful.
6. **Risks observed** — anything in the decision log that suggests the Operator
   might be miscalibrated (false positives, false negatives, edge cases).

Output ONLY the markdown. No preamble.`;

export async function reviewEngagement(engagementId: string): Promise<string | null> {
  const engagement = getEngagement(engagementId);
  if (!engagement) return null;

  const userMessage = buildReviewPrompt(engagement);

  let review: string;
  try {
    // 2026-09-04: OmniRoute is gone — use the active machine pool for reviews.
    const model = await import("@/lib/pool-router").then((m) => m.routeRequest("machine", false, false));
    if (!model) {
      console.warn(`[operator-review] no model available, skipping review for ${engagementId}`);
      return null;
    }
    const res = await fetch(model.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${model.apiKey}`,
      },
      body: JSON.stringify({
        model: model.modelId,
        messages: [
          { role: "system", content: REVIEW_SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        max_tokens: 2000,
        temperature: 0.2,
        stream: false,
      }),
    });
    if (!res.ok) {
      console.warn(`[operator-review] model returned ${res.status}`);
      return null;
    }
    const data = await res.json();
    review = data?.choices?.[0]?.message?.content || "";
  } catch (e: any) {
    console.error(`[operator-review] error: ${e.message}`);
    return null;
  }

  if (!review) return null;

  // Write to disk
  try {
    const dir = join(process.cwd(), "operator", "reviews");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${engagementId}.md`);
    const header = `# Engagement Review: ${engagementId}\n\n`;
    const meta = `**Started:** ${engagement.startedAt}\n**Ended:** ${new Date().toISOString()}\n**Status:** ${engagement.status}\n**Stop reason:** ${engagement.stopReason || "—"}\n**Total decisions:** ${engagement.decisions.length}\n**Auto-continues used:** ${engagement.autoContinuesUsed}/${engagement.policy.max_auto_continues}\n**Spend:** $${engagement.spendSoFarUsd.toFixed(3)} / $${engagement.policy.spend_cap_usd.toFixed(2)}\n\n---\n\n`;
    writeFileSync(path, header + meta + review, "utf-8");
    console.log(`[operator-review] wrote review to ${path}`);
    return path;
  } catch (e: any) {
    console.error(`[operator-review] write failed: ${e.message}`);
    return null;
  }
}

function buildReviewPrompt(engagement: OperatorEngagement): string {
  const decisionLog = engagement.decisions.length > 0
    ? engagement.decisions.map((d, i) => {
        const time = new Date(Date.now() - (engagement.decisions.length - i) * engagement.policy.tick_interval_ms).toISOString();
        let detail = `  - ${i + 1}. [${time}] action=${d.action} conf=${d.confidence.toFixed(2)}`;
        detail += ` | reason: ${d.reason}`;
        if (d.suggestedPrompt) detail += ` | prompt: "${d.suggestedPrompt.slice(0, 80)}"`;
        if (d.dialogResponse) detail += ` | response: "${d.dialogResponse}"`;
        return detail;
      }).join("\n")
    : "  (no decisions recorded)";

  const counts: Record<string, number> = {};
  for (const d of engagement.decisions) {
    counts[d.action] = (counts[d.action] || 0) + 1;
  }
  const countTable = Object.entries(counts)
    .map(([k, v]) => `  - ${k}: ${v}`)
    .join("\n") || "  (none)";

  return `## Engagement policy

\`\`\`yaml
${JSON.stringify(engagement.policy, null, 2)}
\`\`\`

## Engagement summary

- sessionId: ${engagement.sessionId}
- chatSessionId: ${engagement.chatSessionId}
- startedAt: ${engagement.startedAt}
- final status: ${engagement.status}
- stop reason: ${engagement.stopReason || "—"}
- total decisions: ${engagement.decisions.length}
- auto-continues used: ${engagement.autoContinuesUsed}/${engagement.policy.max_auto_continues}
- spend: $${engagement.spendSoFarUsd.toFixed(3)} / $${engagement.policy.spend_cap_usd.toFixed(2)}

## Decision count by action

${countTable}

## Full decision log

${decisionLog}

Write the review.`;
}
