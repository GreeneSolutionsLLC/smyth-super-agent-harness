"use client";

import { useState } from "react";
import { X, Plus, ChevronDown } from "lucide-react";
import { AGENT_VARIANTS } from "@/config/agentVariants";
import type { AgentTab } from "@/hooks/useAgentTabs";

interface TabBarProps {
  tabs: AgentTab[];
  activeTabId: string;
  usedVariantIds: string[];
  canAddTab: boolean;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onAddTab: (variantId: string) => void;
  onOpenInNewTab?: (variantId: string) => void;
}

export default function TabBar({
  tabs,
  activeTabId,
  usedVariantIds,
  canAddTab,
  onSelectTab,
  onCloseTab,
  onAddTab,
  onOpenInNewTab,
}: TabBarProps) {
  const [showDropdown, setShowDropdown] = useState(false);

  return (
    <div className="flex items-center gap-0.5 px-2 py-1 bg-[#0a0a0a] border-b border-[#1a1a1a] overflow-x-auto shrink-0">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onSelectTab(tab.id)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all shrink-0 ${
            tab.id === activeTabId
              ? "bg-[#1a1a1a] text-white border border-[#333]"
              : "text-[#666] hover:text-[#999] hover:bg-[#111] border border-transparent"
          }`}
        >
          <span>{tab.emoji}</span>
          <span>{tab.name}</span>
          {tab.isStreaming && (
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          )}
          {tabs.length > 1 && (
            <span
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(tab.id);
              }}
              className="ml-1 p-0.5 rounded hover:bg-[#333] hover:text-red-400 text-[#555] transition-colors"
            >
              <X size={10} />
            </span>
          )}
        </button>
      ))}

      {canAddTab && (
        <div className="relative shrink-0">
          <button
            onClick={() => setShowDropdown(!showDropdown)}
            className="flex items-center gap-1 px-2 py-1.5 rounded-md text-xs text-[#555] hover:text-[#999] hover:bg-[#111] transition-colors border border-transparent hover:border-[#222]"
          >
            <Plus size={12} />
            <ChevronDown size={10} />
          </button>

          {showDropdown && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowDropdown(false)} />
              <div className="absolute top-full left-0 mt-1 z-50 bg-[#111] border border-[#222] rounded-lg shadow-xl min-w-[220px] py-1">
                {AGENT_VARIANTS.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-[#555]">No variants</div>
                ) : (
                  AGENT_VARIANTS.map((v) => {
                    const used = usedVariantIds.includes(v.id);
                    return (
                      <div key={v.id} className="flex items-center gap-1 px-2 py-1.5 hover:bg-[#1a1a1a]">
                        <button
                          onClick={() => {
                            onAddTab(v.id);
                            setShowDropdown(false);
                          }}
                          disabled={used}
                          className={`flex-1 flex items-center gap-2 text-left text-xs ${used ? "opacity-40 cursor-not-allowed" : ""}`}
                        >
                          <span>{v.emoji}</span>
                          <div className="flex-1">
                            <div className="text-[#ccc] font-medium">{v.name}</div>
                            <div className="text-[#555] text-[10px]">{v.description}</div>
                          </div>
                          <span className={`w-2 h-2 rounded-full ${v.color}`} />
                        </button>
                        {onOpenInNewTab && (
                          <button
                            onClick={() => {
                              onOpenInNewTab(v.id);
                              setShowDropdown(false);
                            }}
                            title="Open in new browser tab"
                            className="px-1.5 py-1 rounded hover:bg-[#333] text-[#777] hover:text-accent transition-colors text-[10px]"
                          >
                            ↗
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
