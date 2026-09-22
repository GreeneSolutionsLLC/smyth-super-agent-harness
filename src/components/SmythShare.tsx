"use client";

/**
 * Smyth Share — Send files via LAN in one tap.
 * Starts a LocalSend-compatible HTTP server on port 53317.
 * Receiver opens the URL or scans a QR — downloads immediately.
 *
 * Files come from:
 *   1. Smyth's generated files (images, reports, etc.) with a Share button
 *   2. Manual file picker
 *   3. Drag-and-drop onto the panel
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Share2,
  Copy,
  QrCode,
  Link,
  X,
  Check,
  Globe,
  Monitor,
  Smartphone,
  Laptop,
  Shield,
  Clock,
  FileText,
  ExternalLink,
} from "lucide-react";

// ── Types ──

type ShareState = "idle" | "starting" | "active" | "error";

export interface ShareFile {
  fileName: string;
  filePath: string;
  size: number;
  fileType: string;
}

interface ShareStatus {
  running: boolean;
  url: string | null;
  session: {
    sessionId: string;
    files: Array<{ id: string; fileName: string; size: number; fileType: string }>;
    alias: string;
    createdAt: number;
  } | null;
}

// ── Component ──

interface SmythShareProps {
  onClose: () => void;
  fileQueue?: ShareFile[];
  onClearQueue?: () => void;
  onAddFile?: (f: ShareFile) => void;
}

export default function SmythShare({ onClose, fileQueue = [], onClearQueue, onAddFile }: SmythShareProps) {
  const [state, setState] = useState<ShareState>("idle");
  const [status, setStatus] = useState<ShareStatus>({ running: false, url: null, session: null });
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [localFiles, setLocalFiles] = useState<ShareFile[]>([]);
  const [fileObjects, setFileObjects] = useState<Map<string, File>>(new Map()); // fileName → File object
  const [showQR, setShowQR] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  // Combine queue from parent + local files
  const allFiles = [...fileQueue, ...localFiles];

  const shareUrl = status.url || "";
  const isActive = state === "active" && status.running;

  // Poll status
  useEffect(() => {
    if (state === "idle") {
      fetchShareStatus().then(s => {
        if (s.running) {
          setStatus(s);
          setState("active");
        }
      });
      return;
    }

    const interval = setInterval(async () => {
      const s = await fetchShareStatus();
      setStatus(s);
      if (!s.running) {
        setState("idle");
        setShowQR(false);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [state]);

  // Generate QR when we have a URL and QR is toggled on
  useEffect(() => {
    if (!showQR) return;
    if (!canvasRef.current) return;
    if (!shareUrl) return;
    (async () => {
      try {
        const QRCode = (await import("qrcode")).default;
        await QRCode.toCanvas(canvasRef.current, shareUrl, {
          width: 200,
          margin: 2,
          color: { dark: "#ededee", light: "#08080a" },
        });
      } catch (err: any) {
        // Surface in console so future debugging is easy
        console.warn("[SmythShare] QR render failed:", err?.message || err);
      }
    })();
  }, [showQR, shareUrl]);

  const startSharing = async () => {
    if (allFiles.length === 0) {
      setError("No files to share — generate something first, or pick a file");
      setState("error");
      return;
    }

    setState("starting");
    setError("");

    try {
      // Separate files that exist on disk (workspace files) from browser-picked files
      // Browser-picked files need multipart upload; workspace files use JSON
      const browserFiles = localFiles.filter(f => !f.filePath.startsWith("/") && !f.filePath.startsWith("/Users"));
      const workspaceFiles = allFiles.filter(f => !browserFiles.includes(f));

      let res: Response;

      if (browserFiles.length > 0) {
        // Upload browser-picked files as multipart form data with actual File objects
        const formData = new FormData();
        for (const f of browserFiles) {
          const fileObj = fileObjects.get(f.fileName);
          if (fileObj) {
            formData.append("files", fileObj, f.fileName);
          }
        }
        // Also include workspace files (they have absolute paths)
        if (workspaceFiles.length > 0) {
          formData.append("workspaceFiles", JSON.stringify(workspaceFiles));
        }
        res = await fetch("/api/share/start", {
          method: "POST",
          body: formData,
        });
      } else {
        // All files are workspace files — use JSON
        res = await fetch("/api/share/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ files: allFiles }),
        });
      }

      if (!res.ok) {
        const err = await res.text().catch(() => "Server error");
        throw new Error(err || "Failed to start share server");
      }
      const data = await res.json();
      setStatus(data);
      setState("active");
      // Clear queue after successful start
      onClearQueue?.();
      setLocalFiles([]);
      setFileObjects(new Map());
    } catch (err: any) {
      setError(err.message || "Could not start sharing");
      setState("error");
    }
  };

  const stopSharing = async () => {
    try {
      await fetch("/api/share/stop", { method: "POST" });
    } catch {}
    setState("idle");
    setStatus({ running: false, url: null, session: null });
    setShowQR(false);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const pickFile = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.onchange = (e: any) => {
      const file = e.target?.files?.[0];
      if (!file) return;
      setFileObjects(prev => new Map(prev).set(file.name, file));
      setLocalFiles(prev => [...prev, {
        fileName: file.name,
        filePath: file.name, // Browser file — will be uploaded as multipart
        size: file.size,
        fileType: file.type || "application/octet-stream",
      }]);
    };
    input.click();
  };

  // ── Render ──

  return (
    <div className="flex flex-col h-full overflow-y-auto px-3 py-3 bg-surface text-foreground">
      {/* Live indicator (the overlay above already has its own header) */}
      {isActive && (
        <div className="flex items-center gap-1 text-[10px] text-accent mb-2">
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
          Live — share server running
        </div>
      )}

      {/* ── Idle State ── */}
      {state === "idle" && (
        <div ref={dropRef} className="space-y-2">
          <div className="text-[11px] text-muted leading-relaxed">
            Share files with anyone on your network. They download in their browser — no app needed.
          </div>

          {/* Pending files */}
          {allFiles.length > 0 && (
            <div className="space-y-1">
              <div className="text-[9px] text-muted font-medium">Files ready to share</div>
              {allFiles.map((f, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px] text-foreground bg-muted-bg rounded px-2 py-1 border border-border">
                  <FileText size={12} className="shrink-0 text-accent" />
                  <span className="truncate flex-1">{f.fileName}</span>
                  <span className="text-[9px] text-muted">{formatSize(f.size)}</span>
                  <button
                    onClick={() => {
                      if (i < fileQueue.length) {
                        const filtered = fileQueue.filter((_, j) => j !== i);
                        // Can't directly modify parent — just remove from local
                      }
                      setLocalFiles(prev => prev.filter((_, j) => j !== i - fileQueue.length));
                    }}
                    className="text-muted hover:text-red-500 bg-none border-none p-0 cursor-pointer"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-1.5">
            <button
              onClick={startSharing}
              disabled={allFiles.length === 0}
              className="flex-1 bg-accent text-[#08080a] border-none rounded-md py-1.5 text-xs font-semibold cursor-pointer hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed font-sans"
            >
              {allFiles.length > 0 ? `Share (${allFiles.length})` : "Select a file first"}
            </button>
            <button
              onClick={pickFile}
              className="bg-muted-bg border border-border text-muted rounded-md px-2.5 py-1.5 text-xs cursor-pointer hover:text-foreground hover:border-accent bg-none font-sans"
              title="Add file"
            >
              + File
            </button>
          </div>

          {allFiles.length === 0 && (
            <div className="text-[10px] text-muted text-center py-2 border border-dashed border-border rounded">
              Add files from chat or tap + File
            </div>
          )}
        </div>
      )}

      {/* ── Starting State ── */}
      {state === "starting" && (
        <div className="flex items-center gap-2 py-3">
          <span className="w-3 h-3 rounded-full border border-accent animate-spin border-t-transparent" />
          <span className="text-[11px] text-muted">Starting shared server...</span>
        </div>
      )}

      {/* ── Active State ── */}
      {isActive && (
        <div className="space-y-2.5">
          {/* Share URL */}
          <div>
            <div className="text-[9px] text-muted font-medium mb-1">Share Link</div>
            <div className="flex items-center gap-1">
              <input
                readOnly
                value={shareUrl}
                className="flex-1 bg-muted-bg border border-border rounded px-2 py-1.5 text-[11px] font-mono text-accent outline-none"
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <button
                onClick={copyLink}
                className="bg-muted-bg border border-border text-muted rounded p-1.5 cursor-pointer hover:text-accent hover:border-accent bg-none"
                title="Copy link"
              >
                {copied ? <Check size={14} /> : <Link size={14} />}
              </button>
            </div>
          </div>

          {/* QR Code */}
          <div>
            <button
              onClick={() => setShowQR(!showQR)}
              className="flex items-center gap-1.5 text-[11px] text-muted hover:text-accent cursor-pointer bg-none border-none p-0 font-sans"
            >
              <QrCode size={13} />
              {showQR ? "Hide QR" : "Show QR Code"}
            </button>
            {showQR && (
              <div className="mt-2 flex justify-center">
                <canvas
                  ref={canvasRef}
                  width={200}
                  height={200}
                  className="rounded-lg border border-border"
                  style={{ width: 160, height: 160 }}
                />
              </div>
            )}
          </div>

          {/* Device info */}
          <div className="bg-muted-bg rounded border border-border px-2.5 py-2">
            <div className="flex items-center gap-2 text-[10px] text-muted">
              <Monitor size={12} />
              <span className="text-foreground font-medium">Smyth</span>
              <span className="text-muted">·</span>
              <span className="text-muted">{status.session?.files.length || 0} files</span>
            </div>
            <div className="flex items-center gap-1 text-[9px] text-muted mt-1">
              <Shield size={9} />
              <span>Local network only — no data leaves your LAN</span>
            </div>
            <div className="flex items-center gap-1 text-[9px] text-muted mt-0.5">
              <Clock size={9} />
              <span>Auto-shuts down after 5 min idle</span>
            </div>
          </div>

          {/* Shared files list */}
          {status.session && status.session.files.length > 0 && (
            <div className="space-y-1">
              <div className="text-[9px] text-muted font-medium">Shared files</div>
              {status.session.files.map((f) => (
                <div key={f.id} className="flex items-center gap-2 text-[10px] text-foreground bg-muted-bg rounded px-2 py-1 border border-border">
                  <FileText size={11} className="shrink-0 text-accent" />
                  <span className="truncate flex-1">{f.fileName}</span>
                  <span className="text-[9px] text-muted">{formatSize(f.size)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Stop button */}
          <button
            onClick={stopSharing}
            className="w-full border border-red-500/30 text-red-400 bg-red-500/5 rounded-md py-1.5 text-xs font-medium cursor-pointer hover:bg-red-500/10 bg-none font-sans"
          >
            Stop Sharing
          </button>
        </div>
      )}

      {/* ── Error State ── */}
      {state === "error" && (
        <div className="space-y-2">
          <div className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/30 rounded px-2.5 py-2">
            {error}
          </div>
          <button
            onClick={() => setState("idle")}
            className="w-full border border-border text-muted rounded-md py-1.5 text-xs cursor-pointer hover:text-foreground bg-none font-sans"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

// ── Fetch share server status ──

async function fetchShareStatus(): Promise<ShareStatus> {
  try {
    const res = await fetch("/api/share/status");
    if (res.ok) return await res.json();
  } catch {}
  return { running: false, url: null, session: null };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}
