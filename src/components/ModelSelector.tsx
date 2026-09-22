"use client";

import { ChevronDown } from "lucide-react";
import { AGENT_VARIANTS } from "@/config/agentVariants";
import type { AgentTab } from "@/hooks/useAgentTabs";

interface ModelSelectorProps {
  activeTab: AgentTab | undefined;
  tabs: AgentTab[];
  onSwitchVariant: (tabId: string, variantId: string) => void;
}

export default function ModelSelector({ activeTab, tabs, onSwitchVariant }: ModelSelectorProps) {
  if (!activeTab) return null;

  return (
    <div className="flex items-center gap-1.5">
      <span className="px-1 rounded bg-accent/10 text-accent text-[9px] font-mono">
        v.{process.env.NEXT_PUBLIC_BUILD_VERSION || "dev"}
      </span>
      <div className="relative inline-flex items-center">
        <select
          value={activeTab.variantId}
          onChange={(e) => onSwitchVariant(activeTab.id, e.target.value)}
          className="appearance-none bg-muted-bg border border-border rounded-sm pl-2 pr-6 py-1 text-[11.5px] text-foreground hover:bg-accent/10 hover:border-accent/30 transition-colors cursor-pointer outline-none focus:border-accent focus:shadow-[0_0_0_2px_var(--accent-glow)]"
          style={{ fontFamily: "inherit" }}
        >
          {AGENT_VARIANTS.map((v) => {
            const usedInOtherTab = tabs.some((t) => t.id !== activeTab.id && t.variantId === v.id);
            return (
              <option key={v.id} value={v.id}>
                {v.emoji} {v.name} — {v.description}{usedInOtherTab ? " (open in another tab)" : ""}
              </option>
            );
          })}
        </select>
        <ChevronDown size={12} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
      </div>
    </div>
  );
}
