import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";

interface JobInfo {
  name: string;
  displayName: string;
  status: "running" | "idle" | "error" | "stopped";
  lastRun: string | null;
  nextRun: string | null;
  schedule: string;
  description: string;
  lastError: string | null;
  enabled: boolean;
}

// Local LaunchAgent services to monitor
const LAUNCH_AGENTS = [
  { label: "ai.openclaw.gateway", displayName: "OpenClaw Gateway", description: "Main agent gateway on port 18789" },
  { label: "com.agenticmail.server", displayName: "AgenticMail Server", description: "Email relay and agent mail system" },
  { label: "com.agenticmail.config", displayName: "AgenticMail Config", description: "AgenticMail configuration loader" },
  { label: "com.greene.imap-sync", displayName: "IMAP Sync", description: "Syncs Greene Solutions IMAP inbox" },
  { label: "com.greenesolutions.email-autopilot", displayName: "Email Autopilot", description: "Automated email processing for Greene Solutions" },
  { label: "com.godaddy-bridge", displayName: "GoDaddy Bridge", description: "Domain/DNS management bridge" },
  { label: "com.smyth.unipile-poller", displayName: "Unipile Poller", description: "Polls Unipile for social/account data" },
  { label: "com.smyth.unipile-runner", displayName: "Unipile Runner", description: "Unipile task runner" },
  { label: "com.smyth.unipile-webhook", displayName: "Unipile Webhook", description: "Unipile webhook receiver" },
  { label: "com.smyth.unipile-reporter", displayName: "Unipile Reporter", description: "Unipile reporting service" },
  { label: "com.smyth.whisper-server", displayName: "Whisper Server", description: "Local Whisper speech-to-text server" },
  { label: "com.nerve.server", displayName: "Nerve Server", description: "Nerve automation server" },
  { label: "com.robbiagent.lockwatcher", displayName: "Lock Watcher", description: "File lock monitoring and cleanup" },
  { label: "com.openclaw.cleanup-spawns", displayName: "OpenClaw Cleanup", description: "Cleans up stale spawn processes" },
  { label: "com.openclaw.perchance-service", displayName: "Perchance Service", description: "Perchance image generation service" },
  { label: "com.openclaw.protect-rook-workspace", displayName: "Rook Workspace Guard", description: "Protects Rook workspace from bloat" },
  { label: "com.openclaw.protect-bishop-workspace", displayName: "Bishop Workspace Guard", description: "Protects Bishop workspace" },
  { label: "com.openclaw.protect-sage-workspace", displayName: "Sage Workspace Guard", description: "Protects Sage workspace" },
  { label: "com.openclaw.protect-spark-workspace", displayName: "Spark Workspace Guard", description: "Protects Spark workspace" },
  { label: "com.openclaw.protect-mega-max-workspace", displayName: "Mega-Max Workspace Guard", description: "Protects Mega-Max workspace" },
  { label: "com.openclaw.protect-tools-md", displayName: "Tools.md Guard", description: "Protects TOOLS.md from bloat" },
];

function getLaunchdStatus(label: string, displayName: string, description: string): JobInfo {
  try {
    const list = execSync(`launchctl list 2>/dev/null`, { timeout: 5000 }).toString();
    const line = list.split("\n").find(l => l.includes(label));
    
    if (!line) {
      return {
        name: label,
        displayName,
        status: "stopped",
        lastRun: null,
        nextRun: null,
        schedule: "launchd",
        description,
        lastError: null,
        enabled: false,
      };
    }

    const parts = line.trim().split(/\s+/);
    const pid = parts[0];
    const status = parts[1];
    const isActive = pid !== "-" && pid !== "0";
    const isError = status !== "0" && !isActive;

    // Check if plist exists (enabled)
    const plistPath = `${process.env.HOME}/Library/LaunchAgents/${label}.plist`;
    const isEnabled = require("fs").existsSync(plistPath);

    let lastError: string | null = null;
    if (isError) {
      lastError = `Exit code: ${status}`;
    }

    return {
      name: label,
      displayName,
      status: isActive ? "running" : isError ? "error" : "stopped",
      lastRun: isActive ? "running" : null,
      nextRun: null,
      schedule: "launchd",
      description,
      lastError,
      enabled: isEnabled,
    };
  } catch {
    return {
      name: label,
      displayName,
      status: "stopped",
      lastRun: null,
      nextRun: null,
      schedule: "launchd",
      description,
      lastError: null,
      enabled: false,
    };
  }
}

export async function GET() {
  const jobs = LAUNCH_AGENTS.map(j => 
    getLaunchdStatus(j.label, j.displayName, j.description)
  );

  // Add cron jobs
  try {
    const crontab = execSync("crontab -l 2>/dev/null", { timeout: 5000 }).toString();
    const cronLines = crontab.split("\n").filter(l => l.trim() && !l.startsWith("#"));
    for (const line of cronLines) {
      const parts = line.trim().split(/\s+/);
      const schedule = parts.slice(0, 5).join(" ");
      const cmd = parts.slice(5).join(" ");
      const name = cmd.split("/").pop()?.split(" ")[0] || "cron-job";
      jobs.push({
        name: `cron-${name}`,
        displayName: name.replace(/\.sh$/, ""),
        status: "idle" as const,
        lastRun: null,
        nextRun: "scheduled",
        schedule,
        description: cmd.substring(0, 100),
        lastError: null,
        enabled: true,
      });
    }
  } catch {}

  return NextResponse.json({ jobs });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, action } = body;

  if (action === "toggle") {
    try {
      const plistPath = `${process.env.HOME}/Library/LaunchAgents/${name}.plist`;
      const fs = require("fs");
      if (fs.existsSync(plistPath)) {
        // Check if loaded
        const list = execSync("launchctl list 2>/dev/null", { timeout: 5000 }).toString();
        const isLoaded = list.includes(name);
        if (isLoaded) {
          execSync(`launchctl unload ${plistPath} 2>/dev/null`, { timeout: 10000 });
        } else {
          execSync(`launchctl load ${plistPath} 2>/dev/null`, { timeout: 10000 });
        }
      }
      return NextResponse.json({ success: true });
    } catch (e: any) {
      return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
  }

  if (action === "run") {
    try {
      const plistPath = `${process.env.HOME}/Library/LaunchAgents/${name}.plist`;
      execSync(`launchctl kickstart -k ${name} 2>/dev/null || launchctl unload ${plistPath} 2>/dev/null; launchctl load ${plistPath} 2>/dev/null`, { timeout: 10000 });
      return NextResponse.json({ success: true });
    } catch (e: any) {
      return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
  }

  if (action === "delete") {
    try {
      const plistPath = `${process.env.HOME}/Library/LaunchAgents/${name}.plist`;
      const fs = require("fs");
      // Unload if loaded
      try {
        execSync(`launchctl unload ${plistPath} 2>/dev/null`, { timeout: 10000 });
      } catch {}
      // Remove the plist file
      if (fs.existsSync(plistPath)) {
        fs.unlinkSync(plistPath);
      }
      return NextResponse.json({ success: true });
    } catch (e: any) {
      return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
  }

  return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 });
}