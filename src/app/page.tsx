"use client";

export const dynamic = "force-dynamic";
import { useState, useEffect, useRef, useCallback } from "react";
import EchoVisionDaemon from "@/components/EchoVisionDaemon";
import { SmythSplash } from "@/components/SmythSplash";
import { ChatMessage } from "@/components/ChatMessage";
import { ThinkingIndicator } from "@/components/ThinkingIndicator";
import { ThinkingBackground } from "@/components/ThinkingBackground";
import { OperatorStatus } from "@/components/OperatorStatus";
import OperatorAssistPanel from "@/components/OperatorAssistPanel";
import MailboxesPanel from "@/components/MailboxesPanel";
import VoicePlayer from "@/components/VoicePlayer";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import type { RecState } from "@/hooks/useVoiceRecorder";
import WaveformVisualizer from "@/components/WaveformVisualizer";
import { ThemeToggle } from "@/components/ThemeToggle";
// 2026-09-09: 'Eye' removed here — it collided with the same identifier
// in the consolidated lucide-react import below (duplicate declaration broke
// the build). Single source of truth for Eye/EyeOff is the barrel import.
import { Globe, Search, Mail as MailIcon, FolderOpen as FolderIcon, Calendar as CalendarIcon } from "lucide-react";
import { TokenGauge, SessionContextGauge } from "@/components/token-gauge";
import { SwarmIcon } from "@/components/SwarmIcon";
import TabBar from "@/components/TabBar";
import { useAgentTabs } from "@/hooks/useAgentTabs";
import SmythShare from "@/components/SmythShare";
import SmythWebcam from "@/components/SmythWebcam";
import ModelSelector from "@/components/ModelSelector";
import OllamaUsageWidget from "@/components/OllamaUsageWidget";
import { OLLAMA_CLOUD_MODELS, OLLAMA_PRO_MODELS, CLOUDFLARE_AI_MODELS, NVIDIA_POOL_MODELS } from "@/lib/ollama-models";
import ProviderSwitchboard from "@/components/ProviderSwitchboard";
import { getProviderKeyName, type CustomProviderId } from "@/lib/custom-providers";
import MCPStatusPanel from "@/components/MCPStatusPanel";
import EmailPanel from "@/components/EmailPanel";
import SchedulingPanel from "@/components/SchedulingPanel";
import MeetingRoom from "@/components/MeetingRoom";
import VideographyPanel from "@/components/VideographyPanel";
import DesignPanel from "@/components/DesignPanel";
import OpsPanel from "@/components/OpsPanel";
import {
  MessageSquare,
  ClipboardList,
  Puzzle,
  Monitor,
  FolderOpen,
  Settings,
  Paperclip,
  SquarePen,
  MoreHorizontal,
  Plus,
  FileText,
  Image,
  ExternalLink,
  ChevronRight,
  Check,
  X,
  Trash2,
  Wifi,
  Cloud,
  // 2026-08-22: Cloud mode now renders as 'API Routing' — Network icon
  // (globe with crossing wires) communicates "upstream route" better than
  // the fluffy cloud. Imported but referenced in the mode dropdown below.
  Network,
  Sun,
  Moon,
  Share2,
  Camera,
  Activity,
  Inbox,
  Phone,
  Mic,
  VolumeX,
  Mail,
  Calendar,
  Film,
  Megaphone,
  Briefcase,
  Shield,
  PenTool,
  Download,
  Eye,
  EyeOff,
} from "lucide-react";

// ── Types ──

type Mode = "offline" | "cloud" | "operator" | "swarm";
// 2026-08-22: the 'offline' identifier is kept for backward compat with
// persisted preferences, but the user-facing label is now 'Cloud' — the
// 'shift-to-VPS' mode Rob envisions. 'cloud' (no o) is 'API Routing',
// the pool-router / multi-provider mode.
type RouteMode = "auto" | "maetryxx" | "machine" | "custom";
type Page = "Chat" | "Sessions" | "Skills" | "Agents" | "Files" | "Settings";

type Message = {
  role: "user" | "assistant" | "system-meta";
  content: string;
  timestamp: number;
  imageUrl?: string;
  fileUrls?: { name: string; ext: string }[];
  // For system-meta anchors
  model?: string;
  pool?: string;
  hidden?: boolean;
};

type Session = {
  id: string;
  title: string;
  preview: string;
  time: string;
  tokensUsed: number;
  messages: Message[];
  createdAt: number;
};

type Skill = {
  id: string;
  name: string;
  description: string;
  installed: boolean;
  icon: string;
};

// ── Provider defaults ──

const endpointDefaults: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta",
  perplexity: "https://api.perplexity.ai",
  deepseek: "https://api.deepseek.com/v1",
  mistral: "https://api.mistral.ai/v1",
  "ollama-cloud": "https://cloud.ollama.ai/api",
  "ollama-pro": "https://pro.ollama.ai/api",
  custom: "",
};

const providerLabels: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta",
  perplexity: "https://api.perplexity.ai",
  deepseek: "https://api.deepseek.com/v1",
  mistral: "https://api.mistral.ai/v1",
  "ollama-cloud": "https://cloud.ollama.ai/api",
  "ollama-pro": "https://pro.ollama.ai/api",
  custom: "https://your-custom-endpoint.com/v1",
};

const endpointPlaceholder = (provider: string) =>
  providerLabels[provider] || "https://api.example.com/v1";

// ── Data ──

const SESSIONS_KEY = "smyth-sessions";
const ACTIVE_KEY = "smyth-active";
const MESSAGES_KEY = "smyth-messages";

const MAX_STORED_MESSAGES = 60;
const MAX_STORED_CONTENT = 4000;

function slimForStorage(msgs: Message[]): Message[] {
  return msgs.slice(-MAX_STORED_MESSAGES).map(m => ({
    ...m,
    content: m.content.length > MAX_STORED_CONTENT
      ? m.content.slice(0, MAX_STORED_CONTENT) + "\n…[truncated]"
      : m.content,
    // strip heavy fields
    image: undefined,
    imageUrl: m.imageUrl && m.imageUrl.length < 200000 ? m.imageUrl : undefined,
  }));
}

// One-time startup hygiene: remove orphaned smyth-tab-* keys (left behind by
// closed browser windows — the tab list is per-window so they never get
// removed) and re-slim legacy sessions/messages written before storage caps.
function cleanupLocalStorage() {
  if (typeof window === "undefined") return;
  try {
    const flag = "smyth-cleanup-v1";
    if (localStorage.getItem(flag)) return;

    // 1. Orphaned tab keys — keep only tabs referenced by this window's list
    const liveIds = new Set<string>();
    try {
      const list = JSON.parse(localStorage.getItem("smyth-tabs") || "[]");
      for (const t of list) if (t?.id) liveIds.add(t.id);
    } catch {}
    const toDelete: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("smyth-tab-tab-") && !liveIds.has(k.slice("smyth-tab-".length))) {
        toDelete.push(k);
      }
    }
    toDelete.forEach(k => localStorage.removeItem(k));

    // 2. Re-slim legacy sessions blob
    try {
      const raw = localStorage.getItem(SESSIONS_KEY);
      if (raw) {
        const sessions = JSON.parse(raw);
        localStorage.setItem(SESSIONS_KEY, JSON.stringify(
          sessions.map((s: any) => ({ ...s, messages: slimForStorage(s.messages || []) }))
        ));
      }
    } catch {}

    // 3. Re-slim cached messages
    try {
      const raw = localStorage.getItem(MESSAGES_KEY);
      if (raw) localStorage.setItem(MESSAGES_KEY, JSON.stringify(slimForStorage(JSON.parse(raw))));
    } catch {}

    localStorage.setItem(flag, new Date().toISOString());
    console.log(`[smyth] localStorage cleanup: removed ${toDelete.length} orphaned tab keys, re-slimmed sessions`);
  } catch {}
}

function loadSessions(): Session[] {
  cleanupLocalStorage();
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

function saveSessions(sessions: Session[]) {
  try {
    const slim = sessions.map(s => ({ ...s, messages: slimForStorage(s.messages || []) }));
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(slim));
  } catch {}
}

function loadActiveId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch { return null; }
}

// ── Monthly token usage (resets on the 1st of each month) ──
// 2026-08-22: Rob wants the token-usage meter to reset to 0 on the
// first of every month forever (Sept 1, Oct 1, Nov 1, ...). Storage
// shape: { ["YYYY-MM"]: tokens }. We always read/write only the
// current-month key. Older keys stick around for reference but are
// not summed into the meter.
const MONTHLY_USAGE_KEY = "smyth:monthlyUsage";
const MONTHLY_USAGE_MIGRATED_KEY = "smyth:monthlyUsage.migrated";

function currentYearMonth(now = new Date()): string {
  // 'YYYY-MM' in local time — matches the wall-clock month the user is in.
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function loadMonthlyUsage(): Record<string, number> {
  try {
    const raw = localStorage.getItem(MONTHLY_USAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}

function saveMonthlyUsage(map: Record<string, number>) {
  try {
    localStorage.setItem(MONTHLY_USAGE_KEY, JSON.stringify(map));
  } catch {}
}

// Read the running total for the *current* month. Older months
// (Sept reading Aug, etc.) just fall to 0 — the meter resets.
export function getCurrentMonthUsage(now = new Date()): number {
  const key = currentYearMonth(now);
  return loadMonthlyUsage()[key] ?? 0;
}

// Add `delta` to the current month. Safe to call from anywhere.
// Returns the new current-month total after the bump.
export function recordMonthlyUsage(delta: number, now = new Date()): number {
  if (!delta || delta <= 0) return getCurrentMonthUsage(now);
  const map = loadMonthlyUsage();
  const key = currentYearMonth(now);
  map[key] = (map[key] ?? 0) + delta;
  saveMonthlyUsage(map);
  return map[key];
}

// 2026-08-22: one-time migration from per-session tokensUsed. Old data
// had no month concept, so we attribute it all to the current month.
// Subsequent token deltas go through recordMonthlyUsage and respect
// the calendar boundary automatically.
function migrateLegacyTokensIntoCurrentMonth() {
  try {
    if (localStorage.getItem(MONTHLY_USAGE_MIGRATED_KEY)) return;
    const sessions = JSON.parse(localStorage.getItem(SESSIONS_KEY) || "[]") as Array<{ tokensUsed?: number }>;
    const total = sessions.reduce((sum, s) => sum + (s.tokensUsed ?? 0), 0);
    if (total > 0) {
      const map = loadMonthlyUsage();
      const key = currentYearMonth();
      map[key] = (map[key] ?? 0) + total;
      saveMonthlyUsage(map);
    }
    localStorage.setItem(MONTHLY_USAGE_MIGRATED_KEY, new Date().toISOString());
  } catch {}
}

function saveActiveId(id: string | null) {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {}
}

function loadCachedMessages(): Message[] {
  try {
    const raw = localStorage.getItem(MESSAGES_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

function saveCachedMessages(msgs: Message[]) {
  try {
    localStorage.setItem(MESSAGES_KEY, JSON.stringify(slimForStorage(msgs)));
  } catch {}
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// Files are loaded dynamically from the workspace via /api/files

const SKILL_ICONS: Record<string, any> = {
  browser: Globe,
  research: Search,
  email: MailIcon,
  vision: Eye,
  files: FolderIcon,
  calendar: CalendarIcon,
};

const skillsData: Skill[] = [
  { id: "browser", name: "Browser Control", description: "Navigate, click, fill, and read web pages", installed: true, icon: "" },
  { id: "research", name: "Web Research", description: "Search, scrape, and summarize web content", installed: true, icon: "" },
  { id: "email", name: "Email Triage", description: "Read, categorize, and draft email replies", installed: true, icon: "" },
  { id: "vision", name: "Image Understanding", description: "Analyze images with Echo Vision", installed: true, icon: "" },
  { id: "files", name: "File Operations", description: "Read, write, and organize project files", installed: true, icon: "" },
  { id: "calendar", name: "Calendar Actions", description: "Check schedule, create events", installed: false, icon: "" },
];

const providers = [
  { id: "matrix", label: "Matrix", desc: "Default Smyth inference network", free: true },
  { id: "openai", label: "OpenAI", desc: "GPT-4o, GPT-4, GPT-3.5", free: false },
  { id: "anthropic", label: "Anthropic", desc: "Claude Sonnet, Haiku, Opus", free: false },
  { id: "google", label: "Google", desc: "Gemini 2.0 Pro, Gemini 2.0 Flash", free: false },
  { id: "perplexity", label: "Perplexity", desc: "Sonar Pro, Sonar Huge", free: false },
  { id: "deepseek", label: "DeepSeek", desc: "DeepSeek V3, R1", free: false },
  { id: "mistral", label: "Mistral", desc: "Mistral Large, Small, Codestral", free: false },
  { id: "ollama", label: "Ollama (Local)", desc: "Run local models on your machine", free: true },
  { id: "ollama-cloud", label: "Ollama Cloud", desc: "Cloud-hosted Ollama models", free: false },
  { id: "ollama-pro", label: "Ollama Pro", desc: "Premium Ollama, faster inference", free: false },
  { id: "custom", label: "Custom", desc: "Any OpenAI-compatible endpoint", free: false },
];

const navItems: { icon: any; label: Page }[] = [
  { icon: MessageSquare, label: "Chat" },
  { icon: ClipboardList, label: "Sessions" },
  { icon: Puzzle, label: "Skills" },
  { icon: Monitor, label: "Agents" },
  { icon: FolderOpen, label: "Files" },
  { icon: Settings, label: "Settings" },
];

// 2026-08-22: account plan reflects Rob's actual quota (1B tokens/mo).
// Earlier 1M limit caused the meter to read 100% CRITICAL on day one.
const MONTHLY_LIMIT = 1_000_000_000;

// ── Settings page helpers ──

/** Keys surfaced in the Settings → API Keys editor (Electron only). */
const SETTINGS_ENV_KEYS: { key: string; label: string }[] = [
  { key: "OLLAMA_API_KEY", label: "Ollama" },
  { key: "OLLAMA_CLOUD_API_KEY", label: "Ollama Cloud" },
  { key: "OLLAMA_PRO_API_KEY", label: "Ollama Pro" },
  { key: "CLOUDFLARE_ACCOUNT_ID", label: "Cloudflare Account" },
  { key: "CLOUDFLARE_API_TOKEN", label: "Cloudflare Token" },
  { key: "NVIDIA_API_KEY", label: "NVIDIA NIM" },
  { key: "ZERNIO_API_KEY", label: "Zernio (Social)" },
];

function EnvKeyRow({
  envKey,
  label,
  value,
  saveState,
  onSave,
}: {
  envKey: string;
  label: string;
  value: string;
  saveState?: "saving" | "saved" | "error";
  onSave: (key: string, value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  const [show, setShow] = useState(false);

  // Keep draft in sync when the env is (re)loaded from main
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);

  const dirty = draft !== value;

  return (
    <div className="flex items-center gap-2">
      <div className="w-[110px] shrink-0">
        <div className="text-[11px] font-medium text-foreground leading-tight">{label}</div>
        <div className="text-[9px] text-muted leading-tight">{envKey}</div>
      </div>
      <div className="flex-1 relative">
        <input
          type={show ? "text" : "password"}
          value={draft}
          onFocus={() => setEditing(true)}
          onBlur={() => setEditing(false)}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="not set"
          className="w-full border border-border bg-background rounded-sm px-2 py-1.5 pr-7 text-[11px] outline-none placeholder:text-muted/50 focus:border-accent font-mono"
        />
        <button
          onClick={() => setShow(!show)}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted hover:text-foreground cursor-pointer bg-none border-none p-0.5"
          title={show ? "Hide" : "Show"}
        >
          {show ? <EyeOff size={12} /> : <Eye size={12} />}
        </button>
      </div>
      <button
        onClick={() => onSave(envKey, draft)}
        disabled={!dirty || saveState === "saving"}
        className={`text-[11px] px-2.5 py-1.5 rounded border cursor-pointer transition-colors shrink-0 ${
          saveState === "saved"
            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
            : saveState === "error"
              ? "border-red-500/40 bg-red-500/10 text-red-400"
              : dirty
                ? "border-accent bg-accent/10 text-accent hover:bg-accent/20"
                : "border-border bg-muted-bg text-muted opacity-50 cursor-default"
        }`}
      >
        {saveState === "saving" ? "…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Error" : "Save"}
      </button>
    </div>
  );
}

export default function AppPage() {
  const [dark, setDark] = useState(true);
  const [mode, setMode] = useState<Mode>("cloud");
  const [routeMode, setRouteMode] = useState<RouteMode>("machine");
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null); // null = pool default

  // Ollama account override: only applies when routeMode === "machine".
  // "rotate" = use both keys (default), "cloud" = exclusive Cloud, "pro" = exclusive Pro.
  const [ollamaAccount, setOllamaAccount] = useState<"rotate" | "cloud" | "pro" | "cloudflare" | "nvidia">("rotate");
  // Per-routing-system model pins (null = "Routing Pool" — rotate across that key's models)
  const [cloudModelId, setCloudModelId] = useState<string | null>(null);
  const [proModelId, setProModelId] = useState<string | null>(null);
  const [cloudflareModelId, setCloudflareModelId] = useState<string | null>(null);
  const [nvidiaModelId, setNvidiaModelId] = useState<string | null>(null);
  // Custom provider routing state
  const [customProvider, setCustomProvider] = useState<CustomProviderId | null>(null);
  const [customModel, setCustomModel] = useState<string | null>(null);
  const [customApiKey, setCustomApiKey] = useState<string>("");
  const [customApiKeySet, setCustomApiKeySet] = useState<boolean>(false);
  // Bumped after each completed turn so the Ollama widgets refresh.
  const [usageRefreshTrigger, setUsageRefreshTrigger] = useState(0);
  const [operatorSessionId, setOperatorSessionId] = useState<string | null>(null);
  const [showOperatorAssist, setShowOperatorAssist] = useState(false);
  const [activePage, setActivePage] = useState<Page>("Chat");
  const [mounted, setMounted] = useState(false);
  const [initialLoadId, setInitialLoadId] = useState<string | null>(null);
  const [initialMsgs, setInitialMsgs] = useState<Message[]>([]);
  const [hasRecoverableSession, setHasRecoverableSession] = useState(false);

  // ── Agent Tab System ──
  const agentTabs = useAgentTabs();
  const {
    tabs,
    activeTab,
    activeTabId,
    setActiveTabId,
    addTab,
    openInNewTab,
    closeTab,
    switchVariant,
    addMessage: saveTabMessage,
    setTabMessages,
    updateTabMessages,
    setStreaming,
    usedVariantIds,
    canAddTab,
  } = agentTabs;


  // When user pins a specific model via any source (Ollama widget, ModelSelector,
  // or global selectedModelId), drop a system-meta anchor into the chat history
  // so the backend can tell the model what it is driving. Fires whenever the
  // active model changes or on first mount with a non-null value.
  // Uses sessionStorage so we survive reloads but reset per tab.
  const activePinnedModel =
    (ollamaAccount === "cloud" ? cloudModelId :
     ollamaAccount === "pro" ? proModelId :
     selectedModelId) || null;

  useEffect(() => {
    if (!activePinnedModel) return;
    if (typeof window === "undefined") return;
    const storageKey = "smyth:lastAnchored:" + (activeTabId || "default");
    const previouslyAnchored = window.sessionStorage.getItem(storageKey);
    if (previouslyAnchored === activePinnedModel) return;
    window.sessionStorage.setItem(storageKey, activePinnedModel);
    const metaMsg: any = {
      id: "meta-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
      role: "system-meta",
      model: activePinnedModel,
      pool: routeMode === "machine" ? "machine" : routeMode,
      timestamp: Date.now(),
      hidden: true,
    };
    setMessages((prev) => [...prev, metaMsg]);
    if (typeof setTabMessages === "function" && activeTabId) {
      try {
        const tabObj = tabs.find((t: any) => t.id === activeTabId);
        if (tabObj) {
          const updated = [...(tabObj.messages || []), metaMsg];
          setTabMessages(activeTabId, updated as any);
        }
      } catch {}
    }
  }, [activePinnedModel, routeMode, activeTabId]);
  const [messages, setMessages] = useState<Message[]>([]);

  // Sync messages state with active tab on tab switch
  useEffect(() => {
    if (activeTab) {
      setMessages(activeTab.messages);
    }
  }, [activeTabId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync messages back to active tab whenever they change
  useEffect(() => {
    if (activeTab && activeTabId && messages !== activeTab.messages) {
      setTabMessages(activeTabId, messages);
    }
  }, [messages, activeTabId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Hydration-safe: localStorage reads only run on the client
    const lid = loadActiveId();
    const imsgs = lid ? loadCachedMessages() : [{ role: "assistant" as const, content: "Ready. What are we building today?", timestamp: Date.now() }];
    setInitialLoadId(lid);
    setInitialMsgs(imsgs);
    setHasRecoverableSession(lid !== null && imsgs.length > 0);
    // Hydrate routing mode + Ollama account override from localStorage
    // 2026-08-25: routeMode was NOT persisted before — the user reloaded,
    // got bounced back to "auto" while their pinned account stayed, and
    // every message routed to the auto pool anyway. That mismatch was the
    // real cross-pollination Rob saw.
    try {
      const savedRouteMode = localStorage.getItem("smyth:routeMode");
      // 2026-09-02: migrate stale "auto"/"maetryxx" (OmniRoute is dead) → "machine"
      const effectiveRouteMode = (savedRouteMode === "auto" || savedRouteMode === "maetryxx") ? "machine" : savedRouteMode;
      if (effectiveRouteMode === "machine" || effectiveRouteMode === "offline" || effectiveRouteMode === "custom") {
        setRouteMode(effectiveRouteMode as RouteMode);
        if (savedRouteMode !== effectiveRouteMode) {
          localStorage.setItem("smyth:routeMode", effectiveRouteMode);
        }
      }
    } catch {
      // localStorage unavailable (e.g. private mode) — fall back to default
    }
    try {
      const saved = localStorage.getItem("smyth:ollamaAccount");
      if (saved === "cloud" || saved === "pro" || saved === "cloudflare" || saved === "nvidia" || saved === "rotate") {
        setOllamaAccount(saved);
      }
      const savedCloudModel = localStorage.getItem("smyth:cloudModelId");
      if (savedCloudModel) setCloudModelId(savedCloudModel);
      const savedProModel = localStorage.getItem("smyth:proModelId");
      if (savedProModel) setProModelId(savedProModel);
      const savedNvidiaModel = localStorage.getItem("smyth:nvidiaModelId");
      if (savedNvidiaModel) setNvidiaModelId(savedNvidiaModel);
      const savedCustomProvider = localStorage.getItem("smyth:customProvider");
      if (savedCustomProvider) setCustomProvider(savedCustomProvider as CustomProviderId);
      const savedCustomModel = localStorage.getItem("smyth:customModel");
      if (savedCustomModel) setCustomModel(savedCustomModel);
      const savedCustomKey = localStorage.getItem("smyth:customApiKey");
      if (savedCustomKey) {
        setCustomApiKey(savedCustomKey);
        setCustomApiKeySet(true);
      }
    } catch {
      // localStorage unavailable (e.g. private mode) — fall back to default
    }
    setMounted(true);
  }, []);

  // Persist Ollama account override + per-widget model pins across sessions
  useEffect(() => {
    if (!mounted) return;
    try {
      localStorage.setItem("smyth:routeMode", routeMode);
      localStorage.setItem("smyth:ollamaAccount", ollamaAccount);
      if (cloudModelId) localStorage.setItem("smyth:cloudModelId", cloudModelId);
      else localStorage.removeItem("smyth:cloudModelId");
      if (proModelId) localStorage.setItem("smyth:proModelId", proModelId);
      else localStorage.removeItem("smyth:proModelId");
      if (nvidiaModelId) localStorage.setItem("smyth:nvidiaModelId", nvidiaModelId);
      else localStorage.removeItem("smyth:nvidiaModelId");
      if (customProvider) localStorage.setItem("smyth:customProvider", customProvider);
      else localStorage.removeItem("smyth:customProvider");
      if (customModel) localStorage.setItem("smyth:customModel", customModel);
      else localStorage.removeItem("smyth:customModel");
      if (customApiKey) localStorage.setItem("smyth:customApiKey", customApiKey);
      else localStorage.removeItem("smyth:customApiKey");
    } catch {
      // best-effort
    }
  }, [routeMode, ollamaAccount, cloudModelId, proModelId, cloudflareModelId, nvidiaModelId, customProvider, customModel, customApiKey, mounted]);

  // Once we know our initial messages, populate the state
  useEffect(() => {
    if (mounted && initialMsgs.length > 0) {
      setMessages(initialMsgs);
    }
  }, [mounted]);

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  // Per-tab streaming: which tab is currently streaming (allows parallel tabs)
  const streamingTabRef = useRef<string | null>(null);
  const [toolPhase, setToolPhase] = useState<string>("thinking");
  const [deepResearch, setDeepResearch] = useState(false);
  const [swarmMode, setSwarmMode] = useState(false);
  const [showMailboxes, setShowMailboxes] = useState(false);
  const [compiling, setCompiling] = useState(false);
  // 2026-08-22: surface mic permission / device errors inline so Rob knows
  // whether to grant browser mic permission or fix hardware.
  const [recError, setRecError] = useState<string | null>(null);
  const [visionContext, setVisionContext] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSession, setActiveSession] = useState<string | null>(null);
  // Sync active session from initial load data after hydration
  useEffect(() => {
    if (mounted && initialLoadId) {
      setActiveSession(initialLoadId);
    }
  }, [mounted]);
  const [sessions, setSessions] = useState<Session[]>(() => loadSessions());

  // Debounced persistence — avoids JSON.stringify of full history on every
  // render/keystroke. Writes at most every 2s, and once more on unmount.
  const sessionsSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (sessionsSaveTimer.current) clearTimeout(sessionsSaveTimer.current);
    sessionsSaveTimer.current = setTimeout(() => saveSessions(sessions), 2000);
    return () => { if (sessionsSaveTimer.current) clearTimeout(sessionsSaveTimer.current); };
  }, [sessions]);

  // Cache current messages + active session for page refresh recovery
  useEffect(() => { saveActiveId(activeSession); }, [activeSession]);
  const msgSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (messages.length === 0) return; // never wipe cache on empty
    if (msgSaveTimer.current) clearTimeout(msgSaveTimer.current);
    msgSaveTimer.current = setTimeout(() => saveCachedMessages(messages), 2000);
    return () => { if (msgSaveTimer.current) clearTimeout(msgSaveTimer.current); };
  }, [messages]);

  // ── Background job auto-resume watcher ──
  // When the latest assistant message OR recent tool result mentions a
  // job_xxxxxx token, poll the job status endpoint every 2s. Once the job
  // completes (success or failure), auto-inject one prompt asking the agent
  // to call shell_status and report the result. If the job disappears (404),
  // we stop polling.
  const watchedJobsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (loading || activePage !== "Chat") return;

    // Collect jobIds from the latest assistant message text and from recent
    // tool_results that may have returned a background job JSON blob.
    const seen = new Set<string>();
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.role === "assistant") {
      for (const m of (lastMsg.content || "").match(/job_[0-9a-f]{6,}/gi) || []) seen.add(m);
    }

    const lastToolResults: { tool?: string; result?: any }[] = [];
    for (let i = messages.length - 1; i >= 0 && lastToolResults.length < 10; i--) {
      const m = messages[i];
      if (m.role === "assistant" && (m.content?.startsWith("✅ shell:") || m.content?.startsWith("✅ shell_status:"))) {
        lastToolResults.push({ tool: m.content.split(":")[0].replace("✅ ", ""), result: m.content.slice(m.content.indexOf(":") + 1) });
      }
    }
    for (const tr of lastToolResults) {
      if (tr.result) {
        for (const m of String(tr.result).match(/job_[0-9a-f]{6,}/gi) || []) seen.add(m);
      }
    }

    const jobIds = Array.from(seen);
    if (jobIds.length === 0) return;

    let cancelled = false;
    const timers: number[] = [];

    for (const jobId of jobIds) {
      if (watchedJobsRef.current.has(jobId) || watchedJobsRef.current.has(`done:${jobId}`)) continue;
      watchedJobsRef.current.add(jobId);

      const poll = async () => {
        try {
          const res = await fetch(`/api/jobs?jobId=${encodeURIComponent(jobId)}`, { cache: "no-store" });
          if (!res.ok) {
            if (res.status === 404) {
              console.log(`[job-watcher] job ${jobId} not found, stopping poll`);
            }
            return;
          }
          const data = await res.json();
          if (data.status === "completed" || data.status === "failed") {
            if (cancelled || watchedJobsRef.current.has(`done:${jobId}`)) return;
            watchedJobsRef.current.add(`done:${jobId}`);
            const prompt = data.status === "completed"
              ? `Background job ${jobId} has completed. Call shell_status with jobId="${jobId}" and give the user a concise summary. Do not explain that you are doing this.`
              : `Background job ${jobId} has failed${data.exitCode !== null ? ` with exit code ${data.exitCode}` : ""}. Call shell_status with jobId="${jobId}", explain what went wrong, and decide the next step. Do not explain that you are doing this.`;
            sendPrompt(prompt, true);
          } else {
            if (!cancelled) {
              timers.push(window.setTimeout(poll, 2000));
            }
          }
        } catch {
          // Network or other error — stop polling this job
        }
      };
      timers.push(window.setTimeout(poll, 2000));
    }

    return () => {
      cancelled = true;
      for (const t of timers) clearTimeout(t);
    };
  }, [messages, loading, activePage]);

  // ── Operator Assist — state ingestion ──
  // Posts chat state to /api/operator/ingest on a 5s interval.
  // Active whenever an Operator engagement is running (panel toggle ON).
  useEffect(() => {
    if (activePage !== "Chat" || !operatorSessionId) return;
    const interval = setInterval(() => {
      const lastMsg = messages[messages.length - 1];
      const inputEl = document.querySelector<HTMLInputElement>('[data-warden-target="chat-input"]');
      const recentEvents = [`phase:${toolPhase}`, lastMsg ? `last_msg:${lastMsg.role}` : "no_messages"];
      fetch("/api/operator/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lastActivityAt: lastMsg?.timestamp ? new Date(lastMsg.timestamp).toISOString() : new Date().toISOString(),
          lastPhase: toolPhase,
          streamOpen: loading,
          userInputFocused: document.activeElement === inputEl,
          userInputHasText: Boolean(inputEl && inputEl.value && inputEl.value.length > 0),
          lastMessageText: lastMsg?.content || "",
          lastMessageRole: lastMsg?.role || null,
          recentEvents,
          sessionId: activeSession,
          // Send recent messages (last 20, user+assistant only) so the Warden
          // can pass them as history when injecting a continuation prompt.
          messages: messages
            .filter((m: any) => m.role === "user" || m.role === "assistant")
            .slice(-20)
            .map((m: any) => ({ role: m.role, content: m.content })),
        }),
        keepalive: true,
      }).catch(() => { /* swallow; non-fatal */ });
    }, 5000);
    return () => clearInterval(interval);
  }, [activePage, mode, messages, toolPhase, activeSession]);
  // 2026-08-22: token-usage meter reads from a per-month bucket that
  // resets on the 1st of every month. Migration runs once on mount so
  // existing session.tokenUsed sums end up in the current month.
  const [monthlyUsage, setMonthlyUsage] = useState<number>(0);
  useEffect(() => {
    if (typeof window === "undefined") return;
    migrateLegacyTokensIntoCurrentMonth();
    setMonthlyUsage(getCurrentMonthUsage());
    // Tick once per minute so cross-midnight (1st of month) rolls over
    // automatically without a reload.
    const id = setInterval(() => setMonthlyUsage(getCurrentMonthUsage()), 60_000);
    return () => clearInterval(id);
  }, []);
  const totalMonthlyTokens = monthlyUsage;
  // Real context = tokens in the current message window (what we actually send),
  // not cumulative lifetime tokensUsed which only goes up.
  const CONTEXT_LIMIT = 256000;
  // The gauge bar shows used vs the model's real window. Earlier we faked a
  // 16K “session budget” so the bar filled visibly — but 16K is far too small
  // for real work: with OmniRoute 256K windows you'd compact away context
  // the model could still use. Honest window: amber/red only appear when the
  // model genuinely risks overflowing, which is exactly when compaction is
  // useful.
  const CONTEXT_BUDGET = CONTEXT_LIMIT;
  const contextTokens = Math.round(
    messages.reduce((sum, m) => sum + (m.content?.length || 0), 0) / 4
  );
  const [skills, setSkills] = useState<Skill[]>(skillsData);
  const [fileSearch, setFileSearch] = useState("");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [showAgentCreator, setShowAgentCreator] = useState(false);
  const [showWebcam, setShowWebcam] = useState(false);
  // Voice mode removed — sidebar orb section gone (useVoiceRecorder stays for chat mic)
  const [showEmail, setShowEmail] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showMeeting, setShowMeeting] = useState(false);
  const [showVideoEditor, setShowVideoEditor] = useState(false);
  const [showSocial, setShowSocial] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showCRM, setShowCRM] = useState(false);
  const [showDesign, setShowDesign] = useState(false);
  const [showOps, setShowOps] = useState(false);
  const [meetingRoom, setMeetingRoom] = useState<string>("");
  const [meetingName, setMeetingName] = useState<string>("Guest");
  const [meetingBookingId, setMeetingBookingId] = useState<string>("");
  const [agentCreatorStep, setAgentCreatorStep] = useState<"provider" | "chat" | "done">("provider");
  const [agentCreatorProvider, setAgentCreatorProvider] = useState("matrix");
  const [agentCreatorKey, setAgentCreatorKey] = useState("");
  const [agentCreatorEndpoint, setAgentCreatorEndpoint] = useState("");
  const [agentCreatorMessages, setAgentCreatorMessages] = useState<Message[]>([]);
  const [createdAgentId, setCreatedAgentId] = useState<string | null>(null);
  const [customAgents, setCustomAgents] = useState<any[]>([]);
  const [workspaceFiles, setWorkspaceFiles] = useState<{ name: string; type: string; size?: number }[]>([]);
  const [agentCreatorDesc, setAgentCreatorDesc] = useState("");
  const [splashDone, setSplashDone] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const phaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingInjectionRef = useRef<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cloudInputRef = useRef<HTMLInputElement>(null);
  const [forceCloud, setForceCloud] = useState(false);

  // Load agents from API on mount
  useEffect(() => {
    fetch("/api/agents").then(r => r.json()).then(data => {
      if (data.agents?.length) setCustomAgents(data.agents);
    }).catch(() => {});
  }, []);

  // Load workspace files on mount
  useEffect(() => {
    fetch("/api/files").then(r => r.json()).then(data => {
      if (data.files?.length) {
        setWorkspaceFiles(data.files);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => { document.documentElement.classList.toggle("dark", dark); }, [dark]);
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Electron menu: Preferences (Cmd+,) opens the Settings page
  useEffect(() => {
    if (typeof window === "undefined") return;
    const api = (window as any).smythRuntime;
    if (!api?.onOpenPreferences) return;
    const cleanup = api.onOpenPreferences(() => {
      setActivePage("Settings");
    });
    return cleanup;
  }, []);

  // ── Electron runtime: env keys + app info for the Settings page ──
  const [electronEnv, setElectronEnv] = useState<Record<string, string> | null>(null);
  const [electronUserData, setElectronUserData] = useState<string | null>(null);
  const [electronServerStatus, setElectronServerStatus] = useState<{ smyth?: boolean; omniroute?: boolean } | null>(null);
  const [envSaveState, setEnvSaveState] = useState<Record<string, "saving" | "saved" | "error">>({});
  const isElectron = typeof window !== "undefined" && !!(window as any).smythRuntime;

  useEffect(() => {
    if (isElectron) {
      const api = (window as any).smythRuntime;
      api.getEnv?.().then((env: Record<string, string>) => setElectronEnv(env)).catch(() => {});
      api.getUserDataPath?.().then((p: string) => setElectronUserData(p)).catch(() => {});
      api.getServerStatus?.().then((s: any) => setElectronServerStatus(s)).catch(() => {});
      const cleanupStatus = api.onServerStatus?.((s: any) => setElectronServerStatus(s));
      return () => { if (typeof cleanupStatus === "function") cleanupStatus(); };
    } else {
      fetch("/api/env")
        .then((r) => r.json())
        .then((data) => { if (data.env) setElectronEnv(data.env); })
        .catch(() => {});
    }
  }, [isElectron]);

  const saveEnvKey = async (key: string, value: string) => {
    setEnvSaveState((s) => ({ ...s, [key]: "saving" }));
    try {
      if (isElectron) {
        const api = (window as any).smythRuntime;
        if (!api?.setEnv) throw new Error("no runtime");
        await api.setEnv(key, value);
      } else {
        const res = await fetch("/api/env", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, value }),
        });
        if (!res.ok) throw new Error("save failed");
      }
      setElectronEnv((prev) => ({ ...(prev || {}), [key]: value }));
      setEnvSaveState((s) => ({ ...s, [key]: "saved" }));
      setTimeout(() => setEnvSaveState((s) => { const n = { ...s }; delete n[key]; return n; }), 2500);
    } catch {
      setEnvSaveState((s) => ({ ...s, [key]: "error" }));
    }
  };

  // Core send logic — accepts an optional override prompt (used by Operator injection).
  // When overrideText is provided, we don't read from or clear the input field.
  // `hidden` is used by the background-job watcher so the user doesn't see a
  // raw "call shell_status" prompt bubble.
  const sendPrompt = async (overrideText?: string, hidden = false) => {
    const text = overrideText || input.trim();
    if (!text) return;
    const streamTabId = activeTabId; // capture initiating tab — stream writes go HERE, not the active tab
    // Tab-scoped message writer: appends/replaces messages in the initiating tab's thread.
    const writeTab = (updater: (m: Message[]) => Message[]) => {
      updateTabMessages(streamTabId, updater);
      // If the stream belongs to the currently visible tab, mirror into global
      // state so the chat area re-renders (the UI renders from `messages`).
      if (streamTabId === activeTabId) {
        setMessages((m: Message[]) => updater(m));
      }
    };
    // If THIS tab's agent is currently loading, queue the injection to fire when it
    // finishes. Other tabs can stream in parallel — only the same tab serializes.
    if (loading && streamingTabRef.current === activeTabId) {
      console.log(`[operator] tab ${activeTabId} busy, queuing injection: "${text.slice(0, 60)}"`);
      pendingInjectionRef.current = text;
      return;
    }
    if (!overrideText) setInput("");

    // Auto-create a session if none is active (first message on page load)
    if (!activeSession) {
      const now = Date.now();
      const autoTitle = text.slice(0, 50).replace(/\n/g, " ").trim() || "New Chat";
      const n: Session = {
        id: String(now),
        title: autoTitle,
        preview: text.slice(0, 60) + (text.length > 60 ? "..." : ""),
        time: "just now",
        tokensUsed: 0,
        messages: [],
        createdAt: now,
      };
      setSessions((prev: Session[]) => [n, ...prev]);
      setActiveSession(n.id);
    } else if (activeSession && sessions.find(s => s.id === activeSession)?.title === "New Chat") {
      // Rename "New Chat" session from first real message
      const autoTitle = text.slice(0, 50).replace(/\n/g, " ").trim() || "New Chat";
      setSessions((prev: Session[]) => prev.map((s: Session) =>
        s.id === activeSession ? { ...s, title: autoTitle } : s
      ));
    }

    if (!hidden) {
      writeTab((m: Message[]) => [...m, { role: "user", content: text, timestamp: Date.now() }]);
    }
    setLoading(true);
    streamingTabRef.current = activeTabId;
    setStreaming(activeTabId, true);
    setToolPhase("thinking");
    // Auto-switch to "working..." after 4s if still loading (tools taking time)
    phaseTimerRef.current = setTimeout(() => { setToolPhase("working"); }, 4000);

    const controller = new AbortController();
    abortRef.current = controller;
    userStopRef.current = false; // fresh request — not a user stop yet

    // Client-side safety timeout: 21 minutes — slightly ABOVE the server's
    // 20-min cap so the server's retry/rotation logic always gets to finish
    // (or emit a clear error) before the client gives up. Firing this first
    // is what used to cause fake "Interrupted" messages on long tool chains.
    const clientTimeout = setTimeout(() => {
      if (abortRef.current === controller) {
        controller.abort();
      }
    }, 1_260_000);

    try {
      // Always use the normal agent streaming path.
      // The Operator Assist panel watches via /api/operator/ingest +
      // /api/operator/events and injects continuations independently.
      // No special mode routing needed — the panel's toggle is the source of truth.
        const effectiveRouteMode = mode === "offline" ? "offline" : (swarmMode ? "machine" : routeMode);
    // Resolve which model to use:
    //   - offline / swarm / default: use existing selectedModelId logic
    //   - machine + cloud exclusive: use the per-widget cloudModelId (null = rotate Cloud models)
    //   - machine + pro exclusive:   use the per-widget proModelId   (null = rotate Pro models)
    //   - machine + rotate / auto / maetryxx: use the global selectedModelId (or null for pool default)
    // 2026-09-09: per-widget model resolution now covers ALL pools
    // (cloud, pro, nvidia, cloudflare), not just cloud/pro. When a user
    // pins a specific model in any pool widget, that model ID is sent to
    // the server. The server's direct-selection path respects the pool
    // boundary — no cross-pollination.
    const perWidgetModel = (effectiveRouteMode === "machine" && ollamaAccount === "cloud") ? cloudModelId
      : (effectiveRouteMode === "machine" && ollamaAccount === "pro") ? proModelId
      : (effectiveRouteMode === "machine" && ollamaAccount === "nvidia") ? nvidiaModelId
      : (effectiveRouteMode === "machine" && ollamaAccount === "cloudflare") ? cloudflareModelId
      : null;
    const baseModelId = mode === "offline"
      ? "lfm2.5"
      : swarmMode
        ? "kimi-k2.6"
        : effectiveRouteMode === "custom"
          ? (customModel || "")
          : (perWidgetModel || selectedModelId || activeTab?.model || "kimi-k2.7-code");
    const effectiveModel = mode === "offline" ? { id: "lfm2.5", label: "LFM 2.5 (Local)" } : (swarmMode ? { id: "kimi-k2.6", name: "Kimi K2.6" } : { id: baseModelId, label: activeTab?.name || "Smyth" });
    // Build history synchronously at fetch time so the latest selectedModelId
    // is always represented, even if React's setMessages hasn't flushed yet.
    // This is the source of truth for what the backend sees.
    const effectiveHistory = messages.slice(-30).map(m => {
      if (m.role === "system-meta") {
        return { role: "system-meta", model: m.model, pool: m.pool, content: "" };
      }
      return { role: m.role, content: (m.content || "").slice(0, 4000) };
    });

    // Append a synthetic system-meta anchor at the tail of history for the
    // *current* selection, but only if it isn't already there. This guarantees
    // the backend always sees the latest selection regardless of useEffect timing.
    // Resolve from ALL possible model sources (perWidgetModel, cloudModelId, proModelId,
    // selectedModelId) so we never miss a pin.
    const activePinnedForFetch =
      perWidgetModel ||
      (ollamaAccount === "cloud" ? cloudModelId : null) ||
      (ollamaAccount === "pro" ? proModelId : null) ||
      selectedModelId ||
      null;

    if (activePinnedForFetch) {
      const lastMetaIdx = [...effectiveHistory].reverse().findIndex((m: any) => m.role === "system-meta");
      const lastMeta = lastMetaIdx >= 0 ? effectiveHistory[effectiveHistory.length - 1 - lastMetaIdx] : null;
      if (!lastMeta || lastMeta.model !== activePinnedForFetch) {
        effectiveHistory.push({
          role: "system-meta",
          model: activePinnedForFetch,
          pool: effectiveRouteMode === "machine" ? "machine" : effectiveRouteMode,
          content: "",
        });
      }
    }

    const payload: any = {
      message: text,
      model: baseModelId,
      routeMode: effectiveRouteMode,
      ollamaAccount: ollamaAccount,
      customProvider: customProvider,
      customModel: customModel,
      customApiKey: customApiKey,
      history: effectiveHistory,
      deepResearch: mode === "offline" ? false : (swarmMode ? false : deepResearch),
      swarm: mode === "offline" ? false : swarmMode
    };
        if (visionContext) {
          payload.visionContext = visionContext;
          payload.nativeVision = visionContext.nativeVision === true;
        }

        // Use streaming endpoint for real-time tool progress
        let data: any = null;
        try {
          const streamRes = await fetch("/api/agent/stream", { signal: controller.signal, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
          if (streamRes.ok && streamRes.body) {
            const reader = streamRes.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let finalReply = "";
            let streamedReply = "";
            let finalPhases: any[] = [];
            let finalImageUrl: string | null = null;
            let finalTokens = 0;
            let finalModel = "";
            let finalPool = "";

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              
              // Process complete SSE events
              const lines = buffer.split("\n");
              buffer = lines.pop() || ""; // Keep incomplete line in buffer
              
              for (const line of lines) {
                if (!line.startsWith("data: ")) continue;
                const jsonStr = line.slice(6).trim();
                if (!jsonStr) continue;
                try {
                  const event = JSON.parse(jsonStr);
                  
                  if (event.type === "phase") {
                    // Show thinking/working status
                    const phaseLabel = event.phase === "thinking" ? (event.turn !== undefined ? `Thinking (turn ${event.turn + 1})...` : "Thinking...") : "Working...";
                    setToolPhase(phaseLabel);
                  } else if (event.type === "tool_call") {
                    // Show which tool is being called
                    setToolPhase(`Running ${event.tool}...`);
                    // Add tool call bubble
                    writeTab((m: Message[]) => {
                      const last = m[m.length - 1];
                      if (last?.role === "assistant" && last.content.endsWith(`\n⏳ Running ${event.tool}...`)) {
                        return [...m.slice(0, -1), { ...last, content: last.content.replace(/⏳ Running \w+\.\.\./, `⏳ Running ${event.tool}...`) }];
                      }
                      return [...m, { role: "assistant", content: `⏳ Running ${event.tool}...`, timestamp: Date.now() }];
                    });
                  } else if (event.type === "tool_result") {
                    // Tool completed — update the message
                    const resultText = event.result || event.error || "Done";
                    writeTab((m: Message[]) => {
                      const lastIdx = m.length - 1;
                      const last = m[lastIdx];
                      if (last?.role === "assistant" && last.content.includes(`⏳ Running ${event.tool}...`)) {
                        const toolLabel = event.error ? `❌ ${event.tool}: ${event.error.slice(0, 100)}` : `✅ ${event.tool}: ${resultText.slice(0, 100)}`;
                        return [...m.slice(0, lastIdx), { ...last, content: last.content.replace(`⏳ Running ${event.tool}...`, toolLabel) }];
                      }
                      return m;
                    });
                    setToolPhase(`${event.tool} done`);
                  } else if (event.type === "token") {
                    // Streaming token from synthesizer or normal chat — accumulate
                    // into streamedReply so the user sees the reply build up live.
                    streamedReply += event.delta || "";
                    // Update the last assistant message OR create one if needed.
                    writeTab((m: Message[]) => {
                      const last = m[m.length - 1];
                      if (last?.role === "assistant" && (last as any).__streaming === true) {
                        return [...m.slice(0, -1), { ...last, content: streamedReply }];
                      }
                      return [...m, { role: "assistant", content: streamedReply, timestamp: Date.now(), __streaming: true } as any];
                    });
                  } else if (event.type === "complete") {
                    // Mark streaming complete, clear __streaming flag, prefer the
                    // server's final reply (includes any synthesis cleanup).
                    streamedReply = "";
                    writeTab((m: Message[]) => m.map((msg) => {
                      if ((msg as any).__streaming) {
                        return { ...msg, content: event.reply || msg.content, __streaming: undefined } as any;
                      }
                      return msg;
                    }));
                    finalReply = event.reply || "No response.";
                    finalPhases = event.phases || [];
                    finalTokens = event.tokens || 0;
                    finalModel = event.model || "";
                    finalPool = event.pool || "";
                    // Bump Ollama usage widgets — they refresh after this turn to show updated quota
                    setUsageRefreshTrigger((n) => n + 1);
                  } else if (event.type === "error") {
                    writeTab((m: Message[]) => [...m, { role: "assistant", content: `Error: ${event.error}`, timestamp: Date.now() }]);
                    setLoading(false);
                    if (streamingTabRef.current === activeTabId) {
                      streamingTabRef.current = null;
                      setStreaming(activeTabId, false);
                    }
                    return;
                  }
                } catch (e) {
                  // Not valid JSON, skip
                }
              }
            }
            
            // Build final message from the completed response
            data = { reply: finalReply, toolPhases: finalPhases, usage: { total_tokens: finalTokens }, model: finalModel, pool: finalPool, imageUrl: finalImageUrl, deepResearch: payload.deepResearch };
          } else {
            // Fallback to non-streaming
            const res = await fetch("/api/agent", { signal: controller.signal, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
            if (!res.ok) { writeTab((m: Message[]) => [...m, { role: "assistant", content: `Error: ${res.status}`, timestamp: Date.now() }]); return; }
            data = await res.json();
          }
        } catch (streamErr: any) {
          // Fallback to non-streaming on stream error
          const res = await fetch("/api/agent", { signal: controller.signal, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
          if (!res.ok) { writeTab((m: Message[]) => [...m, { role: "assistant", content: `Error: ${res.status}`, timestamp: Date.now() }]); return; }
          data = await res.json();
        }
        const tokens = data.usage?.total_tokens || 0;
        if (tokens > 0 && activeSession) {
          setSessions((prev: Session[]) => prev.map((s: Session) =>
            s.id === activeSession ? { ...s, tokensUsed: s.tokensUsed + tokens } : s
          ));
          // 2026-08-22: record into the monthly bucket so the meter
          // reflects only the current calendar month. Resets on the 1st.
          if (typeof window !== "undefined") {
            setMonthlyUsage(recordMonthlyUsage(tokens));
          }
        }
        // Build content with tool phase markers
        const isDeepResearch = data.deepResearch === true;
        let finalContent = data.reply || "No response.";

        // Check for deep research file output from tool phases
        let researchFiles: { txt: string; md: string } | undefined;
        if (isDeepResearch && data.toolPhases) {
          for (const phase of data.toolPhases) {
            if (phase.tool === "deep_research" && phase.result && phase.result.startsWith("[DEEP_RESEARCH_RESULT]")) {
              const lines = phase.result.split("\n");
              let txt = "", md = "";
              for (const l of lines) {
                if (l.startsWith("txtFile: ")) txt = l.slice(9);
                if (l.startsWith("mdFile: ")) md = l.slice(8);
                if (l.startsWith("summary: ") && !finalContent.includes(l.slice(9))) {
                  const summary = l.slice(9);
                  finalContent = `[Deep Research Complete]\n\n${summary}\n\nFiles saved to research/ directory.`;
                }
              }
              if (txt && md) {
                researchFiles = { txt, md };
                const txtName = txt.split("/").pop() || "research-output.txt";
                const mdName = md.split("/").pop() || "research-output.md";
                finalContent = `[Deep Research Complete]\n\n📄 ${txtName}\n📝 ${mdName}\n\n---\n\n${data.reply || ""}`;
              }
              break;
            }
          }
        }

        if (researchFiles) {
          writeTab((m: Message[]) => [...m, {
            role: "assistant",
            content: finalContent,
            timestamp: Date.now(),
            _researchFiles: researchFiles,
          } as any]);
        } else {
          writeTab((m: Message[]) => [...m, { role: "assistant", content: finalContent, timestamp: Date.now(), imageUrl: data.imageUrl || undefined, fileUrls: data.fileUrls || undefined }]);
        }
        // Clear vision context after use
        setVisionContext(null);
    } catch (err: any) {
      if (err.name === "AbortError" || controller.signal.aborted) {
        if (userStopRef.current) {
          // User pressed Stop — genuine interruption
          setMessages((m: Message[]) => [...m, { role: "assistant", content: "⏸ Interrupted. Awaiting further instruction.", timestamp: Date.now() }]);
        } else {
          // Not a user stop — the request was aborted by the safety timer
          // (server side retries had already run). Tell the user what happened.
          setMessages((m: Message[]) => [...m, { role: "assistant", content: "⏱ This request exceeded the 10-minute safety limit and was stopped. The agent may have been mid-work — try again with a more focused request, or compact the context and retry.", timestamp: Date.now() }]);
        }
      } else {
        // Try to be more helpful than just "Failed to connect"
        const msg = err?.message || String(err);
        let userMsg = "Failed to connect.";
        if (/abort/i.test(msg) || /aborted/i.test(msg)) {
          userMsg = "⏸ Stream interrupted. Awaiting further instruction.";
        } else if (/network|fetch failed|econnrefused|enotfound/i.test(msg)) {
          userMsg = "Network error talking to the agent. The server may be busy — try again in a moment.";
        } else if (msg) {
          userMsg = `Stream error: ${msg.slice(0, 200)}`;
        }
        setMessages((m: Message[]) => [...m, { role: "assistant", content: userMsg, timestamp: Date.now() }]);
      }
    }
    finally {
      setLoading(false); abortRef.current = null; if (phaseTimerRef.current) clearTimeout(phaseTimerRef.current); clearTimeout(clientTimeout);
      if (streamingTabRef.current === activeTabId) {
        streamingTabRef.current = null;
        setStreaming(activeTabId, false);
      }
      // Drain any queued Operator injection
      if (pendingInjectionRef.current) {
        const queued = pendingInjectionRef.current;
        pendingInjectionRef.current = null;
        setTimeout(() => sendPrompt(queued), 100);
      }
    }
  };

  // Public send() — reads from the input field
  const send = async () => { await sendPrompt(); };

  const stop = () => {
    if (phaseTimerRef.current) clearTimeout(phaseTimerRef.current);
    if (abortRef.current) {
      userStopRef.current = true;  // user pressed Stop — real interruption
      abortRef.current.abort();
    }
    setLoading(false);
    if (streamingTabRef.current === activeTabId) {
      streamingTabRef.current = null;
      setStreaming(activeTabId, false);
    }
  };

  const userStopRef = useRef(false);

  const newSession = () => {
    setActivePage("Chat"); setInput("");
    const now = Date.now();
    // Save current session messages before switching
    if (activeSession && messages.length > 0) {
      setSessions((prev: Session[]) => prev.map((s: Session) =>
        s.id === activeSession
          ? { ...s, messages: messages as any, preview: (() => {
        const lastVisible = [...messages].reverse().find((m) => m.role !== "system-meta");
        const last = messages[messages.length - 1];
        const head = lastVisible ? lastVisible.content.slice(0, 60) : "";
        return head + (last && typeof last.content === "string" && last.content.length > 60 ? "..." : "");
      })(), time: timeAgo(s.createdAt) }
          : s
      ));
    }
    const n: Session = { id: String(now), title: "New Chat", preview: "Started just now...", time: "just now", tokensUsed: 0, messages: [], createdAt: now };
    setSessions((s: Session[]) => [n, ...s]);
    setActiveSession(n.id);
    setMessages([]);
    saveCachedMessages([]);
    // Reset splash flag so the cinematic shows on next fresh start
    try { localStorage.removeItem("smyth-splash-done"); } catch {}
  };

  const loadSession = (id: string) => {
    const s = sessions.find(x => x.id === id);
    if (!s) return;
    setActiveSession(id);
    setActivePage("Chat");
    setMessages(s.messages || []);
  };

  const deleteSession = (id: string) => {
    if (!confirm("Delete this session permanently?")) return;
    setSessions((s: Session[]) => s.filter((x) => x.id !== id));
    // Also remove its rolling memory file (manual cleanup gesture)
    fetch(`/api/chat/memory?sessionId=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
    if (activeSession === id) {
      setActiveSession(null);
      setActivePage("Chat");
      setMessages([]);
    }
  };

  const downloadSession = async (s: Session) => {
    // If downloading the active session, use live messages state (not stale localStorage copy)
    const msgs = s.id === activeSession ? messages : (s.messages || []);
    // Fetch the rolling memory file (archived compacted sections) so the
    // download is the COMPLETE conversation, not just the live window.
    let memoryMd = "";
    try {
      const res = await fetch(`/api/chat/memory-file?sessionId=${encodeURIComponent(s.id)}&title=${encodeURIComponent(s.title || "chat")}`);
      if (res.ok) {
        const data = await res.json();
        if (data.content) memoryMd = data.content;
      }
    } catch {}
    const lines: string[] = [];
    lines.push(`# ${s.title}`);
    lines.push("");
    lines.push(`**Date:** ${s.time}`);
    lines.push(`**Session ID:** ${s.id}`);
    lines.push(`**Tokens Used:** ${s.tokensUsed}`);
    lines.push("");
    if (memoryMd) {
      lines.push("> 📦 Includes archived sections from this chat's rolling memory file.");
      lines.push("");
      lines.push(memoryMd);
      lines.push("");
      lines.push("---");
      lines.push("");
      lines.push("## 💬 Live window");
      lines.push("");
    }
    lines.push("---");
    lines.push("");
    for (const msg of msgs) {
      const role = msg.role === "user" ? "👤 **User**" : "🤖 **Smyth**";
      lines.push(role);
      lines.push("");
      lines.push(msg.content || "");
      lines.push("");
      if (msg.imageUrl) {
        lines.push(`![Image](${msg.imageUrl})`);
        lines.push("");
      }
      if (msg.fileUrls && msg.fileUrls.length > 0) {
        lines.push(`**Attachments:** ${msg.fileUrls.map(f => f.name).join(", ")}`);
        lines.push("");
      }
      lines.push("---");
      lines.push("");
    }
    const md = lines.join("\n");
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safeTitle = s.title.replace(/[^a-zA-Z0-9-_ ]/g, "").replace(/\s+/g, "_").slice(0, 60);
    a.download = `${safeTitle || "smyth_session"}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const toggleSkill = (id: string) => setSkills((s: Skill[]) => s.map((sk) => sk.id === id ? { ...sk, installed: !sk.installed } : sk));
  const openWorkspace = () => window.open("/api/workspace", "_blank");
  const openFile = (name: string) => {
    setSelectedFile(name);
    setActivePage("Files");
    // If it's an image, we could open it in the workspace viewer
    const ext = name.split(".").pop()?.toLowerCase();
    if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext || "")) {
      window.open(`/api/workspace?file=${encodeURIComponent(name)}`, "_blank");
    }
  };
  const handleAttach = () => fileInputRef.current?.click();
  const handleFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fs = e.target.files; if (!fs || fs.length === 0) return;
    const file = fs[0];
    const isImage = file.type.startsWith("image/");
    const isText = file.type.startsWith("text/") || /\.(md|txt|csv|json|xml|yaml|yml|log|env|cfg|ini|toml|js|ts|tsx|jsx|py|rb|go|rs|java|c|cpp|h|hpp|css|html|sh|bash|zsh|sql|graphql|svg)$/i.test(file.name);

    if (isImage) {
      // Delegate to image handler
      handleImagePick(e);
      return;
    }

    setMessages((m: Message[]) => [...m, { role: "assistant", content: `📎 Reading ${file.name}...`, timestamp: Date.now() }]);

    try {
      const content = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Failed to read file"));
        if (isText) reader.readAsText(file);
        else reader.readAsDataURL(file);
      });

      // Build a message that includes the file content
      const fileMessage = isText
        ? `[File: ${file.name}]\n\`\`\`\n${content.slice(0, 32000)}\n\`\`\`\n\nPlease analyze this file.`
        : `[File attached: ${file.name} (${(file.size / 1024).toFixed(1)} KB, ${file.type})]`;

      // Remove the "Reading..." message and send the file content
      setMessages((m: Message[]) => {
        const withoutReading = m.slice(0, -1);
        return [...withoutReading, { role: "user", content: fileMessage, timestamp: Date.now() }];
      });

      // Auto-send to agent
      sendPrompt(fileMessage, true);
    } catch {
      setMessages((m: Message[]) => [
        ...m.slice(0, -1),
        { role: "assistant", content: `❌ Failed to read ${file.name}`, timestamp: Date.now() },
      ]);
    }

    // Reset input so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = "";
  };
  const imageInputRef = useRef<HTMLInputElement>(null);
  const { state: recState, audioLevel, startRecording, stopAndGetBlob, cancelRecording } = useVoiceRecorder();
  // ── Voice Conversation Hook ──




  const handleImagePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fs = e.target.files; if (!fs || fs.length === 0) return;
    const file = fs[0];
    setMessages((m: Message[]) => [...m, { role: "assistant", content: `🖼 Analyzing image: ${file.name}...`, timestamp: Date.now() }]);
    setLoading(true);
    try {
      // Convert file to base64 for the agent route (Echo Vision runs server-side)
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(",")[1]);
        };
        reader.readAsDataURL(file);
      });
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Analyze this image",
          model: activeTab?.model || "kimi-k2.6",
          routeMode,
          image: {
            base64,
            mimeType: file.type,
            filename: file.name,
          },
        }),
      });
      const data = await res.json();
      setMessages((m: Message[]) => [
        ...m.slice(0, -1), // remove the "analyzing..." message
        { role: "assistant", content: data.reply || `Image "${file.name}" processed.`, timestamp: Date.now() },
      ]);
      // Store vision context for follow-up questions
      setVisionContext(data.visionContext || null);
    } catch {
      setMessages((m: Message[]) => [...m, { role: "assistant", content: `Failed to process image: ${file.name}`, timestamp: Date.now() }]);
    } finally { setLoading(false); }
  };

  // Cloud upload — file/folder/video/image sent directly to an Ollama Cloud
  // model with vision + tools. Uses the streaming endpoint to surface the
  // reply as a live token stream in the chat bubble. Multiple files allowed.
  // Cloud upload —

  const handleCloudPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fs = e.target.files; if (!fs || fs.length === 0) return;
    setForceCloud(true);
    setLoading(true);
    // Declare here so both try and catch can access it.
    let finalizeBubble: (final: string) => void = () => {};
    try {
      // Pick the most-likely-capable file (the one with image/video/PDF content
      // gets routed through vision; everything else gets the text/tools path).
      const filesArr = Array.from(fs);
      const primary = filesArr[0];
      // The streaming assistant bubble is created up-front and held by an id.
      // Both the streaming-token path (live updates) and the complete-event
      // path (single-shot reply, e.g. when the orchestrator returns the final
      // answer in one shot without streaming) find the same bubble by id.
      // Without this, a single-shot 'complete' reply would never overwrite
      // the placeholder because the bubbles wouldn't match by id.
      const streamingId = `s-cloud-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
      setMessages((m: Message[]) => [
        ...m,
        {
          role: "assistant",
          content: `☁️ Sending ${primary.name} to Ollama Cloud…`,
          timestamp: Date.now(),
          // Used by the streaming/complete handlers below to write back.
          _streamingId: streamingId,
        } as any,
      ]);
      const writeToBubble = (next: string) => setMessages((m: Message[]) =>
        m.map((msg: any) => msg._streamingId === streamingId ? { ...msg, content: next } : msg)
      );
      finalizeBubble = (final: string) => setMessages((m: Message[]) =>
        m.map((msg: any) => msg._streamingId === streamingId ? { ...msg, content: final, _streamingId: undefined } as any : msg)
      );

      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(",")[1]);
        };
        reader.onerror = () => reject(new Error("file read failed"));
        reader.readAsDataURL(primary);
      });

      // Stream the response so the user sees tokens appear live, just like
      // a normal chat reply. forceCloud locks routing to the machine/Cloud
      // pool regardless of the toolbar's current selection.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 300_000);

      const res = await fetch("/api/agent/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Describe and analyze this file in full detail.",
          routeMode: "machine",
          ollamaAccount: ollamaAccount,
          forceCloud: true,
          history: messages,
          image: {
            base64,
            mimeType: primary.type || "application/octet-stream",
            filename: primary.name,
          },
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.body) {
        setMessages((m: Message[]) => [...m, { role: "assistant", content: "Cloud did not return a stream.", timestamp: Date.now() }]);
        return;
      }

      const streamReader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamedReply = "";
      while (true) {
        const { value, done } = await streamReader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE events separated by blank lines.
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";
        for (const ev of events) {
          for (const line of ev.split("\n")) {
            const payload = line.replace(/^data: /, "").trim();
            if (!payload) continue;
            try {
              const parsed = JSON.parse(payload);
              if (parsed.type === "token" && parsed.delta) {
                streamedReply += parsed.delta;
                writeToBubble(streamedReply);
              } else if (parsed.type === "complete") {
                // Single-shot reply. The bubble is identified by
                // _streamingId, so this works whether or not tokens arrived
                // first.
                finalizeBubble(parsed.reply || streamedReply);
              } else if (parsed.type === "error") {
                streamedReply = (streamedReply || "") + `\n\n⚠️ ${parsed.error || "cloud error"}`;
                finalizeBubble(streamedReply);
              }
            } catch { /* ignore non-JSON heartbeats */ }
          }
        }
      }
    } catch (e: any) {
      const friendly = e?.name === "AbortError"
        ? "Cloud upload timed out."
        : (e?.message || String(e));
      try { finalizeBubble(`Cloud upload failed: ${friendly}`); }
      catch { /* finalizeBubble may not exist if request never made it that far; fall back below */ }
      // Fallback: if streaming bubble hasn't been created yet (failure before fetch), append a fresh assistant message.
      setMessages((m: Message[]) => {
        const hasCloudPlaceholder = m.some((msg: any) => msg._streamingId);
        if (!hasCloudPlaceholder) {
          return [...m, { role: "assistant", content: `Cloud upload failed: ${friendly}`, timestamp: Date.now() }];
        }
        return m;
      });
    } finally {
      setLoading(false);
      // Reset the input so the same file can be picked again if needed
      if (cloudInputRef.current) cloudInputRef.current.value = "";
    }
  };

  const filteredSessions = sessions.filter((s) => s.title.toLowerCase().includes(searchQuery.toLowerCase()));
  const filteredFiles = workspaceFiles.filter((f) => f.name.toLowerCase().includes(fileSearch.toLowerCase()));

  const createAgent = async (description: string) => {
    const res = await fetch("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description,
        provider: agentCreatorProvider,
        apiKey: agentCreatorKey || undefined,
        endpoint: agentCreatorEndpoint || undefined,
      }),
    });
    return res.json();
  };

  const selfNameAgent = async (agentId: string, name: string) => {
    const res = await fetch("/api/agents/manage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, name }),
    });
    return res.json();
  };

  // Splash: always show on fresh page load (including page refresh with conversation)
  // Messages will be restored from cache after splash completes
  if (!mounted) return <div style={{display:'none'}} />;
  if (!splashDone) {
    return <SmythSplash onDone={() => {
      setSplashDone(true);
    }} />;
  }

  // ── Shared runtime sections: rendered in the right sidebar normally,
  // moved into the Settings page when it's active (single mount — the
  // aside hides them while Settings is open so panels don't double-mount).
  const runtimeSections = (
    <>
{/* ── Runtime ── */}
<div className="right-section">
  <div className="section-label">Mode</div>
  <div className="flex flex-col gap-1">
    {[
      { id: "offline" as Mode, icon: Cloud, label: "Cloud" },
      { id: "cloud" as Mode, icon: Network, label: "API Routing" },
      { id: "swarm" as Mode, icon: SwarmIcon, label: "Swarm" },
    ].map((m) => (
      <button key={m.id} onClick={() => { setMode(m.id); if (m.id === "swarm") { setSwarmMode(true); } else { setSwarmMode(false); } }} className={`flex items-center gap-2 w-full bg-none border-none text-muted px-3 py-1.5 rounded-md text-sm cursor-pointer hover:bg-muted-bg hover:text-foreground transition-colors ${mode === m.id ? "bg-accent/10 text-accent" : ""}`}>
        <m.icon size={16} strokeWidth={1.5} /><span>{m.label}</span>
        {mode === m.id && <span className="ml-auto text-accent text-xs">●</span>}
      </button>
    ))}
  </div>
</div>

<div className="right-section">
  <div className="section-label">Routing Pool</div>
  <div className="flex flex-col gap-1">
    <button onClick={() => {
      setRouteMode("machine");
      setOllamaAccount("cloudflare"); // Cloudflare is the new default routing pool
      setSelectedModelId(null);
    }} className={`flex items-center gap-2 w-full bg-none border-none text-muted px-3 py-1.5 rounded-md text-sm cursor-pointer hover:bg-muted-bg hover:text-foreground transition-colors ${routeMode === "machine" && ollamaAccount === "cloudflare" ? "bg-accent/10 text-accent" : ""}`}>
      <img src="/cloudflare-icon.svg" alt="Cloudflare" className="inline-block h-4 w-4 shrink-0" />
      <span>Cloudflare</span>
      {routeMode === "machine" && ollamaAccount === "cloudflare" && <span className="ml-auto text-accent text-xs">●</span>}
    </button>
    {routeMode === "machine" && ollamaAccount === "cloudflare" && (
      <div className="px-3 mt-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted">Model:</span>
          <select
            value={cloudflareModelId || ""}
            onChange={(e) => setCloudflareModelId(e.target.value || null)}
            className="flex-1 appearance-none bg-muted-bg border border-border rounded-sm pl-2 pr-6 py-1 text-[11px] text-foreground hover:bg-accent/10 hover:border-accent/30 transition-colors cursor-pointer outline-none focus:border-accent"
            style={{ fontFamily: "inherit" }}
          >
            <option value="">Routing Pool (rotate all)</option>
            {CLOUDFLARE_AI_MODELS.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>
      </div>
    )}
    <button onClick={() => {
      setRouteMode("machine");
      setOllamaAccount("nvidia"); // NVIDIA NIM pool (local proxy on :8766)
      setSelectedModelId(null);
    }} className={`flex items-center gap-2 w-full bg-none border-none text-muted px-3 py-1.5 rounded-md text-sm cursor-pointer hover:bg-muted-bg hover:text-foreground transition-colors ${routeMode === "machine" && ollamaAccount === "nvidia" ? "bg-accent/10 text-accent" : ""}`}>
      <img src="/nvidia-icon.png" alt="NVIDIA" className="inline-block h-4 w-4 shrink-0" />
      <span>NVIDIA</span>
      {routeMode === "machine" && ollamaAccount === "nvidia" && <span className="ml-auto text-accent text-xs">●</span>}
    </button>
    {routeMode === "machine" && ollamaAccount === "nvidia" && (
      <div className="px-3 mt-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted">Model:</span>
          <select
            value={nvidiaModelId || ""}
            onChange={(e) => {
              const v = e.target.value || null;
              setNvidiaModelId(v);
              // Pin the selection so server uses findModel() path
              if (v) setSelectedModelId(v);
              else setSelectedModelId(null);
            }}
            className="flex-1 appearance-none bg-muted-bg border border-border rounded-sm pl-2 pr-6 py-1 text-[11px] text-foreground hover:bg-accent/10 hover:border-accent/30 transition-colors cursor-pointer outline-none focus:border-accent"
            style={{ fontFamily: "inherit" }}
          >
            <option value="">Routing Pool (rotate all)</option>
            {NVIDIA_POOL_MODELS.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>
      </div>
    )}
    <button onClick={() => {
      setRouteMode("machine");
      setOllamaAccount("rotate"); // explicit Machine → rotate both keys
    }} className={`flex items-center gap-2 w-full bg-none border-none text-muted px-3 py-1.5 rounded-md text-sm cursor-pointer hover:bg-muted-bg hover:text-foreground transition-colors ${routeMode === "machine" && ollamaAccount === "rotate" ? "bg-accent/10 text-accent" : ""}`}>
      <img src="/ollama-icon.svg" alt="Ollama" className="inline-block h-4 w-4 shrink-0" style={{ filter: "brightness(0) saturate(100%) invert(62%) sepia(8%) saturate(419%) hue-rotate(176deg) brightness(94%) contrast(86%)" }} />
      <span>Ollama Pool</span>
      {routeMode === "machine" && ollamaAccount === "rotate" && <span className="ml-auto text-accent text-xs">●</span>}
    </button>
  </div>
</div>

{/* ── Ollama Account (exclusive routing + live usage) ── */}
{routeMode === "machine" && (
  <div className="right-section">
    <div className="section-label">Ollama Account</div>
    <div className="flex flex-col gap-1.5">
      <OllamaUsageWidget
        account="cloud"
        label="Ollama Cloud Routing System"
        icon="cloud"
        active={ollamaAccount === "cloud"}
        onSelect={() => {
          setRouteMode("machine");
          setOllamaAccount("cloud");
        }}
        refreshTrigger={usageRefreshTrigger}
        availableModels={OLLAMA_CLOUD_MODELS.map((m) => ({ id: m.id, name: m.name }))}
        selectedModelId={cloudModelId}
        onModelChange={setCloudModelId}
      />
      <OllamaUsageWidget
        account="pro"
        label="Ollama Pro Model Routing System"
        icon="pro"
        active={ollamaAccount === "pro"}
        onSelect={() => {
          setRouteMode("machine");
          setOllamaAccount("pro");
        }}
        refreshTrigger={usageRefreshTrigger}
        availableModels={OLLAMA_PRO_MODELS.map((m) => ({ id: m.id, name: m.name }))}
        selectedModelId={proModelId}
        onModelChange={setProModelId}
      />
    </div>
  </div>
)}

{/* ── AI Providers (switchboard) ── */}
{routeMode !== "offline" && (
  <div className="right-section">
    <div className="section-label">AI Providers</div>
    <ProviderSwitchboard
      active={routeMode === "custom"}
      activeProvider={customProvider}
      activeModel={customModel}
      onSelect={(providerId, modelId) => {
        setCustomProvider(providerId);
        setCustomModel(modelId);
        setRouteMode("custom");
        setOllamaAccount("rotate");
        setCustomApiKey("");
        setCustomApiKeySet(true);
      }}
      onAddKey={async (providerId, key) => {
        const keyName = getProviderKeyName(providerId);
        await saveEnvKey(keyName, key);
      }}
      onDeactivate={() => setRouteMode("auto")}
    />
  </div>
)}

{/* ── MCP Servers (live status of all configured connections) ── */}
<div className="right-section">
  <div className="section-label">MCP Servers</div>
  <MCPStatusPanel />
</div>
    </>
  );

  return (
    <div className="flex flex-1 h-screen overflow-hidden bg-background text-foreground">

      {/* ═══ LEFT PANEL ═══ */}
      <aside className="w-[260px] shrink-0 border-r border-border bg-surface flex flex-col overflow-hidden min-h-0">
        <div className="flex items-center gap-2 px-3.5 py-2 border-b border-border min-h-[48px]">
          <div className="w-[33px] h-[33px] shrink-0 flex items-center justify-center overflow-hidden">
            <img src="/Artwork/Logocircle2-circle.png" alt="Smyth" className="w-full h-full object-contain" />
          </div>
          <div className="flex flex-col justify-center leading-none flex-1">
            <span className="font-display text-[20px] font-bold tracking-[0.2em] text-accent">SMYTH</span>
            <span className="font-sans text-[10px] font-medium tracking-wide text-muted">Super Agent</span>
          </div>
          <ThemeToggle />
        </div>
        <EchoVisionDaemon />
        <div className="px-2.5 pt-2 pb-1">
          <button onClick={newSession} className="flex items-center justify-center gap-1.5 w-full border border-dashed border-border bg-muted-bg hover:bg-accent/10 hover:border-accent rounded-sm py-2 text-xs text-muted hover:text-accent cursor-pointer transition-all font-sans">
            <Plus size={14} strokeWidth={1.5} /><span>New Session</span>
          </button>
        </div>
        <div className="px-2.5 pb-1">
          <input
            className="w-full border border-border bg-background rounded-sm px-2.5 py-1.5 text-xs outline-none placeholder:text-muted focus:border-accent focus:shadow-[0_0_0_2px_var(--accent-glow)]"
            placeholder="Search sessions..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <nav className="flex-1 overflow-y-auto px-1.5 py-1">
          <div className="text-[10px] font-semibold text-muted uppercase tracking-wider px-2 pt-3 pb-1">Workspace</div>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.label} onClick={() => setActivePage(item.label)}
                className={`flex items-center gap-2 w-full px-2 py-1.5 rounded text-xs cursor-pointer border-none transition-all font-sans text-left ${activePage === item.label ? "bg-accent/10 text-accent" : "text-muted hover:bg-muted-bg hover:text-foreground"}`}>
                <Icon size={15} className="shrink-0" strokeWidth={1.5} /><span>{item.label}</span>
                {item.label === "Sessions" && <span className="ml-auto text-[9px] bg-muted-bg px-1.5 rounded text-muted">{filteredSessions.length}</span>}
                {item.label === "Skills" && <span className="ml-auto text-[9px] bg-accent/10 text-accent px-1.5 rounded">{skills.filter(s => s.installed).length}/{skills.length}</span>}
                {item.label === "Agents" && <span className="ml-auto text-[9px] bg-muted-bg px-1.5 rounded text-muted">{customAgents.length + 1}</span>}
                {item.label === "Files" && <span className="ml-auto text-[9px] bg-muted-bg px-1.5 rounded text-muted">{workspaceFiles.length}</span>}
              </button>
            );
          })}
          <button onClick={openWorkspace} className="text-accent font-mono cursor-pointer text-left bg-none border-none flex items-center gap-1 px-2 py-0.5 text-[11px] w-full mt-1 hover:opacity-75 hover:underline">
            <FolderOpen size={12} /> ~/smyth-super-agent
          </button>
          <div className="text-[10px] font-semibold text-muted uppercase tracking-wider px-2 pt-3 pb-1">Sessions</div>
          {filteredSessions.map((s) => (
            <div key={s.id} className="flex items-stretch group hover:bg-muted-bg rounded transition-all">
              <button onClick={() => loadSession(s.id)}
                className={`flex-1 min-w-0 text-left px-2 py-1.5 cursor-pointer border-none bg-none font-sans transition-all ${activeSession === s.id ? "bg-accent/10" : ""}`}>
                <div className="text-xs font-medium text-foreground truncate">{s.title}</div>
                <div className="text-[10.5px] text-muted truncate">{s.preview}</div>
                <div className="text-[10px] text-muted">{s.time}</div>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); downloadSession(s); }}
                className="flex items-center justify-center w-7 self-stretch text-muted hover:text-accent hover:bg-accent/10 px-1 rounded cursor-pointer bg-none border-none transition-all text-xs shrink-0"
                title="Download as markdown"
              >
                <Download size={12} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                className="flex items-center justify-center w-7 self-stretch text-muted hover:text-red-500 hover:bg-red-500/10 px-1 rounded cursor-pointer bg-none border-none transition-all text-xs shrink-0"
                title="Delete session"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </nav>

      </aside>

      {/* ═══ CENTER PANEL ═══ */}
      <main className="flex-1 flex flex-col min-w-0 min-h-0 relative">
        {loading && <ThinkingBackground active={true} />}
        <div className="flex items-center justify-between px-3.5 py-2 border-b border-border bg-surface relative z-10">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{activePage}</span>
            {compiling && (
              <div className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-accent/10 text-accent">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent mr-1 animate-pulse" />
                Compiling...
              </div>
            )}
            {!compiling && (
              <div className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${mode === "operator" ? "bg-amber-500/10 text-amber-500" : "bg-accent/10 text-accent"}`}>
                {mode === "offline" ? "Cloud" : mode === "operator" ? "Operator" : "API Routing"}
              </div>
            )}
            {activePage === "Chat" && activeTab && (
              <ModelSelector activeTab={activeTab} tabs={tabs} onSwitchVariant={switchVariant} />
            )}
          </div>
          <div className="flex gap-1.5 text-muted cursor-pointer">
            {activePage === "Chat" && <button onClick={() => { setMessages([]); const n: Session = { id: String(Date.now()), title: "New Chat", preview: "Started just now...", time: "just now", tokensUsed: 0, messages: [], createdAt: Date.now() }; setSessions(prev => [n, ...prev]); setActiveSession(n.id); }} title="New Session" className="hover:text-foreground bg-none border-none p-1 cursor-pointer"><SquarePen size={16} strokeWidth={1.5} /></button>}
            <button title="More" className="hover:text-foreground bg-none border-none p-1 cursor-pointer"><MoreHorizontal size={16} strokeWidth={1.5} /></button>
          </div>
        </div>

        {/* ═══ Chat ═══ */}
        {activePage === "Chat" && (
          <div className="flex-1 flex flex-col min-h-0">
            {/* Agent Tab Bar */}
            <TabBar
              tabs={tabs}
              activeTabId={activeTabId}
              usedVariantIds={usedVariantIds}
              canAddTab={canAddTab}
              onSelectTab={setActiveTabId}
              onCloseTab={closeTab}
              onAddTab={addTab}
              onOpenInNewTab={openInNewTab}
            />
            <OperatorStatus
              operatorSessionId={operatorSessionId}
              onSessionIdChange={setOperatorSessionId}
              onInjection={(prompt, reply, model) => {
                // Warden injection — trigger the real send flow with the
                // continuation prompt so the agent streams a proper response
                // in the chat UI with tool progress, thinking phases, etc.
                sendPrompt(`🛡️ [Operator] ${prompt}`);
              }}
            />
            <div ref={chatScrollRef} data-warden-target="chat-panel" className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3.5 scroll-smooth relative z-10">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-muted gap-4 animate-fade-in-up">
                  <div className="w-16 h-16 rounded-full bg-surface border border-border flex items-center justify-center overflow-hidden glow-blue">
                    <img src="/Artwork/Logocircle2-circle.png" alt="" className="w-full h-full object-contain" />
                  </div>
                  <div className="flex flex-col items-center gap-1.5">
                    <p className="font-display text-sm font-bold tracking-[0.15em] text-foreground">SMYTH</p>
                    <p className="text-xs text-muted">Choose a mode and start typing</p>
                  </div>
                  <div className="flex gap-2 mt-2">
                    {["Write code", "Analyze data", "Creative brief"].map((hint) => (
                      <span key={hint} className="px-3 py-1.5 rounded-md border border-border bg-muted-bg text-[11px] text-muted cursor-default">
                        {hint}
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                messages.filter((m) => !m.hidden).map((msg, i) => (
                  <div key={i} className={`flex animate-fade-in-up ${msg.role === "user" ? "justify-end" : "justify-start"}`} style={{ position: 'relative', zIndex: 2 }}>
                    <div className={`max-w-[72%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed backdrop-blur-sm ${msg.role === "user" ? "bg-accent/10 border border-accent/30" : "bg-surface/85 border border-border"}`}>
                      {msg.role === "assistant" && (
                        <div className="flex items-center gap-1.5 text-[10.5px] font-semibold text-muted mb-1">
                          <span className="w-4 h-4 rounded-full overflow-hidden shrink-0 bg-white flex items-center justify-center"><img src="/Artwork/Logocircle2-circle.png" alt="" className="w-full h-full object-contain" /></span>
                          {mode === "operator" ? "Smyth Operator" : "Smyth Agent"}
                        </div>
                      )}
                      <ChatMessage content={msg.content} />
                      {/* Show generated image if present */}
                      {(msg as any).imageUrl && (
                        <div className="mt-2.5 pt-2.5 border-t border-border">
                          <img src={(msg as any).imageUrl} alt="Generated image" className="w-full rounded-lg border border-border max-h-80 object-contain bg-black/20" />
                          <a href={(msg as any).imageUrl} target="_blank" className="mt-1.5 inline-flex items-center gap-1 text-xs text-accent hover:underline">
                            <ExternalLink size={12} /> Open full size
                          </a>
                        </div>
                      )}
                      {/* Show generated/downloadable files */}
                      {(msg as any).fileUrls && (msg as any).fileUrls.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-2.5 pt-2.5 border-t border-border">
                          {(msg as any).fileUrls.map((f: any, fi: number) => (
                            <a key={fi} href={`/api/workspace?file=${encodeURIComponent(f.name)}`} target="_blank" className="flex items-center gap-1.5 text-xs font-medium text-accent hover:text-accent/80 underline decoration-accent/30 hover:decoration-accent/60 bg-none border border-border rounded px-2 py-1 hover:bg-muted-bg transition-colors">
                              <FileText size={13} strokeWidth={1.5} />
                              {f.name}
                              <ExternalLink size={10} strokeWidth={1.5} className="opacity-50" />
                            </a>
                          ))}
                        </div>
                      )}
                      {/* Show audio player for TTS messages */}
                      {(msg as any).role === "assistant" && (msg as any).content.includes("Audio generated") && (msg as any).content.match(/workspace\/([^\s]+)\.wav/) && (
                        <VoicePlayer
                          src={(msg as any).content.match(/workspace\/([^\s]+\.wav)/)?.[0] || ""}
                          label="Smyth Voice"
                        />
                      )}
                      {/* Show download links for deep research results */}
                      {(msg as any)._researchFiles && (
                        <div className="flex gap-3 mt-3 pt-2.5 border-t border-border">
                          <a href={`/api/research?file=${encodeURIComponent((msg as any)._researchFiles.txt)}`} target="_blank" className="flex items-center gap-1.5 text-xs font-medium text-accent hover:text-accent/80 underline decoration-accent/30 hover:decoration-accent/60 bg-none border-none cursor-pointer">
                            <FileText size={14} /> {(msg as any)._researchFiles.txt.split("/").pop()}
                          </a>
                          <a href={`/api/research?file=${encodeURIComponent((msg as any)._researchFiles.md)}`} target="_blank" className="flex items-center gap-1.5 text-xs font-medium text-accent hover:text-accent/80 underline decoration-accent/30 hover:decoration-accent/60 bg-none border-none cursor-pointer">
                            <FileText size={14} /> {(msg as any)._researchFiles.md.split("/").pop()}
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
              {loading && <ThinkingIndicator mode={toolPhase} />}
              <div ref={endRef} />
            </div>
            <div className="border-t border-border bg-surface px-3.5 py-2.5 relative z-10">
              {deepResearch && (
                <div className="text-[10px] text-accent font-mono mb-1.5 px-1 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                  Deep Research mode — queries use Parallel Web API credits. Write your query and get results as downloadable files.
                </div>
              )}
              {swarmMode && (
                <div className="text-[10px] text-emerald-400 font-mono mb-1.5 px-1 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Swarm will activate multiple agents and consume a heavy number of tokens. Be very clear in your instructions.
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <button onClick={handleAttach} className="bg-none border-none text-muted cursor-pointer px-1.5 py-1 rounded hover:bg-muted-bg hover:text-foreground" title="Attach"><Paperclip size={18} strokeWidth={1.5} /></button>
                <button onClick={() => imageInputRef.current?.click()} className="bg-none border-none text-muted cursor-pointer px-1.5 py-1 rounded hover:bg-muted-bg hover:text-foreground" title="Upload Image"><Image size={18} strokeWidth={1.5} /></button>
                <button onClick={openWorkspace} className="bg-none border-none text-muted cursor-pointer px-1.5 py-1 rounded hover:bg-muted-bg hover:text-foreground" title="Folder"><FolderOpen size={18} strokeWidth={1.5} /></button>
                <button onClick={() => cloudInputRef.current?.click()} className={`bg-none border-none cursor-pointer px-1.5 py-1 rounded hover:bg-muted-bg ${forceCloud ? 'text-sky-400 bg-sky-400/10' : 'text-muted hover:text-foreground'}`} title={forceCloud ? "Cloud Send (ON) — uploads to Ollama Cloud model with vision/tools" : "Send to Cloud (Ollama) — uploads file/folder/video/image directly to a capable Cloud model"}><Cloud size={18} strokeWidth={1.5} /></button>
                <button onClick={() => setDeepResearch(!deepResearch)} className={`bg-none border-none cursor-pointer px-1.5 py-1 rounded hover:bg-muted-bg ${deepResearch ? "text-accent bg-accent/10" : "text-muted hover:text-foreground"}`} title="Deep Research (Parallel Web)"><Search size={18} strokeWidth={1.5} /></button>
                <button onClick={() => { setSwarmMode(!swarmMode); if (!swarmMode && mode === "operator") setMode("cloud"); }} className={`bg-none border-none cursor-pointer px-1.5 py-1 rounded hover:bg-muted-bg ${swarmMode ? "text-emerald-400 bg-emerald-400/10" : "text-muted hover:text-foreground"}`} title="Agent Swarm (Kimi K2.6)"><SwarmIcon size={18} strokeWidth={1.5} active={swarmMode} /></button>
                <button onClick={() => setShowMailboxes(true)} className="bg-none border-none text-muted cursor-pointer px-1.5 py-1 rounded hover:bg-muted-bg hover:text-foreground" title="Mailboxes — manage email inboxes"><Inbox size={18} strokeWidth={1.5} /></button>
                <input type="file" ref={fileInputRef} onChange={handleFilePicked} multiple className="hidden" />
                <input type="file" ref={imageInputRef} onChange={handleImagePick} accept="image/*" className="hidden" />
                <input type="file" ref={cloudInputRef} onChange={handleCloudPicked} multiple className="hidden" />

                {/* 2026-08-22: transient mic error banner — surfaces permission / device failures */}
                {recError && (
                  <div className="mx-2 mb-1 px-3 py-1.5 rounded-md bg-red-950/40 border border-red-500/30 text-red-300 text-xs flex items-center justify-between gap-2">
                    <span>{recError}</span>
                    <button onClick={() => setRecError(null)} className="text-red-300/70 hover:text-red-200 text-xs" title="Dismiss">✕</button>
                  </div>
                )}
                {/* ═══ Microphone + Waveform + Input Row ═══ */}
                {/* Three states — exactly one renders at a time: */}
                {/*   (1) compiling = true   → "Translating…" with waveform  */}
                {/*   (2) recState="recording" → "Listening…" with stop btn   */}
                {/*   (3) idle + !compiling → input + send + mic               */}
                {/* Prior bug: recState === "idle" || compiling → idle UI       */}
                {/* flashed after stop, hiding that transcription was running.  */}
                {compiling ? (
                  <>
                    <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent/5 border border-accent/20">
                      <WaveformVisualizer level={audioLevel} barCount={5} className="text-accent" />
                      <span className="text-xs text-accent font-medium">Translating…</span>
                    </div>
                    <div className="w-[42px] h-[42px]" aria-hidden="true" />
                    <div className="w-[42px] h-[42px]" aria-hidden="true" />
                  </>
                ) : recState === "recording" ? (
                  <>
                    <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent/5 border border-accent/20">
                      <WaveformVisualizer level={audioLevel} barCount={5} className="text-accent" />
                      <span className="text-xs text-accent font-medium">Listening…</span>
                    </div>
                    <button onClick={async () => {
                      const blob = await stopAndGetBlob();
                      if (!blob) { return; }
                      setCompiling(true);
                      try {
                        const formData = new FormData();
                        formData.append("audio", blob, "recording.webm");
                        formData.append("routeMode", routeMode || "auto");
                        const res = await fetch("/api/dictate", {
                          method: "POST",
                          body: formData,
                        });
                        const data = await res.json();
                        const prompt = data.prompt || data.text || "";
                        console.log("[dictation] Transcribed:", JSON.stringify(data.transcript || ""));
                        console.log("[dictation] Refined prompt:", JSON.stringify(prompt));
                        if (prompt.length > 0) {
                          sendPrompt(prompt);
                        } else {
                          console.warn("[dictation] Empty transcription");
                        }
                      } catch (err) {
                        console.error("[dictation] Transcription failed:", err);
                      } finally {
                        setCompiling(false);
                      }
                    }}
                      className="w-[42px] h-[42px] rounded-full bg-red-600 text-white text-xs font-bold border-none cursor-pointer hover:bg-red-500 flex items-center justify-center transition-all"
                      title="Stop & Transcribe">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                    </button>
                    <button onClick={cancelRecording}
                      className="w-[42px] h-[42px] rounded-full bg-surface border border-border text-muted cursor-pointer hover:text-red-500 hover:border-red-500 flex items-center justify-center transition-all"
                      title="Cancel recording">
                      <X size={16} />
                    </button>
                  </>
                ) : (
                  <>
                    <div className="flex-1 connect-line">
                      <input data-warden-target="chat-input" className="w-full border border-border bg-background rounded-lg px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent font-sans transition-colors"
                        value={input} onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && send()}
                        disabled={loading}
                        placeholder={mode === "operator" ? "Describe the task to watch..." : "Type a message..."} />
                    </div>
                    {loading ? (
                      <button onClick={stop}
                        className="w-[42px] h-[42px] rounded-full bg-red-600 text-white text-xs font-bold border-none cursor-pointer hover:bg-red-500 flex items-center justify-center"
                        title="Interrupt">
                        中止
                      </button>
                    ) : (
                      <button onClick={send} disabled={!input.trim()}
                        className="w-[42px] h-[42px] rounded-full bg-emerald-500 text-white text-xs font-bold border-none cursor-pointer hover:bg-emerald-400 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center"
                        title="Send">
                        送る
                      </button>
                    )}
                    <button onClick={async () => {
                      setRecError(null);
                      try {
                        await startRecording();
                      } catch (err: any) {
                        const msg = String(err?.message || err || "");
                        if (msg.includes("Permission") || msg.includes("NotAllowed") || msg.includes("denied")) {
                          setRecError("Microphone permission denied — allow it in the browser address bar.");
                        } else if (msg.includes("NotFound") || msg.includes("device")) {
                          setRecError("No microphone found — check your input device.");
                        } else {
                          setRecError(`Mic failed: ${msg || "unknown"}`);
                        }
                      }
                    }}
                      className="w-[42px] h-[42px] rounded-full bg-surface border border-border text-muted cursor-pointer hover:text-accent hover:border-accent flex items-center justify-center transition-all"
                      title="Voice Input"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                        <line x1="12" y1="19" x2="12" y2="23" />
                        <line x1="8" y1="23" x2="16" y2="23" />
                      </svg>
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ═══ Sessions ═══ */}
        {activePage === "Sessions" && (
          <div className="flex-1 overflow-y-auto px-4 py-4 relative z-10">
            <div className="flex items-center gap-2 mb-3">
              <input className="flex-1 border border-border bg-muted-bg rounded-sm px-3 py-2 text-xs outline-none placeholder:text-muted focus:border-accent" placeholder="Search sessions..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
              {filteredSessions.length > 0 && (
                <button
                  onClick={() => { if (confirm(`Delete all ${filteredSessions.length} session(s) permanently?`)) { setSessions([]); setActiveSession(null); setActivePage("Chat"); setMessages([]); } }}
                  className="flex items-center gap-1 text-xs text-muted hover:text-red-500 border border-border hover:border-red-500/50 bg-surface px-2.5 py-2 rounded cursor-pointer transition-all shrink-0"
                  title="Delete all sessions"
                >
                  <Trash2 size={12} /> <span>Delete All</span>
                </button>
              )}
            </div>
            {filteredSessions.map((s) => (
              <div key={s.id} className="flex items-center justify-between px-3 py-2 rounded border border-border bg-surface hover:bg-muted-bg cursor-pointer transition-all font-sans mb-1 group">
                <button onClick={() => loadSession(s.id)} className="flex-1 min-w-0 text-left bg-none border-none p-0 cursor-pointer font-sans">
                  <div className="flex justify-between"><span className="text-sm font-medium truncate">{s.title}</span><span className="text-[10px] text-muted shrink-0 ml-2">{s.time}</span></div>
                  <div className="text-xs text-muted mt-0.5 truncate">{s.preview}</div>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); downloadSession(s); }}
                  className="ml-1 flex items-center justify-center w-8 h-8 text-muted hover:text-accent hover:bg-accent/10 rounded bg-none border-none cursor-pointer transition-all shrink-0"
                  title="Download as markdown"
                >
                  <Download size={14} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                  className="ml-1 flex items-center justify-center w-8 h-8 text-muted hover:text-red-500 hover:bg-red-500/10 rounded bg-none border-none cursor-pointer transition-all shrink-0"
                  title="Delete session"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ═══ Skills ═══ */}
        {activePage === "Skills" && (
          <div className="flex-1 overflow-y-auto px-4 py-4 relative z-10">
            {skills.map((sk) => (
              <div key={sk.id} className="flex items-center justify-between px-3 py-2.5 rounded border border-border bg-surface mb-2">
                <div className="flex items-center gap-2.5">{(() => { const SkillIcon = SKILL_ICONS[sk.id]; return SkillIcon ? <SkillIcon size={18} className="text-accent" /> : null; })()}
                  <div><div className="text-sm font-medium">{sk.name}</div><div className="text-[11px] text-muted">{sk.description}</div></div>
                </div>
                <button onClick={() => toggleSkill(sk.id)} className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer border-none ${sk.installed ? "bg-accent" : "bg-muted-bg"}`}>
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${sk.installed ? "translate-x-[18px]" : "translate-x-0.5"}`} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ═══ Agents ═══ */}
        {activePage === "Agents" && (
          <div className="flex-1 overflow-y-auto px-4 py-4 relative z-10">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-muted">Your agent team.</p>
              <button onClick={() => { setShowAgentCreator(true); setAgentCreatorStep("provider"); setAgentCreatorProvider("matrix"); setAgentCreatorKey(""); setAgentCreatorEndpoint(""); setAgentCreatorMessages([]); setCreatedAgentId(null); setAgentCreatorDesc(""); }}
                className="flex items-center gap-1 text-xs bg-accent text-[#08080a] px-3 py-1.5 rounded font-semibold cursor-pointer border-none hover:opacity-90 font-sans">
                <Plus size={14} /><span>New Agent</span>
              </button>
            </div>
            <div className="text-[10px] font-semibold text-muted uppercase tracking-wider px-1 pb-1">System</div>
            <button className="w-full text-left px-3 py-2.5 rounded border border-accent bg-accent/5 mb-3 cursor-pointer font-sans">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-accent" /><span className="text-sm font-medium">Smyth</span></div>
                <span className="text-[10px] text-accent bg-accent/10 px-1.5 rounded">Active</span>
              </div>
              <div className="text-[11px] text-muted mt-0.5 ml-4">Matrix — Pro Coding</div>
            </button>
            <div className="text-[10px] font-semibold text-muted uppercase tracking-wider px-1 pb-1">Custom</div>
            {customAgents.length === 0 ? (
              <p className="text-xs text-muted px-1 py-4 text-center">No custom agents yet.</p>
            ) : (
              customAgents.map((ag: any) => (
                <button key={ag.id} className="w-full text-left px-3 py-2.5 rounded border border-border bg-surface hover:bg-muted-bg mb-1 cursor-pointer font-sans">
                  <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-accent" /><span className="text-sm font-medium">{ag.name}</span></div>
                  <div className="text-[11px] text-muted ml-4">{ag.provider} — {ag.description?.slice(0,60)}...</div>
                </button>
              ))
            )}
          </div>
        )}

        {/* ═══ Files ═══ */}
        {activePage === "Files" && (
          <div className="flex-1 overflow-y-auto px-4 py-4 relative z-10">
            <div className="mb-3"><input className="w-full border border-border bg-muted-bg rounded-sm px-3 py-2 text-xs outline-none placeholder:text-muted focus:border-accent" placeholder="Search files..." value={fileSearch} onChange={(e) => setFileSearch(e.target.value)} /></div>
            {filteredFiles.map((f) => (
              <button key={f.name} onClick={() => openFile(f.name)} className={`w-full text-left px-3 py-1.5 rounded text-xs font-sans flex items-center gap-2 mb-0.5 ${selectedFile === f.name ? "bg-accent/10 text-accent" : "bg-surface hover:bg-muted-bg text-muted"}`}>
                <span>{f.type === "img" ? <Image size={14} /> : <FileText size={14} />}</span><span className="truncate flex-1">{f.name}</span><ExternalLink size={11} className="shrink-0 opacity-50" />
              </button>
            ))}
          </div>
        )}

        {/* ═══ Settings ═══ */}
        {activePage === "Settings" && (
          <div className="flex-1 overflow-y-auto px-4 py-4 relative z-10">
            <div className="max-w-[560px] mx-auto flex flex-col gap-4">

              {/* ── Dashboard ── */}
              <div>
                <div className="section-label mb-2">Dashboard</div>
                <div className="px-3 py-3 rounded border border-border bg-surface mb-3">
                  <TokenGauge used={totalMonthlyTokens} limit={MONTHLY_LIMIT} isActive={false} />
                </div>
                <div className="flex items-center justify-between px-3 py-2.5 rounded border border-border bg-surface">
                  <div className="flex items-center gap-2"><Sun size={16} className="text-muted" />
                    <div><div className="text-sm font-medium">Dark Mode</div><div className="text-[11px] text-muted">Toggle theme</div></div>
                  </div>
                  <button onClick={() => setDark(!dark)} className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer border-none ${dark ? "bg-accent" : "bg-muted-bg"}`}>
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${dark ? "translate-x-[18px]" : "translate-x-0.5"}`} />
                  </button>
                </div>
              </div>

              {/* ── Runtime configuration (Mode / Routing Pool / Ollama / Custom Provider / MCP) ── */}
              <div className="flex flex-col gap-4 [&_.right-section]:!p-0 [&_.right-section]:!border-0 [&_.right-section]:!bg-transparent">
                {runtimeSections}
              </div>

              {/* ── API Keys (stored locally, not synced) ── */}
              <div>
                <div className="section-label mb-2">API Keys</div>
                <div className="rounded border border-border bg-surface px-3 py-2.5 flex flex-col gap-2.5">
                  <p className="text-[10px] text-muted leading-relaxed">
                    Stored locally on this machine (not synced anywhere). Changes take effect immediately.
                  </p>
                  {SETTINGS_ENV_KEYS.map((k) => (
                    <EnvKeyRow
                      key={k.key}
                      envKey={k.key}
                      label={k.label}
                      value={electronEnv?.[k.key] ?? ""}
                      saveState={envSaveState[k.key]}
                      onSave={saveEnvKey}
                    />
                  ))}
                </div>
              </div>

              {/* ── App ── */}
              {isElectron && (
                <div>
                  <div className="section-label mb-2">App</div>
                  <div className="rounded border border-border bg-surface px-3 py-2.5 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Activity size={15} className="text-muted" />
                        <div>
                          <div className="text-sm font-medium">Engine</div>
                          <div className="text-[11px] text-muted">
                            {electronServerStatus?.smyth ? "Running" : "Stopped"}
                          </div>
                        </div>
                      </div>
                      <span className={`w-2 h-2 rounded-full ${electronServerStatus?.smyth ? "bg-emerald-500" : "bg-red-500"}`} />
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FolderOpen size={15} className="text-muted" />
                        <div>
                          <div className="text-sm font-medium">Logs</div>
                          <div className="text-[11px] text-muted">Engine + crash logs</div>
                        </div>
                      </div>
                      <button
                        onClick={() => (window as any).smythRuntime?.openLog?.()}
                        className="text-[11px] px-2.5 py-1 rounded border border-border bg-muted-bg text-muted hover:text-foreground hover:border-accent cursor-pointer transition-colors"
                      >Open</button>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <FolderOpen size={15} className="text-muted shrink-0" />
                        <div className="min-w-0">
                          <div className="text-sm font-medium">Data Folder</div>
                          <div className="text-[10px] text-muted truncate">{electronUserData || "…"}</div>
                        </div>
                      </div>
                      <button
                        onClick={() => (window as any).smythRuntime?.openUserData?.()}
                        className="text-[11px] px-2.5 py-1 rounded border border-border bg-muted-bg text-muted hover:text-foreground hover:border-accent cursor-pointer transition-colors shrink-0"
                      >Open</button>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Shield size={15} className="text-muted" />
                        <div>
                          <div className="text-sm font-medium">Permissions</div>
                          <div className="text-[11px] text-muted">Accessibility + Screen Recording (macOS-MCP)</div>
                        </div>
                      </div>
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => (window as any).smythRuntime?.openSystemSettings?.("accessibility")}
                          className="text-[11px] px-2.5 py-1 rounded border border-border bg-muted-bg text-muted hover:text-foreground hover:border-accent cursor-pointer transition-colors"
                        >Accessibility</button>
                        <button
                          onClick={() => (window as any).smythRuntime?.openSystemSettings?.("screen")}
                          className="text-[11px] px-2.5 py-1 rounded border border-border bg-muted-bg text-muted hover:text-foreground hover:border-accent cursor-pointer transition-colors"
                        >Screen</button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

            </div>
          </div>
        )}

      </main>

      {/* ═══ Agent Creator Overlay ═══ */}
      {showAgentCreator && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center">
          <div className="bg-surface border border-border rounded-xl w-[560px] max-h-[85vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="text-sm font-semibold">New Agent</span>
              <button onClick={() => setShowAgentCreator(false)} className="text-muted hover:text-foreground cursor-pointer bg-none border-none p-1 font-sans"><X size={16} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">

              {/* ── Step 1: Pick Provider ── */}
              {agentCreatorStep === "provider" && (
                <div className="space-y-3">
                  <p className="text-xs text-muted mb-2">Choose a provider for your new agent.</p>
                  {providers.map((p) => (
                    <div key={p.id} onClick={() => {
                      setAgentCreatorProvider(p.id);
                      setAgentCreatorEndpoint(endpointDefaults[p.id] || "");
                      setAgentCreatorKey("");
                    }}
                      className={`px-3 py-2.5 rounded border cursor-pointer transition-all ${agentCreatorProvider === p.id ? "border-accent bg-accent/5" : "border-border bg-surface hover:bg-muted-bg"}`}>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-foreground">{p.label}</span>
                        {p.free && <span className="text-[9px] text-accent bg-accent/10 px-1.5 rounded">No key needed</span>}
                      </div>
                      <div className="text-[11px] text-muted mt-0.5">{p.desc}</div>
                    </div>
                  ))}

                  {/* API key + endpoint for non-free / non-local providers */}
                  {agentCreatorProvider !== "matrix" && agentCreatorProvider !== "ollama" && (
                    <div className="mt-3 space-y-2">
                      <div className="text-[10px] text-muted font-medium">Endpoint URL</div>
                      <input
                        className="w-full border border-border bg-background rounded-sm px-3 py-2 text-xs outline-none placeholder:text-muted focus:border-accent font-sans"
                        placeholder={endpointPlaceholder(agentCreatorProvider)}
                        value={agentCreatorEndpoint}
                        onChange={(e) => setAgentCreatorEndpoint(e.target.value)}
                      />
                      <div className="text-[10px] text-muted font-medium mt-2">API Key</div>
                      <input
                        className="w-full border border-border bg-background rounded-sm px-3 py-2 text-xs outline-none placeholder:text-muted focus:border-accent font-sans"
                        type="password"
                        placeholder="sk-..."
                        value={agentCreatorKey}
                        onChange={(e) => setAgentCreatorKey(e.target.value)}
                      />
                    </div>
                  )}

                  <button
                    onClick={() => {
                      if (agentCreatorProvider === "matrix" || agentCreatorProvider === "ollama") {
                        setAgentCreatorStep("chat");
                      } else if (agentCreatorKey.trim()) {
                        setAgentCreatorStep("chat");
                      }
                    }}
                    className="w-full bg-accent text-[#08080a] border-none rounded-lg py-2 text-sm font-semibold cursor-pointer hover:opacity-90 font-sans mt-2"
                  >
                    Continue
                  </button>
                  {agentCreatorProvider !== "matrix" && agentCreatorProvider !== "ollama" && !agentCreatorKey.trim() && (
                    <p className="text-[10px] text-amber-500 text-center">API key is required for this provider.</p>
                  )}
                </div>
              )}

              {/* ── Step 2: Describe Agent ── */}
              {agentCreatorStep === "chat" && (
                <div className="space-y-3">
                  {agentCreatorMessages.length === 0 && (
                    <div className="bg-surface border border-border rounded-xl px-3.5 py-2.5 text-sm leading-relaxed">
                      <div className="flex items-center gap-1.5 text-[10.5px] font-semibold text-muted mb-1">
                        <span className="w-4 h-4 rounded-full overflow-hidden shrink-0 bg-white flex items-center justify-center"><img src="/Artwork/Smyth-New-Logo-circle.png" alt="" className="w-full h-full object-contain" /></span>
                        Smyth
                      </div>
                      Tell me about the agent you want to build. What should they do? What skills, tone, and autonomy level?
                    </div>
                  )}
                  {agentCreatorMessages.map((m, i) => (
                    <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[80%] rounded-xl px-3.5 py-2 text-sm leading-relaxed ${m.role === "user" ? "bg-accent/10 border border-accent/20" : "bg-surface border border-border"}`}>
                        <div className="whitespace-pre-wrap">{m.content}</div>
                      </div>
                    </div>
                  ))}
                  <div className="flex gap-1.5">
                    <textarea
                      className="flex-1 border border-border bg-background rounded-lg px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent font-sans resize-none"
                      rows={3}
                      placeholder="Describe your agent..."
                      value={agentCreatorDesc}
                      onChange={(e) => setAgentCreatorDesc(e.target.value)}
                    />
                  </div>
                  <button
                    onClick={async () => {
                      if (!agentCreatorDesc.trim()) return;
                      setAgentCreatorMessages((m) => [...m, { role: "user", content: agentCreatorDesc, timestamp: Date.now() }]);
                      const desc = agentCreatorDesc;
                      setAgentCreatorDesc("");
                      try {
                        const data = await createAgent(desc);
                        if (data.status === "ok") {
                          setCreatedAgentId(data.agent.id);
                          // Self-name the agent
                          // In a full implementation, the actual VLM call to name itself goes here
                          // For now, use the agent ID as a seed for a simple name
                          const agentName = `Agent-${data.agent.id.slice(-4)}`;
                          const nameData = await selfNameAgent(data.agent.id, agentName);
                          if (nameData.status === "ok") {
                            setCustomAgents((a) => [...a, nameData.agent]);
                            setAgentCreatorMessages((m) => [...m, { role: "assistant", content: `✨ ${nameData.agent.name} has been created and named. They're ready to work.`, timestamp: Date.now() }]);
                            setTimeout(() => { setAgentCreatorStep("done"); }, 1500);
                          }
                        }
                      } catch {
                        setAgentCreatorMessages((m) => [...m, { role: "assistant", content: "Error creating agent.", timestamp: Date.now() }]);
                      }
                    }}
                    className="bg-accent text-[#08080a] border-none rounded-lg py-2 text-sm font-semibold cursor-pointer hover:opacity-90 font-sans"
                  >
                    Create Agent
                  </button>
                </div>
              )}

              {/* ── Step 3: Done ── */}
              {agentCreatorStep === "done" && (
                <div className="text-center py-8 space-y-3">
                  <div className="text-2xl">🎉</div>
                  <p className="text-sm font-medium">Agent created successfully</p>
                  <p className="text-xs text-muted">They've self-named and are ready to work.</p>
                  <button onClick={() => { setShowAgentCreator(false); setAgentCreatorStep("provider"); setCreatedAgentId(null); setAgentCreatorMessages([]); setAgentCreatorDesc(""); }}
                    className="bg-accent text-[#08080a] border-none rounded-lg px-5 py-2 text-sm font-semibold cursor-pointer hover:opacity-90 font-sans">Done</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══ RIGHT PANEL ═══ */}
      <aside className="w-[290px] shrink-0 border-l border-border bg-surface flex flex-col overflow-y-auto min-h-0">
        {/* ── Status gauges ── */}
        {activePage === "Chat" && (
          <div className="flex flex-col gap-0">
            <div className="right-section pb-1">
              <SessionContextGauge used={contextTokens} limit={CONTEXT_BUDGET} />
              <div className="flex gap-1.5 mt-1.5">
                <button
                  onClick={async () => {
                    if (messages.length <= 2) return;
                    // 2026-08-22: always keep the last 50 messages live; archive
                    // everything older. Was tied to messages.length/2 which
                    // scaled with chat size — Rob wanted a fixed keep-window
                    // so the meter predictions stay stable.
                    const KEEP_LAST = 50;
                    const kept = messages.slice(-KEEP_LAST);
                    const dropped = messages.slice(0, -KEEP_LAST);
                    if (dropped.length === 0) {
                      setMessages(m => [...m, {
                        role: "assistant",
                        content: `Nothing to compact — chat has ${messages.length} messages, all within the last ${KEEP_LAST}.`,
                        timestamp: Date.now(),
                      }]);
                      return;
                    }
                    const sess = sessions.find(s => s.id === activeSession);
                    try {
                      const res = await fetch("/api/chat/memory", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ sessionId: activeSession, title: sess?.title || "chat", messages: dropped }),
                      });
                      const data = await res.json();
                      const note: Message = {
                        role: "assistant",
                        content: data.ok
                          ? `📦 ${dropped.length} messages archived to \`memory/${data.file}\` (${data.sizeKB}KB). Last ${kept.length} messages kept live. I can read the archive file anytime to recall details.${data.overLimit ? `\n\n⚠️ This chat's memory file is over 1MB — recall may get fuzzy. Consider starting a fresh chat (the archive stays on disk).` : ""}`
                          : `⚠️ Compaction archive failed (${data.error || "unknown"}). Messages kept in context.`,
                        timestamp: Date.now(),
                      };
                      setMessages(data.ok ? [note, ...kept] : [note, ...messages]);
                    } catch (e: any) {
                      setMessages(m => [...m, { role: "assistant", content: `⚠️ Compaction failed: ${e.message}`, timestamp: Date.now() }]);
                    }
                  }}
                  disabled={messages.length <= 2}
                  title="Archive older messages to a rolling memory file on disk, keep last 50"
                  className={`flex-1 text-[10px] font-medium px-2 py-1 rounded border transition-colors ${
                    messages.length <= 2
                      ? "border-border bg-none text-muted opacity-40 cursor-default"
                      : contextTokens > CONTEXT_BUDGET * 0.9
                        ? "border-red-500/40 bg-red-500/10 text-red-400 hover:bg-red-500/20 cursor-pointer"
                        : contextTokens > CONTEXT_BUDGET * 0.7
                          ? "border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 cursor-pointer"
                          : "border-border bg-none text-muted hover:text-foreground hover:bg-muted-bg cursor-pointer"
                  }`}
                >Compact</button>
                {/* 2026-08-22: Clear button removed. Rob wants only Compact as
                    the way to slim a chat — "Clear" was confusing because it
                    wiped context without archiving. Use a new chat tab instead. */}
              </div>
            </div>
            <div className="right-section pb-2">
              <div className="section-label">Account Plan</div>
              <TokenGauge used={totalMonthlyTokens} limit={MONTHLY_LIMIT} isActive={false} />
            </div>
          </div>
        )}

        {activePage !== "Settings" && runtimeSections}


        {/* ── Tools ── */}
        <div className="right-section">
          <div className="section-label">Tools</div>
          <div className="grid grid-cols-2 gap-1.5">
            {[
              { icon: Shield, label: "Operator", active: showOperatorAssist, toggle: () => setShowOperatorAssist(!showOperatorAssist), badge: operatorSessionId },
              { icon: Share2, label: "Share", active: showShare, toggle: () => setShowShare(!showShare) },
              { icon: Mail, label: "Mail", active: showEmail, toggle: () => setShowEmail(!showEmail) },
              { icon: Calendar, label: "Schedule", active: showSchedule, toggle: () => setShowSchedule(!showSchedule) },
              { icon: Megaphone, label: "Social", active: showSocial, toggle: () => setShowSocial(!showSocial) },
              { icon: Film, label: "Video", active: showVideoEditor, toggle: () => setShowVideoEditor(!showVideoEditor) },
              { icon: Briefcase, label: "Clients", active: showCRM, toggle: () => setShowCRM(!showCRM) },
              { icon: PenTool, label: "Design", active: showDesign, toggle: () => setShowDesign(!showDesign) },
              { icon: Camera, label: "Camera", active: showWebcam, toggle: () => setShowWebcam(!showWebcam) },
              { icon: Activity, label: "Ops", active: showOps, toggle: () => setShowOps(!showOps) },
            ].map((t) => (
              <button
                key={t.label}
                onClick={t.toggle}
                className={`relative flex flex-col items-center gap-1.5 px-2 py-2.5 rounded-md border text-xs cursor-pointer font-sans transition-all ${
                  t.active
                    ? "bg-accent/10 text-accent border-accent shadow-[var(--shadow-glow-green)]"
                    : "bg-muted-bg text-muted border-border hover:border-accent hover:text-foreground"
                }`}
              >
                <t.icon size={18} strokeWidth={1.5} />
                <span className="text-[10px] font-medium leading-none">{t.label}</span>
                {t.badge && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />}
              </button>
            ))}
          </div>
        </div>

        {showWebcam && <SmythWebcam onClose={() => setShowWebcam(false)} />}
      </aside>

      {/* ── Design Panel Overlay (Perchance AI) ── */}
      {showDesign && (
        <DesignPanel onClose={() => setShowDesign(false)} />
      )}

      {/* ── Email Panel Overlay ── */}
      {showEmail && (
        <div className="fixed z-50 bg-black/90 flex flex-col inset-4 rounded-xl border border-border shadow-2xl overflow-hidden">
          <EmailPanel onClose={() => setShowEmail(false)} />
        </div>
      )}

      {/* ── Operator Assist Overlay ── */}
      {showOperatorAssist && (
        <div className="fixed inset-0 z-50 flex items-end justify-end p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowOperatorAssist(false)} />
          <div className="relative w-[440px] h-[85vh] max-h-[720px] bg-surface border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden z-10">
            <OperatorAssistPanel
              operatorSessionId={operatorSessionId}
              onSessionIdChange={setOperatorSessionId}
              chatSessionId={activeSession}
              messages={messages}
              onInjection={(prompt, reply, model) => {
                // Warden injection — trigger the real send flow so the agent
                // streams a proper response in the chat UI.
                sendPrompt(`🛡️ [Operator] ${prompt}`);
              }}
            />
          </div>
        </div>
      )}

      {/* ── Mailboxes Panel Overlay ── */}
      {showMailboxes && (
        <MailboxesPanel onClose={() => setShowMailboxes(false)} />
      )}

      {/* ── Scheduling Panel Overlay ── */}
      {showSchedule && (
        <div className="fixed inset-0 z-50 flex items-end justify-end p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowSchedule(false)} />
          <div className="relative w-[440px] h-[85vh] max-h-[720px] bg-surface border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden z-10">
            <SchedulingPanel onClose={() => setShowSchedule(false)} onJoinMeeting={(roomName, displayName, bookingId) => { setMeetingRoom(roomName); setMeetingName(displayName); setMeetingBookingId(bookingId || ""); setShowMeeting(true); }} />
          </div>
        </div>
      )}

      {/* ── Meeting Room Overlay ── */}
      {showMeeting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => { setShowMeeting(false); setMeetingRoom(""); }}>
          <div className="relative w-[90vw] max-w-[960px] h-[85vh] max-h-[700px] bg-surface border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <MeetingRoom
              roomName={meetingRoom}
              displayName={meetingName}
              bookingId={meetingBookingId}
              isHost={true}
              onClose={() => { setShowMeeting(false); setMeetingRoom(""); }}
              onMeetingEnd={() => { setShowMeeting(false); setMeetingRoom(""); }}
            />
          </div>
        </div>
      )}

      {/* ── Social Media Panel Overlay ── */}
      {showSocial && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowSocial(false)} />
          <div className="relative w-[90vw] max-w-[1100px] h-[85vh] max-h-[800px] bg-surface border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden z-10">
            {/* Smyth Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-surface border-b border-border">
              <div className="flex items-center gap-2">
                <Megaphone size={18} className="text-accent" />
                <span className="font-sans font-semibold text-sm text-foreground">Smyth Social</span>
                <span className="text-[10px] text-muted-foreground ml-2">Powered by Zernio</span>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href="https://zernio.com/signin"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-muted-foreground hover:text-accent transition-colors flex items-center gap-1"
                  title="Open Zernio in a new tab to sign in or get an API key"
                >
                  <ExternalLink size={11} />
                  zernio.com
                </a>
                <button
                  onClick={() => setShowSocial(false)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            {/* Zernio dashboard iframe — user signs in with their Zernio
                account and manages connected platforms from there. */}
            <iframe
              src="https://zernio.com/signin"
              className="flex-1 w-full border-none"
              title="Zernio — sign in to manage your social accounts"
              allow="camera; microphone; clipboard-read; clipboard-write"
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads"
            />
          </div>
        </div>
      )}

      {/* ── Videography Overlay (OpenCut iframe) ── */}
      {showVideoEditor && (
        <VideographyPanel onClose={() => setShowVideoEditor(false)} />
      )}

      {/* ── Local Share Overlay ── */}
      {showShare && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowShare(false)} />
          <div className="relative w-[90vw] max-w-[640px] h-[85vh] max-h-[720px] bg-surface border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden z-10">
            <div className="flex items-center justify-between px-4 py-3 bg-surface border-b border-border flex-shrink-0">
              <div className="flex items-center gap-2">
                <Share2 size={18} className="text-accent" />
                <span className="font-sans font-semibold text-sm text-foreground">Local Share</span>
                <span className="text-[10px] text-muted-foreground ml-2">Share files on your network</span>
              </div>
              <button
                onClick={() => setShowShare(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
                title="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <SmythShare onClose={() => setShowShare(false)} />
            </div>
          </div>
        </div>
      )}
      {/* ── Client Management Overlay ── */}
      {showCRM && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowCRM(false)} />
          <div className="relative w-[95vw] h-[95vh] max-w-[1400px] bg-surface border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden z-10">
            <div className="flex items-center justify-between px-4 py-3 bg-surface border-b border-border flex-shrink-0">
              <div className="flex items-center gap-2">
                <Briefcase size={18} className="text-accent" />
                <span className="font-sans font-semibold text-sm text-foreground">Client Management</span>
                <span className="text-[10px] text-muted-foreground ml-2">Powered by Twenty CRM</span>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href="http://localhost:4000"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-muted-foreground hover:text-accent transition-colors flex items-center gap-1"
                  title="Open in new tab"
                >
                  <ExternalLink size={11} />
                  Open
                </a>
                <button
                  onClick={() => setShowCRM(false)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  title="Close"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            <iframe
              src="http://localhost:4000"
              className="flex-1 w-full border-none bg-background"
              title="Client Management"
              allow="camera; microphone; clipboard-read; clipboard-write"
            />
          </div>
        </div>
      )}

      {/* ── Ops Mission Control Overlay ── */}
      {showOps && (
        <OpsPanel onClose={() => setShowOps(false)} />
      )}
    </div>
  );
}
