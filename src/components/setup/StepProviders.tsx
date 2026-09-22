"use client";

import { useMemo, useState } from "react";
import { ArrowRight, ArrowLeft } from "lucide-react";
import { PROVIDERS, getCategoryLabel, ProviderInfo } from "@/lib/model-config";
import { ProviderCard, ProviderFormState } from "./ProviderCard";

export type ProviderFormMap = Record<string, ProviderFormState>;

interface StepProvidersProps {
  initial: ProviderFormMap;
  onChange: (state: ProviderFormMap) => void;
  onNext: () => void;
  onBack: () => void;
}

export function StepProviders({ initial, onChange, onNext, onBack }: StepProvidersProps) {
  const [providers, setProviders] = useState<ProviderFormMap>(initial);
  const [activeProviderId, setActiveProviderId] = useState<string>("omniroute");
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message?: string } | null>>({});

  const categories = useMemo(() => {
    const map: Record<string, ProviderInfo[]> = {};
    for (const p of PROVIDERS) {
      const label = getCategoryLabel(p.category);
      map[label] = map[label] || [];
      map[label].push(p);
    }
    return map;
  }, []);

  const updateProvider = (id: string, state: ProviderFormState) => {
    const next = { ...providers, [id]: state };
    setProviders(next);
    onChange(next);
  };

  const activeProvider = PROVIDERS.find((p) => p.id === activeProviderId)!;

  const handleTest = async (id: string) => {
    const state = providers[id];
    setTesting((t) => ({ ...t, [id]: true }));
    try {
      const res = await fetch("/api/setup/test-model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: id, model: state.model, endpoint: state.endpoint, key: state.key }),
      });
      const data = await res.json();
      setTestResults((prev) => ({ ...prev, [id]: { ok: data.ok, message: data.error || (data.ok ? undefined : `HTTP ${data.status}`) } }));
    } catch (err: any) {
      setTestResults((prev) => ({ ...prev, [id]: { ok: false, message: err.message || "Request failed" } }));
    } finally {
      setTesting((t) => ({ ...t, [id]: false }));
    }
  };

  return (
    <div className="flex flex-col flex-1 px-6 py-8">
      <div className="mb-6">
        <h2 className="text-2xl font-heading font-bold">Choose Your AI Providers</h2>
        <p className="text-sm text-muted mt-1">
          OmniRoute Auto is enabled by default. Add keys for other providers when you are ready.
        </p>
      </div>

      <div className="flex flex-1 gap-6 overflow-hidden">
        <div className="w-64 shrink-0 overflow-y-auto border-r border-border pr-4">
          {Object.entries(categories).map(([category, items]) => (
            <div key={category} className="mb-5">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">{category}</h4>
              <div className="space-y-1">
                {items.map((p) => {
                  const enabled = providers[p.id]?.enabled ?? false;
                  return (
                    <button
                      key={p.id}
                      onClick={() => setActiveProviderId(p.id)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm transition flex items-center justify-between ${
                        activeProviderId === p.id ? "bg-accent/15 text-accent-bright border border-accent/30" : "hover:bg-surface"
                      }`}
                    >
                      <span>{p.name}</span>
                      {enabled && <span className="w-2 h-2 rounded-full bg-accent-bright" />}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          <ProviderCard
            key={activeProvider.id}
            provider={activeProvider}
            value={providers[activeProvider.id] ?? { enabled: activeProvider.id === "omniroute", model: activeProvider.models?.[0]?.id || "", endpoint: activeProvider.defaultEndpoint || "", key: "" }}
            onChange={(state) => updateProvider(activeProvider.id, state)}
            onTest={() => handleTest(activeProvider.id)}
            testing={testing[activeProvider.id]}
            testResult={testResults[activeProvider.id]}
          />
        </div>
      </div>

      <div className="flex justify-between pt-6 border-t border-border mt-6">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-border hover:bg-surface"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <button
          onClick={onNext}
          className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-accent hover:bg-accent/90 text-white font-semibold shadow-[0_0_20px_rgba(0,102,255,0.35)]"
        >
          Continue <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
