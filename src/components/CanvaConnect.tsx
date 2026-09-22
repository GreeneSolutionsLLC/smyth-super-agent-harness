import { useState, useEffect } from "react";
import { Palette, Check, Loader2, ExternalLink } from "lucide-react";

export default function CanvaConnect() {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [initiating, setInitiating] = useState(false);

  // Check connection status on mount
  useEffect(() => {
    checkStatus();
  }, []);

  async function checkStatus() {
    try {
      const res = await fetch("/api/mcp/oauth/status?server=canva");
      const data = await res.json();
      setConnected(data.connected && !data.expired);
    } catch {
      // ignore
    }
  }

  async function handleConnect() {
    setInitiating(true);
    try {
      const res = await fetch("/api/mcp/oauth/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serverName: "canva",
          serverUrl: "https://mcp.canva.com/mcp",
        }),
      });
      const data = await res.json();
      if (data.authUrl) {
        // Open Canva OAuth in a new tab
        window.open(data.authUrl, "_blank", "noopener,noreferrer,width=600,height=700");
        // Start polling for connection status
        pollStatus();
      } else {
        console.error("[canva] No auth URL returned:", data);
      }
    } catch (err) {
      console.error("[canva] Connection failed:", err);
    } finally {
      setInitiating(false);
    }
  }

  function pollStatus() {
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      if (attempts > 60) {
        clearInterval(interval);
        return;
      }
      try {
        const res = await fetch("/api/mcp/oauth/status?server=canva");
        const data = await res.json();
        if (data.connected && !data.expired) {
          setConnected(true);
          clearInterval(interval);
        }
      } catch {
        // ignore
      }
    }, 2000);
  }

  if (connected) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm bg-accent/10 text-accent">
        <Check size={14} strokeWidth={2} />
        <span className="text-xs">Canva Connected</span>
      </div>
    );
  }

  return (
    <button
      onClick={handleConnect}
      disabled={initiating}
      className="flex items-center gap-2 w-full bg-none border-none text-muted px-3 py-1.5 rounded-md text-sm cursor-pointer hover:bg-muted-bg hover:text-foreground transition-colors disabled:opacity-50"
    >
      {initiating ? (
        <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />
      ) : (
        <Palette size={14} strokeWidth={1.5} />
      )}
      <span className="text-xs">{initiating ? "Connecting…" : "Connect Canva"}</span>
      <ExternalLink size={12} strokeWidth={1.5} className="ml-auto opacity-40" />
    </button>
  );
}