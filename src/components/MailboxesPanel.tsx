"use client";
import { useState, useEffect, useCallback } from "react";

interface Account {
  id: string;
  name: string;
  email: string;
  role: string;
  stopped: boolean;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, any>;
}

// ── Provider presets — fill common IMAP/SMTP hosts to reduce user error ──
interface ProviderPreset {
  label: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  note?: string;
}
const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  custom: { label: "Custom (type your own)", imapHost: "", imapPort: 993, smtpHost: "", smtpPort: 587 },
  godaddy: {
    label: "GoDaddy / Workspace",
    imapHost: "imap.secureserver.net", imapPort: 993,
    smtpHost: "smtpout.secureserver.net", smtpPort: 587,
    note: "Workspace mail",
  },
  gmail: {
    label: "Gmail",
    imapHost: "imap.gmail.com", imapPort: 993,
    smtpHost: "smtp.gmail.com", smtpPort: 587,
    note: "Requires an App Password (2FA enabled)",
  },
  fastmail: {
    label: "Fastmail",
    imapHost: "imap.fastmail.com", imapPort: 993,
    smtpHost: "smtp.fastmail.com", smtpPort: 587,
  },
  protonmail: {
    label: "ProtonMail",
    imapHost: "127.0.0.1", imapPort: 1143,
    smtpHost: "127.0.0.1", smtpPort: 1025,
    note: "Requires ProtonMail Bridge running locally",
  },
  icloud: {
    label: "iCloud",
    imapHost: "imap.mail.me.com", imapPort: 993,
    smtpHost: "smtp.mail.me.com", smtpPort: 587,
    note: "Requires app-specific password",
  },
  outlook: {
    label: "Outlook / Office365",
    imapHost: "outlook.office365.com", imapPort: 993,
    smtpHost: "smtp.office365.com", smtpPort: 587,
  },
  zoho: {
    label: "Zoho Mail",
    imapHost: "imap.zoho.com", imapPort: 993,
    smtpHost: "smtp.zoho.com", smtpPort: 587,
  },
};

export default function MailboxesPanel({ onClose }: { onClose: () => void }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeEmail, setActiveEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [provider, setProvider] = useState<keyof typeof PROVIDER_PRESETS>("custom");
  const [email, setEmail] = useState("");
  const [domain, setDomain] = useState("");
  const [password, setPassword] = useState("");
  const [presetNote] = useState(PROVIDER_PRESETS.custom.note || "");

  // ── Load accounts + active operator email ──
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const acctsRes = await fetch("/api/agenticmail/accounts");
      const acctsJson = await acctsRes.json();
      setAccounts(acctsJson.accounts || []);
      // Active mailbox — read-only display. The operator/active mailbox is
      // managed upstream by @agenticmail/openclaw MCP tools, not from this UI.
      const activeRes = await fetch("/api/agenticmail/accounts/me");
      if (activeRes.ok) {
        const activeData = await activeRes.json();
        setActiveEmail(activeData?.email || null);
      }
    } catch (e: any) {
      setError(e?.message || "Failed to load mailboxes");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Auto-fill domain when email is typed (if user uses simple form)
  useEffect(() => {
    if (email && email.includes("@")) {
      const [, dom] = email.split("@");
      if (dom) setDomain(dom);
    }
  }, [email]);

  // Active mailbox display is read-only here. Switching happens via
// @agenticmail/openclaw MCP tools at the agent runtime.

  // ── Add new account ──
  const addAccount = async () => {
    setBusy(true);
    setError(null);
    try {
      const localpart = email.includes("@") ? email.split("@")[0] : "";
      const dom = domain || (email.includes("@") ? email.split("@")[1] : "");
      if (!localpart || !dom || !password) {
        throw new Error("Local-part (email), domain, and password are required");
      }
      const res = await fetch("/api/agenticmail/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: `${localpart}@${dom}`, password }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "create failed");
      setShowAdd(false);
      setEmail(""); setDomain(""); setPassword("");
      await load();
    } catch (e: any) {
      setError(e?.message || "Failed to add mailbox");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-3xl max-h-[85vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
              <span className="text-emerald-400">📬</span>
              Mailboxes
            </h2>
            <p className="text-xs text-zinc-400 mt-1">
              Configure any email address. Read-only list — active identity
              is managed by the agent runtime.
              {activeEmail && <> · <span className="text-emerald-400">currently: {activeEmail}</span></>}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 transition px-2 py-1"
            aria-label="Close"
          >✕</button>
        </div>

        {/* Body */}
        <div className="p-6">
          {error && (
            <div className="mb-4 px-3 py-2 bg-red-900/40 border border-red-700/50 rounded text-sm text-red-200">
              {error}
            </div>
          )}

          {loading ? (
            <p className="text-zinc-500 text-sm py-12 text-center">Loading mailboxes…</p>
          ) : (
            <>
              {/* Account list */}
              <div className="space-y-2">
                {accounts.map((acct) => {
                  // Read-only display. Active identity is set by the agent
                  // runtime via @agenticmail/openclaw MCP tools.
                  const isActive = activeEmail === acct.email;
                  return (
                    <div
                      key={acct.id}
                      className={`px-4 py-3 rounded-lg border transition ${
                        isActive
                          ? "border-emerald-500/60 bg-emerald-900/20"
                          : "border-zinc-700/60 bg-zinc-800/40 hover:border-zinc-600"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm text-zinc-200 truncate">
                              {acct.email}
                            </span>
                            {isActive && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                                ACTIVE
                              </span>
                            )}
                            {acct.stopped && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-400">
                                stopped
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-1.5 text-[10px] text-zinc-500">
                            <span>role: {acct.role}</span>
                            <span>·</span>
                            <span>created {new Date(acct.createdAt).toLocaleDateString()}</span>
                            {acct.metadata?.autoRespond && (
                              <>
                                <span>·</span>
                                <span>auto-respond: {String(acct.metadata.autoRespondMode || "on")}</span>
                              </>
                            )}
                          </div>
                        </div>
                        {/* No action buttons — read-only. Active identity is
                            controlled by the agent runtime. */}
                      </div>
                    </div>
                  );
                })}

                {accounts.length === 0 && (
                  <p className="text-zinc-500 text-sm text-center py-8">
                    No mailboxes yet. Add one below.
                  </p>
                )}
              </div>

              {/* Add new */}
              <div className="mt-6 pt-4 border-t border-zinc-800">
                {!showAdd ? (
                  <button
                    onClick={() => setShowAdd(true)}
                    className="w-full px-3 py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm border border-zinc-700 border-dashed transition"
                  >
                    + Add a mailbox (any email)
                  </button>
                ) : (
                  <div className="bg-zinc-800/50 rounded-lg p-4 border border-zinc-700 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-medium text-zinc-200">New mailbox</h3>
                      <button
                        onClick={() => setShowAdd(false)}
                        disabled={busy}
                        className="text-xs text-zinc-500 hover:text-zinc-300"
                      >
                        Cancel
                      </button>
                    </div>

                    <div>
                      <label className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1">
                        Provider preset
                      </label>
                      <select
                        value={provider}
                        onChange={(e) => setProvider(e.target.value as keyof typeof PROVIDER_PRESETS)}
                        className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200"
                      >
                        {Object.entries(PROVIDER_PRESETS).map(([k, p]) => (
                          <option key={k} value={k}>{p.label}</option>
                        ))}
                      </select>
                      {PROVIDER_PRESETS[provider]?.note && (
                        <p className="text-[10px] text-zinc-500 mt-1">
                          ℹ {PROVIDER_PRESETS[provider].note}
                        </p>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1">
                          Email address
                        </label>
                        <input
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="you@example.com"
                          className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1">
                          Domain (auto-filled)
                        </label>
                        <input
                          type="text"
                          value={domain}
                          onChange={(e) => setDomain(e.target.value)}
                          placeholder="example.com"
                          className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200 font-mono"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1">
                        Password (IMAP/SMTP)
                      </label>
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="App password recommended"
                        className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200"
                        autoComplete="off"
                      />
                      <p className="text-[10px] text-zinc-500 mt-1">
                        For Gmail/Outlook, use an App Password — not your account password.
                      </p>
                    </div>

                    <button
                      onClick={addAccount}
                      disabled={busy || !email || !password}
                      className="w-full px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium disabled:opacity-50 transition"
                    >
                      {busy ? "Connecting…" : "Add mailbox"}
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
