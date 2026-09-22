"use client";

import { useState, useEffect, useCallback, useRef } from "react";

const AGENTICMAIL_API = process.env.NEXT_PUBLIC_AGENTICMAIL_API_URL || "http://127.0.0.1:3829/api/agenticmail";
const MASTER_KEY = process.env.NEXT_PUBLIC_AGENTICMAIL_MASTER_KEY || "";

const masterHeaders = () => ({
  Authorization: `Bearer ${MASTER_KEY}`,
  "Content-Type": "application/json",
});

const apiUrl = (path: string) => {
  if (typeof window === "undefined") return path;
  return `${window.location.origin}${path}`;
};

export type AutoRespondState = {
  enabled: boolean;
  mode: "draft" | "auto";
};

export type AutoRespondDraft = {
  to: string;
  subject: string;
  body: string;
  originalUid: number;
  originalFrom: string;
  originalSubject: string;
};

export function useAutoRespond(
  activeAccountId: string | null,
  activeApiKey: string,
  onDraftReady: (draft: AutoRespondDraft) => void
) {
  const [state, setState] = useState<AutoRespondState>({ enabled: false, mode: "draft" });
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastSeenUidRef = useRef<number>(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch auto-respond state for the active account
  const fetchState = useCallback(async () => {
    if (!activeAccountId) return;
    try {
      const res = await fetch(`${AGENTICMAIL_API}/../agenticmail/accounts`, {
        headers: masterHeaders(),
      });
      if (!res.ok) return;
      const data = await res.json();
      const agent = (data.agents || []).find((a: any) => a.id === activeAccountId);
      if (agent) {
        setState({
          enabled: agent.metadata?.autoRespond ?? false,
          mode: agent.metadata?.autoRespondMode ?? "draft",
        });
      }
    } catch (err) {
      console.error("[autoRespond] Failed to fetch state:", err);
    }
  }, [activeAccountId]);

  // Toggle auto-respond on/off
  const toggle = useCallback(async (enabled?: boolean) => {
    if (!activeAccountId) {
      setError("No email account selected");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiUrl("/api/mail/auto-respond"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: activeAccountId,
          enabled: enabled ?? !state.enabled,
          mode: state.mode,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        setError(`Toggle failed: ${text.slice(0, 200)}`);
        console.error("[autoRespond] Toggle failed:", text);
        return;
      }
      const data = await res.json();
      setState(prev => ({
        enabled: data.autoRespond ?? !prev.enabled,
        mode: data.autoRespondMode ?? prev.mode,
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Network error: ${msg}`);
      console.error("[autoRespond] Toggle error:", err);
    } finally {
      setLoading(false);
    }
  }, [activeAccountId, state.enabled, state.mode]);

  // Set mode (draft or auto)
  const setMode = useCallback(async (mode: "draft" | "auto") => {
    if (!activeAccountId) {
      setError("No email account selected");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiUrl("/api/mail/auto-respond"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: activeAccountId,
          enabled: true,
          mode,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        setError(`Set mode failed: ${text.slice(0, 200)}`);
        return;
      }
      const data = await res.json();
      setState(prev => ({
        enabled: data.autoRespond ?? prev.enabled,
        mode: data.autoRespondMode ?? mode,
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Network error: ${msg}`);
      console.error("[autoRespond] Set mode error:", err);
    } finally {
      setLoading(false);
    }
  }, [activeAccountId]);

  // Poll for new mail and trigger auto-respond
  useEffect(() => {
    if (!state.enabled || !activeAccountId || !activeApiKey) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }

    // Initial fetch of current inbox to set the baseline (via bypass)
    const initBaseline = async () => {
      try {
        const res = await fetch(`/api/mail/inbox-bypass?agentId=${encodeURIComponent(activeAccountId)}&folder=INBOX&limit=1`, {
          headers: { "Content-Type": "application/json" },
        });
        if (res.ok) {
          const data = await res.json();
          const msgs = data.messages || [];
          if (msgs.length > 0) {
            lastSeenUidRef.current = msgs[0].uid;
          }
        }
      } catch {}
    };
    initBaseline();

    // Poll every 15s for new mail (via bypass)
    pollRef.current = setInterval(async () => {
      if (processing) return;
      try {
        const res = await fetch(`/api/mail/inbox-bypass?agentId=${encodeURIComponent(activeAccountId)}&folder=INBOX&limit=5`, {
          headers: { "Content-Type": "application/json" },
        });
        if (!res.ok) return;
        const data = await res.json();
        const msgs = data.messages || [];
        // Find new messages with UID > lastSeenUid
        const newMsgs = msgs.filter((m: any) => m.uid > lastSeenUidRef.current);
        if (newMsgs.length === 0) return;

        // Update last seen UID
        lastSeenUidRef.current = Math.max(...msgs.map((m: any) => m.uid));

        // Process each new message
        for (const msg of newMsgs) {
          // Skip messages sent by any of our own agents
          const fromAddr = msg.from?.[0]?.address || "";
          if (fromAddr.includes("@localhost")) {
            continue;
          }

          setProcessing(true);
          try {
            const triggerRes = await fetch("/api/mail/auto-respond-trigger", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                agentId: activeAccountId,
                agentName: "smyth",
                agentApiKey: activeApiKey,
                message: { uid: msg.uid, from: msg.from, subject: msg.subject, date: msg.date },
              }),
            });

            if (!triggerRes.ok) continue;
            const result = await triggerRes.json();

            if (result.ok && result.mode === "draft" && result.draft) {
              // Notify the UI about the new draft
              onDraftReady(result.draft);
            }
          } catch (err) {
            console.error("[autoRespond] Trigger error:", err);
          } finally {
            setProcessing(false);
          }
        }
      } catch (err) {
        console.error("[autoRespond] Poll error:", err);
      }
    }, 15000);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [state.enabled, state.mode, activeAccountId, activeApiKey, processing, onDraftReady]);

  // Fetch state on mount and when account changes
  useEffect(() => {
    fetchState();
  }, [fetchState]);

  return {
    state,
    loading,
    processing,
    error,
    clearError: () => setError(null),
    toggle,
    setMode,
    refresh: fetchState,
  };
}