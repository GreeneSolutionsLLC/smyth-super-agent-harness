/**
 * Pricing data for cost estimation
 *
 * Rough public list prices as of Aug 2025, USD per 1M tokens.
 * Not exact — actual rates depend on user's account, batch discounts,
 * and any negotiated pricing. Marked "estimated" in the UI so users
 * know these are ballpark figures.
 *
 * Ollama is intentionally null — $20/mo flat, no per-token costs.
 */

export interface Pricing {
  inputPerMillion: number;   // USD per 1M input tokens
  outputPerMillion: number;  // USD per 1M output tokens
}

export type PricingMap = Record<string, Pricing | null>;  // null = included in plan

// ── Anthropic ──
const ANTHROPIC: PricingMap = {
  "claude-sonnet-4-5-20250929":  { inputPerMillion: 3,    outputPerMillion: 15 },
  "claude-opus-4-5-20251101":    { inputPerMillion: 15,   outputPerMillion: 75 },
  "claude-haiku-4-5-20251001":   { inputPerMillion: 0.80, outputPerMillion: 4  },
  "claude-3-5-sonnet-20241022":  { inputPerMillion: 3,    outputPerMillion: 15 },
  "claude-3-5-haiku-20241022":   { inputPerMillion: 0.80, outputPerMillion: 4  },
};

// ── OpenAI ──
const OPENAI: PricingMap = {
  "gpt-5":       { inputPerMillion: 5,    outputPerMillion: 15   },
  "gpt-5-mini":  { inputPerMillion: 0.25, outputPerMillion: 2    },
  "gpt-5-nano":  { inputPerMillion: 0.05, outputPerMillion: 0.40 },
  "gpt-4o":      { inputPerMillion: 2.50, outputPerMillion: 10   },
  "gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.60 },
  "o3":         { inputPerMillion: 15,   outputPerMillion: 60   },
  "o3-mini":    { inputPerMillion: 1.10, outputPerMillion: 4.40 },
  "o4-mini":    { inputPerMillion: 1.10, outputPerMillion: 4.40 },
};

// ── Google ──
const GOOGLE: PricingMap = {
  "gemini-2.5-pro":      { inputPerMillion: 1.25, outputPerMillion: 5   },
  "gemini-2.5-flash":    { inputPerMillion: 0.30, outputPerMillion: 1.20 },
  "gemini-2.5-flash-lite": { inputPerMillion: 0.10, outputPerMillion: 0.40 },
};

// ── xAI ──
const XAI: PricingMap = {
  "grok-4-6": { inputPerMillion: 5, outputPerMillion: 15 },
  "grok-4":   { inputPerMillion: 5, outputPerMillion: 15 },
  "grok-3":   { inputPerMillion: 3, outputPerMillion: 12 },
};

// ── Mistral ──
const MISTRAL: PricingMap = {
  "mistral-large-latest":  { inputPerMillion: 2, outputPerMillion: 6 },
  "mistral-medium-latest": { inputPerMillion: 0.40, outputPerMillion: 2 },
  "mistral-small-latest":  { inputPerMillion: 0.20, outputPerMillion: 0.60 },
  "codestral-latest":     { inputPerMillion: 0.30, outputPerMillion: 0.90 },
};

// ── DeepSeek ──
const DEEPSEEK: PricingMap = {
  "deepseek-chat":     { inputPerMillion: 0.27, outputPerMillion: 1.10 },
  "deepseek-reasoner": { inputPerMillion: 0.55, outputPerMillion: 2.19 },
};

// ── Qwen ──
const QWEN: PricingMap = {
  "qwen3-max":     { inputPerMillion: 2,    outputPerMillion: 6   },
  "qwen-plus":     { inputPerMillion: 0.40, outputPerMillion: 1.20 },
  "qwen-turbo":    { inputPerMillion: 0.05, outputPerMillion: 0.20 },
  "qwen-flash":    { inputPerMillion: 0.0,  outputPerMillion: 0.0  },
  "qwen-long":     { inputPerMillion: 0.40, outputPerMillion: 1.20 },
  "qwen-coder-plus": { inputPerMillion: 0.40, outputPerMillion: 1.20 },
};

// ── Cohere ──
const COHERE: PricingMap = {
  "command-a-03-2025":     { inputPerMillion: 2.50, outputPerMillion: 10 },
  "command-r-plus-08-2024": { inputPerMillion: 2.50, outputPerMillion: 10 },
  "command-r-08-2024":    { inputPerMillion: 0.15, outputPerMillion: 0.60 },
};

// ── Groq ──
const GROQ: PricingMap = {
  "llama-3.3-70b-versatile": { inputPerMillion: 0.59, outputPerMillion: 0.79 },
  "llama-3.1-8b-instant":    { inputPerMillion: 0.05, outputPerMillion: 0.08 },
  "mixtral-8x7b-32768":     { inputPerMillion: 0.27, outputPerMillion: 0.27 },
};

// ── Perplexity ──
const PERPLEXITY: PricingMap = {
  "sonar-pro":     { inputPerMillion: 3, outputPerMillion: 15 },
  "sonar":         { inputPerMillion: 1, outputPerMillion: 1  },
};

// ── Z.ai / Zhipu ──
const ZHIPU: PricingMap = {
  "glm-4.6":  { inputPerMillion: 0.60, outputPerMillion: 2.20 },
  "glm-4.5":  { inputPerMillion: 0.50, outputPerMillion: 2   },
  "glm-4-plus":  { inputPerMillion: 7,   outputPerMillion: 7   },
  "glm-4-air":   { inputPerMillion: 0.20, outputPerMillion: 0.20 },
  "glm-4-flash": { inputPerMillion: 0,   outputPerMillion: 0   },
};

// ── Moonshot ──
const MOONSHOT: PricingMap = {
  "kimi-k2-0711-preview": { inputPerMillion: 0.60, outputPerMillion: 2.20 },
  "moonshot-v1-128k":     { inputPerMillion: 2,    outputPerMillion: 2    },
  "moonshot-v1-32k":      { inputPerMillion: 1,    outputPerMillion: 1    },
  "moonshot-v1-8k":       { inputPerMillion: 0.50, outputPerMillion: 0.50 },
};

// ── Aggregator pricing (rough averages) ──
const OPENROUTER_DEFAULT: Pricing | null = null;  // varies wildly per model — UI shows "varies"
const TOGETHER_DEFAULT: Pricing | null = null;
const FIREWORKS_DEFAULT: Pricing | null = null;
const DEEPINFRA_DEFAULT: Pricing | null = null;

const ALL_PRICING: Record<string, PricingMap> = {
  openai: OPENAI,
  anthropic: ANTHROPIC,
  google: GOOGLE,
  xai: XAI,
  mistral: MISTRAL,
  deepseek: DEEPSEEK,
  qwen: QWEN,
  cohere: COHERE,
  groq: GROQ,
  perplexity: PERPLEXITY,
  zhipu: ZHIPU,
  moonshot: MOONSHOT,
};

const DEFAULT_PRICING: Record<string, Pricing | null> = {
  openrouter: OPENROUTER_DEFAULT,
  together: TOGETHER_DEFAULT,
  fireworks: FIREWORKS_DEFAULT,
  deepinfra: DEEPINFRA_DEFAULT,
};

/**
 * Look up pricing for a (provider, model) pair.
 * Returns null if the model is "included in plan" (Ollama) or
 * pricing varies (aggregators).
 */
export function getPricing(provider: string, model: string): Pricing | null {
  if (provider === "ollama-cloud" || provider === "ollama-pro") {
    return null;  // included in $20/mo
  }
  if (provider === "ollama") {
    return null;
  }
  // Specific model lookup
  const providerMap = ALL_PRICING[provider];
  if (providerMap && model in providerMap) {
    return providerMap[model];
  }
  // Default for the provider
  if (provider in DEFAULT_PRICING) {
    return DEFAULT_PRICING[provider];
  }
  return null;
}

/**
 * Estimate the USD cost of a request given token counts and pricing.
 * Returns 0 if pricing is unknown / included in plan.
 */
export function estimateCost(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = getPricing(provider, model);
  if (!pricing) return 0;
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;
  return inputCost + outputCost;
}
