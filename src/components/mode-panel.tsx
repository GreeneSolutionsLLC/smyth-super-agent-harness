"use client";

import { useState } from "react";
import { Wifi, Cloud, Monitor } from "lucide-react";

type Mode = "offline" | "cloud" | "operator" | "swarm";

const modes: { id: Mode; label: string; icon: any }[] = [
  { id: "offline", label: "Offline", icon: Wifi },
  { id: "cloud", label: "Cloud", icon: Cloud },
];

export function ModePanel({
  mode,
  onModeChange,
}: {
  mode: Mode;
  onModeChange: (m: Mode) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="section-label">Mode</span>
      {modes.map((m) => {
        const Icon = m.icon;
        return (
          <button
            key={m.id}
            onClick={() => onModeChange(m.id)}
            className={`flex items-center gap-2 w-full bg-none border-none text-muted px-3 py-1.5 rounded-md text-sm cursor-pointer transition-all hover:bg-muted-bg hover:text-foreground ${
              mode === m.id ? "bg-accent/10 text-accent" : ""
            }`}
          >
            <Icon size={16} strokeWidth={1.5} />
            <span>{m.label}</span>
            {mode === m.id && <span className="ml-auto text-accent text-xs">●</span>}
          </button>
        );
      })}
    </div>
  );
}
