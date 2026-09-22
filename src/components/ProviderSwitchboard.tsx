"use client";

/**
 * ProviderSwitchboard — shows every provider the user has a key for,
 * as clickable cards. Click one to route all chat through that provider.
 *
 * Replaces the single-provider CustomProviderPanel dropdown UX.
 * Reads the env to detect which providers have keys configured.
 */

import { useState, useEffect } from "react";
import { Check, Plus, ChevronDown, Key, Eye, EyeOff } from "lucide-react";
import {
  CUSTOM_PROVIDERS,
  getProviderById,
  getProviderKeyName,
  type CustomProviderId,
  type CustomModel,
} from "@/lib/custom-providers";

interface ConfiguredProvider {
  id: CustomProviderId;
  name: string;
  keyName: string;
  hasKey: boolean;
  models: CustomModel[];
}

interface Props {
  active: boolean;                        // is custom mode on?
  activeProvider: CustomProviderId | null; // which provider is active
  activeModel: string | null;              // which model is active
  onSelect: (provider: CustomProviderId, model: string) => void;
  onAddKey: (provider: CustomProviderId, key: string) => void;
  onDeactivate: () => void;
}

export default function ProviderSwitchboard({
  active,
  activeProvider,
  activeModel,
  onSelect,
  onAddKey,
  onDeactivate,
}: Props) {
  const [configuredProviders, setConfiguredProviders] = useState<ConfiguredProvider[]>([]);
  const [unconfiguredProviders, setUnconfiguredProviders] = useState<ConfiguredProvider[]>([]);
  const [expandedProvider, setExpandedProvider] = useState<CustomProviderId | null>(null);
  const [addingKeyFor, setAddingKeyFor] = useState<CustomProviderId | null>(null);
  const [newKey, setNewKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [selectedModels, setSelectedModels] = useState<Record<string, string>>({});

  // Detect which providers have keys from the env
  useEffect(() => {
    fetch("/api/env")
      .then((r) => r.json())
      .then((data) => {
        if (!data.env) return;
        const env = data.env;
        const configured: ConfiguredProvider[] = [];
        const unconfigured: ConfiguredProvider[] = [];

        for (const p of CUSTOM_PROVIDERS) {
          const keyName = getProviderKeyName(p.id);
          const hasKey = Boolean(env[keyName]?.trim());
          const entry: ConfiguredProvider = {
            id: p.id,
            name: p.name,
            keyName,
            hasKey,
            models: p.models,
          };
          if (hasKey) configured.push(entry);
          else unconfigured.push(entry);
        }
        setConfiguredProviders(configured);
        setUnconfiguredProviders(unconfigured);
      })
      .catch(() => {});
  }, []);

  function handleSelect(providerId: CustomProviderId) {
    const provider = getProviderById(providerId);
    if (!provider) return;
    const model = selectedModels[providerId] || provider.models[0]?.id || "";
    if (model) {
      onSelect(providerId, model);
    }
  }

  function handleModelChange(providerId: CustomProviderId, modelId: string) {
    setSelectedModels((prev) => ({ ...prev, [providerId]: modelId }));
    // If this provider is already active, update the model live
    if (activeProvider === providerId) {
      onSelect(providerId, modelId);
    }
  }

  function handleAddKey(providerId: CustomProviderId) {
    if (!newKey.trim()) return;
    onAddKey(providerId, newKey.trim());
    setNewKey("");
    setAddingKeyFor(null);
    // Refresh the configured list
    setTimeout(() => {
      fetch("/api/env")
        .then((r) => r.json())
        .then((data) => {
          if (!data.env) return;
          const env = data.env;
          const configured: ConfiguredProvider[] = [];
          const unconfigured: ConfiguredProvider[] = [];
          for (const p of CUSTOM_PROVIDERS) {
            const keyName = getProviderKeyName(p.id);
            const hasKey = Boolean(env[keyName]?.trim());
            const entry: ConfiguredProvider = { id: p.id, name: p.name, keyName, hasKey, models: p.models };
            if (hasKey) configured.push(entry);
            else unconfigured.push(entry);
          }
          setConfiguredProviders(configured);
          setUnconfiguredProviders(unconfigured);
        })
        .catch(() => {});
    }, 500);
  }

  return (
    <div className="flex flex-col gap-1.5">
      {/* Configured providers — clickable cards */}
      {configuredProviders.map((p) => {
        const isActive = active && activeProvider === p.id;
        const currentModel = activeProvider === p.id
          ? activeModel
          : selectedModels[p.id] || p.models[0]?.id || "";

        return (
          <div key={p.id}>
            <button
              onClick={() => handleSelect(p.id)}
              className={`flex items-center gap-2 w-full bg-none border-none text-muted px-3 py-1.5 rounded-md text-sm cursor-pointer hover:bg-muted-bg hover:text-foreground transition-colors ${
                isActive ? "bg-accent/10 text-accent" : ""
              }`}
            >
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: isActive ? "#22c55e" : "#525252" }} />
              <span className="truncate">{p.name}</span>
              {isActive && <span className="ml-auto text-accent text-xs">●</span>}
            </button>

            {/* Model picker — shown when this provider is active or expanded */}
            {(isActive || expandedProvider === p.id) && (
              <div className="px-3 mt-1 mb-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted">Model:</span>
                  <select
                    value={currentModel || ""}
                    onChange={(e) => handleModelChange(p.id, e.target.value)}
                    className="flex-1 appearance-none bg-muted-bg border border-border rounded-sm pl-2 pr-6 py-1 text-[11px] text-foreground hover:bg-accent/10 hover:border-accent/30 transition-colors cursor-pointer outline-none focus:border-accent"
                    style={{ fontFamily: "inherit" }}
                  >
                    {p.models.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Add provider */}
      {unconfiguredProviders.length > 0 && (
        <div className="mt-1">
          {addingKeyFor ? (
            <div className="px-3 py-2 rounded-md border border-border bg-surface space-y-2">
              <div className="text-xs text-muted font-medium">
                Add {getProviderById(addingKeyFor)?.name} key
              </div>
              <div className="relative">
                <input
                  type={showKey ? "text" : "password"}
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  placeholder="Paste API key..."
                  className="w-full border border-border bg-background rounded-sm px-2 py-1.5 pr-7 text-[11px] outline-none placeholder:text-muted/50 focus:border-accent font-mono"
                  onKeyDown={(e) => e.key === "Enter" && handleAddKey(addingKeyFor)}
                  autoFocus
                />
                <button
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted hover:text-foreground cursor-pointer bg-none border-none p-0.5"
                >
                  {showKey ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleAddKey(addingKeyFor)}
                  disabled={!newKey.trim()}
                  className="text-[11px] px-2.5 py-1 rounded border border-accent bg-accent/10 text-accent hover:bg-accent/20 cursor-pointer transition-colors disabled:opacity-40"
                >
                  Save
                </button>
                <button
                  onClick={() => { setAddingKeyFor(null); setNewKey(""); }}
                  className="text-[11px] px-2.5 py-1 rounded border border-border text-muted hover:text-foreground cursor-pointer transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => {
                // Cycle through unconfigured providers for quick-add
                if (unconfiguredProviders.length === 1) {
                  setAddingKeyFor(unconfiguredProviders[0].id);
                } else {
                  // Show a mini dropdown
                  setExpandedProvider(null);
                  // Toggle through: show a simple picker
                  const current = addingKeyFor;
                  setAddingKeyFor(current ? null : unconfiguredProviders[0].id);
                }
              }}
              className="flex items-center gap-2 w-full bg-none border-none text-muted px-3 py-1.5 rounded-md text-sm cursor-pointer hover:bg-muted-bg hover:text-foreground transition-colors"
            >
              <Plus size={14} />
              <span>Add provider</span>
            </button>
          )}

          {/* Unconfigured providers quick-add list */}
          {!addingKeyFor && unconfiguredProviders.length > 1 && (
            <div className="mt-1 ml-4 flex flex-col gap-0.5">
              {unconfiguredProviders.slice(0, 5).map((p) => (
                <button
                  key={p.id}
                  onClick={() => setAddingKeyFor(p.id)}
                  className="flex items-center gap-2 text-left text-muted px-2 py-1 rounded text-[11px] cursor-pointer hover:bg-muted-bg hover:text-foreground transition-colors bg-none border-none"
                >
                  <Key size={10} />
                  <span>{p.name}</span>
                </button>
              ))}
              {unconfiguredProviders.length > 5 && (
                <span className="text-[10px] text-muted px-2">
                  +{unconfiguredProviders.length - 5} more
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
