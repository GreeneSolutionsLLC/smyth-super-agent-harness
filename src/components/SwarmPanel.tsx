"use client";

import { useState } from "react";
import {
  Workflow,
  Check,
  FlaskConical,
  MessageSquare,
  X,
  AlertCircle,
} from "lucide-react";

// ── Fleet Model Registry ──
// Each model knows which routing backend to use

interface FleetModel {
  id: string;
  label: string;
  tier: "heavy" | "specialist" | "infra" | "gateway";
  description: string;
  selected: boolean;
  free: boolean;
}

const FLEET_MODELS: FleetModel[] = [
  // ═══ Tier 1: Heavy Lifters ═══
  // Ollama Cloud
  {
    id: "ollama-cloud/glm-5.2",
    label: "GLM 5.2",
    tier: "heavy",
    description: "1M context, surgical precision — full-codebase reviews",
    selected: true,
    free: false,
  },
  // Ollama Pro
  {
    id: "ollama-pro/kimi-k2.7-code",
    label: "Kimmy K27",
    tier: "heavy",
    description: "Code-optimized, strong reasoning — coding & debugging",
    selected: true,
    free: false,
  },
  {
    id: "ollama-pro/minimax-m3",
    label: "Max M3",
    tier: "heavy",
    description: "Creative + analytical — UX, content, strategy, 1M ctx",
    selected: true,
    free: false,
  },
  // OmniRoute free
  {
    id: "omniroute/oc/deepseek-v4-flash-free",
    label: "DeepSeek V4",
    tier: "heavy",
    description: "Fast, free, capable — default go-to (Maetryxx)",
    selected: true,
    free: true,
  },
  {
    id: "omniroute/oc/minimax-m3-free",
    label: "Max M3 (Free)",
    tier: "heavy",
    description: "MiniMax M3 free tier via Maetryxx",
    selected: false,
    free: true,
  },
  {
    id: "omniroute/oc/nemotron-3-super-free",
    label: "Nemotron Free",
    tier: "heavy",
    description: "Nemotron 3 Super free tier via Maetryxx",
    selected: false,
    free: true,
  },

  // ═══ Tier 2: Specialists ═══
  {
    id: "ollama-cloud/nemotron-3-super",
    label: "Nemotron Super",
    tier: "specialist",
    description: "Deep reasoning, analytical rigor — research & review",
    selected: false,
    free: false,
  },
  {
    id: "ollama-pro/minimax-m2.7",
    label: "Mini",
    tier: "specialist",
    description: "Fast, reliable — quick drafts & high-volume tasks",
    selected: false,
    free: false,
  },
  {
    id: "ollama-cloud/qwen3.5:397b",
    label: "Qwen 3.5",
    tier: "specialist",
    description: "397B, vision + coding — code generation & analysis",
    selected: false,
    free: false,
  },
  {
    id: "ollama-cloud/gpt-oss:120b",
    label: "GPT-OSS",
    tier: "specialist",
    description: "Community-driven 120B, free backup",
    selected: false,
    free: false,
  },

  // ═══ Tier 3: Gateway Agents ═══
  {
    id: "openclaw/knight",
    label: "Knight",
    tier: "gateway",
    description: "MiniMax M3-powered agent",
    selected: false,
    free: false,
  },
  {
    id: "openclaw/rook",
    label: "Rook",
    tier: "gateway",
    description: "GLM 5.2-powered agent",
    selected: false,
    free: false,
  },
  {
    id: "openclaw/orion",
    label: "Orion",
    tier: "gateway",
    description: "DeepSeek V4-powered agent",
    selected: false,
    free: false,
  },
];

type SwarmMode = "parallel" | "consensus" | "pipeline" | "synthesis";

const SWARM_MODES: { id: SwarmMode; icon: any; label: string; desc: string }[] = [
  {
    id: "parallel",
    icon: Workflow,
    label: "Parallel Brainstorm",
    desc: "All models respond — you pick the best",
  },
  {
    id: "consensus",
    icon: Check,
    label: "Consensus Review",
    desc: "Models review & flag disagreements",
  },
  {
    id: "pipeline",
    icon: FlaskConical,
    label: "Sequential Pipeline",
    desc: "Draft → Improve → Polish (single model chain)",
  },
  {
    id: "synthesis",
    icon: MessageSquare,
    label: "Full Synthesis",
    desc: "All respond → merged into one answer",
  },
];

interface SwarmPanelProps {
  onSendSwarm: (prompt: string, models: string[], synthesize: boolean) => void;
  onClose: () => void;
  swarmRunning: boolean;
}

export default function SwarmPanel({
  onSendSwarm,
  onClose,
  swarmRunning,
}: SwarmPanelProps) {
  const [models, setModels] = useState<FleetModel[]>(FLEET_MODELS);
  const [swarmMode, setSwarmMode] = useState<SwarmMode>("synthesis");
  const [swarmPrompt, setSwarmPrompt] = useState("");

  const toggleModel = (id: string) => {
    setModels((prev) =>
      prev.map((m) =>
        m.id === id ? { ...m, selected: !m.selected } : m
      )
    );
  };

  const selectedModels = models.filter((m) => m.selected);

  const handleExecute = () => {
    const prompt = swarmPrompt.trim();
    if (!prompt || selectedModels.length === 0 || swarmRunning) return;
    const synthesize = swarmMode === "synthesis" || swarmMode === "consensus";
    onSendSwarm(prompt, selectedModels.map((m) => m.id), synthesize);
  };

  const tierLabels: Record<string, string> = {
    heavy: "Heavy Lifters",
    specialist: "Specialists",
    gateway: "Gateway Agents",
    infra: "Infrastructure",
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center">
      <div className="bg-surface border border-border rounded-xl w-[660px] max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Workflow size={18} className="text-accent" strokeWidth={1.5} />
            <span className="text-sm font-semibold">Swarm Command</span>
          </div>
          <button
            onClick={onClose}
            className="text-muted hover:text-foreground cursor-pointer bg-none border-none p-1"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Mode Selector */}
          <div>
            <div className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-2">
              Swarm Mode
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {SWARM_MODES.map((mode) => {
                const Icon = mode.icon;
                const isActive = swarmMode === mode.id;
                return (
                  <button
                    key={mode.id}
                    onClick={() => setSwarmMode(mode.id)}
                    className={`text-left px-3 py-2 rounded border cursor-pointer transition-all ${
                      isActive
                        ? "border-accent bg-accent/5"
                        : "border-border bg-surface hover:bg-muted-bg"
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <Icon
                        size={14}
                        className={isActive ? "text-accent" : "text-muted"}
                        strokeWidth={1.5}
                      />
                      <span
                        className={`text-xs font-medium ${
                          isActive ? "text-accent" : "text-foreground"
                        }`}
                      >
                        {mode.label}
                      </span>
                    </div>
                    <div className="text-[10px] text-muted mt-0.5 ml-0.5">
                      {mode.desc}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Model Selection */}
          <div>
            <div className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-2 flex items-center justify-between">
              <span>
                Models ({selectedModels.length}/{models.length})
              </span>
              {selectedModels.length === 0 && (
                <span className="text-[9px] text-amber-500 flex items-center gap-1">
                  <AlertCircle size={10} />
                  Select at least one
                </span>
              )}
            </div>

            {(["heavy", "specialist", "gateway"] as const).map((tier) => {
              const tierModels = models.filter((m) => m.tier === tier);
              if (tierModels.length === 0) return null;
              return (
                <div key={tier}>
                  <div className="text-[9px] font-semibold text-muted uppercase tracking-wider px-1 pb-1 pt-2">
                    {tierLabels[tier]}
                  </div>
                  {tierModels.map((m) => (
                    <div
                      key={m.id}
                      onClick={() => toggleModel(m.id)}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded border cursor-pointer transition-all mb-1 ${
                        m.selected
                          ? "border-accent bg-accent/5"
                          : "border-border bg-surface hover:bg-muted-bg"
                      }`}
                    >
                      <div
                        className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${
                          m.selected
                            ? "bg-accent border-accent"
                            : "border-muted bg-transparent"
                        }`}
                      >
                        {m.selected && (
                          <span className="text-[8px] text-[#08080a] font-bold">
                            ✓
                          </span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-foreground">
                          {m.label}
                        </div>
                        <div className="text-[10px] text-muted truncate">
                          {m.description}
                        </div>
                      </div>
                      <span
                        className={`text-[9px] px-1.5 rounded shrink-0 ${
                          m.free
                            ? "text-emerald-500 bg-emerald-500/10"
                            : "text-accent bg-accent/10"
                        }`}
                      >
                        {m.free ? "Free" : "Pro"}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>

          {/* Prompt Input */}
          <div>
            <div className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-2">
              Swarm Prompt
            </div>
            <textarea
              className="w-full border border-border bg-background rounded-lg px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent font-sans resize-none"
              rows={4}
              placeholder="What do you want the swarm to work on?"
              value={swarmPrompt}
              onChange={(e) => setSwarmPrompt(e.target.value)}
            />
          </div>
        </div>

        {/* Execute */}
        <div className="border-t border-border px-4 py-3 flex items-center justify-between">
          <div className="text-[10px] text-muted">
            {selectedModels.length > 0 ? (
              <>
                Firing to:{" "}
                <span className="text-foreground font-medium">
                  {selectedModels.map((m) => m.label).join(", ")}
                </span>
              </>
            ) : (
              <span className="text-amber-500 flex items-center gap-1">
                <AlertCircle size={10} />
                Select models to execute
              </span>
            )}
          </div>
          <button
            onClick={handleExecute}
            disabled={
              !swarmPrompt.trim() || selectedModels.length === 0 || swarmRunning
            }
            className="flex items-center gap-1.5 bg-accent text-[#08080a] border-none rounded-lg px-4 py-2 text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed font-sans"
          >
            <Workflow size={16} strokeWidth={1.5} />
            <span>
              {swarmRunning
                ? "Swarming..."
                : `Execute (${selectedModels.length} models)`}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
