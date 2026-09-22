"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useAutoRespond, type AutoRespondDraft } from "@/hooks/useAutoRespond";
import {
  Mail,
  Inbox,
  Send,
  Reply,
  Trash2,
  RefreshCw,
  X,
  Loader2,
  AlertCircle,
  ArrowLeft,
  PenLine,
  Check,
  Bot,
  User,
  Sparkles,
  ChevronDown,
  Plus,
  Settings,
  Shield,
  Eye,
  EyeOff,
  Zap,
  ZapOff,
  Clock,
  Send as SendIcon,
} from "lucide-react";

// ── Types ──

type EmailMessage = {
  uid: number;
  subject: string;
  from: { name: string; address: string }[];
  to: { name: string; address: string }[];
  date: string;
  flags: Record<string, boolean>;
  size: number;
  preview?: string;
  text?: string;
  html?: string;
  replyAddress?: string;
  replyTo?: { name: string; address: string }[];
  isAgentSent?: boolean;
};

type ComposeState = {
  to: string;
  subject: string;
  body: string;
  fromAccountId?: string;
};

type ViewMode = "inbox" | "message" | "compose" | "addMailbox";

type MailAccount = {
  id: string;
  name: string;
  email: string;
  role: string;
  apiKey: string;
  displayName?: string;
  relayEmail?: string;
  provider?: string;
  isRelay?: boolean;
  isInboxOwner?: boolean;
};

type ProviderPreset = {
  id: string;
  name: string;
  icon: string;
  smtpHost: string;
  smtpPort: number;
  imapHost: string;
  imapPort: number;
  hint: string;
};

// ── API Base ──
// Same-origin Smyth proxy at /api/agenticmail/*. The catch-all route forwards
// to the live AgenticMail API at :3829. Avoid direct localhost:3829 calls —
// that port may be occupied by other services and CORS would block browser
// requests anyway.
const API_URL = "/api/agenticmail";
const MASTER_KEY = process.env.NEXT_PUBLIC_AGENTICMAIL_MASTER_KEY || "";

const getHeaders = (apiKey: string) => ({
  Authorization: `Bearer ${apiKey}`,
  'Content-Type': 'application/json',
});

const getMasterHeaders = () => ({
  Authorization: `Bearer ${MASTER_KEY}`,
  'Content-Type': 'application/json',
});

// ── Provider Presets ──
const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "gmail",
    name: "Gmail",
    icon: "G",
    smtpHost: "smtp.gmail.com",
    smtpPort: 587,
    imapHost: "imap.gmail.com",
    imapPort: 993,
    hint: "Use an App Password (not your regular password). Enable 2FA first.",
  },
  {
    id: "outlook",
    name: "Outlook / Hotmail",
    icon: "O",
    smtpHost: "smtp.office365.com",
    smtpPort: 587,
    imapHost: "outlook.office365.com",
    imapPort: 993,
    hint: "Use an App Password from account.live.com/proofs/AppPassword",
  },
  {
    id: "icloud",
    name: "iCloud",
    icon: "i",
    smtpHost: "smtp.mail.me.com",
    smtpPort: 587,
    imapHost: "imap.mail.me.com",
    imapPort: 993,
    hint: "Generate an app-specific password at appleid.apple.com",
  },
  {
    id: "yahoo",
    name: "Yahoo",
    icon: "Y",
    smtpHost: "smtp.mail.yahoo.com",
    smtpPort: 587,
    imapHost: "imap.mail.yahoo.com",
    imapPort: 993,
    hint: "Generate an app password at yahoo.com",
  },
  {
    id: "custom",
    name: "Custom (IMAP/SMTP)",
    icon: "⚙",
    smtpHost: "",
    smtpPort: 587,
    imapHost: "",
    imapPort: 993,
    hint: "Enter your provider's IMAP and SMTP server details.",
  },
];

// Detect provider from email domain
function detectProvider(email: string): string {
  const domain = email.split("@")[1]?.toLowerCase() || "";
  if (domain.includes("gmail") || domain === "googlemail.com") return "gmail";
  if (domain.includes("outlook") || domain.includes("hotmail") || domain.includes("live.com")) return "outlook";
  if (domain.includes("icloud") || domain.includes("me.com") || domain.includes("mac.com")) return "icloud";
  if (domain.includes("yahoo")) return "yahoo";
  return "custom";
}

// ── Spam Detection ──
const SPAM_PATTERNS = [
  /error.?report/i,
  /website.?traffic/i,
  /seo.?consult/i,
  /growth.?consult/i,
  /digital.?marketing.?plan/i,
  /audit.?report/i,
  /i (?:came across|found|noticed) your (?:website|site)/i,
  /can i (?:send|share) (?:you )?(?:the|a|my|our) (?:error|audit|report|proposal)/i,
  /reply (?:yes|sure|y) to/i,
  /free.?audit/i,
  /greene-solutions\.com/i,
];

function isSpam(msg: EmailMessage): boolean {
  const text = `${msg.subject} ${msg.text || ""}`;
  return SPAM_PATTERNS.some(p => p.test(text));
}

// ── Component ──

export default function EmailPanel({ onClose }: { onClose: () => void }) {
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [selectedUid, setSelectedUid] = useState<number | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [folder, setFolder] = useState("inbox");
  const [compose, setCompose] = useState<ComposeState | null>(null);
  const [sending, setSending] = useState(false);
  const [replying, setReplying] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [view, setView] = useState<ViewMode>("inbox");
  const [sentConfirm, setSentConfirm] = useState<string | null>(null);
  const [aiDrafting, setAiDrafting] = useState(false);
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const [autoRespondDraft, setAutoRespondDraft] = useState<AutoRespondDraft | null>(null);
  const [showAutoRespondMenu, setShowAutoRespondMenu] = useState(false);
  const autoRespondMenuRef = useRef<HTMLDivElement>(null);

  // Add Mailbox state
  const [addStep, setAddStep] = useState<"provider" | "credentials" | "connecting">("provider");
  const [addEmail, setAddEmail] = useState("");
  const [addPassword, setAddPassword] = useState("");
  const [addShowPassword, setAddShowPassword] = useState(false);
  const [addProvider, setAddProvider] = useState<string>("");
  const [addSmtpHost, setAddSmtpHost] = useState("");
  const [addSmtpPort, setAddSmtpPort] = useState(587);
  const [addImapHost, setAddImapHost] = useState("");
  const [addImapPort, setAddImapPort] = useState(993);
  const [addError, setAddError] = useState<string | null>(null);

  const accountPickerRef = useRef<HTMLDivElement>(null);
  const composeRef = useRef<HTMLTextAreaElement>(null);

  // Get active account
  const activeAccount = accounts.find(a => a.id === activeAccountId) || accounts[0];
  const activeApiKey = activeAccount?.apiKey || '';

  // Auto-respond hook
  const handleDraftReady = useCallback((draft: AutoRespondDraft) => {
    setAutoRespondDraft(draft);
  }, []);
  const { state: autoRespondState, loading: autoRespondLoading, processing: autoRespondProcessing, error: autoRespondError, clearError: clearAutoRespondError, toggle: toggleAutoRespond, setMode: setAutoRespondMode } = useAutoRespond(activeAccountId, activeApiKey, handleDraftReady);

  // Fetch accounts + relay config on mount
  useEffect(() => {
    const fetchAccounts = async () => {
      try {
        const [accountsRes, relayRes] = await Promise.all([
          fetch(`${API_URL}/accounts`, { headers: getMasterHeaders() }).catch((err) => {
            // Transient network failure (CORS, ECONNRESET, service restarting). Log once, recover.
            console.warn("[EmailPanel] accounts fetch network error (recovering):", err?.message || err);
            return null;
          }),
          fetch(`${API_URL}/gateway/status`, { headers: getMasterHeaders() }).catch(() => null),
        ]);
        if (!accountsRes) {
          // AgenticMail service unreachable; UI will show empty state, no crash.
          return;
        }
        if (!accountsRes.ok) throw new Error(`Failed to fetch accounts (${accountsRes.status})`);
        const data = await accountsRes.json();

        // Fetch relay email if available
        let relayEmail: string | null = null;
 let relayAgentId: string | null = null;
        if (relayRes && relayRes.ok) {
          const relayData = await relayRes.json();
          if (relayData.mode === "relay" && relayData.relay?.email) {
            relayEmail = relayData.relay.email;
          }
        }

        const agentList: MailAccount[] = (Array.isArray(data) ? data : (data.agents || [])).map((a: any) => {
          // If this is the secretary agent and we have a relay, show the relay email
          const isRelayTarget = relayEmail && a.role === "secretary";
          const displayEmail = isRelayTarget ? relayEmail! : a.email;
          // Prefer the bridge agent (sales) as the default active account because it owns INBOX/Sent
          const isInboxOwner = a.role === "bridge" || a.role === "sales" || a.email?.includes("sales@");
          return {
            id: a.id,
            name: a.metadata?.ownerName || a.name,
            email: displayEmail,
            role: a.role,
            apiKey: a.apiKey,
            displayName: isRelayTarget
              ? `${a.metadata?.ownerName || a.name} (${relayEmail})`
              : a.metadata?.ownerName ? `${a.metadata.ownerName} (${a.name})` : a.name,
            isRelay: isRelayTarget,
            isInboxOwner,
          };
        });
        setAccounts(agentList);
        // Default to bridge/sales agent (the one that owns the INBOX), otherwise secretary/relay
        const preferred = agentList.find((a: MailAccount) => a.isInboxOwner) || agentList[0];
        if (preferred && (!activeAccountId || !agentList.find((a: MailAccount) => a.id === activeAccountId))) {
          setActiveAccountId(preferred.id);
        }
      } catch (err: any) {
        console.error("Failed to fetch accounts:", err);
      }
    };
    fetchAccounts();
  }, []);

  // Close account picker on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (accountPickerRef.current && !accountPickerRef.current.contains(e.target as Node)) {
        setShowAccountPicker(false);
      }
      if (autoRespondMenuRef.current && !autoRespondMenuRef.current.contains(e.target as Node)) {
        setShowAutoRespondMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Fetch inbox (bypass AgenticMail API: it returns 0 messages even though Stalwart has them)
  const fetchInbox = useCallback(async () => {
    if (!activeAccountId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/mail/inbox-bypass?agentId=${encodeURIComponent(activeAccountId)}&folder=${encodeURIComponent(folder)}&limit=50`);
      if (!res.ok) throw new Error(`Failed to fetch ${folder} (bypass)`);
      const data = await res.json();
      const msgs = (data.messages || []).map((m: EmailMessage) => ({
        ...m,
        // Mark as agent-sent if from address contains our agent names
        isAgentSent: m.from?.some(f =>
          f.address?.includes("secretary@localhost") ||
          f.address?.includes("sales+") ||
          f.name?.toLowerCase().includes("smyth agent")
        ) || false,
      }));
      setMessages(msgs);
      if (folder === "inbox") {
        setUnreadCount(
          msgs.filter((m: EmailMessage) => !m.flags?.["\\Seen"]).length
        );
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [folder, activeAccountId]);

  // Fetch single message via bypass
  const fetchMessage = useCallback(async (uid: number) => {
    if (!activeAccountId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/mail/message-bypass?agentId=${encodeURIComponent(activeAccountId)}&uid=${uid}`);
      if (!res.ok) throw new Error("Failed to fetch message (bypass)");
      const data = await res.json();
      setSelectedMessage(data);
      setSelectedUid(uid);
      setView("message");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [activeAccountId]);

  // Send email
  const sendEmail = useCallback(
    async (to: string, subject: string, body: string, fromAccountId?: string) => {
      const account = accounts.find(a => a.id === (fromAccountId || activeAccountId));
      if (!account) return;
      setSending(true);
      setError(null);
      try {
        const res = await fetch(`${API_URL}/mail/send`, {
          method: "POST",
          headers: getHeaders(account.apiKey),
          body: JSON.stringify({ to, subject, body, html: `<p>${body.replace(/\n/g, '</p><p>')}</p>` }),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `Failed to send email (${res.status})`);
        }
        setCompose(null);
        setReplying(false);
        setView("inbox");
        setSentConfirm(`Sent to ${to} via ${account.displayName || account.name}`);
        setTimeout(() => setSentConfirm(null), 3000);
        fetchInbox();
      } catch (err: any) {
        setError(err.message);
      } finally {
        setSending(false);
      }
    },
    [accounts, activeAccountId, fetchInbox]
  );

  // AI-assisted draft reply (prefer replyAddress from bypass)
  const aiDraftReply = useCallback(async (msg: any) => {
    if (!msg) return;
    setAiDrafting(true);
    try {
      const replyTo = msg.replyAddress || msg.replyTo?.[0]?.address || msg.from?.[0]?.address || "unknown";
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `Draft a brief, professional reply to this email. Keep it concise and friendly. Don't include subject line, just the body text:\n\nFrom: ${replyTo}\nSubject: ${msg.subject || "(no subject)"}\n\n${msg.text || ""}`,
          model: "openclaw",
          routeMode: "auto",
          history: [],
        }),
      });
      if (!res.ok) throw new Error("AI draft failed");
      const data = await res.json();
      const draft = data.reply || "";
      setCompose(prev => prev ? { ...prev, body: draft } : { to: replyTo, subject: `Re: ${msg.subject || ""}`, body: draft });
    } catch (err: any) {
      setError("AI draft failed: " + err.message);
    } finally {
      setAiDrafting(false);
    }
  }, []);

  // Mark as read
  const markRead = useCallback(async (uid: number) => {
    if (!activeAccountId) return;
    await fetch(`${API_URL}/mail/messages/${uid}/seen`, {
      method: "POST",
      headers: getHeaders(activeApiKey),
    });
    fetchInbox();
  }, [activeAccountId, activeApiKey, fetchInbox]);

  // Delete
  const deleteMessage = useCallback(
    async (uid: number) => {
      if (!activeAccountId) return;
      await fetch(`${API_URL}/mail/messages/${uid}`, {
        method: "DELETE",
        headers: getHeaders(activeApiKey),
      });
      if (selectedUid === uid) {
        setSelectedUid(null);
        setSelectedMessage(null);
        setView("inbox");
      }
      fetchInbox();
    },
    [activeAccountId, activeApiKey, fetchInbox, selectedUid]
  );

  // Mark as spam
  const markAsSpam = useCallback(
    async (uid: number) => {
      await deleteMessage(uid);
    },
    [deleteMessage]
  );

  // Add Mailbox
  const handleAddMailbox = useCallback(async () => {
    setAddStep("connecting");
    setAddError(null);
    try {
      const provider = addProvider || detectProvider(addEmail);
      const preset = PROVIDER_PRESETS.find(p => p.id === provider);

      const body: Record<string, any> = {
        provider: provider === "custom" ? "custom" : provider,
        email: addEmail,
        password: addPassword,
      };

      if (provider === "custom") {
        body.smtpHost = addSmtpHost;
        body.smtpPort = addSmtpPort;
        body.imapHost = addImapHost;
        body.imapPort = addImapPort;
      }

      const res = await fetch(`${API_URL}/gateway/relay`, {
        method: "POST",
        headers: getMasterHeaders(),
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Setup failed (${res.status})`);
      }

      const data = await res.json();

      // Refresh accounts
      const accountsRes = await fetch(`${API_URL}/accounts`, { headers: getMasterHeaders() });
      if (accountsRes.ok) {
        const accountsData = await accountsRes.json();
        const agentList = (accountsData.agents || []).map((a: any) => ({
          id: a.id,
          name: a.metadata?.ownerName || a.name,
          email: a.email,
          role: a.role,
          apiKey: a.apiKey,
          displayName: a.metadata?.ownerName ? `${a.metadata.ownerName} (${a.name})` : a.name,
        }));
        setAccounts(agentList);
        if (data.agent) {
          setActiveAccountId(data.agent.id);
        }
      }

      // Reset form
      setAddEmail("");
      setAddPassword("");
      setAddProvider("");
      setAddSmtpHost("");
      setAddImapHost("");
      setAddStep("provider");
      setView("inbox");
      fetchInbox();
    } catch (err: any) {
      setAddError(err.message);
      setAddStep("credentials");
    }
  }, [addEmail, addPassword, addProvider, addSmtpHost, addSmtpPort, addImapHost, addImapPort, fetchInbox]);

  useEffect(() => {
    if (activeAccountId) fetchInbox();
  }, [fetchInbox, activeAccountId]);

  // Auto-refresh every 30s
  useEffect(() => {
    if (!activeAccountId) return;
    const interval = setInterval(() => {
      fetchInbox();
    }, 30000);
    return () => clearInterval(interval);
  }, [activeAccountId, fetchInbox]);

  // ── Render ──

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffHrs = diffMs / (1000 * 60 * 60);
    if (diffHrs < 24) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    if (diffHrs < 168) {
      return d.toLocaleDateString([], { weekday: "short" });
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  const getPreview = (msg: EmailMessage) => {
    const text = msg.text || msg.subject || "";
    return text.substring(0, 80) + (text.length > 80 ? "…" : "");
  };

  // ── Account Picker ──
  const AccountPicker = () => (
    <div ref={accountPickerRef} className="absolute top-full left-0 right-0 z-50 mt-1 bg-surface border border-border rounded-lg shadow-xl overflow-hidden">
      <div className="px-3 py-2 text-[10px] text-muted uppercase tracking-wider font-medium border-b border-border">
        Mailboxes
      </div>
      {accounts.map((account) => (
        <button
          key={account.id}
          onClick={() => {
            setActiveAccountId(account.id);
            setShowAccountPicker(false);
            setSelectedUid(null);
            setSelectedMessage(null);
            setView("inbox");
          }}
          className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 hover:bg-accent/5 cursor-pointer transition-colors ${
            account.id === activeAccountId ? "bg-accent/10" : ""
          }`}
        >
          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
            account.id === activeAccountId ? "bg-accent text-accent-foreground" : "bg-muted-bg text-muted"
          }`}>
            {(account.displayName || account.name)[0]?.toUpperCase() || "?"}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium truncate flex items-center gap-1.5">
              {account.displayName || account.name}
              {account.isRelay && (
                <span className="text-[8px] px-1 py-0.5 rounded bg-blue-500/15 text-blue-400 font-medium shrink-0">RELAY</span>
              )}
            </div>
            <div className="text-[10px] text-muted truncate">{account.email}</div>
          </div>
          {account.id === activeAccountId && (
            <Check size={14} className="text-accent shrink-0" />
          )}
        </button>
      ))}
      <div className="px-3 py-2 border-t border-border">
        <button
          onClick={() => { setShowAccountPicker(false); setView("addMailbox"); setAddStep("provider"); }}
          className="flex items-center gap-1.5 text-xs text-accent hover:text-accent/80 cursor-pointer"
        >
          <Plus size={12} /> Add mailbox
        </button>
      </div>
    </div>
  );

  // ── Add Mailbox View ──
  if (view === "addMailbox") {
    return (
      <div className="flex flex-col h-full bg-surface text-foreground font-sans">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <button
            onClick={() => { setView("inbox"); setAddError(null); }}
            className="flex items-center gap-1 text-xs text-muted hover:text-foreground cursor-pointer"
          >
            <ArrowLeft size={14} /> Back
          </button>
          <h2 className="text-sm font-semibold flex items-center gap-1.5">
            <Plus size={14} className="text-accent" />
            Add Mailbox
          </h2>
          <div style={{ width: 60 }} />
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {addStep === "provider" && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium mb-1">Connect an email account</h3>
                <p className="text-xs text-muted mb-4">
                  Add any email address. Your agent can send and receive from this mailbox.
                </p>
              </div>

              {/* Email input with auto-detect */}
              <div>
                <label className="text-[10px] text-muted uppercase tracking-wider font-medium">Email address</label>
                <input
                  type="email"
                  value={addEmail}
                  onChange={(e) => {
                    setAddEmail(e.target.value);
                    const detected = detectProvider(e.target.value);
                    setAddProvider(detected);
                    const preset = PROVIDER_PRESETS.find(p => p.id === detected);
                    if (preset && detected !== "custom") {
                      setAddSmtpHost(preset.smtpHost);
                      setAddSmtpPort(preset.smtpPort);
                      setAddImapHost(preset.imapHost);
                      setAddImapPort(preset.imapPort);
                    }
                  }}
                  className="w-full bg-muted-bg border border-border rounded-md px-3 py-2 text-sm text-foreground focus:border-accent focus:ring-1 focus:ring-accent/30 outline-none mt-1"
                  placeholder="you@example.com"
                  autoFocus
                />
                {addProvider && addProvider !== "custom" && (
                  <p className="text-[10px] text-accent mt-1">
                    Detected: {PROVIDER_PRESETS.find(p => p.id === addProvider)?.name}
                  </p>
                )}
              </div>

              {/* Provider selection */}
              <div>
                <label className="text-[10px] text-muted uppercase tracking-wider font-medium">Provider</label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  {PROVIDER_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setAddProvider(p.id);
                        if (p.id !== "custom") {
                          setAddSmtpHost(p.smtpHost);
                          setAddSmtpPort(p.smtpPort);
                          setAddImapHost(p.imapHost);
                          setAddImapPort(p.imapPort);
                        }
                      }}
                      className={`flex items-center gap-2 px-3 py-2 rounded-md border text-xs cursor-pointer transition-colors ${
                        addProvider === p.id
                          ? "border-accent bg-accent/10 text-accent"
                          : "border-border hover:border-accent/30 text-muted hover:text-foreground"
                      }`}
                    >
                      <span className="w-6 h-6 rounded-full bg-muted-bg flex items-center justify-center text-[10px] font-bold shrink-0">
                        {p.icon}
                      </span>
                      <span className="truncate">{p.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom server fields */}
              {addProvider === "custom" && (
                <div className="space-y-3 p-3 bg-muted-bg/50 rounded-md border border-border">
                  <p className="text-[10px] text-muted">Enter your email provider&apos;s server details.</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-muted">SMTP Host</label>
                      <input
                        type="text"
                        value={addSmtpHost}
                        onChange={(e) => setAddSmtpHost(e.target.value)}
                        className="w-full bg-surface border border-border rounded px-2 py-1.5 text-xs text-foreground outline-none focus:border-accent"
                        placeholder="smtp.example.com"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted">SMTP Port</label>
                      <input
                        type="number"
                        value={addSmtpPort}
                        onChange={(e) => setAddSmtpPort(parseInt(e.target.value) || 587)}
                        className="w-full bg-surface border border-border rounded px-2 py-1.5 text-xs text-foreground outline-none focus:border-accent"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted">IMAP Host</label>
                      <input
                        type="text"
                        value={addImapHost}
                        onChange={(e) => setAddImapHost(e.target.value)}
                        className="w-full bg-surface border border-border rounded px-2 py-1.5 text-xs text-foreground outline-none focus:border-accent"
                        placeholder="imap.example.com"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted">IMAP Port</label>
                      <input
                        type="number"
                        value={addImapPort}
                        onChange={(e) => setAddImapPort(parseInt(e.target.value) || 993)}
                        className="w-full bg-surface border border-border rounded px-2 py-1.5 text-xs text-foreground outline-none focus:border-accent"
                      />
                    </div>
                  </div>
                </div>
              )}

              {addProvider && (
                <button
                  onClick={() => setAddStep("credentials")}
                  disabled={!addEmail.trim() || !addProvider}
                  className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 bg-accent text-accent-foreground rounded-md text-xs font-semibold cursor-pointer hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Continue <ArrowLeft size={12} className="rotate-180" />
                </button>
              )}

              {addProvider && addProvider !== "custom" && (
                <div className="flex items-start gap-2 p-2.5 bg-blue-500/5 border border-blue-500/10 rounded-md">
                  <Shield size={14} className="text-blue-400 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-blue-300 leading-relaxed">
                    {PROVIDER_PRESETS.find(p => p.id === addProvider)?.hint}
                  </p>
                </div>
              )}
            </div>
          )}

          {addStep === "credentials" && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium mb-1">Enter credentials</h3>
                <p className="text-xs text-muted mb-4">
                  Connecting to <span className="text-foreground font-medium">{addEmail}</span> via {PROVIDER_PRESETS.find(p => p.id === addProvider)?.name || "custom server"}
                </p>
              </div>

              <div>
                <label className="text-[10px] text-muted uppercase tracking-wider font-medium">Email</label>
                <input
                  type="email"
                  value={addEmail}
                  onChange={(e) => setAddEmail(e.target.value)}
                  className="w-full bg-muted-bg border border-border rounded-md px-3 py-2 text-sm text-foreground focus:border-accent focus:ring-1 focus:ring-accent/30 outline-none mt-1"
                  placeholder="you@example.com"
                />
              </div>

              <div>
                <label className="text-[10px] text-muted uppercase tracking-wider font-medium">Password / App Password</label>
                <div className="relative mt-1">
                  <input
                    type={addShowPassword ? "text" : "password"}
                    value={addPassword}
                    onChange={(e) => setAddPassword(e.target.value)}
                    className="w-full bg-muted-bg border border-border rounded-md px-3 py-2 pr-9 text-sm text-foreground focus:border-accent focus:ring-1 focus:ring-accent/30 outline-none"
                    placeholder="App password"
                    autoFocus
                  />
                  <button
                    onClick={() => setAddShowPassword(!addShowPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-foreground cursor-pointer"
                  >
                    {addShowPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                {addProvider !== "custom" && (
                  <p className="text-[10px] text-muted mt-1">
                    Use an App Password, not your regular password.
                  </p>
                )}
              </div>

              {addError && (
                <div className="flex items-start gap-2 p-2.5 bg-red-500/10 border border-red-500/20 rounded-md">
                  <AlertCircle size={14} className="text-red-400 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-red-400">{addError}</p>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => { setAddStep("provider"); setAddError(null); }}
                  className="flex-1 px-3 py-2 text-xs text-muted hover:text-foreground cursor-pointer rounded hover:bg-muted-bg transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleAddMailbox}
                  disabled={!addEmail.trim() || !addPassword.trim()}
                  className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 bg-accent text-accent-foreground rounded-md text-xs font-semibold cursor-pointer hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <Shield size={13} /> Connect
                </button>
              </div>
            </div>
          )}

          {addStep === "connecting" && (
            <div className="flex flex-col items-center justify-center h-48 gap-3">
              <Loader2 size={24} className="animate-spin text-accent" />
              <p className="text-sm text-foreground">Connecting to {addEmail}…</p>
              <p className="text-[10px] text-muted">Verifying IMAP and SMTP settings</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Compose View ──
  if (view === "compose" || compose || replying) {
    const replyTo = replying && selectedMessage
      ? (selectedMessage.replyAddress || selectedMessage.replyTo?.[0]?.address || selectedMessage.from?.[0]?.address || "")
      : "";
    const replySubject = replying && selectedMessage
      ? `Re: ${selectedMessage.subject || ""}`
      : "";

    const currentTo = compose?.to ?? replyTo ?? "";
    const currentSubject = compose?.subject ?? replySubject ?? "";
    const currentBody = compose?.body ?? "";
    const currentFromAccountId = compose?.fromAccountId ?? activeAccountId ?? "";

    return (
      <div className="flex flex-col h-full bg-surface text-foreground font-sans">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <button
            onClick={() => { setCompose(null); setReplying(false); setView("inbox"); }}
            className="flex items-center gap-1 text-xs text-muted hover:text-foreground cursor-pointer"
          >
            <ArrowLeft size={14} /> Back
          </button>
          <h2 className="text-sm font-semibold flex items-center gap-1.5">
            <PenLine size={14} className="text-accent" />
            {replying ? "Reply" : "New Email"}
          </h2>
          <div style={{ width: 60 }} />
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* From field */}
          {accounts.length > 1 && (
            <div>
              <label className="text-[10px] text-muted uppercase tracking-wider font-medium">From</label>
              <div className="relative mt-1">
                <select
                  value={currentFromAccountId}
                  onChange={(e) => setCompose({ ...compose!, fromAccountId: e.target.value })}
                  className="w-full bg-muted-bg border border-border rounded-md px-3 py-2 text-sm text-foreground appearance-none cursor-pointer focus:border-accent focus:ring-1 focus:ring-accent/30 outline-none"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.displayName || a.name} ({a.email})
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
              </div>
            </div>
          )}
          <div>
            <label className="text-[10px] text-muted uppercase tracking-wider font-medium">To</label>
            <input
              type="email"
              value={currentTo}
              onChange={(e) =>
                setCompose({ to: e.target.value, subject: currentSubject, body: currentBody, fromAccountId: currentFromAccountId })
              }
              className="w-full bg-muted-bg border border-border rounded-md px-3 py-2 text-sm text-foreground focus:border-accent focus:ring-1 focus:ring-accent/30 outline-none mt-1"
              placeholder="recipient@example.com"
              autoFocus={!replying}
            />
          </div>
          <div>
            <label className="text-[10px] text-muted uppercase tracking-wider font-medium">Subject</label>
            <input
              type="text"
              value={currentSubject}
              onChange={(e) =>
                setCompose({ to: currentTo, subject: e.target.value, body: currentBody, fromAccountId: currentFromAccountId })
              }
              className="w-full bg-muted-bg border border-border rounded-md px-3 py-2 text-sm text-foreground focus:border-accent focus:ring-1 focus:ring-accent/30 outline-none mt-1"
              placeholder="Subject"
            />
          </div>
          <div className="flex-1 flex flex-col">
            <label className="text-[10px] text-muted uppercase tracking-wider font-medium">Body</label>
            <textarea
              ref={composeRef}
              value={currentBody}
              onChange={(e) =>
                setCompose({ to: currentTo, subject: currentSubject, body: e.target.value, fromAccountId: currentFromAccountId })
              }
              className="flex-1 min-h-[200px] bg-muted-bg border border-border rounded-md px-3 py-2 text-sm text-foreground focus:border-accent focus:ring-1 focus:ring-accent/30 outline-none resize-none mt-1 font-sans"
              placeholder="Write your email..."
            />
          </div>
        </div>

        {/* Action bar */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border">
          <button
            onClick={() => { setCompose(null); setReplying(false); setView("inbox"); }}
            className="px-3 py-1.5 text-xs text-muted hover:text-foreground cursor-pointer rounded hover:bg-muted-bg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => sendEmail(currentTo, currentSubject, currentBody, currentFromAccountId)}
            disabled={sending || !currentTo.trim() || !currentSubject.trim()}
            className="flex items-center gap-1.5 px-4 py-2 bg-accent text-accent-foreground rounded-md text-xs font-semibold cursor-pointer hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Send size={13} />
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    );
  }

  // ── Message Detail View ──
  if (view === "message" && selectedMessage) {
    const fromAddr = selectedMessage.replyAddress || selectedMessage.replyTo?.[0]?.address || selectedMessage.from?.[0]?.address || "unknown@unknown.com";
    const displayFrom = selectedMessage.from?.[0]?.name || selectedMessage.from?.[0]?.address || fromAddr;
    const fromName = selectedMessage.from?.[0]?.name || fromAddr;
    const spamFlag = isSpam({ uid: selectedUid || 0, subject: selectedMessage.subject, from: selectedMessage.from, to: selectedMessage.to, date: selectedMessage.date, flags: selectedMessage.flags || {}, size: 0, text: selectedMessage.text || "" });
    const isAgentSent = selectedMessage.from?.some((f: { name: string; address: string }) =>
      f.address?.includes("secretary@localhost") ||
      f.address?.includes("sales+") ||
      f.name?.toLowerCase().includes("smyth agent")
    );

    return (
      <div className="flex flex-col h-full bg-surface text-foreground font-sans">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <button
            onClick={() => { setSelectedUid(null); setSelectedMessage(null); setView("inbox"); }}
            className="flex items-center gap-1 text-xs text-muted hover:text-foreground cursor-pointer"
          >
            <ArrowLeft size={14} /> Inbox
          </button>
          <div className="flex items-center gap-1.5">
            {spamFlag && (
              <button
                onClick={() => markAsSpam(selectedUid!)}
                className="flex items-center gap-1 px-2 py-1 text-[10px] text-red-400 bg-red-500/10 rounded hover:bg-red-500/20 cursor-pointer"
                title="Mark as spam & delete"
              >
                <AlertCircle size={11} /> Spam
              </button>
            )}
            {isAgentSent && (
              <span className="flex items-center gap-1 px-2 py-1 text-[10px] text-violet-400 bg-violet-500/10 rounded">
                🤖 Sent by Smyth
              </span>
            )}
            <button
              onClick={() => aiDraftReply(selectedMessage)}
              disabled={aiDrafting}
              className="flex items-center gap-1 px-2 py-1 text-[10px] text-accent bg-accent/10 rounded hover:bg-accent/20 cursor-pointer disabled:opacity-50"
              title="AI draft reply"
            >
              <Sparkles size={11} /> {aiDrafting ? "Drafting…" : "AI Draft"}
            </button>
            <button
              onClick={() => {
                setReplying(true);
                setCompose({
                  to: fromAddr,
                  subject: `Re: ${selectedMessage.subject || ""}`,
                  body: "",
                  fromAccountId: activeAccountId || undefined,
                });
                setView("compose");
              }}
              className="p-1.5 text-muted hover:text-accent cursor-pointer rounded hover:bg-accent/10"
              title="Reply"
            >
              <Reply size={14} />
            </button>
            <button
              onClick={() => deleteMessage(selectedUid!)}
              className="p-1.5 text-muted hover:text-red-500 cursor-pointer rounded hover:bg-red-500/10"
              title="Delete"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {/* Message */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="flex items-start gap-2 mb-3">
            <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center text-xs font-bold text-accent shrink-0">
              {(fromName || fromAddr)[0]?.toUpperCase() || "?"}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate">{fromName}</span>
                {isAgentSent && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400 font-medium">🤖 Smyth</span>
                )}
                {spamFlag && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 font-medium">SPAM</span>
                )}
              </div>
              <div className="text-[10px] text-muted">&lt;{displayFrom}&gt;</div>
            </div>
            <span className="text-[10px] text-muted shrink-0">{formatDate(selectedMessage.date)}</span>
          </div>
          <h3 className="text-base font-semibold mb-3">
            {selectedMessage.subject || "(no subject)"}
          </h3>
          <div className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">
            {selectedMessage.text || "(no content)"}
          </div>
        </div>

        {/* Quick reply bar */}
        <div className="px-4 py-3 border-t border-border">
          <div className="flex gap-2">
            <button
              onClick={() => {
                setReplying(true);
                setCompose({
                  to: fromAddr,
                  subject: `Re: ${selectedMessage.subject || ""}`,
                  body: "",
                  fromAccountId: activeAccountId || undefined,
                });
                setView("compose");
              }}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-accent/10 text-accent rounded-md text-xs font-medium cursor-pointer hover:bg-accent/20 transition-colors"
            >
              <Reply size={13} /> Reply
            </button>
            <button
              onClick={() => aiDraftReply(selectedMessage)}
              disabled={aiDrafting}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-accent/5 text-accent rounded-md text-xs font-medium cursor-pointer hover:bg-accent/15 transition-colors disabled:opacity-50"
            >
              <Sparkles size={13} /> {aiDrafting ? "Drafting…" : "AI Draft"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Inbox List View ──
  return (
    <div className="flex flex-col h-full bg-surface text-foreground font-sans">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Mail size={16} className="text-accent" />
          <h2 className="text-sm font-semibold">Email</h2>
          {unreadCount > 0 && (
            <span className="bg-accent text-accent-foreground text-[10px] font-bold rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
              {unreadCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {/* Auto-Respond Toggle */}
          <div className="relative" ref={autoRespondMenuRef}>
            <button
              onClick={() => setShowAutoRespondMenu(!showAutoRespondMenu)}
              disabled={!activeAccountId || autoRespondLoading}
              className={`flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium cursor-pointer transition-colors ${
                !activeAccountId ? "opacity-40 cursor-not-allowed" : ""
              } ${
                autoRespondState.enabled
                  ? "bg-violet-500/15 text-violet-400 hover:bg-violet-500/25"
                  : "text-muted hover:text-foreground hover:bg-muted-bg"
              }`}
              title={autoRespondState.enabled ? `Auto-respond ON (${autoRespondState.mode})` : "Auto-respond OFF"}
            >
              {autoRespondProcessing ? (
                <Loader2 size={13} className="animate-spin" />
              ) : autoRespondState.enabled ? (
                <Zap size={13} />
              ) : (
                <ZapOff size={13} />
              )}
              {autoRespondState.enabled && (
                <span className="text-[9px] uppercase tracking-wider">{autoRespondState.mode === "auto" ? "Auto" : "Draft"}</span>
              )}
            </button>
            {showAutoRespondMenu && (
              <div className="absolute right-0 top-full mt-1 z-50 w-80 bg-surface border border-border rounded-lg shadow-xl overflow-hidden">
                <div className="px-3 py-2 text-[10px] text-muted uppercase tracking-wider font-medium border-b border-border">
                  Auto-Respond
                </div>
                {/* Toggle on/off */}
                <button
                  onClick={() => toggleAutoRespond()}
                  disabled={autoRespondLoading}
                  className="w-full text-left px-3 py-2.5 flex items-center justify-between hover:bg-accent/5 cursor-pointer transition-colors disabled:opacity-50"
                >
                  <div className="flex items-center gap-2">
                    {autoRespondState.enabled ? <Zap size={14} className="text-violet-400" /> : <ZapOff size={14} className="text-muted" />}
                    <span className="text-xs">{autoRespondState.enabled ? "Enabled" : "Disabled"}</span>
                  </div>
                  {autoRespondState.enabled && <Check size={12} className="text-accent" />}
                </button>
                {autoRespondState.enabled && (
                  <>
                    <div className="px-3 py-1.5 text-[10px] text-muted uppercase tracking-wider border-t border-border">Mode</div>
                    <button
                      onClick={() => setAutoRespondMode("draft")}
                      className={`w-full text-left px-3 py-2 flex items-center gap-2 cursor-pointer transition-colors ${
                        autoRespondState.mode === "draft" ? "bg-accent/10 text-accent" : "hover:bg-muted-bg text-muted"
                      }`}
                    >
                      <Clock size={13} />
                      <div>
                        <div className="text-xs">Draft for review</div>
                        <div className="text-[9px] text-muted">Agent drafts, you approve</div>
                      </div>
                      {autoRespondState.mode === "draft" && <Check size={12} className="text-accent ml-auto" />}
                    </button>
                    <button
                      onClick={() => setAutoRespondMode("auto")}
                      className={`w-full text-left px-3 py-2 flex items-center gap-2 cursor-pointer transition-colors ${
                        autoRespondState.mode === "auto" ? "bg-accent/10 text-accent" : "hover:bg-muted-bg text-muted"}`}
                    >
                      <SendIcon size={13} />
                      <div>
                        <div className="text-xs">Auto-send</div>
                        <div className="text-[9px] text-muted">Agent replies automatically</div>
                      </div>
                      {autoRespondState.mode === "auto" && <Check size={12} className="text-accent ml-auto" />}
                    </button>
                  </>
                )}
                <div className="px-3 py-1.5 border-t border-border text-[9px] text-muted">
                  {autoRespondState.enabled
                    ? `Watching inbox. ${autoRespondState.mode === "auto" ? "Auto-replies on." : "Drafts saved for review."}`
                    : "Enable to let the agent auto-respond to incoming emails."}
                </div>
                {autoRespondError && (
                  <div className="px-3 py-2 border-t border-border bg-red-500/10 text-red-400 text-[10px] flex items-start gap-1.5">
                    <AlertCircle size={12} className="shrink-0 mt-0.5" />
                    <span className="flex-1">{autoRespondError}</span>
                    <button onClick={clearAutoRespondError} className="text-muted hover:text-foreground shrink-0"><X size={12} /></button>
                  </div>
                )}
              </div>
            )}
          </div>
          <button
            onClick={fetchInbox}
            className="p-1.5 text-muted hover:text-foreground cursor-pointer rounded hover:bg-muted-bg transition-colors"
            title="Refresh"
          >
            <RefreshCw size={14} />
          </button>
          <button
            onClick={() => {
              setCompose({ to: "", subject: "", body: "", fromAccountId: activeAccountId || undefined });
              setReplying(false);
              setView("compose");
            }}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-accent text-accent-foreground rounded-md text-xs font-semibold cursor-pointer hover:bg-accent/90 transition-colors"
            title="Compose new email"
          >
            <PenLine size={13} /> Compose
          </button>
          <button
            onClick={onClose}
            className="p-1.5 text-muted hover:text-foreground cursor-pointer rounded hover:bg-muted-bg transition-colors"
            title="Close"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Account selector */}
      {accounts.length > 0 && (
        <div className="relative px-4 py-2 border-b border-border">
          <button
            onClick={() => setShowAccountPicker(!showAccountPicker)}
            className="w-full flex items-center justify-between px-3 py-1.5 bg-muted-bg border border-border rounded-md text-xs cursor-pointer hover:border-accent/30 transition-colors"
          >
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-5 h-5 rounded-full bg-accent/10 flex items-center justify-center text-[9px] font-bold text-accent shrink-0">
                {(activeAccount?.displayName || activeAccount?.name || "?")[0]?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <span className="font-medium truncate block">{activeAccount?.displayName || activeAccount?.name || "Select mailbox"}</span>
              </div>
            </div>
            <ChevronDown size={14} className="text-muted shrink-0" />
          </button>
          {showAccountPicker && <AccountPicker />}
        </div>
      )}

      {/* Sent confirmation */}
      {sentConfirm && (
        <div className="px-4 py-2 bg-emerald-500/10 text-emerald-400 text-xs flex items-center gap-1.5">
          <Check size={12} /> {sentConfirm}
        </div>
      )}

      {/* Auto-respond draft notification */}
      {autoRespondDraft && (
        <div className="px-4 py-2.5 bg-violet-500/10 border-b border-violet-500/20">
          <div className="flex items-start gap-2">
            <Bot size={14} className="text-violet-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-violet-400">Agent drafted a reply</div>
              <div className="text-[10px] text-muted truncate mt-0.5">
                To: {autoRespondDraft.to} · Re: {autoRespondDraft.originalSubject.slice(0, 40)}
              </div>
              <div className="text-[10px] text-foreground/70 mt-1 line-clamp-2">
                {autoRespondDraft.body.slice(0, 150)}{autoRespondDraft.body.length > 150 ? "…" : ""}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <button
                  onClick={() => {
                    setCompose({
                      to: autoRespondDraft.to,
                      subject: autoRespondDraft.subject,
                      body: autoRespondDraft.body,
                      fromAccountId: activeAccountId || undefined,
                    });
                    setReplying(true);
                    setView("compose");
                    setAutoRespondDraft(null);
                  }}
                  className="flex items-center gap-1 px-2.5 py-1 bg-violet-500/20 text-violet-300 rounded text-[10px] font-medium cursor-pointer hover:bg-violet-500/30 transition-colors"
                >
                  <PenLine size={11} /> Review & Edit
                </button>
                <button
                  onClick={() => {
                    sendEmail(autoRespondDraft.to, autoRespondDraft.subject, autoRespondDraft.body, activeAccountId || undefined);
                    setAutoRespondDraft(null);
                  }}
                  className="flex items-center gap-1 px-2.5 py-1 bg-accent text-accent-foreground rounded text-[10px] font-medium cursor-pointer hover:bg-accent/90 transition-colors"
                >
                  <Send size={11} /> Send Now
                </button>
                <button
                  onClick={() => setAutoRespondDraft(null)}
                  className="px-2 py-1 text-[10px] text-muted hover:text-foreground cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="px-4 py-2 bg-red-500/10 text-red-400 text-xs flex items-center gap-1.5">
          <AlertCircle size={12} />
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-auto text-red-400 hover:text-red-300 cursor-pointer"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Message list */}
      <div className="flex-1 overflow-y-auto">
        {loading && messages.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-xs text-muted">
            <Loader2 size={16} className="animate-spin mr-2" />
            Loading…
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-xs text-muted">
            <Inbox size={24} className="mb-2 opacity-30" />
            <span>No messages in {folder}</span>
            <button
              onClick={() => { setCompose({ to: "", subject: "", body: "", fromAccountId: activeAccountId || undefined }); setReplying(false); setView("compose"); }}
              className="mt-2 flex items-center gap-1 text-accent hover:text-accent/80 cursor-pointer text-xs"
            >
              <PenLine size={12} /> Write an email
            </button>
          </div>
        ) : (
          messages.map((msg) => {
            const isUnread = !msg.flags?.["\\Seen"];
            const spamFlag = isSpam(msg);
            const fromAddr = msg.replyAddress || msg.replyTo?.[0]?.address || msg.from?.[0]?.address || "Unknown";
            const fromName = msg.from?.[0]?.name || fromAddr;
            const initial = fromName[0]?.toUpperCase() || "?";
            const isAgentSent = msg.isAgentSent || msg.from?.some(f =>
              f.address?.includes("secretary@localhost") ||
              f.address?.includes("sales+") ||
              f.name?.toLowerCase().includes("smyth agent")
            );

            return (
              <button
                key={msg.uid}
                onClick={() => {
                  fetchMessage(msg.uid);
                  if (isUnread) markRead(msg.uid);
                }}
                className={`w-full text-left px-4 py-3 border-b border-border hover:bg-accent/5 cursor-pointer transition-colors ${
                  isUnread ? "bg-accent/5" : ""
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                    spamFlag ? "bg-red-500/10 text-red-400" : isAgentSent ? "bg-violet-500/10 text-violet-400" : "bg-accent/10 text-accent"
                  }`}>
                    {spamFlag ? "!" : isAgentSent ? "\u{1F916}" : initial}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className={`text-xs truncate max-w-[140px] ${
                        isUnread ? "font-semibold text-foreground" : "text-muted"
                      }`}>
                        {fromName}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {isAgentSent && (
                          <span className="text-[9px] px-1 py-0.5 rounded bg-violet-500/10 text-violet-400 font-medium">🤖 Smyth</span>
                        )}
                        {spamFlag && (
                          <span className="text-[9px] px-1 py-0.5 rounded bg-red-500/10 text-red-400 font-medium">SPAM</span>
                        )}
                        <span className="text-[10px] text-muted">{formatDate(msg.date)}</span>
                      </div>
                    </div>
                    <div className={`text-xs truncate mt-0.5 ${
                      isUnread ? "font-medium text-foreground" : "text-muted"
                    }`}>
                      {msg.subject || "(no subject)"}
                    </div>
                    <div className="text-[10px] text-muted/70 truncate mt-0.5">
                      {getPreview(msg)}
                    </div>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Folder tabs */}
      <div className="flex items-center gap-1 px-3 py-2 border-t border-border text-[10px]">
        {[
          { key: "inbox", label: "Inbox" },
          { key: "Sent Items", label: "Sent" },
          { key: "Drafts", label: "Drafts" },
          { key: "Deleted Items", label: "Trash" },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setFolder(f.key)}
            className={`px-2.5 py-1 rounded-md cursor-pointer transition-colors ${
              folder === f.key
                ? "bg-accent/10 text-accent font-medium"
                : "text-muted hover:text-foreground hover:bg-muted-bg"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
    </div>
  );
}