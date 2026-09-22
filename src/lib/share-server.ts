// ── Smyth Share — LocalSend-compatible HTTP file server ──
// Starts on-demand, serves files via LocalSend Reverse Download API (v2.1)
// Receiver opens browser link or scans QR — downloads immediately, no app needed

import http from "http";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { getWorkspacePath } from "@/lib/env";

const DEFAULT_PORT = 53317;
const FALLBACK_PORT = 53318;
let PORT = DEFAULT_PORT;
const SHARE_TIMEOUT_MS = 300_000; // 5 min idle → auto-shutdown
const WORKSPACE_DIR = getWorkspacePath();
const SHARE_DIR = path.join(WORKSPACE_DIR, ".shared");

export interface ShareSession {
  sessionId: string;
  files: Array<{ id: string; fileName: string; size: number; fileType: string; filePath: string }>;
  alias: string;
  createdAt: number;
  lastAccess: number;
}

let server: http.Server | null = null;
let currentSession: ShareSession | null = null;
let shutdownTimer: any = null;

// ── Server status ──

export function getShareStatus() {
  if (!server || !server.listening) {
    return { running: false, url: null, session: null };
  }
  return {
    running: true,
    url: currentSession ? `http://${getLocalIP()}:${PORT}` : null,
    session: currentSession
      ? {
          sessionId: currentSession.sessionId,
          files: currentSession.files.map(f => ({
            id: f.id,
            fileName: f.fileName,
            size: f.size,
            fileType: f.fileType,
          })),
          alias: currentSession.alias,
          createdAt: currentSession.createdAt,
        }
      : null,
  };
}

export function isServerRunning(): boolean {
  return server !== null && server.listening;
}

// ── Start sharing files ──

export function startShareServer(files: Array<{ filePath: string; fileName: string }>): Promise<ShareSession> {
  return new Promise(async (resolve, reject) => {
    // If a server exists but isn't listening (zombie), clean it up first
    if (server && !server.listening) {
      try { server.close(); } catch {}
      server = null;
    }
    // If server is listening, add files to existing session
    if (server && server.listening) {
      // Server already running — just add files to existing session
      if (currentSession) {
        for (const f of files) {
          const stat = getFileStat(f.filePath);
          if (stat) {
            const fileId = randomUUID().slice(0, 8);
            currentSession.files.push({
              id: fileId,
              fileName: f.fileName,
              size: stat.size,
              fileType: getMimeType(f.fileName),
              filePath: f.filePath,
            });
          }
        }
        resetShutdownTimer();
        resolve(currentSession);
      }
      return;
    }

    // Ensure share directory
    try { fs.mkdirSync(SHARE_DIR, { recursive: true }); } catch {}

    const sessionId = randomUUID().slice(0, 12);
    const alias = `Smyth (${require("os").hostname?.() || "Mac"})`;

    const fileEntries = files
      .map(f => {
        const stat = getFileStat(f.filePath);
        if (!stat) return null;
        return {
          id: randomUUID().slice(0, 8),
          fileName: f.fileName,
          size: stat.size,
          fileType: getMimeType(f.fileName),
          filePath: f.filePath,
        };
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);

    currentSession = {
      sessionId,
      files: fileEntries,
      alias,
      createdAt: Date.now(),
      lastAccess: Date.now(),
    };

    server = http.createServer((req, res) => {
      // Set a 30s timeout on each connection to prevent hanging
      req.setTimeout(30_000, () => {
        console.log(`[share-server] Request timeout: ${req.method} ${req.url}`);
        if (!res.headersSent) {
          res.writeHead(504, { "Content-Type": "text/plain" });
          res.end("Request timeout");
        }
        req.destroy();
      });
      currentSession!.lastAccess = Date.now();
      resetShutdownTimer();

      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const pathname = url.pathname;

      // ── CORS headers ──
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      // ── API endpoints ──

      // GET /api/localsend/v2/info — device info
      if (pathname === "/api/localsend/v2/info") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          alias: currentSession!.alias,
          version: "2.0",
          deviceModel: "MacBook Air (M3)",
          deviceType: "desktop",
          fingerprint: sessionId,
          download: true,
        }));
        return;
      }

      // POST /api/localsend/v2/prepare-download — get file metadata
      if (pathname === "/api/localsend/v2/prepare-download") {
        const filesMap: Record<string, any> = {};
        for (const f of currentSession!.files) {
          filesMap[f.id] = {
            id: f.id,
            fileName: f.fileName,
            size: f.size,
            fileType: f.fileType,
          };
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          info: {
            alias: currentSession!.alias,
            version: "2.0",
            deviceModel: "MacBook Air (M3)",
            deviceType: "desktop",
            fingerprint: sessionId,
            download: true,
          },
          sessionId: currentSession!.sessionId,
          files: filesMap,
        }));
        return;
      }

      // GET /api/localsend/v2/download?sessionId=X&fileId=Y — download a file
      if (pathname === "/api/localsend/v2/download") {
        const sid = url.searchParams.get("sessionId");
        const fid = url.searchParams.get("fileId");
        if (sid !== currentSession?.sessionId) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Session not found");
          return;
        }
        const fileEntry = currentSession.files.find(f => f.id === fid);
        if (!fileEntry) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("File not found");
          return;
        }

        // Stream the file instead of buffering into memory
        try {
          const stat = fs.statSync(fileEntry.filePath);
          // RFC 5987 encoding for filenames with spaces/special chars
          const safeName = fileEntry.fileName.replace(/[^\x20-\x7E]/g, '_');
          res.writeHead(200, {
            "Content-Type": fileEntry.fileType,
            "Content-Disposition": `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(fileEntry.fileName)}`,
            "Content-Length": stat.size,
          });
          const stream = fs.createReadStream(fileEntry.filePath);
          stream.pipe(res);
          stream.on("error", (err) => {
            console.error("[share-server] Stream error:", err.message);
            if (!res.headersSent) {
              res.writeHead(500, { "Content-Type": "text/plain" });
            }
            res.end("File read error");
          });
        } catch (err: any) {
          console.error("[share-server] Download error:", err.message);
          res.writeHead(500, { "Content-Type": "text/plain" });
          res.end("File read error");
        }
        return;
      }

      // GET / — browser landing page (for QR scan)
      if (pathname === "/") {
        const filesHtml = currentSession!.files
          .map(f => `<li>
            <a href="/api/localsend/v2/download?sessionId=${currentSession!.sessionId}&fileId=${f.id}" 
               class="file" download="${f.fileName}">
              <span class="icon">${getFileIcon(f.fileName)}</span>
              <span>${f.fileName}</span>
              <span class="size">${formatSize(f.size)}</span>
            </a>
          </li>`)
          .join("");

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Smyth Share</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #08080a; color: #ededee;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    display: flex; align-items: center; justify-content: center;
    min-height: 100vh; padding: 20px;
  }
  .card {
    background: #0d0d10; border: 1px solid #1e1e24;
    border-radius: 16px; padding: 32px; max-width: 420px; width: 100%;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
  }
  .logo {
    display: flex; align-items: center; gap: 10px; margin-bottom: 20px;
  }
  .logo-icon {
    width: 36px; height: 36px; border-radius: 50%;
    background: linear-gradient(135deg, #8ab86e, #5a7d4a);
    display: flex; align-items: center; justify-content: center;
    font-size: 18px; color: #08080a; font-weight: bold;
  }
  .logo-text { font-size: 16px; font-weight: 700; color: #ededee; }
  .badge {
    display: inline-block; padding: 2px 8px; font-size: 10px; font-weight: 600;
    background: #8ab86e; color: #08080a; border-radius: 6px;
    margin-left: 8px; text-transform: uppercase; letter-spacing: 0.5px;
  }
  p { color: #8a8a95; font-size: 13px; line-height: 1.5; margin-bottom: 20px; }
  ul { list-style: none; display: flex; flex-direction: column; gap: 8px; }
  .file {
    display: flex; align-items: center; gap: 10px;
    padding: 12px 16px; background: #121215;
    border: 1px solid #1e1e24; border-radius: 10px;
    text-decoration: none; color: #ededee;
    transition: all 0.2s;
  }
  .file:hover { border-color: #8ab86e; background: #18181d; }
  .icon { font-size: 18px; }
  .size { margin-left: auto; font-size: 11px; color: #8a8a95; font-variant-numeric: tabular-nums; }
  .status { text-align: center; margin-top: 16px; font-size: 11px; color: #5a5a65; }
</style>
</head>
<body>
  <div class="card">
    <div class="logo">
      <div class="logo-icon">S</div>
      <span class="logo-text">Smyth <span class="badge">Share</span></span>
    </div>
    <p>${currentSession!.alias} is sharing files with you. Click to download.</p>
    <ul>${filesHtml}</ul>
    <div class="status">Connected via local network</div>
  </div>
</body>
</html>`);
        return;
      }

      // 404 for everything else
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    });

    server.listen(PORT, "0.0.0.0", () => {
      console.log(`[share-server] Listening on http://0.0.0.0:${PORT}`);
      resetShutdownTimer();
      resolve(currentSession!);
    });

    server.on("error", (err: any) => {
      if (err.code === "EADDRINUSE") {
        // Port in use — close this server attempt and try fallback
        try { server.closeAllConnections?.(); } catch {}
        server.close();
        server = null;
        if (PORT === DEFAULT_PORT) {
          console.log("[share-server] Port 53317 in use, trying 53318...");
          PORT = FALLBACK_PORT;
          // Retry with fallback port
          startShareServer(files).then(resolve).catch(reject);
          return;
        }
        reject(new Error("Both share ports in use (53317 and 53318). Stop any existing share or LocalSend app and try again."));
      } else {
        reject(err);
      }
    });
  });
}

// ── Stop the server ──

export function stopShareServer(): Promise<void> {
  if (shutdownTimer) clearTimeout(shutdownTimer);
  shutdownTimer = null;
  const oldServer = server;
  server = null;
  currentSession = null;
  PORT = DEFAULT_PORT; // Reset to default port for next share
  return new Promise((resolve) => {
    if (!oldServer) { resolve(); return; }
    try { (oldServer as any).closeAllConnections?.(); } catch {}
    oldServer.close(() => resolve());
    setTimeout(resolve, 2000); // safety net: resolve even if close() hangs
  });
}

// ── Auto-shutdown after idle ──

function resetShutdownTimer() {
  if (shutdownTimer) clearTimeout(shutdownTimer);
  shutdownTimer = setTimeout(() => {
    stopShareServer();
    console.log("[share-server] Auto-shutdown due to idle timeout");
  }, SHARE_TIMEOUT_MS);
}

// ── Helpers ──

function getLocalIP(): string {
  const interfaces = require("os").networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const iface = interfaces[name];
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === "IPv4" && !addr.internal) {
        return addr.address;
      }
    }
  }
  return "127.0.0.1";
}

function getFileStat(filePath: string): fs.Stats | null {
  try { return fs.statSync(filePath); } catch { return null; }
}

function getMimeType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
    ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
    ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg",
    ".pdf": "application/pdf", ".zip": "application/zip",
    ".txt": "text/plain", ".md": "text/markdown",
    ".json": "application/json", ".html": "text/html",
    ".csv": "text/csv", ".py": "text/x-python", ".ts": "text/typescript",
    ".tsx": "text/typescript", ".js": "text/javascript",
  };
  return mimeMap[ext] || "application/octet-stream";
}

function getFileIcon(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  const iconMap: Record<string, string> = {
    ".png": "🖼", ".jpg": "🖼", ".jpeg": "🖼", ".gif": "🖼", ".webp": "🖼", ".svg": "🖼",
    ".mp4": "🎬", ".mov": "🎬", ".webm": "🎬",
    ".mp3": "🎵", ".wav": "🎵",
    ".pdf": "📄", ".zip": "📦",
    ".txt": "📝", ".md": "📝",
    ".json": "📊", ".html": "🌐",
    ".py": "🐍", ".ts": "🔷", ".tsx": "⚛️", ".js": "🟨",
  };
  return iconMap[ext] || "📎";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + " GB";
}
