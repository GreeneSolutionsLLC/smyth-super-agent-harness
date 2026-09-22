"use client";

import { useState, useCallback, useRef, useMemo } from "react";
import { AGENT_VARIANTS, MAX_TABS, getVariantById } from "@/config/agentVariants";

export interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface AgentTab {
  id: string;
  variantId: string;
  model: string;
  name: string;
  emoji: string;
  color: string;
  messages: Message[];
  isStreaming: boolean;
}

function generateTabId(): string {
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function loadTabMessages(tabId: string): Message[] {
  try {
    const raw = localStorage.getItem(`smyth-tab-${tabId}`);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

function saveTabMessages(tabId: string, messages: Message[]) {
  try {
    localStorage.setItem(`smyth-tab-${tabId}`, JSON.stringify(messages));
  } catch {}
}

function loadTabList(): Array<{ id: string; variantId: string }> {
  try {
    const raw = localStorage.getItem("smyth-tabs");
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

function saveTabList(tabs: Array<{ id: string; variantId: string }>) {
  try {
    localStorage.setItem("smyth-tabs", JSON.stringify(tabs));
  } catch {}
}

function getInitialVariantId(): string {
  if (typeof window === "undefined") return AGENT_VARIANTS[0].id;
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("model");
  return requested && getVariantById(requested) ? requested : AGENT_VARIANTS[0].id;
}

function getInitialTabId(): string {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  return params.get("session") || "";
}

export function useAgentTabs() {
  const urlVariantId = useMemo(getInitialVariantId, []);
  const urlTabId = useMemo(getInitialTabId, []);

  const [tabs, setTabs] = useState<AgentTab[]>(() => {
    const saved = loadTabList();
    const existing = saved.find((s) => s.id === urlTabId);

    const makeTab = (variantId: string, id: string): AgentTab => {
      const v = getVariantById(variantId) || AGENT_VARIANTS[0];
      return {
        id,
        variantId: v.id,
        model: v.model,
        name: v.name,
        emoji: v.emoji,
        color: v.color,
        messages: loadTabMessages(id),
        isStreaming: false,
      };
    };

    if (existing) {
      return saved.map((s) => makeTab(s.variantId, s.id));
    }

    if (saved.length === 0) {
      // Start fresh with URL model (or default Smyth)
      const id = urlTabId || generateTabId();
      return [makeTab(urlVariantId, id)];
    }

    // URL wants a new session/model -> append it if room
    if (urlTabId && urlTabId !== saved[0].id && saved.length < MAX_TABS) {
      const newTab = makeTab(urlVariantId, urlTabId);
      return [...saved.map((s) => makeTab(s.variantId, s.id)), newTab];
    }

    return saved.map((s) => makeTab(s.variantId, s.id));
  });

  const [activeTabId, setActiveTabId] = useState<string>(() => {
    const fallback = tabs[0]?.id || "";
    if (!urlTabId) return fallback;
    return tabs.find((t) => t.id === urlTabId)?.id || fallback;
  });

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  const usedVariantIds = useMemo(() => tabs.map((t) => t.variantId), [tabs]);

  const addTab = useCallback((variantId: string) => {
    if (tabs.length >= MAX_TABS) return;
    const variant = getVariantById(variantId);
    if (!variant) return;

    const newTab: AgentTab = {
      id: generateTabId(),
      variantId: variant.id,
      model: variant.model,
      name: variant.name,
      emoji: variant.emoji,
      color: variant.color,
      messages: [],
      isStreaming: false,
    };

    setTabs((prev) => {
      const next = [...prev, newTab];
      saveTabList(next.map((t) => ({ id: t.id, variantId: t.variantId })));
      return next;
    });
    setActiveTabId(newTab.id);
  }, [tabs.length]);

  const openInNewTab = useCallback((variantId: string) => {
    const variant = getVariantById(variantId);
    if (!variant) return;
    const id = generateTabId();
    const url = new URL(window.location.href);
    url.searchParams.set("model", variant.id);
    url.searchParams.set("session", id);
    url.searchParams.delete("nocache");
    window.open(url.toString(), "_blank", "noopener,noreferrer");
    // Note: we do NOT add this to the current window's tab state; the new
    // browser tab owns its own instance via the URL params.
  }, []);

  const closeTab = useCallback((tabId: string) => {
    setTabs((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((t) => t.id !== tabId);
      saveTabList(next.map((t) => ({ id: t.id, variantId: t.variantId })));
      localStorage.removeItem(`smyth-tab-${tabId}`);
      return next;
    });
    setActiveTabId((prev) => {
      if (prev !== tabId) return prev;
      return tabs[0]?.id || "";
    });
  }, [tabs]);

  const switchVariant = useCallback((tabId: string, variantId: string) => {
    const variant = getVariantById(variantId);
    if (!variant) return;

    // If this tab was spawned from a URL, keep the URL model param in sync
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (url.searchParams.get("session") === tabId) {
        url.searchParams.set("model", variant.id);
        window.history.replaceState({}, "", url.toString());
      }
    }

    setTabs((prev) => {
      const next = prev.map((t) =>
        t.id === tabId
          ? { ...t, variantId: variant.id, model: variant.model, name: variant.name, emoji: variant.emoji, color: variant.color }
          : t
      );
      saveTabList(next.map((t) => ({ id: t.id, variantId: t.variantId })));
      return next;
    });
  }, []);

  const addMessage = useCallback((tabId: string, message: Message) => {
    setTabs((prev) => {
      const next = prev.map((t) =>
        t.id === tabId ? { ...t, messages: [...t.messages, message] } : t
      );
      const tab = next.find((t) => t.id === tabId);
      if (tab) saveTabMessages(tabId, tab.messages);
      return next;
    });
  }, []);

  const setStreaming = useCallback((tabId: string, streaming: boolean) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, isStreaming: streaming } : t))
    );
  }, []);

  const setTabMessages = useCallback((tabId: string, messages: Message[]) => {
    setTabs((prev) => {
      const next = prev.map((t) =>
        t.id === tabId ? { ...t, messages } : t
      );
      saveTabMessages(tabId, messages);
      return next;
    });
  }, []);

  // Updater-style tab message write — used by streaming to update the
  // initiating tab's thread in place (replace last bubble, append tokens, etc.)
  // without clobbering other tabs or the active-tab global state.
  const updateTabMessages = useCallback((tabId: string, updater: (m: Message[]) => Message[]) => {
    setTabs((prev) => {
      const next = prev.map((t) =>
        t.id === tabId ? { ...t, messages: updater(t.messages || []) } : t
      );
      const tab = next.find((t) => t.id === tabId);
      if (tab) saveTabMessages(tabId, tab.messages);
      return next;
    });
  }, []);

  return {
    tabs,
    activeTab,
    activeTabId,
    setActiveTabId,
    addTab,
    openInNewTab,
    closeTab,
    switchVariant,
    addMessage,
    setTabMessages,
    updateTabMessages,
    setStreaming,
    usedVariantIds,
    canAddTab: tabs.length < MAX_TABS,
  };
}
