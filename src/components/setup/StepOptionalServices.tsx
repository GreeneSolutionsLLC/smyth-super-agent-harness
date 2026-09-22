"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, Check, X, Server, Mail, Database, ExternalLink } from "lucide-react";

interface DockerStatus {
  installed: boolean;
  running: boolean;
  compose: boolean;
  version: string;
}

export default function StepOptionalServices() {
  const [docker, setDocker] = useState<DockerStatus | null>(null);
  const [loadingDocker, setLoadingDocker] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [log, setLog] = useState<string>("");
  const [installedCrm, setInstalledCrm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshDocker = useCallback(async () => {
    setLoadingDocker(true);
    try {
      const r = await fetch("/api/setup/docker");
      const data = await r.json();
      setDocker(data.docker ?? null);
    } catch {
      setDocker(null);
    } finally {
      setLoadingDocker(false);
    }
  }, []);

  useEffect(() => {
    refreshDocker();
  }, [refreshDocker]);

  const dockerReady = docker?.installed && docker?.running && docker?.compose;

  async function installTwenty() {
    setInstalling(true);
    setError(null);
    setLog("");
    try {
      const r = await fetch("/api/setup/docker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "install-twenty" }),
      });
      const data = await r.json();
      setLog(data.output ?? "");
      if (data.ok) {
        setInstalledCrm(true);
      } else {
        setError("Install did not complete cleanly. See the log below.");
      }
    } catch (e: any) {
      setError(e.message || "Failed to install.");
    } finally {
      setInstalling(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Docker status */}
      <div className="card p-4 flex items-start gap-3">
        <Server className="w-5 h-5 text-accent mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-medium">Get Ready</div>
          {loadingDocker ? (
            <div className="text-muted text-sm flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking…
            </div>
          ) : dockerReady ? (
            <div className="text-sm text-accent flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5" /> You're ready to install with one click.
            </div>
          ) : (
            <div className="text-sm text-warning space-y-1">
              <div>
                {docker?.installed
                  ? "A helper program needs to be started. Open the app called \"Docker\" on your computer, wait a moment, then try again."
                  : "We need to install a small helper program first. It's free and safe."}
              </div>
              <a href="https://www.docker.com/products/docker-desktop/" target="_blank" rel="noreferrer" className="text-accent hover:underline inline-flex items-center gap-1">
                Install the helper <ExternalLink className="w-3 h-3" />
              </a>
              <div className="text-xs text-muted">After it's installed, click the button below to check again.</div>
            </div>
          )}
          <button onClick={refreshDocker} className="text-xs text-muted hover:text-foreground mt-1 underline underline-offset-2">
            Check again
          </button>
        </div>
      </div>

      {/* CRM (Twenty) */}
      <div className="card p-4 flex items-start gap-3">
        <Database className="w-5 h-5 text-accent mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-medium">Customer Book (CRM)</div>
          <p className="text-muted text-sm">
            Your assistant remembers your customers — names, companies, and deals — all on your own
            computer.
          </p>
          {installedCrm ? (
            <div className="text-sm text-accent mt-2 flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5" /> Done! Your customer book is ready.
            </div>
          ) : (
            <button
              onClick={installTwenty}
              disabled={installing || !dockerReady}
              className="btn btn-primary mt-2 disabled:opacity-50"
            >
              {installing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
              {installing ? "Setting up…" : "Set Up Customer Book"}
            </button>
          )}
        </div>
      </div>

      {/* Email (AgenticMail) — managed stub */}
      <div className="card p-4 flex items-start gap-3 opacity-70">
        <Mail className="w-5 h-5 text-muted mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-medium">Email Helper</div>
          <p className="text-muted text-sm">
            Your assistant can read, sort, and reply to your email. This one needs a quick setup by
            Greene Solutions — we'll walk you through it.
          </p>
        </div>
      </div>

      {error && <div className="text-error text-sm">{error}</div>}
      {log && (
        <pre className="bg-muted-bg border border-muted rounded-lg p-3 text-xs overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto">
          {log}
        </pre>
      )}
    </div>
  );
}
