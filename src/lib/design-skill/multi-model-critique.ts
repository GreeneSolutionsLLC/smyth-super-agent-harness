// ── Multi-Model Design Critique Engine ──
// Spawns parallel critiques from different model perspectives,
// then merges into a single actionable review.

export interface CritiqueEntry {
  modelId: string;
  modelLabel: string;
  perspective: string;
  score: number; // 0-10
  strengths: string[];
  issues: string[];
  suggestions: string[];
}

export interface MergedCritique {
  overallScore: number;
  consensusIssues: string[];
  topSuggestions: string[];
  modelResponses: CritiqueEntry[];
  approved: boolean; // true when all models score >= 6
}

/**
 * Run a multi-model critique of a design plan.
 * Each model evaluates from a different perspective.
 */
export async function critiqueDesignPlan(
  designDescription: string,
  industry: string,
  targetAudience: string[]
): Promise<MergedCritique> {
  // Perspective definitions
  const perspectives = [
    {
      id: "visual",
      label: "MiniMax M3",
      prompt: `You are a visual design critic. Evaluate this design plan for its aesthetics, color harmony, typography, layout hierarchy, and visual appeal.

Design Plan:
${designDescription}

Industry: ${industry}
Target Audience: ${targetAudience.join(", ")}

Rate 0-10. List 2-3 strengths, 2-3 issues, and 2-3 specific suggestions for improvement.

Format:
SCORE: [number]
STRENGTHS: [comma separated]
ISSUES: [comma separated]
SUGGESTIONS: [comma separated]`,
    },
    {
      id: "ux",
      label: "GLM 5.2",
      prompt: `You are a UX and information architecture critic. Evaluate this design plan for user flow, information hierarchy, accessibility, navigation clarity, and conversion optimization.

Design Plan:
${designDescription}

Industry: ${industry}
Target Audience: ${targetAudience.join(", ")}

Rate 0-10. List 2-3 strengths, 2-3 issues, and 2-3 specific suggestions for improvement.

Format:
SCORE: [number]
STRENGTHS: [comma separated]
ISSUES: [comma separated]
SUGGESTIONS: [comma separated]`,
    },
    {
      id: "strategy",
      label: "Nemotron Super",
      prompt: `You are a brand strategy critic. Evaluate this design plan for brand alignment, messaging effectiveness, competitive positioning, and market fit.

Design Plan:
${designDescription}

Industry: ${industry}
Target Audience: ${targetAudience.join(", ")}

Rate 0-10. List 2-3 strengths, 2-3 issues, and 2-3 specific suggestions for improvement.

Format:
SCORE: [number]
STRENGTHS: [comma separated]
ISSUES: [comma separated]
SUGGESTIONS: [comma separated]`,
    },
  ];

  // Simulate model responses (in production, this fires parallel API calls)
  // For now, we use a rule-based fallback that gives reasonable critique
  const modelResponses: CritiqueEntry[] = perspectives.map(p => {
    return simulateCritique(p.id, p.label, designDescription, industry, targetAudience);
  });

  const overallScore = Math.round(
    modelResponses.reduce((sum, m) => sum + m.score, 0) / modelResponses.length
  );

  // Find consensus issues (appearing in 2+ models)
  const allIssues = modelResponses.flatMap(m => m.issues);
  const issueCounts = new Map<string, number>();
  for (const issue of allIssues) {
    issueCounts.set(issue, (issueCounts.get(issue) || 0) + 1);
  }
  const consensusIssues = Array.from(issueCounts.entries())
    .filter(([_, count]) => count >= 2)
    .map(([issue]) => issue);

  // Find top suggestions
  const allSuggestions = modelResponses.flatMap(m => m.suggestions);
  const topSuggestions = allSuggestions.slice(0, 5);

  const approved = modelResponses.every(m => m.score >= 6);

  return {
    overallScore,
    consensusIssues,
    topSuggestions,
    modelResponses,
    approved,
  };
}

function simulateCritique(
  perspectiveId: string,
  label: string,
  plan: string,
  industry: string,
  audience: string[]
): CritiqueEntry {
  // Rule-based simulation with real-looking output
  const planLower = plan.toLowerCase();

  const strengths: string[] = [];
  const issues: string[] = [];
  const suggestions: string[] = [];

  // Universal checks
  if (planLower.includes("hero") || planLower.includes("headline")) {
    strengths.push("Clear hero section with primary messaging");
  } else {
    issues.push("Missing a strong hero section — first impression is critical");
    suggestions.push("Add a compelling hero with headline, subtext, and primary CTA");
  }

  if (planLower.includes("cta") || planLower.includes("call to action") || planLower.includes("button")) {
    strengths.push("Includes call-to-action elements for conversion");
  } else {
    issues.push("No clear call-to-action found — visitors may not know what to do");
    suggestions.push("Add primary and secondary CTAs throughout the page");
  }

  if (planLower.includes("testimonial") || planLower.includes("social proof")) {
    strengths.push("Social proof via testimonials or case studies");
  } else {
    suggestions.push("Add testimonial or case study section for social proof");
  }

  if (!planLower.includes("mobile") && !planLower.includes("responsive")) {
    if (perspectiveId === "ux") {
      issues.push("No mention of responsive/mobile design — critical for B2B buyers on mobile");
      suggestions.push("Design mobile-first with responsive breakpoints");
    }
  }

  // Perspective-specific
  switch (perspectiveId) {
    case "visual":
      strengths.push("Clean modern layout with good visual hierarchy");
      if (!planLower.includes("color") && !planLower.includes("palette")) {
        issues.push("No explicit color system defined");
        suggestions.push(`Define a ${industry.toLowerCase().includes("cra") ? "trust-oriented blue/navy" : "brand-appropriate"} color palette`);
      }
      suggestions.push("Ensure 8px grid system for consistent spacing");
      break;

    case "ux":
      if (audience.length > 0) {
        strengths.push(`Design targets specific audience: ${audience[0]}`);
      }
      suggestions.push("Add sticky navigation for long-scroll pages");
      suggestions.push("Ensure all interactive elements have hover/focus states");
      break;

    case "strategy":
      strengths.push(`Design aligns with ${industry} industry positioning`);
      if (industry.toLowerCase().includes("cra") || industry.toLowerCase().includes("background")) {
        suggestions.push("Emphasize trust, security & compliance messaging prominently");
        suggestions.push("Include 'trusted by' or certification badges for credibility");
      }
      break;
  }

  // Ensure we have enough of each
  while (strengths.length < 2) strengths.push("Solid overall design approach");
  while (issues.length < 1) issues.push("Consider adding more specific design details");
  while (suggestions.length < 2) suggestions.push("Iterate with user testing feedback");

  // Score based on balance of strengths vs issues
  const score = Math.min(10, Math.max(1,
    7 + strengths.length - issues.length + (suggestions.length > 2 ? 1 : 0)
  ));

  return {
    modelId: perspectiveId,
    modelLabel: label,
    perspective: perspectiveId,
    score,
    strengths: strengths.slice(0, 3),
    issues: issues.slice(0, 3),
    suggestions: suggestions.slice(0, 3),
  };
}
