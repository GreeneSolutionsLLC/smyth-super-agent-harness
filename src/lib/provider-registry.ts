/**
 * Provider / feature registry for the Smyth setup wizard.
 *
 * Defines the 5 setup screens, the environment keys each one collects,
 * and the fallback behaviour when a screen is skipped.
 */

import { CUSTOM_PROVIDERS, getProviderKeyName } from "@/lib/custom-providers";

export type SetupStepId = "chat" | "parallel-web" | "replicate" | "zernio" | "swarm" | "byok" | "optional-services";

export interface EnvField {
  key: string;
  label: string;
  type: "text" | "password" | "url";
  placeholder?: string;
  defaultValue?: string;
}

export interface SetupStep {
  id: SetupStepId;
  title: string;
  shortTitle: string;
  description: string;
  fields: EnvField[];
  dependsOnKeys?: string[]; // keys that can satisfy this feature (e.g. swarm)
  fallback: {
    enabled: boolean;
    summary: string;
    warning?: string;
  };
  // Action step: no input fields; the UI renders an installer panel instead.
  action?: {
    kind: "docker-services";
  };
  // Advanced step: hide its fields behind an "Advanced" disclosure by default.
  // The common case is a moron-safe path; power users can expand.
  advanced?: boolean;
}

export const SETUP_STEPS: SetupStep[] = [
  {
    id: "byok",
    title: "Your AI Assistant",
    shortTitle: "AI",
    description:
      "Smyth works right away — no account needed. It comes with a free AI built in. If you already have your own AI account (like ChatGPT, Claude, or Gemini), you can connect it here. Otherwise, just tap Next and it'll work with the free option.",
    fields: CUSTOM_PROVIDERS.map((p) => ({
      key: getProviderKeyName(p.id),
      label: p.name,
      type: "password" as const,
      placeholder: p.apiKeyPrefix ? `${p.apiKeyPrefix}...` : undefined,
    })),
    advanced: true,
    fallback: {
      enabled: true,
      summary: "No problem — Smyth will use the free AI that's already built in.",
      warning: "You can connect your own AI account any time later in Settings.",
    },
  },
  {
    id: "chat",
    title: "Extra AI Options",
    shortTitle: "Extra AI",
    description:
      "For advanced users only — you can safely skip this. It's for connecting premium AI accounts you already pay for.",
    fields: [
      {
        key: "MOONSHOT_API_KEY",
        label: "Moonshot API Key",
        type: "password",
        placeholder: "sk-...",
      },
      {
        key: "OLLAMA_API_KEY",
        label: "Ollama API Key",
        type: "password",
        placeholder: "from ollama.com/settings/keys",
      },
      {
        key: "OLLAMA_BASE_URL",
        label: "Ollama Base URL",
        type: "url",
        defaultValue: "https://ollama.com/v1",
      },
      {
        key: "LOCAL_OLLAMA_BASE_URL",
        label: "Local Ollama Base URL",
        type: "url",
        defaultValue: "http://127.0.0.1:11434/v1",
      },
      {
        key: "LOCAL_OLLAMA_API_KEY",
        label: "Local Ollama API Key",
        type: "text",
        defaultValue: "ollama-local",
      },
    ],
    advanced: true,
    fallback: {
      enabled: true,
      summary: "Skipped — Smyth uses the free AI automatically.",
      warning: "Premium AI accounts won't be connected (not needed for most people).",
    },
  },
  {
    id: "parallel-web",
    title: "Web Search & Research",
    shortTitle: "Research",
    description:
      "Let your assistant search the internet and do research for you. Works with a free option — skip if you don't need it.",
    fields: [
      {
        key: "PARALLEL_API_KEY",
        label: "Parallel API Key",
        type: "password",
        placeholder: "pa-...",
      },
      {
        key: "PARALLEL_BASE_URL",
        label: "Parallel Base URL",
        type: "url",
        defaultValue: "https://api.parallel.ai",
      },
    ],
    advanced: true,
    fallback: {
      enabled: true,
      summary: "HyperResearch local fallback enabled",
      warning: "Cloud web search and deep research will not be available.",
    },
  },
  {
    id: "replicate",
    title: "Pictures & Videos",
    shortTitle: "Media",
    description:
      "Let your assistant create images and videos for your posts and projects. Works with a free option — skip if you don't need it.",
    fields: [
      {
        key: "REPLICATE_API_TOKEN",
        label: "Replicate Account Key (optional)",
        type: "password",
        placeholder: "r8_...",
      },
      {
        key: "REPLICATE_VERSION_ID",
        label: "Default Image Style (optional)",
        type: "text",
        placeholder: "leave blank",
      },
    ],
    advanced: true,
    fallback: {
      enabled: true,
      summary: "Free image option enabled.",
      warning: "Higher-quality image/video generation will be off.",
    },
  },
  {
    id: "zernio",
    title: "Social Media",
    shortTitle: "Social",
    description:
      "Let your assistant post to your social accounts (Instagram, Facebook, and more) on a schedule.",
    fields: [
      {
        key: "ZERNIO_API_KEY",
        label: "Social Media Account Key",
        type: "password",
      },
      {
        key: "ZERNIO_API_URL",
        label: "Social Media Link",
        type: "url",
        defaultValue: "https://api.zernio.com/v1",
      },
    ],
    advanced: true,
    fallback: {
      enabled: false,
      summary: "Social posting is off until you add it later.",
      warning: "You can turn this on any time in Settings.",
    },
  },
  {
    id: "swarm",
    title: "Team Mode",
    shortTitle: "Team",
    description:
      "For advanced users — run several AI helpers at once. You can safely skip this.",
    fields: [],
    dependsOnKeys: ["MOONSHOT_API_KEY", "OLLAMA_API_KEY"],
    fallback: {
      enabled: false,
      summary: "Team Mode is off.",
      warning: "Most people don't need this — skip it.",
    },
  },
  {
    id: "optional-services",
    title: "Your CRM & Email",
    shortTitle: "CRM & Email",
    description:
      "Set up the tools your assistant uses to remember your customers (CRM) and handle your email. Each can be turned on with one click.",
    fields: [],
    action: { kind: "docker-services" },
    fallback: {
      enabled: true,
      summary: "CRM & email are not set up yet — you can turn them on any time in Settings.",
      warning: "Your assistant won't manage your contacts or email until you set these up.",
    },
  },
];

export const SETUP_STEP_ORDER: SetupStepId[] = ["byok", "chat", "parallel-web", "replicate", "zernio", "swarm", "optional-services"];

export function getStepById(id: SetupStepId): SetupStep | undefined {
  return SETUP_STEPS.find((s) => s.id === id);
}

export function getStepFieldKeys(stepId: SetupStepId): string[] {
  return getStepById(stepId)?.fields.map((f) => f.key) ?? [];
}

export function allSetupStepIds(): SetupStepId[] {
  return SETUP_STEP_ORDER;
}
