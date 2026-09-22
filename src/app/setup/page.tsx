"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check, ChevronDown, Plus, X } from "lucide-react";
import { CUSTOM_PROVIDERS, getProviderKeyName, type CustomProviderId } from "@/lib/custom-providers";

/** Pool keys the user can optionally configure during setup. */
const POOL_KEYS = [
  { key: "OLLAMA_CLOUD_API_KEY", label: "Ollama Cloud", placeholder: "From ollama.com/settings/keys" },
  { key: "OLLAMA_PRO_API_KEY", label: "Ollama Pro", placeholder: "From ollama.com/settings/keys" },
  { key: "CLOUDFLARE_ACCOUNT_ID", label: "Cloudflare Account ID", placeholder: "From dash.cloudflare.com" },
  { key: "CLOUDFLARE_API_TOKEN", label: "Cloudflare API Token", placeholder: "From dash.cloudflare.com" },
  { key: "NVIDIA_API_KEY", label: "NVIDIA NIM API Key", placeholder: "From build.nvidia.com" },
] as const;

export default function SetupPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState<CustomProviderId | "">("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPools, setShowPools] = useState(false);
  const [poolValues, setPoolValues] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/setup/status")
      .then((r) => r.json())
      .then((data) => {
        if (data.setupComplete) {
          router.replace("/chat");
        } else {
          setLoading(false);
        }
      })
      .catch(() => setLoading(false));
  }, [router]);

  function setPoolValue(key: string, value: string) {
    setPoolValues((prev) => ({ ...prev, [key]: value }));
  }

  async function go() {
    if (!provider || !apiKey.trim()) {
      setError("Pick a provider and paste your key.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const keyName = getProviderKeyName(provider);

      // Collect pool keys into the byok step (it accepts arbitrary provider keys)
      const byokEnv: Record<string, string> = { [keyName]: apiKey.trim() };
      for (const pk of POOL_KEYS) {
        const v = poolValues[pk.key]?.trim();
        if (v) byokEnv[pk.key] = v;
      }

      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stepData: { byok: byokEnv },
          skippedSteps: [],
          legal: { terms: true, privacy: true, eula: true },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Setup failed.");
      router.replace("/chat");
    } catch (e: any) {
      setError(e.message || "Failed to save.");
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6 bg-grid">
      <div className="max-w-md w-full space-y-8 animate-fade-in-up">
        <div className="space-y-2 text-center">
          <h1 className="font-display text-3xl font-bold tracking-[0.1em]">
            <span className="text-accent">Smyth</span>
          </h1>
          <p className="text-muted">Connect your AI to get started.</p>
        </div>

        <div className="card p-6 space-y-5">
          {/* Provider picker */}
          <div>
            <label className="text-sm text-muted block mb-2">AI Provider</label>
            <div className="relative">
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value as CustomProviderId)}
                className="input w-full appearance-none pr-8 cursor-pointer"
              >
                <option value="">Pick your provider...</option>
                {CUSTOM_PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
            </div>
          </div>

          {/* API key */}
          <div>
            <label className="text-sm text-muted block mb-2">API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                provider
                  ? CUSTOM_PROVIDERS.find((p) => p.id === provider)?.apiKeyPrefix
                    ? `${CUSTOM_PROVIDERS.find((p) => p.id === provider)?.apiKeyPrefix}...`
                    : "Paste your key here"
                  : "Pick a provider first"
              }
              className="input w-full"
              disabled={!provider}
              onKeyDown={(e) => e.key === "Enter" && go()}
            />
            {provider && (
              <p className="text-[11px] text-muted mt-1.5">
                {CUSTOM_PROVIDERS.find((p) => p.id === provider)?.name} — your key stays on this machine.
              </p>
            )}
          </div>

          {/* Optional pool keys */}
          {!showPools ? (
            <button
              onClick={() => setShowPools(true)}
              className="flex items-center gap-1.5 text-[11px] text-muted hover:text-foreground cursor-pointer bg-none border-none transition-colors"
            >
              <Plus size={12} />
              Add pool keys (Ollama, Cloudflare, NVIDIA)
            </button>
          ) : (
            <div className="space-y-3 pt-2 border-t border-border">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted font-medium">Pool Keys (optional)</span>
                <button
                  onClick={() => setShowPools(false)}
                  className="text-muted hover:text-foreground cursor-pointer bg-none border-none"
                >
                  <X size={12} />
                </button>
              </div>
              {POOL_KEYS.map((pk) => (
                <div key={pk.key}>
                  <label className="text-[11px] text-muted block mb-1">{pk.label}</label>
                  <input
                    type="password"
                    value={poolValues[pk.key] ?? ""}
                    onChange={(e) => setPoolValue(pk.key, e.target.value)}
                    placeholder={pk.placeholder}
                    className="input w-full text-[11px]"
                  />
                </div>
              ))}
            </div>
          )}

          {/* Go */}
          <button
            onClick={go}
            disabled={saving || !provider || !apiKey.trim()}
            className="btn btn-primary w-full"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Check className="w-4 h-4" />
            )}
            {saving ? "Setting up..." : "Go"}
          </button>

          {error && <div className="text-error text-sm text-center">{error}</div>}
        </div>

        <p className="text-[11px] text-muted text-center">
          Ollama, OpenAI, Anthropic, DeepSeek, Moonshot, Groq, OpenRouter, and more.
          You can change this later in Settings.
        </p>
      </div>
    </div>
  );
}
