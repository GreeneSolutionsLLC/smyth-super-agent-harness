"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check, Cpu, Zap } from "lucide-react";
import {
  OLLAMA_CLOUD_MODELS,
  OLLAMA_PRO_MODELS,
  LOCAL_OLLAMA_MODELS,
  OMNIROUTE_MODELS,
} from "@/lib/ollama-models";

export interface ModelOption {
  id: string;
  name: string;
  group: string;
}

interface ModelDropdownProps {
  selectedModelId: string | null;
  onSelect: (modelId: string | null) => void;
  routeMode: "auto" | "maetryxx" | "machine";
}

export default function ModelDropdown({
  selectedModelId,
  onSelect,
  routeMode,
}: ModelDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Build model groups based on route mode
  const groups: { label: string; models: ModelOption[] }[] = [];

  // OmniRoute models — available in auto and machine (as fallback)
  if (routeMode === "auto" || routeMode === "maetryxx") {
    groups.push({
      label: "OmniRoute (Auto-Routing)",
      models: OMNIROUTE_MODELS.map((id) => ({
        id,
        name: id.replace("auto/", "Auto · ").replace("oc/", "OC · "),
        group: "OmniRoute",
      })),
    });
  }

  // Ollama Cloud models — available in machine mode
  if (routeMode === "machine") {
    groups.push({
      label: "Ollama Cloud",
      models: OLLAMA_CLOUD_MODELS.map((m) => ({
        id: m.id,
        name: m.name,
        group: "Ollama Cloud",
      })),
    });
    groups.push({
      label: "Ollama Pro",
      models: OLLAMA_PRO_MODELS.map((m) => ({
        id: m.id,
        name: m.name,
        group: "Ollama Pro",
      })),
    });
    groups.push({
      label: "Local Ollama",
      models: LOCAL_OLLAMA_MODELS.map((m) => ({
        id: m.id,
        name: m.name,
        group: "Local",
      })),
    });
  }

  // For auto mode, also show Ollama Cloud models (user can pick a specific one)
  if (routeMode === "auto") {
    groups.push({
      label: "Ollama Cloud (Direct)",
      models: OLLAMA_CLOUD_MODELS.map((m) => ({
        id: m.id,
        name: m.name,
        group: "Ollama Cloud",
      })),
    });
    groups.push({
      label: "Ollama Pro (Direct)",
      models: OLLAMA_PRO_MODELS.map((m) => ({
        id: m.id,
        name: m.name,
        group: "Ollama Pro",
      })),
    });
  }

  const selectedLabel = selectedModelId
    ? [...groups].flatMap((g) => g.models).find((m) => m.id === selectedModelId)?.name || selectedModelId
    : "Pool Default";

  return (
    <div className="flex flex-col gap-1" ref={ref}>
      <span className="section-label">Model</span>
      <div className="relative">
        <button
          onClick={() => setOpen(!open)}
          className={`flex items-center gap-2 w-full bg-none border-none text-muted px-3 py-1.5 rounded-md text-sm cursor-pointer hover:bg-muted-bg hover:text-foreground transition-colors ${
            selectedModelId ? "text-accent bg-accent/10" : ""
          }`}
        >
          <Cpu size={16} strokeWidth={1.5} />
          <span className="truncate text-xs">{selectedLabel}</span>
          <ChevronDown
            size={12}
            className={`ml-auto transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>

        {open && (
          <div className="absolute left-0 right-0 top-full mt-1 bg-background border border-border rounded-md shadow-lg z-50 max-h-72 overflow-y-auto">
            {/* Pool Default option */}
            <button
              onClick={() => {
                onSelect(null);
                setOpen(false);
              }}
              className={`flex items-center gap-2 w-full bg-none border-none text-left px-3 py-2 text-xs cursor-pointer hover:bg-muted-bg transition-colors ${
                !selectedModelId ? "text-accent bg-accent/10" : "text-foreground"
              }`}
            >
              <Zap size={14} strokeWidth={1.5} className="text-muted" />
              <span>Pool Default (auto-routing)</span>
              {!selectedModelId && <Check size={12} className="ml-auto text-accent" />}
            </button>

            <div className="border-t border-border" />

            {groups.map((group) => (
              <div key={group.label}>
                <div className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider text-muted/60 bg-muted-bg/50">
                  {group.label}
                </div>
                {group.models.map((model) => (
                  <button
                    key={model.id}
                    onClick={() => {
                      onSelect(model.id);
                      setOpen(false);
                    }}
                    className={`flex items-center gap-2 w-full bg-none border-none text-left px-3 py-2 text-xs cursor-pointer hover:bg-muted-bg transition-colors ${
                      selectedModelId === model.id ? "text-accent bg-accent/10" : "text-foreground"
                    }`}
                  >
                    <span className="w-3.5 flex justify-center"><span className="block w-1 h-1 rounded-full bg-muted/40" /></span>
                    <span className="truncate">{model.name}</span>
                    <span className="ml-auto text-[9px] text-muted/50 font-mono">{model.id}</span>
                    {selectedModelId === model.id && (
                      <Check size={12} className="text-accent absolute right-3" />
                    )}
                  </button>
                ))}
                <div className="border-t border-border" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}