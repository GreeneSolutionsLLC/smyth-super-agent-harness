"use client";

import { Eye, EyeOff, TestTube, Loader2 } from "lucide-react";
import { useState } from "react";
import { ProviderInfo, getDefaultModel, getEndpointForSelection, getKeyNameForProvider } from "@/lib/model-config";
import { ModelSelector } from "./ModelSelector";

export interface ProviderFormState {
  enabled: boolean;
  model: string;
  endpoint: string;
  key: string;
}

interface ProviderCardProps {
  provider: ProviderInfo;
  value: ProviderFormState;
  onChange: (state: ProviderFormState) => void;
  onTest: () => void;
  testing?: boolean;
  testResult?: { ok: boolean; message?: string } | null;
}

export function ProviderCard({ provider, value, onChange, onTest, testing, testResult }: ProviderCardProps) {
  const [showKey, setShowKey] = useState(false);
  const defaultModel = getDefaultModel(provider.id);
  const keyName = getKeyNameForProvider(provider.id);

  const update = (patch: Partial<ProviderFormState>) => {
    onChange({ ...value, ...patch });
  };

  const handleModelChange = (modelId: string) => {
    const endpoint = getEndpointForSelection(provider.id, modelId);
    update({ model: modelId, endpoint: endpoint || value.endpoint });
  };

  return (
    <div className="rounded-xl border border-border bg-surface/50 p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-base">{provider.name}</h3>
          <p className="text-sm text-muted mt-1">{provider.description}</p>
        </div>
        <label className="inline-flex items-center cursor-pointer shrink-0">
          <input
            type="checkbox"
            className="sr-only peer"
            checked={value.enabled}
            onChange={(e) => update({ enabled: e.target.checked })}
          />
          <div className="relative w-11 h-6 bg-muted-bg rounded-full peer-focus:ring-2 peer-focus:ring-accent peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent-bright" />
        </label>
      </div>

      {value.enabled && (
        <div className="space-y-4 pt-2 border-t border-border/50">
          <div>
            <label className="block text-xs text-muted mb-1">Model</label>
            <ModelSelector
              models={provider.models}
              value={value.model || defaultModel?.id || ""}
              onChange={handleModelChange}
            />
          </div>

          <div>
            <label className="block text-xs text-muted mb-1">Endpoint</label>
            <input
              type="text"
              value={value.endpoint}
              onChange={(e) => update({ endpoint: e.target.value })}
              className="w-full rounded-lg border border-border bg-surface px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              placeholder={provider.defaultEndpoint || "https://..."}
            />
          </div>

          {provider.requiresKey !== false && (
            <div>
              <label className="block text-xs text-muted mb-1">
                {keyName} {provider.keyHelp && <span className="text-muted/70">— {provider.keyHelp}</span>}
              </label>
              <div className="relative">
                <input
                  type={showKey ? "text" : "password"}
                  value={value.key}
                  onChange={(e) => update({ key: e.target.value })}
                  className="w-full rounded-lg border border-border bg-surface px-4 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                  placeholder={provider.requiresKey ? `Paste ${keyName}` : `Optional ${keyName}`}
                />
                <button
                  type="button"
                  onClick={() => setShowKey((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-foreground"
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onTest}
              disabled={testing}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:bg-surface text-sm disabled:opacity-50"
            >
              {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <TestTube className="w-4 h-4" />}
              Test
            </button>
            {testResult && (
              <span className={`text-sm ${testResult.ok ? "text-accent-bright" : "text-red-400"}`}>
                {testResult.ok ? "Reachable" : testResult.message || "Failed"}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
