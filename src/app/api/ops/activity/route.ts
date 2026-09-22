import { NextResponse } from "next/server";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const DB_PATH = path.join(process.env.HOME || "", ".agenticmail", "agenticmail.db");
const LOG_DIR = path.join(process.env.HOME || "", ".agenticmail", "logs");

interface ActivityItem {
  icon: string;
  color: string;
  text: string;
  time: string;
  timestamp: number;
}

function sqliteQuery(sql: string): string {
  try {
    return execSync(`sqlite3 "${DB_PATH}" "${sql}" 2>/dev/null`, { timeout: 5000 }).toString().trim();
  } catch {
    return "";
  }
}

function timeAgo(dateStr: string): string {
  const d = new Date(dateStr + "Z");
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export async function GET() {
  const activities: ActivityItem[] = [];

  // 1. Delivered messages (inbound emails)
  try {
    const rows = sqliteQuery(`SELECT message_id, agent_name, delivered_at FROM delivered_messages ORDER BY delivered_at DESC LIMIT 10;`);
    if (rows) {
      for (const row of rows.split("\n")) {
        const [msgId, agent, deliveredAt] = row.split("|");
        if (!msgId || !deliveredAt) continue;
        activities.push({
          icon: "mail",
          color: "text-blue-400",
          text: `Email delivered to ${agent}`,
          time: timeAgo(deliveredAt),
          timestamp: new Date(deliveredAt + "Z").getTime(),
        });
      }
    }
  } catch {}

  // 2. Scheduled emails
  try {
    const rows = sqliteQuery(`SELECT to_addr, subject, send_at, status FROM scheduled_emails ORDER BY created_at DESC LIMIT 10;`);
    if (rows) {
      for (const row of rows.split("\n")) {
        const [to, subject, sendAt, status] = row.split("|");
        if (!to || !sendAt) continue;
        activities.push({
          icon: "mail",
          color: status === "sent" ? "text-green-400" : "text-amber-400",
          text: `Email ${status === "sent" ? "sent to" : "scheduled for"} ${to}: ${subject?.substring(0, 50) || "(no subject)"}`,
          time: timeAgo(sendAt),
          timestamp: new Date(sendAt + "Z").getTime(),
        });
      }
    }
  } catch {}

  // 3. Agent tasks
  try {
    const rows = sqliteQuery(`SELECT task_type, status, created_at, completed_at FROM agent_tasks ORDER BY created_at DESC LIMIT 10;`);
    if (rows) {
      for (const row of rows.split("\n")) {
        const [taskType, status, createdAt] = row.split("|");
        if (!taskType || !createdAt) continue;
        activities.push({
          icon: "activity",
          color: status === "completed" ? "text-green-400" : status === "error" ? "text-red-400" : "text-amber-400",
          text: `Task: ${taskType} — ${status}`,
          time: timeAgo(createdAt),
          timestamp: new Date(createdAt + "Z").getTime(),
        });
      }
    }
  } catch {}

  // 4. Recent autopilot log entries (dedupe errors, limit to 3)
  try {
    const autopilotLog = path.join(LOG_DIR, "autopilot.log");
    if (fs.existsSync(autopilotLog)) {
      const logs = execSync(`tail -50 "${autopilotLog}" 2>/dev/null`, { timeout: 5000 }).toString();
      let errorCount = 0;
      let seenErrors = new Set<string>();
      for (const line of logs.split("\n")) {
        const match = line.match(/\[(.+?)\]\s+(.+)/);
        if (!match) continue;
        const [, dateStr, message] = match;
        if (message.includes("ERROR") || message.includes("error")) {
          // Dedupe identical error messages
          const errKey = message.substring(0, 60);
          if (seenErrors.has(errKey)) continue;
          seenErrors.add(errKey);
          if (errorCount >= 3) continue;
          errorCount++;
          activities.push({
            icon: "alert",
            color: "text-red-400",
            text: `Autopilot: ${message.substring(0, 80)}`,
            time: timeAgo(dateStr),
            timestamp: new Date(dateStr).getTime(),
          });
        } else if (message.includes("POLL") || message.includes("SENT") || message.includes("REPLIED")) {
          activities.push({
            icon: "mail",
            color: "text-cyan-400",
            text: `Autopilot: ${message.substring(0, 80)}`,
            time: timeAgo(dateStr),
            timestamp: new Date(dateStr).getTime(),
          });
        }
      }
    }
  } catch {}

  // 5. OpenClaw gateway log (recent agent activity)
  try {
    const gatewayLog = path.join(process.env.HOME || "", ".openclaw", "logs", "gateway.log");
    if (fs.existsSync(gatewayLog)) {
      const logs = execSync(`tail -30 "${gatewayLog}" 2>/dev/null | grep -i "session\|spawn\|tool\|message" | tail -10`, { timeout: 5000 }).toString();
      for (const line of logs.split("\n")) {
        if (!line.trim()) continue;
        const match = line.match(/(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}).*(session|spawn|tool call|message).*/i);
        if (match) {
          const [, dateStr] = match;
          activities.push({
            icon: "activity",
            color: "text-purple-400",
            text: `Gateway: ${line.substring(line.length - 80)}`,
            time: timeAgo(dateStr),
            timestamp: new Date(dateStr).getTime(),
          });
        }
      }
    }
  } catch {}

  // Sort by timestamp descending, take top 20
  activities.sort((a, b) => b.timestamp - a.timestamp);
  const topActivities = activities.slice(0, 20);

  // Also gather funnel metrics
  const funnel = {
    leads: 0,
    contacted: 0,
    replied: 0,
    booked: 0,
    closed: 0,
  };

  try {
    funnel.contacted = parseInt(sqliteQuery(`SELECT COUNT(*) FROM delivered_messages;`) || "0");
  } catch {}

  // Scheduled emails count
  const scheduledCount = parseInt(sqliteQuery(`SELECT COUNT(*) FROM scheduled_emails WHERE status='pending';`) || "0");
  const sentCount = parseInt(sqliteQuery(`SELECT COUNT(*) FROM scheduled_emails WHERE status='sent';`) || "0");

  return NextResponse.json({
    activities: topActivities,
    funnel,
    stats: {
      scheduledEmails: scheduledCount,
      sentEmails: sentCount,
      deliveredMessages: funnel.contacted,
    },
  });
}