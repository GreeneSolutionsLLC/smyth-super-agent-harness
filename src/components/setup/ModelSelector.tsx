"use client";

import { ChevronDown } from "lucide-react";
import { ModelInfo } from "@/lib/model-config";

interface ModelSelectorProps {
  models?: ModelInfo[];
  value: string;
  onChange: (modelId: string) => void;
}

export function ModelSelector({ models, value, onChange }: ModelSelectorProps) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none rounded-lg border border-border bg-surface px-4 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
      >
        {(models ?? []).map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
    </div>
  );
}
