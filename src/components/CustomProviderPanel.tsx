"use client";

/**
 * CustomProviderPanel — UI for routing through user-supplied API keys
 *
 * Renders a section in the right panel with:
 *   - Provider dropdown (OpenAI, Anthropic, etc.)
 *   - Model dropdown (filtered by provider) — for OpenRouter + DeepInfra
 *     the list is fetched live; for others it's a curated catalog
 *   - "Type custom model ID" text input — escape hatch when the dropdown
 *     doesn't have the model the user wants
 *   - API key input (masked after entry, persisted to localStorage)
 *   - "Use this provider" / "Use routing pool" toggle
 *
 * When active (green dot), all chat traffic routes through the
 * selected provider with the user's API key.
 */

import { useState, useEffect } from "react";
import { ChevronDown, Key, Eye, EyeOff, ExternalLink, Check, AlertCircle, Pencil, RefreshCw } from "lucide-react";
import { CUSTOM_PROVIDERS, getProviderById, type CustomProviderId, type CustomModel } from "@/lib/custom-providers";

interface Props {
  active: boolean;
  provider: CustomProviderId | null;
  model: string | null;
  apiKey: string;
  apiKeySet: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
  onProviderChange: (id: CustomProviderId) => void;
  onModelChange: (modelId: string) => void;
  onApiKeyChange: (key: string) => void;
}

export default function CustomProviderPanel({
  active,
  provider,
  model,
  apiKey,
  apiKeySet,
  onActivate,
  onDeactivate,
  onProviderChange,
  onModelChange,
  onApiKeyChange,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [keyInputFocused, setKeyInputFocused] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [draftKey, setDraftKey] = useState("");
  const [customModelMode, setCustomModelMode] = useState(false);
  const [liveModels, setLiveModels] = useState<CustomModel[] | null>(null);
  const [liveModelsFetchedAt, setLiveModelsFetchedAt] = useState<string | null>(null);
  const [liveModelsLoading, setLiveModelsLoading] = useState(false);
  const [liveModelsError, setLiveModelsError] = useState<string | null>(null);

  const providerConfig = provider ? getProviderById(provider) : null;
  const isLiveProvider = providerConfig?.modelsSource === "live";

  // Compute the model list to show in the dropdown
  // If the provider supports live fetch and we have live data, use that
  // Otherwise use the curated list from the catalog
  const modelList: CustomModel[] = isLiveProvider && liveModels
    ? liveModels
    : providerConfig?.models ?? [];
  const selectedModelDef = modelList.find((m) => m.id === model);

  // Detect when the user has picked a model not in the current list (custom ID)
  useEffect(() => {
    if (model && providerConfig && !modelList.find((m) => m.id === model)) {
      setCustomModelMode(true);
    }
  }, [model, modelList, providerConfig]);

  // Fetch live models when a live provider is selected
  useEffect(() => {
    if (!isLiveProvider || !provider) {
      setLiveModels(null);
      return;
    }
    setLiveModelsLoading(true);
    setLiveModelsError(null);
    fetch(`/api/custom-providers/models?provider=${provider}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setLiveModelsError(data.error);
        } else {
          setLiveModels(data.models || []);
          setLiveModelsFetchedAt(data.fetchedAt);
        }
      })
      .catch((err) => setLiveModelsError(err?.message || "Failed to fetch"))
      .finally(() => setLiveModelsLoading(false));
  }, [provider, isLiveProvider]);

  const keyDisplayValue = keyInputFocused || showKey ? draftKey : (apiKeySet ? "••••••••••••" : "");

  useEffect(() => {
    if (keyInputFocused && apiKeySet && !draftKey) {
      setDraftKey(apiKey);
    }
  }, [keyInputFocused, apiKeySet, apiKey, draftKey]);

  useEffect(() => {
    if (providerConfig && model && !customModelMode && !modelList.find((m) => m.id === model)) {
      onModelChange(modelList[0]?.id ?? "");
    }
  }, [providerConfig, model, modelList, customModelMode, onModelChange]);

  const handleKeyBlur = () => {
    setKeyInputFocused(false);
    if (draftKey && draftKey !== apiKey) {
      onApiKeyChange(draftKey);
    }
  };

  const handleProviderChange = (id: CustomProviderId) => {
    setCustomModelMode(false);
    onProviderChange(id);
  };

  const handleModelChange = (id: string) => {
    if (id === "__custom__") {
      setCustomModelMode(true);
      onModelChange("");
    } else {
      setCustomModelMode(false);
      onModelChange(id);
    }
  };

  return (
    <div
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button, select, input, a")) return;
        if (!active) onActivate();
      }}
      className={`
        group cursor-pointer rounded-md border transition-all px-2.5 py-2
        ${active
          ? "border-accent bg-accent/10"
          : "border-zinc-700 bg-zinc-900/40 hover:border-zinc-500"
        }
      `}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <Key size={12} className={active ? "text-accent" : "text-muted"} />
          <span className={`text-[11.5px] font-medium ${active ? "text-accent" : "text-foreground"}`}>
            Custom Provider
          </span>
          {!apiKeySet && !active && <AlertCircle size={10} className="text-amber-400" />}
        </div>
        <div className="flex items-center gap-1">
          {active && <span className="text-accent text-xs">●</span>}
          {active && (
            <button
              onClick={(e) => { e.stopPropagation(); onDeactivate(); }}
              className="text-[9px] text-muted hover:text-foreground px-1.5 py-0.5 rounded hover:bg-zinc-700/50"
              title="Switch back to Routing Pool"
            >
              off
            </button>
          )}
          <button
            data-expand-toggle
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            className="p-0.5 hover:bg-zinc-700/50 rounded text-muted hover:text-foreground transition-colors"
            title={expanded ? "Hide details" : "Show details"}
          >
            <ChevronDown size={12} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {/* Collapsed view: status summary */}
      {!expanded && (
        <div className="text-[10px] text-muted font-mono flex items-center gap-1">
          {apiKeySet && provider
            ? <><span className="text-emerald-400">●</span> {providerConfig?.name} · {selectedModelDef?.name || (customModelMode ? `${model} (custom)` : "no model")}</>
            : <span className="text-amber-400">Click to configure</span>
          }
        </div>
      )}

      {/* Form (visible when expanded) */}
      {expanded && (
        <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
          {/* Provider dropdown */}
          <div>
            <div className="text-[9px] text-muted font-mono uppercase tracking-wide mb-0.5">Provider</div>
            <div className="relative">
              <select
                value={provider ?? ""}
                onChange={(e) => handleProviderChange(e.target.value as CustomProviderId)}
                className="w-full appearance-none bg-zinc-900/60 border border-zinc-700/60 hover:border-zinc-500 rounded-sm pl-1.5 pr-5 py-1 text-[10.5px] text-foreground font-mono cursor-pointer outline-none focus:border-accent"
              >
                <option value="">Select provider…</option>
                {CUSTOM_PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.modelsSource === "live" ? " (live)" : ""}
                  </option>
                ))}
              </select>
              <ChevronDown size={10} className="absolute right-1 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            </div>
          </div>

          {/* Model dropdown OR custom ID input */}
          {providerConfig && !customModelMode && (
            <div>
              <div className="text-[9px] text-muted font-mono uppercase tracking-wide mb-0.5 flex items-center gap-1">
                Model
                {isLiveProvider && (
                  <span className="text-emerald-400/80 normal-case tracking-normal">
                    · {liveModelsLoading ? "loading…" : liveModels ? `${modelList.length} live` : "offline"}
                  </span>
                )}
                {!isLiveProvider && (
                  <span className="text-muted/60 normal-case tracking-normal">· curated</span>
                )}
                {liveModelsError && (
                  <span className="text-amber-400 normal-case tracking-normal ml-auto">fallback</span>
                )}
                <button
                  onClick={() => { setCustomModelMode(true); onModelChange(""); }}
                  className="ml-auto text-muted/60 hover:text-accent inline-flex items-center gap-0.5"
                  title="Type a custom model ID"
                >
                  <Pencil size={8} /> custom
                </button>
              </div>
              <div className="relative">
                <select
                  value={model ?? ""}
                  onChange={(e) => handleModelChange(e.target.value)}
                  className="w-full appearance-none bg-zinc-900/60 border border-zinc-700/60 hover:border-zinc-500 rounded-sm pl-1.5 pr-5 py-1 text-[10.5px] text-foreground font-mono cursor-pointer outline-none focus:border-accent"
                >
                  <option value="">Select model…</option>
                  {modelList.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
                <ChevronDown size={10} className="absolute right-1 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
              </div>
              {selectedModelDef && (
                <div className="text-[9px] text-muted/60 font-mono mt-0.5">
                  {(selectedModelDef.contextWindow / 1000).toFixed(0)}k context · {(selectedModelDef.maxTokens / 1000).toFixed(0)}k max
                </div>
              )}
            </div>
          )}

          {providerConfig && customModelMode && (
            <div>
              <div className="text-[9px] text-muted font-mono uppercase tracking-wide mb-0.5 flex items-center gap-1">
                Custom Model ID
                <button
                  onClick={() => {
                    setCustomModelMode(false);
                    onModelChange(modelList[0]?.id ?? "");
                  }}
                  className="ml-auto text-muted/60 hover:text-accent normal-case tracking-normal"
                  title="Back to dropdown"
                >
                  ← dropdown
                </button>
              </div>
              <input
                type="text"
                value={model ?? ""}
                onChange={(e) => onModelChange(e.target.value)}
                placeholder="e.g. anthropic/claude-3-7-sonnet-20250219"
                onClick={(e) => e.stopPropagation()}
                className="w-full bg-zinc-900/60 border border-zinc-700/60 hover:border-zinc-500 rounded-sm pl-1.5 pr-2 py-1 text-[10.5px] text-foreground font-mono outline-none focus:border-accent"
              />
              <div className="text-[9px] text-muted/60 font-mono mt-0.5">
                Paste any model ID you have access to
              </div>
            </div>
          )}

          {/* API key input */}
          <div>
            <div className="text-[9px] text-muted font-mono uppercase tracking-wide mb-0.5 flex items-center gap-1">
              API Key
              {apiKeySet && <Check size={9} className="text-emerald-400" />}
              {providerConfig?.docsUrl && (
                <a
                  href={providerConfig.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="ml-auto text-muted/60 hover:text-accent inline-flex items-center gap-0.5"
                >
                  get <ExternalLink size={8} />
                </a>
              )}
            </div>
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={keyDisplayValue}
                placeholder={apiKeySet ? "••••••••••••" : "Paste your API key…"}
                onFocus={() => { setKeyInputFocused(true); setDraftKey(apiKey || ""); }}
                onChange={(e) => setDraftKey(e.target.value)}
                onBlur={handleKeyBlur}
                onClick={(e) => e.stopPropagation()}
                className="w-full bg-zinc-900/60 border border-zinc-700/60 hover:border-zinc-500 rounded-sm pl-1.5 pr-7 py-1 text-[10.5px] text-foreground font-mono outline-none focus:border-accent"
              />
              <button
                onClick={(e) => { e.stopPropagation(); setShowKey(!showKey); }}
                className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-muted hover:text-foreground"
                title={showKey ? "Hide key" : "Show key"}
              >
                {showKey ? <EyeOff size={10} /> : <Eye size={10} />}
              </button>
            </div>
            <div className="text-[9px] text-muted/60 font-mono mt-0.5 flex items-center gap-1">
              {apiKeySet ? "Saved on this device" : "Not set — chat will fail"}
              {providerConfig?.modelsVerifiedAt && (
                <span className="ml-auto">
                  dropdown: {providerConfig.modelsSource === "live" ? "live" : `curated ${providerConfig.modelsVerifiedAt}`}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
