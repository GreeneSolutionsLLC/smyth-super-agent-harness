import { NextResponse } from "next/server";
import { execSync } from "child_process";
import fs from "fs";

export async function GET() {
  const metrics = [];

  // AgenticMail email counts
  try {
    const dbPath = `${process.env.HOME}/.agenticmail/agenticmail.db`;
    if (fs.existsSync(dbPath)) {
      const sentCount = execSync(`sqlite3 "${dbPath}" "SELECT COUNT(*) FROM messages WHERE folder='Sent Items' OR folder='Sent';" 2>/dev/null || echo "0"`, { timeout: 5000 }).toString().trim();
      const inboxCount = execSync(`sqlite3 "${dbPath}" "SELECT COUNT(*) FROM messages WHERE folder='INBOX' OR folder='Inbox';" 2>/dev/null || echo "0"`, { timeout: 5000 }).toString().trim();
      metrics.push({
        label: "Emails Sent",
        value: sentCount,
        subValue: `${inboxCount} in inbox`,
        icon: "mail",
        color: "text-blue-400",
      });
    } else {
      metrics.push({ label: "Emails Sent", value: "—", subValue: "DB not found", icon: "mail", color: "text-blue-400" });
    }
  } catch {
    metrics.push({ label: "Emails Sent", value: "—", subValue: "DB error", icon: "mail", color: "text-blue-400" });
  }

  // System uptime (macOS)
  try {
    const uptime = execSync("uptime 2>/dev/null", { timeout: 5000 }).toString().trim();
    const upMatch = uptime.match(/up\s+(.+?),\s+\d+\s+user/);
    metrics.push({
      label: "Uptime",
      value: upMatch ? upMatch[1] : uptime.substring(0, 30),
      subValue: "macOS",
      icon: "server",
      color: "text-green-400",
    });
  } catch {}

  // Memory (macOS)
  try {
    const mem = execSync("vm_stat 2>/dev/null | head -5", { timeout: 5000 }).toString();
    const pageSize = 4096;
    const freeMatch = mem.match(/free:\s+(\d+)/i);
    const activeMatch = mem.match(/active:\s+(\d+)/i);
    const inactiveMatch = mem.match(/inactive:\s+(\d+)/i);
    const wiredMatch = mem.match(/wired down:\s+(\d+)/i);
    
    const used = ((activeMatch ? parseInt(activeMatch[1]) : 0) + (wiredMatch ? parseInt(wiredMatch[1]) : 0)) * pageSize;
    const total = execSync("sysctl -n hw.memsize 2>/dev/null", { timeout: 5000 }).toString().trim();
    const totalBytes = parseInt(total) || 0;
    
    const usedGB = (used / 1024 / 1024 / 1024).toFixed(1);
    const totalGB = (totalBytes / 1024 / 1024 / 1024).toFixed(0);
    
    metrics.push({
      label: "Memory",
      value: `${usedGB}G / ${totalGB}G`,
      subValue: "active + wired",
      icon: "memory",
      color: "text-amber-400",
    });
  } catch {}

  // Disk
  try {
    const disk = execSync("df -h / 2>/dev/null | awk 'NR==2 {print $3 \"/\" $2 \" (\" $5 \")\"}'", { timeout: 5000 }).toString().trim();
    metrics.push({
      label: "Disk",
      value: disk,
      subValue: "used / total",
      icon: "disk",
      color: "text-purple-400",
    });
  } catch {}

  // OpenClaw agents count
  try {
    const workspaceDir = `${process.env.HOME}/.openclaw/workspace`;
    const agents = fs.readdirSync(workspaceDir).filter(d => {
      try { return fs.statSync(`${workspaceDir}/${d}`).isDirectory() && !d.startsWith(".") && d !== "$OPENCLAW_WORKSPACE"; } catch { return false; }
    });
    metrics.push({
      label: "Agent Fleet",
      value: String(agents.length),
      subValue: agents.join(", ").substring(0, 60),
      icon: "users",
      color: "text-cyan-400",
    });
  } catch {}

  return NextResponse.json({ metrics });
}