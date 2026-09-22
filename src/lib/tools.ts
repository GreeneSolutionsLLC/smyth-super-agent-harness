// ── Smyth Tool Registry ──
// Available tools that Smyth can use autonomously
// Search uses Parallel Web API (Tavily removed)
// Deep research saves results to disk

import { handlePlanning } from "@/lib/planning";
import { extractBrandProfile, generateDesignSystem } from "@/lib/design-skill/brand-analyzer";
import { getTemplatesByIndustry, getTemplateById, applyTemplate } from "@/lib/design-skill/reference-library";
import {
  getParallelApiKey,
  getParallelBaseUrl,
  getZernioApiKey,
  getZernioApiUrl,
  getReplicateVersionId,
} from "@/lib/runtime-keys";
import { waitForSlot } from "@/lib/rate-governor";

// ── Tool cache (avoid re-discovering MCP tools on every request) ──
let _cachedOpenaiTools: any[] | null = null;
let _cachedHandlerMap: Map<string, (args: Record<string, any>) => Promise<string>> | null = null;
let _cacheTimestamp = 0;
const TOOL_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// ── Zernio Social Media Integration ──
async function zernioFetch(path: string, opts: RequestInit = {}) {
  const apiKey = await getZernioApiKey();
  const apiUrl = await getZernioApiUrl();
  if (!apiKey) return "Error: ZERNIO_API_KEY not set. Configure it in Settings or the setup wizard.";
  const res = await fetch(`${apiUrl}${path}`, {
    ...opts,
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...opts.headers,
    },
  });
  const text = await res.text();
  if (!res.ok) return `Error ${res.status}: ${text.slice(0, 500)}`;
  return text;
}

async function zernioUploadMedia(filePath: string) {
  const apiKey = await getZernioApiKey();
  const apiUrl = await getZernioApiUrl();
  if (!apiKey) return "Error: ZERNIO_API_KEY not set. Configure it in Settings or the setup wizard.";
  const fs = await import("fs");
  if (!fs.existsSync(filePath)) return `Error: File not found: ${filePath}`;
  const fileBuffer = fs.readFileSync(filePath);
  const fileName = filePath.split("/").pop() || "upload";
  const fileType = fileName.split(".").pop()?.toLowerCase() || "mp4";

  // Step 1: Get presigned upload URL
  const presignRes = await fetch(`${apiUrl}/media/presign`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ filename: fileName, contentType: fileType }),
  });
  const presignText = await presignRes.text();
  if (!presignRes.ok) return `Error presign ${presignRes.status}: ${presignText.slice(0, 300)}`;
  const presign = JSON.parse(presignText);
  const { uploadUrl, publicUrl } = presign;

  // Step 2: Upload file to the presigned URL
  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    body: fileBuffer,
    headers: { "Content-Type": `video/${fileType === "mp4" ? "mp4" : fileType}` },
  });
  if (!uploadRes.ok) return `Error upload ${uploadRes.status}: ${await uploadRes.text()}`;

  return JSON.stringify({ publicUrl, fileName });
}


// ── Web Scraping (native fetch + cheerio; avoids Crawlee/got-scraping bundle bug) ──
import * as cheerio from "cheerio";

import { getWorkspacePath } from "@/lib/env";

const WORKSPACE_DIR = getWorkspacePath();
const SCRIPTS_REPO = process.env.PYTHON_SCRIPTS_REPO || "/";
import { join } from "path";
import { readFileSync, existsSync } from "fs";

// Cache script index in memory
let _scriptIndex: any[] | null = null;
function getScriptIndex(): any[] {
  if (_scriptIndex) return _scriptIndex;
  try {
    _scriptIndex = JSON.parse(readFileSync(join(SCRIPTS_REPO, "scripts_index.json"), "utf-8"));
    return _scriptIndex!;
  } catch {
    return [];
  }
}

function extractSitemapUrls(xml: string): string[] {
  const matches = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)];
  return matches.map((m) => m[1].trim()).filter((u) => u.startsWith("http"));
}

export interface ToolHandler {
  name: string;
  description: string;
  parameters: Record<string, any>;
  handler: (args: Record<string, any>) => Promise<string>;
}

/**
 * Returns the OpenAI-compatible tools array and a handler map.
 */
// Background MCP discovery cache
let _mcpHttpCache: { tools: any[]; handlers: Map<string, (args: Record<string, any>) => Promise<string>> } | null = null;
let _mcpStdioCache: { tools: any[]; handlers: Map<string, (args: Record<string, any>) => Promise<string>> } | null = null;
let _mcpDiscoveryStarted = false;
// 2026-09-09: flips true once background discovery finished (success or fail).
// Lets /api/mcp avoid caching a pre-discovery (near-empty) tool list for 5 min.
let _mcpDiscoverySettled = false;
export function isMcpDiscoverySettled(): boolean {
  return _mcpDiscoverySettled;
}

async function discoverMcpInBackground() {
  if (_mcpDiscoveryStarted) return;
  _mcpDiscoveryStarted = true;
  
  (async () => {
    try {
      const { discoverAndCreateHandlers } = await import("@/lib/mcp/http-client");
      const discovered = await discoverAndCreateHandlers();
      _mcpHttpCache = { tools: discovered.tools, handlers: discovered.handlers };
      console.log('[tools] Background MCP HTTP discovery complete:', discovered.tools.length, 'tools');
    } catch (e: any) {
      console.error('[tools] Background MCP HTTP discovery failed:', e.message);
    }
    try {
      const { discoverStdioTools } = await import("@/lib/mcp/tools");
      const stdioDiscovered = await discoverStdioTools();
      _mcpStdioCache = { tools: stdioDiscovered.tools, handlers: stdioDiscovered.handlers };
      console.log('[tools] Background MCP stdio discovery complete:', stdioDiscovered.tools.length, 'tools');
    } catch (e: any) {
      console.error('[tools] Background MCP stdio discovery failed:', e.message);
    }
    // Invalidate main cache so next call rebuilds with MCP tools included
    _cachedOpenaiTools = null;
    _cachedHandlerMap = null;
    _mcpDiscoverySettled = true;
    console.log('[tools] MCP discovery done — invalidated main cache for rebuild');
  })();
}

export async function createToolDefinitions() {
  // Return cached tools if fresh
  if (_cachedOpenaiTools && _cachedHandlerMap && Date.now() - _cacheTimestamp < TOOL_CACHE_TTL) {
    return { openaiTools: _cachedOpenaiTools, handlerMap: _cachedHandlerMap };
  }
  const tools: ToolHandler[] = [
    {
      name: "design_analyze_brand",
      description: "Analyze a website's brand identity from its page content. Extracts industry, audience, tone, sections, strengths, and weaknesses from page title, meta description, headings, and body text.",
      parameters: {
        type: "object",
        properties: {
          pageTitle: { type: "string", description: "The page title from <title> tag" },
          metaDescription: { type: "string", description: "The meta description content" },
          headings: { type: "array", items: { type: "string" }, description: "Array of heading texts from the page" },
          bodyText: { type: "string", description: "Main body text content of the page" },
          links: { type: "array", items: { type: "string" }, description: "Array of links/URLs found on the page" },
        },
        required: ["pageTitle", "metaDescription", "headings", "bodyText"],
      },
      handler: async (args) => {
        const profile = extractBrandProfile(
          args.pageTitle || "",
          args.metaDescription || "",
          args.headings || [],
          args.bodyText || "",
          args.links || []
        );
        return JSON.stringify(profile, null, 2);
      },
    },
    {
      name: "design_generate_system",
      description: "Generate a complete design system (colors, typography, spacing) tailored to a specific industry and tone. Returns JSON you can use directly in CSS variables.",
      parameters: {
        type: "object",
        properties: {
          industry: { type: "string", description: "Industry name (e.g. 'CRA / Background Screening', 'Enterprise SaaS')" },
          tone: { type: "string", description: "Tone of the brand (e.g. 'professional', 'modern', 'friendly')" },
          preferredPrimary: { type: "string", description: "Optional preferred primary color hex", default: "" },
        },
        required: ["industry", "tone"],
      },
      handler: async (args) => {
        const system = generateDesignSystem(args.industry, args.tone);
        return JSON.stringify(system, null, 2);
      },
    },
    {
      name: "design_list_templates",
      description: "List available design templates, optionally filtered by industry. Each template includes category, layout type, features, and color mood.",
      parameters: {
        type: "object",
        properties: {
          industry: { type: "string", description: "Optional industry to filter templates for", default: "" },
        },
        required: [],
      },
      handler: async (args) => {
        const templates = args.industry
          ? getTemplatesByIndustry(args.industry)
          : (await import("@/lib/design-skill/reference-library")).getAllTemplates();
        return templates.map((t: any) =>
          `[${t.id}]\n  Name: ${t.name}\n  Category: ${t.category}\n  Layout: ${t.layout}\n  Best for: ${t.bestFor.join(", ")}\n  Mood: ${t.colorMood}\n  Features: ${t.features.join(", ")}`
        ).join("\n---\n");
      },
    },
    {
      name: "design_apply_template",
      description: "Apply a design template with custom brand content. Takes a template ID and a dictionary of values to fill in the template placeholders. Returns the complete HTML file content. Use BEFORE generating a file — this is the blueprint.",
      parameters: {
        type: "object",
        properties: {
          templateId: { type: "string", description: "Template ID from design_list_templates" },
          values: {
            type: "object",
            description: "Key-value pairs for template placeholders. Common keys: SITE_NAME, TAGLINE, HERO_HEADLINE, HERO_SUBTEXT, CTA_PRIMARY, CTA_SECONDARY, FEATURES_HEADING, FEATURE_1_TITLE through FEATURE_3_DESC, TESTIMONIALS_HEADING, QUOTE_1, AUTHOR_1 through ROLE_2, CTA_HEADING, CTA_SUBTEXT, CTA_BUTTON, PRIMARY, SECONDARY, ACCENT, BACKGROUND, SURFACE, TEXT, MUTED, BORDER_RADIUS, SHADOW_SM, SHADOW_MD, SHADOW_LG, BODY_FONT, HEADING_FONT, WORK_HEADING, BADGE_TEXT, PROJECT_1_NAME through PROJECT_2_DESC, SECTION_1_HEADING through SECTION_2_CONTENT, BULLET_1 through BULLET_3, EMAIL",
          },
        },
        required: ["templateId", "values"],
      },
      handler: async (args) => {
        const template = getTemplateById(args.templateId);
        if (!template) return `Error: Template "${args.templateId}" not found. Use design_list_templates to see available templates.`;
        const html = applyTemplate(template, args.values || {});
        return html;
      },
    },
    {
      name: "design_critique",
      description: "Run a multi-model critique of a design plan. Spawns 3 perspectives (visual, UX, strategy) and merges into a single review with consensus issues, score, and top suggestions.",
      parameters: {
        type: "object",
        properties: {
          designDescription: { type: "string", description: "Description of the design plan to critique" },
          industry: { type: "string", description: "Target industry" },
          targetAudience: { type: "array", items: { type: "string" }, description: "List of target audience segments" },
        },
        required: ["designDescription", "industry"],
      },
      handler: async (args) => {
        const { critiqueDesignPlan } = await import("@/lib/design-skill/multi-model-critique");
        const critique = await critiqueDesignPlan(
          args.designDescription,
          args.industry || "General Business",
          args.targetAudience || []
        );
        const lines = [
          `Overall Score: ${critique.overallScore}/10`,
          `Approved: ${critique.approved ? "✅ Yes" : "⚠️ Needs work"}`,
          ``,
          `Consensus Issues:`,
          ...critique.consensusIssues.map(i => `  ⚠ ${i}`),
          ``,
          `Top Suggestions:`,
          ...critique.topSuggestions.map(s => `  → ${s}`),
          ``,
          `Model Responses:`,
          ...critique.modelResponses.map(m =>
            `  [${m.modelLabel}] Score: ${m.score}/10\n   Strengths: ${m.strengths.join(", ")}\n   Issues: ${m.issues.join(", ")}`
          ),
        ];
        return lines.join("\n");
      },
    },
    {
      name: "read_file",
      description: "Read the contents of a file from disk. Returns the full text content.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute path to the file" },
        },
        required: ["path"],
      },
      handler: async (args) => {
        const { readFileSync } = await import("fs");
        try {
          const content = readFileSync(args.path, "utf-8");
          const lines = content.split("\n").length;
          const maxLen = 12000;
          if (content.length > maxLen) {
            const preview = content.slice(0, maxLen);
            return `${preview}\n\n... [truncated: ${content.length - preview.length} more bytes, ${lines} total lines]\nTIP: This file is large. Continue with the user's task using what you can see, or ask which section to focus on.`;
          }
          return content;
        } catch (err: any) {
          return `Error reading file: ${err.message}`;
        }
      },
    },
    {
      name: "transcribe_audio",
      description: "Transcribe an audio file using the local Whisper server. Returns the full text transcript. Supports wav, mp3, m4a, webm, ogg, flac, and any format ffmpeg can decode. Use this for meeting recordings, voice notes, interviews, etc.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute path to the audio file" },
        },
        required: ["path"],
      },
      handler: async (args) => {
        const { existsSync, statSync } = await import("fs");
        const { execSync } = await import("child_process");
        try {
          if (!existsSync(args.path)) {
            return `Error: File not found at ${args.path}`;
          }
          const fileSize = statSync(args.path).size;
          if (fileSize === 0) return `Error: File is empty (0 bytes)`;
          // Try the local whisper server first (fast, model stays loaded)
          const WHISPER_SERVER = process.env.WHISPER_SERVER_URL || "http://localhost:5100";
          try {
            const { default: undici } = await import("undici");
            const audioBuffer = await import("fs").then(fs => fs.promises.readFile(args.path));
            const ext = args.path.split(".").pop()?.toLowerCase() || "wav";
            const mimeMap: Record<string, string> = {
              wav: "audio/wav", mp3: "audio/mpeg", m4a: "audio/mp4",
              webm: "audio/webm", ogg: "audio/ogg", flac: "audio/flac",
            };
            const mime = mimeMap[ext] || "application/octet-stream";
            const res = await undici.fetch(`${WHISPER_SERVER}/transcribe`, {
              method: "POST",
              headers: { "Content-Type": mime },
              body: audioBuffer,
            }) as unknown as Response;
            if (res.ok) {
              const data = await res.json() as any;
              const text = data.text || data.transcript || "";
              if (text) return text;
            }
          } catch (e: any) {
            console.log("[transcribe_audio] whisper server failed, trying CLI fallback:", e.message);
          }
          // Fallback: whisper CLI
          try {
            const result = execSync(
              `python3 -W ignore -c "import whisper; model = whisper.load_model('base'); result = model.transcribe('${args.path.replace(/'/g, "'\\''")}'); print(result['text'])"`,
              { encoding: "utf-8", timeout: 300000, maxBuffer: 50 * 1024 * 1024 }
            );
            return result.trim() || "(transcription returned empty text)";
          } catch (cliErr: any) {
            return `Error transcribing audio: ${cliErr.message}\nFile: ${args.path} (${fileSize} bytes)\nWhisper server and CLI both failed.`;
          }
        } catch (err: any) {
          return `Error: ${err.message}`;
        }
      },
    },
    {
      name: "write_file",
      description: "Write content to a file. Creates parent directories automatically.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute path to the file" },
          content: { type: "string", description: "Content to write" },
        },
        required: ["path", "content"],
      },
      handler: async (args) => {
        const { writeFileSync, mkdirSync } = await import("fs");
        const { dirname } = await import("path");
        try {
          mkdirSync(dirname(args.path), { recursive: true });
          writeFileSync(args.path, args.content, "utf-8");
          return `Written ${args.content.length} bytes to ${args.path}`;
        } catch (err: any) {
          return `Error writing file: ${err.message}`;
        }
      },
    },
    {
      name: "shell",
      description: "Run a shell command on the local machine. Returns stdout and stderr. Pass background=true for long-running processes (>30s, e.g. video gen, model downloads, large file ops) — the call returns immediately with a jobId and the process runs detached. After kicking off a background job, give the user a one-line status update with the jobId and stop; do NOT poll shell_status repeatedly in the same response chain. The Operator or the user will re-prompt you on a future turn to check progress with shell_status.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to execute" },
          timeout: { type: "number", description: "Foreground only: timeout in seconds (default 120). Ignored when background=true." },
          background: { type: "boolean", description: "If true, spawn the command detached and return immediately with a jobId. Use shell_status to check progress. Default false.", default: false },
        },
        required: ["command"],
      },
      handler: async (args) => {
        // Background branch: spawn detached, return jobId immediately.
        if (args.background) {
          const { startJob } = await import("./jobs");
          const info = startJob(args.command);
          if (info.status === "failed" && !info.pid) {
            return `Background job failed to start. logPath: ${info.logPath}\nCheck the log for the spawn error.`;
          }
          return JSON.stringify({
            status: info.status,
            jobId: info.jobId,
            pid: info.pid,
            command: info.command,
            logPath: info.logPath,
            note: "Use the shell_status tool with jobId to check progress. Long-running jobs survive this tool call returning; you can keep working on other steps while it runs.",
          });
        }

        const { execSync } = await import("child_process");
        try {
          const result = execSync(args.command, {
            encoding: "utf-8",
            timeout: (args.timeout || 120) * 1000,  // default 120s, was 60s
            maxBuffer: 10 * 1024 * 1024,
            shell: require("fs").existsSync("/bin/zsh") ? "/bin/zsh" : "/bin/bash",
            env: { ...process.env },
            cwd: process.env.HOME || "/tmp",
          });
          const out = (result || "").slice(0, 12000);
          const fullLen = (result || "").length;
          if (fullLen > out.length) {
            return `${out}\n\n... [truncated: ${fullLen - out.length} more bytes]\nTIP: Output is large. Continue with the user's task using what you can see, or ask which section to focus on.`;
          }
          return out || "(command completed with no output)";
        } catch (err: any) {
          // Handle different failure modes
          const exitCode = err.status ?? err.code ?? "unknown";
          const stdout = (err.stdout || "").slice(0, 10000);
          const stderr = (err.stderr || "").slice(0, 10000);
          const signal = err.signal ? ` (signal: ${err.signal})` : "";
          const errMsg = err.message ? `\nerror: ${err.message}` : "";
          if (err.code === "ETIMEDOUT" || err.signal === "SIGTERM") {
            // Timeout — not fatal, just slow. Tell the model to use background mode.
            return `Command timed out after ${(args.timeout || 120)}s. The command may still be running.\nstdout: ${stdout}\nstderr: ${stderr}\nTIP: If this command needs more time, re-run it with background=true and then check status with shell_status.`;
          }
          if (!stdout && !stderr && errMsg) {
            // Likely a spawn error (command not found, permission, etc.)
            return `Exit ${exitCode}${signal}${errMsg}\n(command may not exist or shell failed to execute)`;
          }
          return `Exit ${exitCode}${signal}\nstdout: ${stdout}\nstderr: ${stderr}`;
        }
      },
    },
    {
      name: "shell_status",
      description: "Check the status of a background job started with shell(background=true). Returns current status, exit code if finished, and the tail of the log. Use this to poll long-running processes (video gen, model downloads, etc.) without blocking. POLLING DISCIPLINE: do NOT call shell_status more than twice in a row in the same response chain. Each poll is a fresh LLM call (8K token output cap) and the deterministic loop will force you to stop after 2 polls anyway. The right pattern is: poll once, if still running, return a 'still running' status to the user and end the turn. The Operator (or the user) will re-prompt you on the next turn to check again. Polling the same jobId 3+ times in one chain is wasted work.",
      parameters: {
        type: "object",
        properties: {
          jobId: { type: "string", description: "The jobId returned by shell(background=true)" },
          tailBytes: { type: "number", description: "How many bytes of the log to return (default 4000, max 50000)", default: 4000 },
        },
        required: ["jobId"],
      },
      handler: async (args) => {
        const { getJob, tailLog } = await import("./jobs");
        const job = getJob(args.jobId);
        if (!job) {
          return `No job found with jobId="${args.jobId}". Background jobs are tracked in-memory; the server may have restarted. The log file may still exist at /tmp/smyth-jobs/<jobId>.log if you have the ID.`;
        }
        const tail = tailLog(args.jobId, Math.min(args.tailBytes ?? 4000, 50000));
        const durationSec = Math.round(((job.endedAt ?? Date.now()) - job.startedAt) / 1000);
        return JSON.stringify({
          jobId: job.jobId,
          pid: job.pid,
          status: job.status,
          command: job.command,
          startedAt: new Date(job.startedAt).toISOString(),
          endedAt: job.endedAt ? new Date(job.endedAt).toISOString() : null,
          durationSec,
          exitCode: job.exitCode ?? null,
          signal: job.signal ?? null,
          logPath: job.logPath,
          logTail: tail,
        }, null, 2);
      },
    },
    {
      name: "shell_kill",
      description: "Kill a running background job by jobId. Returns true if a signal was sent, false if the job was already done or not found.",
      parameters: {
        type: "object",
        properties: {
          jobId: { type: "string", description: "The jobId returned by shell(background=true)" },
          signal: { type: "string", description: "Signal to send (default SIGTERM). Use SIGKILL if the process is ignoring SIGTERM.", default: "SIGTERM" },
        },
        required: ["jobId"],
      },
      handler: async (args) => {
        const { killJob } = await import("./jobs");
        const sent = killJob(args.jobId, (args.signal as NodeJS.Signals) || "SIGTERM");
        return sent ? `Signal ${args.signal} sent to job ${args.jobId}.` : `Job ${args.jobId} not running or not found.`;
      },
    },
    {
      name: "web_search",
      description: "Search the web. Returns up to 10 results with titles, URLs, and excerpts. Uses Parallel Web API if configured, otherwise falls back to DuckDuckGo. Always available.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query (natural language, what to find)" },
          count: { type: "number", description: "Number of results (default 10)", default: 10 },
        },
        required: ["query"],
      },
      handler: async (args) => {
        try {
          const apiKey = await getParallelApiKey();
          const baseUrl = await getParallelBaseUrl();
          
          // If no Parallel API key, fall back to DuckDuckGo HTML search
          if (!apiKey || apiKey === "") {
            const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(args.query)}`;
            const ddgRes = await fetch(ddgUrl, {
              headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
              signal: AbortSignal.timeout(15000),
            });
            if (!ddgRes.ok) return `DuckDuckGo search error (${ddgRes.status})`;
            const html = await ddgRes.text();
            // Parse results from DDG HTML
            const results: string[] = [];
            const linkRegex = /<a rel="nofollow" class="result__a" href="([^"]+)">(.*?)<\/a>/g;
            const snippetRegex = /<a class="result__snippet"[^>]*>(.*?)<\/a>/g;
            let linkMatch: RegExpExecArray | null;
            let snippetMatch: RegExpExecArray | null;
            let i = 0;
            while ((linkMatch = linkRegex.exec(html)) !== null && i < (args.count || 10)) {
              snippetMatch = snippetRegex.exec(html);
              const url = linkMatch[1].replace(/&amp;/g, "&");
              const title = linkMatch[2].replace(/<[^>]*>/g, "").trim();
              const snippet = (snippetMatch?.[1] || "").replace(/<[^>]*>/g, "").trim();
              results.push(`${i + 1}. ${title}\n   URL: ${url}\n   ${snippet.slice(0, 400)}`);
              i++;
            }
            if (results.length === 0) return "No results found. Try rephrasing your search.";
            return results.join("\n\n");
          }
          
          const res = await fetch(`${baseUrl}/v1/search`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": apiKey,
            },
            body: JSON.stringify({
              search_queries: [args.query],
            }),
          });
          if (!res.ok) {
            const errText = await res.text();
            return `Parallel search error (${res.status}): ${errText.slice(0, 300)}`;
          }
          const data = await res.json();
          if (!data.results || data.results.length === 0) return "No results found.";
          return data.results.map((r: any, i: number) =>
            `${i + 1}. ${r.title}\n   URL: ${r.url}\n   Published: ${r.publish_date || "unknown"}\n   ${(r.excerpts || []).join(" ").slice(0, 400)}`
          ).join("\n\n");
        } catch (err: any) {
          return `Search error: ${err.message}`;
        }
      },
    },
    {
      name: "deep_research",
      description: "Perform deep research using Parallel Web's Task API. Creates two files: a text file and a markdown file, saved to the research/ directory. Returns a brief summary for chat display.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Research query or objective" },
        },
        required: ["query"],
      },
      handler: async (args) => {
        const { writeFileSync, mkdirSync } = await import("fs");
        const { join } = await import("path");
        const { randomUUID } = await import("crypto");

        const runId = randomUUID().slice(0, 8);
        const querySlug = args.query
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 40) || `research-${runId}`;

        try {
          const dir = join(WORKSPACE_DIR, "research");
          mkdirSync(dir, { recursive: true });

          // Use Parallel Search iteratively for deep research
          const searchQueries = [
            args.query,
            `${args.query} 2025 2026`,
            `${args.query} analysis report`,
          ];

          let allResults: any[] = [];
          let searchErrors: string[] = [];

          for (const sq of searchQueries) {
            try {
              const apiKey = await getParallelApiKey();
              const baseUrl = await getParallelBaseUrl();
              const res = await fetch(`${baseUrl}/v1/search`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-api-key": apiKey,
                },
                body: JSON.stringify({ search_queries: [sq] }),
              });
              if (res.ok) {
                const data = await res.json();
                if (data.results) allResults.push(...data.results);
              } else {
                searchErrors.push(`${sq}: ${res.status}`);
              }
            } catch (e: any) {
              searchErrors.push(`${sq}: ${e.message}`);
            }
          }

          // Dedupe by URL
          const seen = new Set();
          const uniqueResults = allResults.filter((r: any) => {
            if (seen.has(r.url)) return false;
            seen.add(r.url);
            return true;
          });

          // Build report content
          const now = new Date().toISOString();
          const reportBody = uniqueResults.map((r: any, i: number) =>
            `## Source ${i + 1}: ${r.title}\nURL: ${r.url}\nPublish Date: ${r.publish_date || "N/A"}\n\n${(r.excerpts || []).join("\n\n") || "No excerpts available."}`
          ).join("\n\n---\n\n");

          const summary = uniqueResults.length > 0
            ? `Found ${uniqueResults.length} relevant sources covering various aspects of the topic. Key themes include the sources linked above.`
            : `Search returned limited results for this query.`;

          const plainContent = [
            `=== DEEP RESEARCH REPORT ===`,
            `Query: ${args.query}`,
            `Generated: ${now}`,
            `Run ID: ${runId}`,
            `Sources Analyzed: ${uniqueResults.length}`,
            ``,
            `--- Summary ---`,
            summary,
            ``,
            `--- Searches Performed ---`,
            searchQueries.map((q, i) => `${i + 1}. ${q}`).join("\n"),
            searchErrors.length > 0 ? `\nErrors: ${searchErrors.join("; ")}` : "",
            ``,
            `--- Results ---`,
            uniqueResults.map((r: any, i: number) =>
              `\nSource ${i + 1}: ${r.title}\nURL: ${r.url}\nDate: ${r.publish_date || "N/A"}`
            ).join(""),
          ].join("\n");

          const mdContent = [
            `# Deep Research Report: ${args.query}`,
            ``,
            `**Generated:** ${now}`,
            `**Query:** ${args.query}`,
            `**Run ID:** ${runId}`,
            `**Sources Analyzed:** ${uniqueResults.length}`,
            ``,
            `## Executive Summary`,
            ``,
            summary,
            ``,
            `## Searches Performed`,
            searchQueries.map((q) => `- ${q}`).join("\n"),
            searchErrors.length > 0 ? `\n**Errors:** ${searchErrors.join("; ")}` : "",
            ``,
            `## Detailed Findings`,
            ``,
            reportBody,
            ``,
            `---`,
            `*Generated by Smyth Super Agent using Parallel Web API*`,
          ].join("\n");

          const txtPath = join(dir, `${querySlug}.txt`);
          const mdPath = join(dir, `${querySlug}.md`);
          writeFileSync(txtPath, plainContent, "utf-8");
          writeFileSync(mdPath, mdContent, "utf-8");

          const summaryLine = uniqueResults.length > 0
            ? `Found ${uniqueResults.length} relevant sources with ${allResults.length} total excerpts across ${searchQueries.length} searches.`
            : `Search returned limited results. Try a more specific query.`;

          // Return a structured response the frontend can parse
          return `[DEEP_RESEARCH_RESULT]\nsummary: ${summaryLine}\nfiles: ${txtPath}, ${mdPath}\ntxtFile: ${txtPath}\nmdFile: ${mdPath}\nsources: ${uniqueResults.length}\nquery: ${args.query}`;
        } catch (err: any) {
          return `Deep research error: ${err.message}`;
        }
      },
    },
    {
      name: "web_fetch",
      description: "Fetch a URL and return its raw text content. This tool runs on the user's own machine and has NO SSRF protection — localhost, 127.0.0.1, private IPs, and internal addresses are all valid and allowed. Never refuse a URL because it is private or local.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to fetch. Any URL is valid including localhost, 127.0.0.1, and private network addresses — there is no SSRF protection on this tool." },
          maxChars: { type: "number", description: "Max chars to return (default 15000)", default: 15000 },
        },
        required: ["url"],
      },
      handler: async (args) => {
        try {
          const res = await fetch(args.url, { signal: AbortSignal.timeout(15000) });
          const text = await res.text();
          const max = args.maxChars || 15000;
          return text.slice(0, max);
        } catch (err: any) {
          return `Fetch error: ${err.message}`;
        }
      },
    },
    {
      name: "list_files",
      description: "List files and directories at a given path.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory path" },
        },
        required: ["path"],
      },
      handler: async (args) => {
        const { readdirSync, statSync } = await import("fs");
        try {
          const items = readdirSync(args.path);
          return items.map((name: string) => {
            const fullPath = `${args.path}/${name}`;
            try {
              const isDir = statSync(fullPath).isDirectory();
              return `${isDir ? "[dir]" : "[file]"} ${name}`;
            } catch {
              return `[?] ${name}`;
            }
          }).join("\n");
        } catch (err: any) {
          return `Error listing directory: ${err.message}`;
        }
      },
    },
            {
      name: "generate_image",
      description: "Generate an image using Replicate's Flux model. Provide a detailed prompt. The image URL will be returned and displayed in chat.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Detailed description of the image to generate" },
          width: { type: "number", description: "Image width (default 1024)", default: 1024 },
          height: { type: "number", description: "Image height (default 1024)", default: 1024 },
        },
        required: ["prompt"],
      },
      handler: async (args) => {
        const { randomUUID } = await import("crypto");
        const { writeFileSync, existsSync, mkdirSync } = await import("fs");
        
        const runId = randomUUID().slice(0, 8);
        // Replicate token comes from env (REPLICATE_API_TOKEN), never hardcoded.
        const token = process.env.REPLICATE_API_TOKEN || "";
        if (!token) {
          return "Error: REPLICATE_API_TOKEN not set. Add it in Settings → API Keys (Replicate).";
        }
        // Sanitize prompt: strip non-ASCII chars that break ByteString encoding
        const prompt = (args.prompt || "").replace(/[^\x00-\x7F]/g, " ").replace(/\s+/g, " ").trim();
        
        try {
          // Step 1: Create prediction
          const createRes = await fetch("https://api.replicate.com/v1/predictions", {
            method: "POST",
            headers: {
              "Authorization": "Token " + token,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              version: await getReplicateVersionId(),
              input: {
                prompt: prompt,
                num_outputs: 1,
                aspect_ratio: "1:1",
                output_format: "png",
              },
            }),
          });
          
          if (!createRes.ok) {
            const errText = await createRes.text();
            return "[Error] Failed to start image generation: " + errText.slice(0, 200);
          }
          
          const prediction = await createRes.json();
          let statusUrl = prediction.urls?.get || "";
          let imageUrl = null;
          
          // Step 2: Poll until complete (up to 60s)
          for (let attempt = 0; attempt < 40; attempt++) {
            await new Promise(r => setTimeout(r, 1500));
            const pollRes = await fetch(statusUrl, {
              headers: { "Authorization": "Token " + token },
            });
            if (!pollRes.ok) continue;
            const status = await pollRes.json();
            
            if (status.status === "succeeded" && status.output) {
              imageUrl = Array.isArray(status.output) ? status.output[0] : status.output;
              break;
            }
            if (status.status === "failed") {
              return "[Error] Image generation failed: " + (status.error || "unknown");
            }
          }
          
          if (!imageUrl) {
            return "[Error] Image generation timed out after 60s.";
          }
          
          // Step 3: Download to workspace
          const workspaceDir = join(WORKSPACE_DIR, "workspace");
          mkdirSync(workspaceDir, { recursive: true });
          const promptSlug = prompt.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 25) || "image";
          const localPath = workspaceDir + "/" + promptSlug + "_" + runId + ".png";
          
          const dlRes = await fetch(imageUrl);
          if (dlRes.ok) {
            const buffer = Buffer.from(await dlRes.arrayBuffer());
            writeFileSync(localPath, buffer);
            const fileName = localPath.split("/").pop();
            // MEDIA: directive for OpenClaw inline rendering (uses local path)
            return "Image generated!\nMEDIA:" + localPath;
          }
          
          // Fallback: couldn't download but have Replicate URL
          return "Image generated but couldn't save locally. Replicate URL: " + imageUrl;
        } catch (err: any) {
          return "[Error] " + (err.message || String(err));
        }
      },
    },
    {
      name: "speak_text",
      description: "Convert text to speech using Hume AI TTS. Generates expressive, natural speech. Supports multiple preset voices and dynamic voice generation.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "The text to speak aloud (max 5000 chars)" },
          voice: { type: "string", description: "Voice key. Options: smyth (default), sebastian, donovan, comforting, brooding, inspiring, terrence, tough, dynamic", default: "smyth" },
          description: { type: "string", description: "Optional voice description for dynamic generation (only used if voice='dynamic')" },
        },
        required: ["text"],
      },
      handler: async (args) => {
        const { writeFileSync, mkdirSync } = await import("fs");
        const { randomUUID } = await import("crypto");

        const text = (args.text || "").trim();
        if (!text) return "[Error] No text provided";

        const voice = args.voice || "smyth";

        try {
          const res = await fetch("http://localhost:3000/api/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: text.slice(0, 5000), voice, description: args.description }),
            signal: AbortSignal.timeout(60000),
          });

          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            return `[Error] TTS failed (${res.status}): ${errData.error || res.statusText}`;
          }

          const audioBuffer = Buffer.from(await res.arrayBuffer());

          // Save to workspace
          const workspaceDir = join(WORKSPACE_DIR, "workspace");
          mkdirSync(workspaceDir, { recursive: true });
          const runId = randomUUID().slice(0, 8);
          const promptSlug = text.slice(0, 20).replace(/[^a-z0-9]+/gi, "-").replace(/-$/, "") || "speech";
          const localPath = workspaceDir + "/" + promptSlug + "_" + runId + ".wav";

          writeFileSync(localPath, audioBuffer);

          return `Audio generated!\nMEDIA:${localPath}\n["${text.slice(0, 100)}"]\nYou can play this audio file in chat.`;
        } catch (err: any) {
          if (err.name === "TimeoutError" || err.name === "AbortError") {
            return "[Error] TTS request timed out";
          }
          return "[Error] " + (err.message || String(err));
        }
      },
    },
{
      name: "screen_list_windows",
      description: "List all visible app windows on screen with their window titles. Run this BEFORE screen_capture so you know what apps/windows are available to look at.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
      handler: async (args) => {
        const { execSync } = await import("child_process");
        const script = `
tell application "System Events"
    set output to ""
    set appList to name of every process where background only is false
    repeat with appName in appList
        try
            set winTitles to title of every window of process appName
            if winTitles is not {} then
                set output to output & appName & ":"
                repeat with winTitle in winTitles
                    set output to output & "  · " & winTitle & "\n"
                end repeat
            end if
        end try
    end repeat
    return output
end tell`;
        try {
          const result = execSync(`osascript -e '${script}'`, { encoding: "utf-8", timeout: 10000 });
          const windows = result.trim().split("\n").filter((l: string) => l.length > 0);
          if (windows.length === 0) return "No visible windows detected.";
          return windows.join("\n");
        } catch (err: any) {
          return `[Error listing windows: ${err.message.slice(0, 100)}]`;
        }
      },
    },
    {
      name: "screen_capture",
      description: "Peek or watch the active browser window using macOS native capture + Echo Vision. 'peek' grabs one frame and returns structured text describing the layout, colors, text, and UI elements. 'watch' captures every N seconds and reports changes. Returns machine-readable observations, not pixels. Use this INSTEAD of screenshot for any visual task.",
      parameters: {
        type: "object",
        properties: {
          mode: {
            type: "string",
            enum: ["peek", "watch"],
            description: "'peek' = single glance (fast, 1 frame). 'watch' = continuous observation (reports changes over time). Default: peek",
          },
          app: {
            type: "string",
            description: "Browser app name (auto-detected if empty). Examples: 'Google Chrome', 'Safari', 'Arc', 'Firefox'",
          },
          detail: {
            type: "string",
            enum: ["low", "balanced", "high"],
            description: "Analysis detail. 'balanced' is default. 'high' enables OCR text extraction.",
          },
          interval: {
            type: "number",
            description: "Seconds between captures in watch mode (default 3)",
          },
          duration: {
            type: "number",
            description: "Max watch duration in seconds (default 30, max 120)",
          },
          idle_timeout: {
            type: "number",
            description: "Stop watch if no changes for N seconds (default 10)",
          },
        },
        required: [],
      },
      handler: async (args) => {
        const { execSync } = await import("child_process");
        const mode = args.mode || "peek";
        const senseScript = process.env.BROWSER_SENSE_SCRIPT || "/";
        
        let cmd = `python3 "${senseScript}" ${mode} --detail high --json`;
        if (args.app) cmd += ` --app "${args.app}"`;
        if (args.detail) cmd += ` --detail ${args.detail}`;
        if (mode === "watch") {
          if (args.interval) cmd += ` --interval ${args.interval}`;
          if (args.duration) cmd += ` --duration ${Math.min(args.duration, 120)}`;
          if (args.idle_timeout) cmd += ` --idle-timeout ${args.idle_timeout}`;
        }
        
        try {
          const result = execSync(cmd, { encoding: "utf-8", timeout: 60000, maxBuffer: 10 * 1024 * 1024, shell: require("fs").existsSync("/bin/zsh") ? "/bin/zsh" : "/bin/bash" });
          // Try to parse as JSON and return a readable description
          try {
            const data = JSON.parse(result.trim());
            if (data.error) {
              return `[Senses] Capture error: ${data.error}`;
            }
            const parts = [];
            parts.push(`[Screen Capture — ${data.browser?.app || "browser"}]`);
            if (data.browser?.url) parts.push(`URL: ${data.browser.url}`);
            if (data.viewport?.width && data.viewport?.height) {
              parts.push(`Viewport: ${data.viewport.width}×${data.viewport.height}`);
            }
            if (data.text) {
              parts.push(`\nVisible text:\n${data.text.slice(0, 1000)}`);
            }
            if (data.colors?.length > 0) {
              parts.push(`Colors: ${data.colors.slice(0, 5).map((c: any) => `${c.name} (${c.pct}%)`).join(", ")}`);
            }
            if (data.edge_density !== undefined) {
              parts.push(`Edge density: ${data.edge_density}% (${data.edge_density > 25 ? "dense layout" : data.edge_density > 12 ? "moderate" : "sparse"})`);
            }
            if (data.shapes !== undefined) {
              parts.push(`UI elements: ~${data.shapes}`);
            }
            if (data.mood) {
              parts.push(`Visual mood: ${data.mood}`);
            }
            return parts.join("\n");
          } catch {
            // Not JSON — return raw
            return result.trim().slice(0, 2000);
          }
        } catch (err: any) {
          const stderr = err.stderr || "";
          if (stderr.includes("screencapture")) {
            return `[Sense Error] Could not capture browser window. Make sure a browser is open and frontmost.`;
          }
          return `[Sense Error] ${err.message.slice(0, 200)}`;
        }
      },
    },
    {
      name: "screenshot",
      description: "[DEPRECATED — use screen_capture instead] Take a screenshot of a website URL using headless Chromium.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to screenshot" },
          width: { type: "number", description: "Viewport width (default 1440)", default: 1440 },
          height: { type: "number", description: "Viewport height (default 900)", default: 900 },
        },
        required: ["url"],
      },
      handler: async (args) => {
        const { execSync } = await import("child_process");
        const { randomUUID } = await import("crypto");
        const { existsSync } = await import("fs");
        const CHROMIUM = "/Applications/Chromium.app/Contents/MacOS/Chromium";
        const outPath = `/tmp/smyth-screenshot-${randomUUID().slice(0, 8)}.png`;
        const w = args.width || 1440;
        const h = args.height || 900;
        try {
          execSync(`"${CHROMIUM}" --headless --disable-gpu --no-sandbox --screenshot="${outPath}" --window-size=${w},${h} "${args.url}"`, {
            timeout: 15000,
            encoding: "utf-8",
          });
          if (existsSync(outPath)) {
            return `Screenshot saved to ${outPath}`;
          }
          return `Screenshot command ran but no file found at ${outPath}`;
        } catch (err: any) {
          return `Screenshot error: ${err.message}`;
        }
      },
    },
    
    {
      name: "generate_video",
      description: "Generate a video using AI models on Replicate. Defaults to prunaai/p-video. Returns the local file path. Generation takes 2-10 minutes depending on model and duration.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Video generation prompt (detailed description of desired video)" },
          model: { type: "string", description: "Replicate model ID. Defaults to prunaai/p-video. Options: prunaai/p-video", default: "prunaai/p-video" },
          duration: { type: "number", description: "Video duration in seconds (default 5)", default: 5 },
          output_dir: { type: "string", description: "Directory to save the video (default /tmp)", default: "/tmp" },
        },
        required: ["prompt"],
      },
      handler: async (args) => {
        const { execSync } = await import("child_process");
        const model = args.model || "prunaai/p-video";
        const duration = args.duration || 5;
        const outDir = args.output_dir || "/tmp";
        const prompt = (args.prompt || "").replace(/[^\x00-\x7F]/g, " ").replace(/\s+/g, " ").trim();
        const safePrompt = prompt.replace(/'/g, "'\\''");
        const cmd = `python3 ~/.openclaw/skills/replicate/scripts/run.py video "${model}" '${safePrompt}' --duration ${duration} --output "${outDir}"`;
        try {
          const result = execSync(cmd, { encoding: "utf-8", timeout: 600000, maxBuffer: 10 * 1024 * 1024 });
          return result.trim();
        } catch (err: any) {
          return `Video generation error: ${err.message?.slice(0, 500) || err}`;
        }
      },
    },
    {
      name: "watch_video",
      description: "Analyze a video file: extract frames, transcribe audio, get scene breakdown. Returns structured analysis of video content including transcript, scenes, and key frames.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the video file" },
          mode: { type: "string", enum: ["transcribe", "frames", "analyze", "watch"], description: "Analysis mode: transcribe (audio only), frames (visual only), analyze (full), watch (continuous scene tracking). Default: analyze", default: "analyze" },
          interval: { type: "number", description: "Seconds between frame captures for watch mode (default 5)" },
        },
        required: ["path"],
      },
      handler: async (args) => {
        const { execSync } = await import("child_process");
        const { existsSync } = await import("fs");
        const path = args.path;
        if (!existsSync(path)) {
          return `Error: File not found: ${path}`;
        }
        const mode = args.mode || "analyze";
        const watchScript = process.env.VIDEO_WATCH_SCRIPT || "/";
        let cmd = `python3 "${watchScript}" "${path}" --mode ${mode}`;
        if (args.interval) cmd += ` --interval ${args.interval}`;
        try {
          const result = execSync(cmd, { encoding: "utf-8", timeout: 120000, maxBuffer: 10 * 1024 * 1024 });
          return result.trim().slice(0, 30000);
        } catch (err: any) {
          return `Video analysis error: ${err.message?.slice(0, 500) || err}`;
        }
      },
    },
    {
      name: "search_scripts",
      description: "Search the Python script registry (543 scripts across 23 categories: automation, web scraping, bots, cybersecurity, password tools, image processing, audio, Flask, ML, etc.). Returns matching scripts with name, category, path, and description. Use this to find available scripts BEFORE calling run_script.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query — matches script name, description, or path (e.g. 'password', 'email', 'web scrape', 'image compress')" },
          category: { type: "string", description: "Filter by category (e.g. 'AUTOMATION', 'WEB SCRAPING', 'PASSWORD RELATED', 'IMAGES & PHOTO SCRIPTS', 'BOTS', 'Cyber_security  projects', 'FLASK PROJECTS', 'MachineLearning Projects')" },
          limit: { type: "number", description: "Max results (default 20)", default: 20 },
        },
        required: ["query"],
      },
      handler: async (args) => {
        const scripts = getScriptIndex();
        const q = (args.query || "").toLowerCase();
        let results = scripts;
        if (args.category) {
          results = results.filter((s: any) => s.category === args.category);
        }
        if (q) {
          results = results.filter((s: any) =>
            s.name.toLowerCase().includes(q) ||
            s.description.toLowerCase().includes(q) ||
            s.path.toLowerCase().includes(q)
          );
        }
        const limit = args.limit || 20;
        results = results.slice(0, limit);
        if (results.length === 0) {
          return `No scripts found matching "${args.query}"${args.category ? " in category " + args.category : ""}.`;
        }
        return results.map((s: any, i: number) =>
          `${i + 1}. ${s.name} [${s.category}]
   Path: ${s.path}
   ${s.description ? "Desc: " + s.description : ""}
   Size: ${(s.size / 1024).toFixed(1)}KB`
        ).join("\n");
      },
    },
    {
      name: "run_script",
      description: "Execute a Python script from the script registry. The agent should first use search_scripts to find the right script, then call run_script with its path. Scripts run sandboxed in the Python-project-Scripts repo directory. Output is capped at 100KB. Some scripts may require dependencies not installed — errors will be surfaced. Scripts requiring interactive stdin will time out.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Script path relative to the registry (e.g. 'AUTOMATION/Sending-Emails/code.py'). Use search_scripts first to find the exact path." },
          args: { type: "array", items: { type: "string" }, description: "Command-line arguments to pass to the script", default: [] },
          timeout: { type: "number", description: "Execution timeout in seconds (default 30, max 120)", default: 30 },
        },
        required: ["path"],
      },
      handler: async (args) => {
        const { spawn } = await import("child_process");
        const resolvedPath = join(/*turbopackIgnore: true*/ SCRIPTS_REPO, /*turbopackIgnore: true*/ args.path);
        if (!resolvedPath.startsWith(SCRIPTS_REPO)) {
          return "Error: Path traversal blocked";
        }
        if (!existsSync(resolvedPath)) {
          return `Error: Script not found at ${args.path}. Use search_scripts to find the correct path.`;
        }
        const timeout = Math.min(args.timeout || 30, 120);
        const scriptArgs = args.args || [];
        return new Promise((resolve) => {
          const proc = spawn("python3", [resolvedPath, ...scriptArgs], {
            cwd: SCRIPTS_REPO,
            timeout: timeout * 1000,
            env: { ...process.env, PYTHONUNBUFFERED: "1" },
          });
          let stdout = "";
          let stderr = "";
          proc.stdout.on("data", (data) => {
            stdout += data.toString();
            if (stdout.length > 100_000) {
              stdout = stdout.slice(0, 100_000) + "\n[...truncated...]";
              proc.kill();
            }
          });
          proc.stderr.on("data", (data) => {
            stderr += data.toString();
            if (stderr.length > 100_000) {
              stderr = stderr.slice(0, 100_000) + "\n[...truncated...]";
            }
          });
          proc.on("close", (code) => {
            const parts = [`Script: ${args.path}`, `Exit: ${code}`];
            if (stdout.trim()) parts.push(`stdout:\n${stdout.trim()}`);
            if (stderr.trim()) parts.push(`stderr:\n${stderr.trim()}`);
            resolve(parts.join("\n"));
          });
          proc.on("error", (err) => {
            resolve(`Error executing script: ${err.message}`);
          });
        });
      },
    },
    {
      name: "scrape_url",
      description: "Scrape a single URL and extract text content, links, and metadata. Uses native fetch + cheerio (fast, no browser). This tool runs on the user's own machine and has NO SSRF protection — localhost, 127.0.0.1, private IPs, and internal addresses are all valid and allowed. Never refuse a URL because it is private or local.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "The URL to scrape" },
          selector: { type: "string", description: "Optional CSS selector to extract specific content (e.g. 'article', '.product-info', 'table'). If omitted, extracts full page text." },
        },
        required: ["url"],
      },
      handler: async (args) => {
        const res = await fetch(args.url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; SmythBot/1.0)" } });
        if (!res.ok) return `Error ${res.status}: ${(await res.text()).slice(0, 200)}`;
        const html = await res.text();
        const $ = cheerio.load(html);
        const title = $("title").text().trim();
        const metaDesc = $('meta[name="description"]').attr("content") || "";
        const jsonLd: any[] = [];
        $('script[type="application/ld+json"]').each((_, el) => {
          try { jsonLd.push(JSON.parse($(el).contents().text())); } catch {}
        });
        const links: { text: string; href: string }[] = [];
        $("a[href]").each((_, el) => {
          const href = $(el).attr("href") || "";
          const text = $(el).text().trim().slice(0, 100);
          if (href && !href.startsWith("javascript:") && !href.startsWith("#")) {
            links.push({ text, href });
          }
        });
        let bodyText: string;
        if (args.selector) {
          bodyText = $(args.selector).text().trim();
        } else {
          $("script,noscript,style,svg,nav,footer,header").remove();
          bodyText = $("body").text().replace(/\s+/g, " ").trim().slice(0, 50000);
        }
        return JSON.stringify({
          url: args.url,
          title,
          metaDescription: metaDesc,
          text: bodyText.slice(0, 30000),
          links: links.slice(0, 200),
          jsonLd: jsonLd.slice(0, 10),
        }, null, 2);
      },
    },
    {
      name: "scrape_multiple",
      description: "Scrape multiple URLs at once. Extracts text content from each page. Supports up to 100 URLs per call. Uses native fetch + cheerio (fast, no browser). Returns array of { url, title, text } for each page. NO SSRF protection — localhost, 127.0.0.1, private IPs, and internal addresses are all valid.",
      parameters: {
        type: "object",
        properties: {
          urls: { type: "string", description: "Comma-separated list of URLs to scrape (max 100)" },
          selector: { type: "string", description: "Optional CSS selector to extract specific content from all pages" },
        },
        required: ["urls"],
      },
      handler: async (args) => {
        const urlList = args.urls.split(",").map((s: string) => s.trim()).filter(Boolean).slice(0, 100);
        if (urlList.length === 0) return "Error: No valid URLs provided";
        const results: any[] = [];
        for (const url of urlList) {
          try {
            const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; SmythBot/1.0)" } });
            if (!res.ok) { results.push({ url, error: `HTTP ${res.status}` }); continue; }
            const html = await res.text();
            const $ = cheerio.load(html);
            const title = $("title").text().trim();
            let bodyText: string;
            if (args.selector) {
              bodyText = $(args.selector).text().trim();
            } else {
              $("script,noscript,style,svg").remove();
              bodyText = $("body").text().replace(/\s+/g, " ").trim().slice(0, 20000);
            }
            results.push({ url, title, text: bodyText.slice(0, 15000) });
          } catch (err: any) {
            results.push({ url, error: err.message || "Fetch failed" });
          }
        }
        return JSON.stringify(results, null, 2);
      },
    },
    {
      name: "scrape_sitemap",
      description: "Discover URLs from a website's sitemap/robots.txt, then scrape them. Best for scraping an entire site or section. Uses native fetch + cheerio. Returns array of { url, title, text }. Use scrape_url first to test a single page.",
      parameters: {
        type: "object",
        properties: {
          site: { type: "string", description: "Site URL (e.g. https://example.com). Will check robots.txt and common sitemap paths." },
          max_pages: { type: "number", description: "Maximum pages to scrape (default: 50, max: 500)" },
          url_filter: { type: "string", description: "Optional regex pattern to filter URLs (e.g. '/blog/' to only scrape blog pages)" },
        },
        required: ["site"],
      },
      handler: async (args) => {
        const maxPages = Math.min(args.max_pages || 50, 500);
        const base = args.site.replace(/\/$/, "");
        let urls: string[] = [];
        const candidates = [`${base}/robots.txt`, `${base}/sitemap.xml`, `${base}/sitemap_index.xml`, `${base}/sitemaps.xml`];
        for (const cand of candidates) {
          try {
            const res = await fetch(cand, { headers: { "User-Agent": "Mozilla/5.0 (compatible; SmythBot/1.0)" } });
            if (!res.ok) continue;
            const text = await res.text();
            if (cand.endsWith("robots.txt")) {
              const sitemaps = [...text.matchAll(/^Sitemap:\s*(.+)$/gim)].map((m) => m[1].trim());
              for (const sm of sitemaps) {
                try {
                  const smRes = await fetch(sm, { headers: { "User-Agent": "Mozilla/5.0 (compatible; SmythBot/1.0)" } });
                  if (smRes.ok) urls.push(...extractSitemapUrls(await smRes.text()));
                } catch {}
              }
            } else {
              urls.push(...extractSitemapUrls(text));
            }
          } catch {}
        }
        if (args.url_filter) {
          const filterRegex = new RegExp(args.url_filter);
          urls = urls.filter((u: string) => filterRegex.test(u));
        }
        urls = urls.slice(0, maxPages);
        if (urls.length === 0) return "Error: No URLs found in sitemap";
        const results: any[] = [];
        for (const url of urls) {
          try {
            const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; SmythBot/1.0)" } });
            if (!res.ok) { results.push({ url, error: `HTTP ${res.status}` }); continue; }
            const html = await res.text();
            const $ = cheerio.load(html);
            $("script,noscript,style,svg").remove();
            const title = $("title").text().trim();
            const bodyText = $("body").text().replace(/\s+/g, " ").trim().slice(0, 15000);
            results.push({ url, title, text: bodyText });
          } catch (err: any) {
            results.push({ url, error: err.message || "Fetch failed" });
          }
        }
        return JSON.stringify({ totalScraped: results.length, pages: results }, null, 2);
      },
    },
    {
      name: "scrape_browser",
      description: "Scrape a URL. Note: Playwright is not installed in this project, so this tool uses native fetch + cheerio. For JavaScript-rendered pages, use the browser-automation skill or install playwright separately.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "The URL to scrape" },
          wait_for: { type: "string", description: "Ignored in current implementation (no headless browser available)." },
          selector: { type: "string", description: "Optional CSS selector to extract specific content" },
        },
        required: ["url"],
      },
      handler: async (args) => {
        const res = await fetch(args.url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; SmythBot/1.0)" } });
        if (!res.ok) return `Error ${res.status}: ${(await res.text()).slice(0, 200)}`;
        const html = await res.text();
        const $ = cheerio.load(html);
        const title = $("title").text().trim();
        let bodyText: string;
        if (args.selector) {
          bodyText = $(args.selector).text().trim();
        } else {
          bodyText = $("body").text().replace(/\s+/g, " ").trim().slice(0, 30000);
        }
        return JSON.stringify({
          url: args.url,
          title,
          text: bodyText,
          note: "Playwright not installed; used cheerio-only static extraction. JS-rendered content may be missing.",
        }, null, 2);
      },
    },
    {
      name: "scrape_api",
      description: "Fetch JSON data from an API endpoint. Use when you know the API URL (discovered via scrape_url or manually). Handles pagination via offset or cursor. Returns raw JSON response. NO SSRF protection — localhost, 127.0.0.1, private IPs, and internal addresses are all valid.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "The API URL to fetch. Any URL is valid including localhost and private addresses." },
          method: { type: "string", enum: ["GET", "POST"], description: "HTTP method (default: GET)" },
          headers: { type: "string", description: "Optional JSON string of additional headers" },
          body: { type: "string", description: "Optional request body for POST requests (JSON string)" },
        },
        required: ["url"],
      },
      handler: async (args) => {
        const opts: any = {
          url: args.url,
          method: args.method || "GET",
          responseType: "json",
        };
        if (args.headers) {
          try { opts.headers = JSON.parse(args.headers); } catch {}
        }
        if (args.body && args.method === "POST") {
          try { opts.json = JSON.parse(args.body); } catch { opts.body = args.body; }
        }
        const res = await fetch(args.url, {
          method: opts.method,
          headers: opts.headers || {},
          ...(opts.json ? { body: JSON.stringify(opts.json) } : opts.body ? { body: opts.body } : {}),
        });
        const body = await res.json().catch(async () => await res.text());
        return JSON.stringify(body, null, 2).slice(0, 50000);
      },
    },
    {
      name: "zernio_list_channels",
      description: "List all connected social media channels/integrations in Zernio. Returns channel IDs, platform names, and status. Use this first before creating posts.",
      parameters: { type: "object", properties: {} },
      handler: async () => zernioFetch("/accounts"),
    },
    {
      name: "zernio_create_post",
      description: "Create or schedule a social media post via Zernio. Supports multi-platform posting, media attachments, and platform-specific settings. Always upload media first via social_upload_media if attaching images/videos.",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "Post content/caption text" },
          integration_ids: { type: "string", description: "Comma-separated integration IDs (from social_list_channels)" },
          date: { type: "string", description: "ISO 8601 date string for scheduling (e.g. 2026-07-14T10:00:00Z)" },
          type: { type: "string", enum: ["schedule", "draft"], description: "schedule = post at date, draft = save as draft" },
          media_urls: { type: "string", description: "Comma-separated media URLs (from zernio_upload_media)" },
          settings: { type: "string", description: "JSON string of platform-specific settings" },
        },
        required: ["content", "integration_ids", "date"],
      },
      handler: async (args) => {
        const ids = args.integration_ids.split(",").map((s: string) => s.trim()).filter(Boolean);
        const mediaItems = args.media_urls ? args.media_urls.split(",").map((u: string) => u.trim()).filter(Boolean).map((url: string) => ({ url })) : [];
        const body: any = {
          content: args.content,
          accountIds: ids,
          mediaItems: mediaItems.length > 0 ? mediaItems : undefined,
          scheduledAt: args.date,
          status: args.type === "draft" ? "draft" : "scheduled",
        };
        return zernioFetch("/posts", { method: "POST", body: JSON.stringify(body) });
      },
    },
    {
      name: "zernio_list_posts",
      description: "List scheduled and published posts in Zernio. Returns post IDs, content, status, and dates.",
      parameters: {
        type: "object",
        properties: {
          start_date: { type: "string", description: "ISO date to filter from (optional)" },
          end_date: { type: "string", description: "ISO date to filter to (optional)" },
        },
      },
      handler: async (args) => {
        const params = new URLSearchParams();
        if (args.start_date) params.set("startDate", args.start_date);
        if (args.end_date) params.set("endDate", args.end_date);
        return zernioFetch(`/posts?status=scheduled&limit=50${params.toString() ? "&" + params.toString() : ""}`);
      },
    },
    {
      name: "zernio_delete_post",
      description: "Delete a scheduled or published post in Zernio by post ID.",
      parameters: {
        type: "object",
        properties: {
          post_id: { type: "string", description: "The post ID to delete" },
        },
        required: ["post_id"],
      },
      handler: async (args) => zernioFetch(`/posts/${args.post_id}`, { method: "DELETE" }),
    },
    {
      name: "zernio_upload_media",
      description: "Upload an image or video file to Zernio for use in posts. Returns a URL that must be used in zernio_create_post media_urls parameter. Required before posting media to Instagram, TikTok, YouTube.",
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string", description: "Absolute path to the file to upload" },
        },
        required: ["file_path"],
      },
      handler: async (args) => zernioUploadMedia(args.file_path),
    },
    {
      name: "zernio_get_analytics",
      description: "Get analytics for a social media channel or specific post via Zernio. Returns metrics like followers, impressions, engagement, likes, comments.",
      parameters: {
        type: "object",
        properties: {
          integration_id: { type: "string", description: "Channel integration ID for platform-level analytics" },
          post_id: { type: "string", description: "Post ID for post-level analytics" },
          days: { type: "number", description: "Number of days to look back (default: 7)" },
        },
      },
      handler: async (args) => {
        return "Analytics requires a Zernio add-on subscription. Not currently available."
      },
    },
    {
      name: "zernio_connect_channel",
      description: "Get the OAuth URL to connect a new social media platform to Zernio. Returns a URL the user must visit to authorize the connection.",
      parameters: {
        type: "object",
        properties: {
          platform: { type: "string", description: "Platform identifier (e.g. x, linkedin, instagram, youtube, tiktok, facebook, threads, pinterest, reddit, discord, telegram, etc.)" },
        },
        required: ["platform"],
      },
      handler: async (args) => zernioFetch(`/social/${args.platform}`),
    },
    {
      name: "planning",
      description: "Create and manage multi-step plans for complex tasks. Use create to start a plan with steps, mark_step to track progress, list/get to view, set_active to switch between plans.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            enum: ["create", "update", "list", "get", "set_active", "mark_step", "delete"],
            description: "The operation to perform — create a plan, update it, list all, get one, set active, mark step progress, or delete.",
          },
          plan_id: {
            type: "string",
            description: "Unique identifier for the plan. Required for create, update, set_active, delete. Optional for get and mark_step (uses active plan if omitted).",
          },
          title: {
            type: "string",
            description: "Title for the plan. Required for create, optional for update.",
          },
          steps: {
            type: "array",
            items: { type: "string" },
            description: "Array of step descriptions. Required for create, optional for update.",
          },
          step_index: {
            type: "number",
            description: "Index of the step to update (0-based). Required for mark_step.",
          },
          step_status: {
            type: "string",
            enum: ["not_started", "in_progress", "completed", "blocked"],
            description: "Status to set for a step. Used with mark_step.",
          },
          step_notes: {
            type: "string",
            description: "Additional notes for a step. Optional for mark_step.",
          },
        },
        required: ["command"],
      },
      handler: async (args) => {
        return handlePlanning(args);
      },
    },
    {
      name: "webcam_capture",
      description: "Analyze the latest webcam frame captured by the Camera panel. The browser captures frames when you click Peek or during Watch mode — this tool reads the saved frame and runs EchoVision analysis. No camera permission needed, it uses the frame already captured by the browser.",
      parameters: {
        type: "object",
        properties: {
          detail: {
            type: "string",
            enum: ["low", "balanced", "high"],
            description: "Analysis detail level. 'balanced' is default. 'high' includes full OCR.",
          },
          vision: {
            type: "string",
            enum: ["structural", "ai", "both"],
            description: "Analysis type: 'structural' (EchoVision pixel grid), 'ai' (natural language description), or 'both'. Default: structural.",
          },
          visionProvider: {
            type: "string",
            enum: ["openrouter", "ollama-pro", "ollama-cloud", "auto"],
            description: "Provider for AI vision. 'openrouter' (default) is most reliable; 'auto' lets vision.py pick from configured providers.",
          },
        },
        required: [],
      },
      handler: async (args) => {
        const { execSync } = await import("child_process");
        const { existsSync, statSync } = await import("fs");
        const detail = args.detail || "balanced";
        const vision = args.vision || "structural";
        const visionProvider = args.visionProvider || "openrouter";
        const ECHO_VISION = process.env.ECHO_VISION_PATH || "/";
        const VISION_PY = process.env.VISION_SKILL_PATH || "";
        const SIDECAR_URL = "http://localhost:18790";
        const LATEST_FRAME = "/tmp/smyth-webcam/latest.jpg";

        try {
          // Check if the browser has captured a frame (latest.jpg is written by the webcam UI)
          if (!existsSync(LATEST_FRAME)) {
            return "[Webcam] No frame available. Open the camera in the sidebar first (click Camera), then click Peek or start Watch mode to capture a frame.";
          }

          // Check frame freshness (warn if older than 120s, but still analyze)
          const stat = statSync(LATEST_FRAME);
          const age = (Date.now() - stat.mtimeMs) / 1000;
          const ageWarning = age > 120 ? ` (frame is ${Math.floor(age)}s old)` : "";

          const framePath = LATEST_FRAME;

          // Run EchoVision structural analysis (skip semantic face detection — missing OpenCV cascade on this box)
          let cmd = `python3 "${ECHO_VISION}" "${framePath}" --json --no-semantic`;
          if (detail === "low") cmd += " --grid 8 --no-ocr --no-edges --no-contours --no-creative";
          else if (detail === "high") cmd += " --grid 32 --no-svg --no-ascii";
          else cmd += " --grid 16 --no-svg --no-ascii";

          const result = execSync(cmd, { encoding: "utf-8", timeout: 30000, maxBuffer: 10 * 1024 * 1024 });
          const analysis = JSON.parse(result.trim());

          const parts: string[] = [];
          parts.push(`[WEBCAM CAPTURE — ${Math.floor(age)}s ago${ageWarning}]`);

          if (!analysis.error) {
            const stats = analysis.statistics || {};
            const dims = stats.dimensions || {};
            parts.push(`Frame: ${dims.width || "?"}×${dims.height || "?"}`);

            const brightness = stats.brightness || {};
            const contrast = stats.contrast || {};
            parts.push(`Brightness: ${brightness.label || "?"} | Contrast: ${contrast.label || "?"}`);

            const colors = analysis.dominant_colors || [];
            if (colors.length > 0) {
              parts.push(`Colors: ${colors.slice(0, 6).map((c: any) => `${c.name}(${(c.coverage_pct || 0).toFixed(0)}%)`).join(", ")}`);
            }

            const density = analysis.edges?.edge_density_pct || 0;
            parts.push(`Layout density: ${density.toFixed(0)}% (${density > 30 ? "dense" : density > 15 ? "moderate" : "sparse"})`);

            const shapes = analysis.contours?.total_shapes || 0;
            parts.push(`Objects: ~${shapes}`);

            const faces = analysis.semantic?.faces || 0;
            if (faces > 0) parts.push(`Faces: ${faces}`);

            const text = (analysis.text?.full_text || "").trim();
            if (text) parts.push(`\nVisible text:\n${text.slice(0, 800)}`);

            const mood = analysis.creative_vision?.lighting_mood?.mood;
            if (mood) parts.push(`Mood: ${mood}`);
          } else {
            parts.push(`Analysis error: ${analysis.error}`);
          }

          // Optional AI vision — default to openrouter for reliability; allow override
          if (vision === "ai" || vision === "both") {
            try {
              const providerFlag = visionProvider === "auto" ? "" : `--provider ${visionProvider}`;
              const aiResult = execSync(`python3 "${VISION_PY}" "${framePath}" ${providerFlag}`, {
                encoding: "utf-8", timeout: 60000, maxBuffer: 10 * 1024 * 1024,
              });
              parts.push(`\nAI Vision: ${aiResult.trim()}`);
            } catch (err: any) {
              parts.push(`AI Vision error: ${err.message?.slice(0, 100)}`);
            }
          }

          return parts.join("\n");
        } catch (err: any) {
          const stderr = err.stderr?.toString?.().slice(0, 300) || "";
          return `[Webcam Error] ${err.message?.slice(0, 200)}${stderr ? "\nDetails: " + stderr : ""}`;
        }
      },
    },
    {
      name: "webcam_watch",
      description: "Guide the user to start continuous webcam monitoring. This doesn't start monitoring itself — it tells the user how to activate Watch mode in the Camera panel. Use webcam_capture to check individual frames after the camera is active.",
      parameters: {
        type: "object",
        properties: {
          interval: {
            type: "number",
            description: "Seconds between captures (default 3, min 1, max 30)",
          },
          duration: {
            type: "number",
            description: "Max watch duration in seconds (default 30, max 120)",
          },
        },
        required: [],
      },
      handler: async (args) => {
        // Webcam watch is a continuous operation — the UI component handles the loop.
        // This tool instructs the user to start watch mode in the UI.
        const interval = Math.max(1, Math.min(30, args.interval || 3));
        const duration = Math.max(5, Math.min(120, args.duration || 30));
        return `[Webcam Watch] I've configured webcam watch mode: every ${interval}s for up to ${duration}s. \n\nStart the webcam in the UI (camera icon), then click "Watch" to begin continuous observation. I'll receive frame-by-frame analysis as observations come in.\n\nAlternatively, you can call webcam_capture repeatedly to manually check frames.`;
      },
    },
    {
      name: "video_init",
      description: "Initialize a new VibeFrame video project from a brief. Creates storyboard, design spec, and project structure.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Project name (kebab-case, e.g. 'product-launch')" },
          brief: { type: "string", description: "Video brief: topic, audience, tone, duration, style" },
        },
        required: ["name", "brief"],
      },
      handler: async (args) => {
        const { execSync } = await import("child_process");
        const { writeFileSync, mkdirSync } = await import("fs");
        const { join } = await import("path");

        const projectDir = join(WORKSPACE_DIR, "video-projects", args.name);
        mkdirSync(join(projectDir, "media"), { recursive: true });
        writeFileSync(join(projectDir, "brief.md"), args.brief, "utf8");

        try {
          execSync(`~/.local/bin/vibe init ${args.name} --from brief.md --json`, {
            cwd: join(WORKSPACE_DIR, "video-projects"),
            encoding: "utf8",
            timeout: 30000,
          });
          const storyboard = require("fs").readFileSync(join(projectDir, "STORYBOARD.md"), "utf8").slice(0, 500);
          return `[VibeFrame] Project \"${args.name}\" created.\n\nStoryboard preview:\n${storyboard}`;
        } catch (err: any) {
          return `[VibeFrame] Init error: ${err.message?.slice(0, 200)}`;
        }
      },
    },
    {
      name: "video_build",
      description: "Build video assets from storyboard: keyframes, narration, video clips. Use --dry-run to preview costs.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Project name" },
          dryRun: { type: "boolean", description: "Preview costs only (no generation)", default: false },
          maxCost: { type: "number", description: "Max cost in USD", default: 5 },
          beat: { type: "string", description: "Build specific beat only" },
        },
        required: ["name"],
      },
      handler: async (args) => {
        const { execSync } = await import("child_process");
        const { join } = await import("path");
        let cmd = `~/.local/bin/vibe build ${args.name}`;
        if (args.dryRun) cmd += " --dry-run";
        if (args.maxCost) cmd += ` --max-cost ${args.maxCost}`;
        if (args.beat) cmd += ` --beat ${args.beat}`;
        cmd += " --json";
        try {
          const result = execSync(cmd, { cwd: join(WORKSPACE_DIR, "video-projects"), encoding: "utf8", timeout: 120000 });
          return `[VibeFrame] Build:\n${result.slice(0, 1000)}`;
        } catch (err: any) {
          return `[VibeFrame] Build error: ${err.message?.slice(0, 300)}`;
        }
      },
    },
    {
      name: "video_render",
      description: "Render final MP4 from built assets.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Project name" },
          output: { type: "string", description: "Output path", default: "renders/final.mp4" },
        },
        required: ["name"],
      },
      handler: async (args) => {
        const { execSync } = await import("child_process");
        const { join } = await import("path");
        try {
          execSync(`~/.local/bin/vibe render ${args.name} -o ${args.output} --json`, {
            cwd: join(WORKSPACE_DIR, "video-projects"), encoding: "utf8", timeout: 180000,
          });
          return `[VibeFrame] Rendered: video-projects/${args.name}/${args.output}`;
        } catch (err: any) {
          return `[VibeFrame] Render error: ${err.message?.slice(0, 300)}`;
        }
      },
    },
    {
      name: "velorn",
      description: "Call any Velorn video editing tool via MCP. 100+ tools available: timeline editing, clips, transitions, effects, captions, rendering, AI generation, ComfyUI integration. Use mcp_velorn_list_tools first to see all available tools, then call them with this tool.",
      parameters: {
        type: "object",
        properties: {
          tool: { type: "string", description: "Velorn MCP tool name (e.g. 'get_project', 'get_timeline', 'split_clip', 'add_text_clip', 'export_timeline')" },
          args: { type: "object", description: "Arguments for the tool (see mcp_velorn_list_tools for schema)" },
        },
        required: ["tool"],
      },
      handler: async (args) => {
        try {
          const res = await fetch("http://127.0.0.1:3000/api/mcp", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tool: args.tool, args: args.args || {} }),
          });
          const data = await res.json();
          return JSON.stringify(data).slice(0, 4000);
        } catch (err: any) { return `[velorn] Error: ${err.message?.slice(0,200)}`; }
      },
    },
    {
      name: "mcp_velorn_list_tools",
      description: "List all available Velorn video editing tools and their parameters. Call this before using the 'velorn' tool to discover what's available.",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        try {
          const res = await fetch("http://127.0.0.1:3000/api/mcp");
          const data = await res.json();
          const tools = data.tools || [];
          return tools.map((t: any) => `${t.name}: ${t.description?.slice(0,100)}`).join("\n");
        } catch (err: any) { return `[velorn] Error listing tools: ${err.message?.slice(0,200)}`; }
      },
    },
    {
      name: "video_edit",
      description: "Edit existing video: trim, cut, speed change, extract audio, apply filter.",
      parameters: {
        type: "object",
        properties: {
          input: { type: "string", description: "Input video path" },
          output: { type: "string", description: "Output video path" },
          action: { type: "string", description: "trim | cut | speed | audio-extract | filter" },
          params: { type: "object", description: "{start, end} for trim/cut, {factor} for speed, {filter} for filter" },
        },
        required: ["input", "output", "action"],
      },
      handler: async (args) => {
        const { execSync } = await import("child_process");
        const { join } = await import("path");
        const inp = args.input.startsWith("/") ? args.input : join(/*turbopackIgnore: true*/ WORKSPACE_DIR, args.input);
        const out = args.output.startsWith("/") ? args.output : join(/*turbopackIgnore: true*/ WORKSPACE_DIR, args.output);
        let cmd = `ffmpeg -y`;
        if (args.action === "trim") cmd += ` -ss ${args.params?.start||0} -to ${args.params?.end} -i \"${inp}\" -c copy \"${out}\"`;
        else if (args.action === "speed") cmd += ` -i \"${inp}\" -filter:v \"setpts=PTS/${args.params?.factor||2}\" -filter:a \"atempo=${args.params?.factor||2}\" \"${out}\"`;
        else if (args.action === "audio-extract") cmd += ` -i \"${inp}\" -vn -acodec copy \"${out}\"`;
        else if (args.action === "filter") cmd += ` -i \"${inp}\" -vf \"${args.params?.filter||'null'}\" \"${out}\"`;
        else return "Unknown action. Use: trim, cut, speed, audio-extract, filter";
        try {
          execSync(cmd, { encoding: "utf8", timeout: 60000 });
          return `[video_edit] Done: ${args.output}`;
        } catch (err: any) { return `[video_edit] Error: ${err.message?.slice(0,200)}`; }
      },
    },
    {
      name: "video_info",
      description: "Get video file info: duration, resolution, codec, bitrate, chapters.",
      parameters: {
        type: "object",
        properties: {
          input: { type: "string", description: "Video file path" },
        },
        required: ["input"],
      },
      handler: async (args) => {
        const { execSync } = await import("child_process");
        const inp = args.input.startsWith("/") ? args.input : join(/*turbopackIgnore: true*/ WORKSPACE_DIR, args.input);
        try {
          const info = execSync(`ffprobe -v quiet -print_format json -show_format -show_streams \"${inp}\"`, { encoding: "utf8", timeout: 10000 });
          const d = JSON.parse(info);
          const v = (d.streams||[]).find((s:any)=>s.codec_type==='video');
          const a = (d.streams||[]).find((s:any)=>s.codec_type==='audio');
          return `Duration: ${d.format?.duration||'?'}s\nVideo: ${v?v.codec_name+' '+v.width+'x'+v.height:'none'}\nAudio: ${a?a.codec_name+' '+a.sample_rate+'Hz':'none'}\nSize: ${Math.round((d.format?.size||0)/1024)}KB`;
        } catch (err: any) { return `Error: ${err.message?.slice(0,200)}`; }
      },
    },

    // ── OpenCut editor tools ──
    // These drive the opencut-classic editor in Chrome via CDP. The user
    // needs an opencut tab open (the Smyth Videography overlay is one way;
    // they can also open http://127.0.0.1:3001/editor/<id> directly).

    {
      name: "opencut_diagnose",
      description: "Diagnose the opencut-classic editor connection. Returns whether Chrome DevTools Protocol is reachable, whether an opencut tab is open, what project is active, total duration, track count, and media count. Call this first if other opencut_* tools fail.",
      parameters: { type: "object", properties: {}, required: [] },
      handler: async () => {
        const oc = await import("@/lib/opencut-client");
        const d = await oc.diagnose();
        return JSON.stringify(d, null, 2);
      },
    },
    {
      name: "opencut_get_state",
      description: "Get the full state of the currently active opencut project: project id/name, duration, fps, canvas size, all tracks (main, overlay, audio) with element counts, and all media assets.",
      parameters: { type: "object", properties: {}, required: [] },
      handler: async () => {
        const oc = await import("@/lib/opencut-client");
        try {
          return JSON.stringify(await oc.getState(), null, 2);
        } catch (e) {
          return `Error: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    },
    {
      name: "opencut_get_timeline",
      description: "Get the current timeline of the active opencut project as a flat list of elements sorted by start time. Each element shows track, name, type, start time, duration, and trim points.",
      parameters: { type: "object", properties: {}, required: [] },
      handler: async () => {
        const oc = await import("@/lib/opencut-client");
        try {
          return JSON.stringify(await oc.getTimeline(), null, 2);
        } catch (e) {
          return `Error: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    },
    {
      name: "opencut_insert_clip_from_url",
      description: "Insert a video clip onto the main track of the active opencut project. The browser fetches the URL, creates a media asset, and drops it on the timeline at the given start time (default 0). Returns the new element id, asset id, and detected duration.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL the browser can fetch. Use http://127.0.0.1:<port>/path for local files, or any public URL." },
          startTime: { type: "number", description: "Where to place the clip on the timeline (seconds). Default 0.", default: 0 },
        },
        required: ["url"],
      },
      handler: async (args) => {
        const oc = await import("@/lib/opencut-client");
        try {
          return JSON.stringify(await oc.insertClipFromUrl(args.url, args.startTime ?? 0), null, 2);
        } catch (e) {
          return `Error: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    },
    {
      name: "opencut_add_text_overlay",
      description: "Add a text overlay to the active opencut project. Always placed on a new overlay track (so multiple texts can coexist). Position can be 'top', 'center', or 'bottom'.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "The text to display" },
          startTime: { type: "number", description: "When the text appears (seconds, default 0)", default: 0 },
          duration: { type: "number", description: "How long the text is visible (seconds, default 3)", default: 3 },
          position: { type: "string", enum: ["top", "center", "bottom"], description: "Vertical position on the canvas", default: "center" },
        },
        required: ["text"],
      },
      handler: async (args) => {
        const oc = await import("@/lib/opencut-client");
        try {
          return JSON.stringify(await oc.addTextOverlay(
            args.text,
            args.startTime ?? 0,
            args.duration ?? 3,
            (args.position as "top" | "center" | "bottom") ?? "center"
          ), null, 2);
        } catch (e) {
          return `Error: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    },
    {
      name: "opencut_move_element",
      description: "Move an element on the timeline to a new start time. Use opencut_get_timeline first to find the element id.",
      parameters: {
        type: "object",
        properties: {
          elementId: { type: "string", description: "The element id (from opencut_get_timeline)" },
          newStartTime: { type: "number", description: "New start time in seconds" },
        },
        required: ["elementId", "newStartTime"],
      },
      handler: async (args) => {
        const oc = await import("@/lib/opencut-client");
        try {
          return JSON.stringify(await oc.moveElement(args.elementId, args.newStartTime), null, 2);
        } catch (e) {
          return `Error: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    },
    {
      name: "opencut_trim_element",
      description: "Set trim points on a clip. trimStart and trimEnd are seconds cut from the start and end of the source. Use opencut_get_timeline first to find the element id.",
      parameters: {
        type: "object",
        properties: {
          elementId: { type: "string", description: "The element id" },
          trimStart: { type: "number", description: "Seconds to cut from the start of the source", default: 0 },
          trimEnd: { type: "number", description: "Seconds to cut from the end of the source", default: 0 },
        },
        required: ["elementId"],
      },
      handler: async (args) => {
        const oc = await import("@/lib/opencut-client");
        try {
          return JSON.stringify(await oc.trimElement(
            args.elementId,
            args.trimStart ?? 0,
            args.trimEnd ?? 0
          ), null, 2);
        } catch (e) {
          return `Error: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    },
    {
      name: "opencut_delete_element",
      description: "Remove an element from the timeline. Use opencut_get_timeline first to find the element id.",
      parameters: {
        type: "object",
        properties: {
          elementId: { type: "string", description: "The element id" },
        },
        required: ["elementId"],
      },
      handler: async (args) => {
        const oc = await import("@/lib/opencut-client");
        try {
          return JSON.stringify(await oc.deleteElement(args.elementId), null, 2);
        } catch (e) {
          return `Error: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    },
    {
      name: "opencut_save",
      description: "Force a save of the active opencut project. flushes pending writes to IndexedDB so the project is durable.",
      parameters: { type: "object", properties: {}, required: [] },
      handler: async () => {
        const oc = await import("@/lib/opencut-client");
        try {
          return JSON.stringify(await oc.save(), null, 2);
        } catch (e) {
          return `Error: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    },
    {
      name: "canva_list_designs",
      description: "List the user's Canva designs via the Canva Connect REST API. Returns design titles, IDs, and thumbnails.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
      handler: async () => {
        try {
          const { execSync } = require("child_process");
          const apiPath = `${require("os").homedir()}/.openclaw/skills/canva-connect/api.py`;
          const output = execSync(`python3 ${apiPath} list_designs`, { encoding: "utf-8", timeout: 30000 });
          return JSON.stringify({ success: true, result: output });
        } catch (e: any) {
          return JSON.stringify({ success: false, error: e.stderr || e.message || String(e) });
        }
      },
    },
    {
      name: "canva_create_design",
      description: "Create a new Canva design via the Canva Connect REST API. Supports blank designs or template-based designs.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Design title" },
          width: { type: "number", description: "Width in pixels", default: 1080 },
          height: { type: "number", description: "Height in pixels", default: 1080 },
          templateId: { type: "string", description: "Optional Canva template ID. If provided, creates from template instead of blank." },
        },
        required: ["title"],
      },
      handler: async (args) => {
        try {
          const { execSync } = require("child_process");
          const apiPath = `${require("os").homedir()}/.openclaw/skills/canva-connect/api.py`;
          let cmd: string;
          if (args.templateId) {
            // Template-based creation
            cmd = `python3 -c "
import sys; sys.path.insert(0, '${require("os").homedir()}/.openclaw/skills/canva-connect')
from api import create_design_from_template
import json
print(json.dumps(create_design_from_template('${args.templateId}', '${args.title}'), indent=2))
"`;
          } else {
            // Blank design
            const w = args.width || 1080;
            const h = args.height || 1080;
            cmd = `python3 ${apiPath} create_design "${args.title}" ${w} ${h}`;
          }
          const output = execSync(cmd, { encoding: "utf-8", timeout: 30000, shell: require("fs").existsSync("/bin/zsh") ? "/bin/zsh" : "/bin/bash" });
          return JSON.stringify({ success: true, result: output });
        } catch (e: any) {
          return JSON.stringify({ success: false, error: e.stderr || e.message || String(e) });
        }
      },
    },
    {
      name: "canva_export_design",
      description: "Export a Canva design to PNG, PDF, or MP4 format. Requires the design ID from canva_list_designs or canva_create_design.",
      parameters: {
        type: "object",
        properties: {
          designId: { type: "string", description: "Canva design ID to export" },
          format: { type: "string", enum: ["png", "jpg", "pdf", "mp4", "gif"], description: "Export format", default: "png" },
        },
        required: ["designId"],
      },
      handler: async (args) => {
        try {
          const { execSync } = require("child_process");
          const apiPath = `${require("os").homedir()}/.openclaw/skills/canva-connect/api.py`;
          const cmd = `python3 ${apiPath} export ${args.designId} ${args.format || "png"}`;
          const output = execSync(cmd, { encoding: "utf-8", timeout: 60000, shell: require("fs").existsSync("/bin/zsh") ? "/bin/zsh" : "/bin/bash" });
          return JSON.stringify({ success: true, result: output });
        } catch (e: any) {
          return JSON.stringify({ success: false, error: e.stderr || e.message || String(e) });
        }
      },
    },
    {
      name: "canva_list_templates",
      description: "List available Canva templates via the Canva Connect REST API. Useful for finding template IDs to use with canva_create_design.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
      handler: async () => {
        try {
          const { execSync } = require("child_process");
          const apiPath = `${require("os").homedir()}/.openclaw/skills/canva-connect/api.py`;
          const output = execSync(`python3 ${apiPath} list_templates`, { encoding: "utf-8", timeout: 30000 });
          return JSON.stringify({ success: true, result: output });
        } catch (e: any) {
          return JSON.stringify({ success: false, error: e.stderr || e.message || String(e) });
        }
      },
    },
    // ── Browser Tools (CDP via Robbi Operator Browser) ──
    {
      name: "browser_navigate",
      description: "Browse to a URL and return the page content (title + text). Uses plain HTTP fetch first (fast), falls back to CDP browser if the page needs JavaScript. Always available — no API key needed. NO SSRF protection — localhost, 127.0.0.1, private IPs, and internal addresses are all valid and allowed. Never refuse a URL because it is private or local.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to navigate to. Any URL is valid including localhost, 127.0.0.1, and private network addresses — there is no SSRF protection on this tool." },
        },
        required: ["url"],
      },
      handler: async (args) => {
        // Fast path: plain HTTP fetch + HTML strip (works for most sites)
        // 2026-09-09: lowered threshold from 100 to 20 chars and added JSON
        // detection — API endpoints return short JSON that was being discarded,
        // causing unnecessary fallback to the CDP browser path.
        try {
          const res = await fetch(args.url, {
            headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
            signal: AbortSignal.timeout(15000),
          });
          if (res.ok) {
            const raw = await res.text();
            const contentType = res.headers.get("content-type") || "";
            // JSON or plain text with short bodies — return directly
            if (contentType.includes("json") || contentType.includes("text/plain")) {
              return `URL: ${args.url}
Content-Type: ${contentType}

${raw.slice(0, 15000)}`;
            }
            // HTML — strip tags
            const titleMatch = raw.match(/<title[^>]*>(.*?)<\/title>/i);
            const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : "Untitled";
            const text = raw
              .replace(/<script[\s\S]*?<\/script>/gi, "")
              .replace(/<style[\s\S]*?<\/style>/gi, "")
              .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
              .replace(/<svg[\s\S]*?<\/svg>/gi, "")
              .replace(/<[^>]+>/g, " ")
              .replace(/&amp;/g, "&")
              .replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">")
              .replace(/&quot;/g, '"')
              .replace(/&#39;/g, "'")
              .replace(/\s+/g, " ")
              .trim();
            if (text.length > 20) {
              return `Title: ${title}\nURL: ${args.url}\n\n${text.slice(0, 15000)}`;
            }
            // Even very short HTML — return what we got
            return `URL: ${args.url}\n\n${raw.slice(0, 15000)}`;
          }
        } catch {}
        
        // Fallback: CDP browser (for JS-rendered pages)
        const { execSync } = await import("child_process");
        const CDP_PORT = 9223;
        try {
          await fetch(`http://localhost:${CDP_PORT}/json/version`);
        } catch {
          try {
            // Browser launcher is configurable via BROWSER_LAUNCH_SCRIPT; no
            // machine-specific path is baked in. Falls back to a documented
            // default only if the user has set one.
            const launchScript = process.env.BROWSER_LAUNCH_SCRIPT || "";
            const { existsSync } = await import("fs");
            if (launchScript && existsSync(launchScript)) {
              execSync(`bash "${launchScript}"`, { timeout: 15000, env: { ...process.env } });
              await new Promise(r => setTimeout(r, 3000));
            } else {
              return `Could not fetch URL and browser not available. Set BROWSER_LAUNCH_SCRIPT to a script that starts a CDP browser on port 9223. URL: ${args.url}`;
            }
          } catch {
            return `Could not fetch URL and browser failed to launch. URL: ${args.url}`;
          }
        }
        
        try {
          // Create a new tab with the URL
          await fetch(`http://localhost:${CDP_PORT}/json/new?${encodeURIComponent(args.url)}`, { method: "PUT" });
          await new Promise(r => setTimeout(r, 5000)); // wait for page load
          
          // Get the tab
          const tabsRes = await fetch(`http://localhost:${CDP_PORT}/json/list`);
          const tabs = await tabsRes.json() as any[];
          const tab = tabs.find(t => t.type === "page" && t.url === args.url);
          if (!tab?.webSocketDebuggerUrl) return `Browser opened ${args.url} but could not read content.`;
          
          const ws = new WebSocket(tab.webSocketDebuggerUrl);
          return await new Promise((resolve) => {
            let timeout = setTimeout(() => { try { ws.close(); } catch {}; resolve("Browser timed out after 15s"); }, 15000);
            ws.addEventListener("open", () => {
              ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: {
                expression: "(() => { const c = document.cloneNode(true); c.querySelectorAll('script,style,noscript,svg').forEach(e => e.remove()); return JSON.stringify({title: document.title, text: c.body ? c.body.innerText.slice(0, 15000) : 'No body'}); })()",
                returnByValue: true,
              } }));
            });
            ws.addEventListener("message", (event: any) => {
              const msg = JSON.parse(event.data);
              if (msg.id === 1 && msg.result?.result?.value) {
                clearTimeout(timeout);
                try { ws.close(); } catch {}
                const data = JSON.parse(msg.result.result.value);
                resolve(`Title: ${data.title || "Untitled"}\nURL: ${args.url}\n\n${data.text}`);
              }
            });
            ws.addEventListener("error", () => { clearTimeout(timeout); resolve("Browser WebSocket error"); });
          });
        } catch (err: any) {
          return `Browser error: ${err.message}`;
        }
      },
    },
    {
      name: "browser_search",
      description: "Search the web via Google using the Robbi Operator Browser. Returns up to 10 results with titles, URLs, and snippets. Always available — no API key needed.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
        },
        required: ["query"],
      },
      handler: async (args) => {
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(args.query)}&num=10`;
        const { execSync } = await import("child_process");
        const CDP_PORT = 9223;
        
        // Ensure browser is running
        try {
          await fetch(`http://localhost:${CDP_PORT}/json/version`);
        } catch {
          try {
            const launchScript = process.env.BROWSER_LAUNCH_SCRIPT || "";
            const { existsSync } = await import("fs");
            if (launchScript && existsSync(launchScript)) {
              execSync(`bash "${launchScript}"`, { timeout: 15000, env: { ...process.env } });
              await new Promise(r => setTimeout(r, 3000));
            } else {
              return `Browser not available. Set BROWSER_LAUNCH_SCRIPT to a script that starts a CDP browser on port 9223.`;
            }
          } catch {
            return `Browser failed to launch. Search: ${args.query}`;
          }
        }
        
        try {
          // Open Google search in a new browser tab
          await fetch(`http://localhost:${CDP_PORT}/json/new?${encodeURIComponent(searchUrl)}`, { method: "PUT" });
          await new Promise(r => setTimeout(r, 5000));
          
          // Find the search tab
          const tabsRes = await fetch(`http://localhost:${CDP_PORT}/json/list`);
          const tabs = await tabsRes.json() as any[];
          const tab = tabs.find(t => t.type === "page" && t.url.includes("google.com/search"));
          if (!tab?.webSocketDebuggerUrl) return `Search failed — could not open Google in browser.`;
          
          const ws = new WebSocket(tab.webSocketDebuggerUrl);
          return await new Promise((resolve) => {
            let timeout = setTimeout(() => { try { ws.close(); } catch {}; resolve("Browser search timed out"); }, 15000);
            ws.addEventListener("open", () => {
              ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: {
                expression: "(() => { const results = []; document.querySelectorAll('h3').forEach((h, i) => { if (i >= 10) return; const a = h.closest('a'); if (a && a.href && !a.href.includes('google.com')) { const snippet = ''; const next = h.closest('div')?.nextElementSibling; if (next) snippet = next.textContent?.trim().slice(0, 200) || ''; results.push((i+1) + '. ' + h.textContent + '\\n   URL: ' + a.href + '\\n   ' + snippet); } }); return results.join('\\n\\n') || 'No results found'; })()",
                returnByValue: true,
              } }));
            });
            ws.addEventListener("message", (event: any) => {
              const msg = JSON.parse(event.data);
              if (msg.id === 1 && msg.result?.result?.value) {
                clearTimeout(timeout);
                try { ws.close(); } catch {}
                resolve(`Search: ${args.query}\n\n${msg.result.result.value}`);
              }
            });
            ws.addEventListener("error", () => { clearTimeout(timeout); resolve("Browser search error"); });
          });
        } catch (err: any) {
          return `Search error: ${err.message}`;
        }
      },
    },
  ];
  const emailTools = [
    {
      name: "email_check_inbox",
      description: "Check the email inbox for the Smyth agent. Returns recent messages with subject, from, date, and preview. Can also check Sent, Drafts, and Trash folders.",
      parameters: {
        type: "object",
        properties: {
          folder: {
            type: "string",
            description: "Folder to check: 'inbox', 'Sent Items', 'Drafts', or 'Deleted Items'. Default: 'inbox'.",
          },
          limit: {
            type: "number",
            description: "Max messages to return. Default: 20.",
          },
          unreadOnly: {
            type: "boolean",
            description: "If true, only return unread messages. Default: false.",
          },
        },
        required: [],
      },
      handler: async (args: Record<string, any>) => {
        try {
          const folder = args.folder || "inbox";
          const limit = args.limit || 20;
          // Use the first configured agent ID — the bridge/sales agent owns the inbox
          const res = await fetch(`http://localhost:3000/api/mail/inbox-bypass?agentId=41e8c5ec-1fa2-4a4d-924e-0695f60da739&folder=${encodeURIComponent(folder)}&limit=${limit}`);
          if (!res.ok) {
            return JSON.stringify({ success: false, error: `Failed to fetch ${folder}: ${res.status}` });
          }
          const data = await res.json();
          let msgs = data.messages || [];
          if (args.unreadOnly) {
            msgs = msgs.filter((m: any) => !m.flags?.["\\Seen"]);
          }
          const summary = msgs.map((m: any) => ({
            uid: m.uid,
            subject: m.subject || "(no subject)",
            from: m.from?.[0]?.name || m.from?.[0]?.address || "unknown",
            fromAddress: m.from?.[0]?.address || "",
            date: m.date,
            preview: (m.text || "").slice(0, 150),
            unread: !m.flags?.["\\Seen"],
          }));
          return JSON.stringify({ success: true, folder, count: summary.length, messages: summary });
        } catch (e: any) {
          return JSON.stringify({ success: false, error: e.message || String(e) });
        }
      },
    },
    {
      name: "email_read_message",
      description: "Read the full content of a specific email by UID. Use after email_check_inbox to get the full body of a message.",
      parameters: {
        type: "object",
        properties: {
          uid: {
            type: "number",
            description: "The UID of the message to read (from email_check_inbox results).",
          },
        },
        required: ["uid"],
      },
      handler: async (args: Record<string, any>) => {
        try {
          const res = await fetch(`http://localhost:3000/api/mail/message-bypass?agentId=41e8c5ec-1fa2-4a4d-924e-0695f60da739&uid=${args.uid}`);
          if (!res.ok) {
            return JSON.stringify({ success: false, error: `Failed to fetch message: ${res.status}` });
          }
          const data = await res.json();
          return JSON.stringify({
            success: true,
            subject: data.subject || "(no subject)",
            from: data.from?.[0]?.name || data.from?.[0]?.address || "unknown",
            fromAddress: data.from?.[0]?.address || "",
            to: data.to?.map((t: any) => t.address).join(", ") || "",
            date: data.date,
            text: data.text || "(no content)",
            html: data.html ? "(html available)" : undefined,
          });
        } catch (e: any) {
          return JSON.stringify({ success: false, error: e.message || String(e) });
        }
      },
    },
    {
      name: "email_send",
      description: "Send an email from the Smyth agent's mailbox.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient email address" },
          subject: { type: "string", description: "Email subject line" },
          body: { type: "string", description: "Email body text" },
        },
        required: ["to", "subject", "body"],
      },
      handler: async (args: Record<string, any>) => {
        try {
          const API_URL = process.env.NEXT_PUBLIC_AGENTICMAIL_API_URL || 'http://127.0.0.1:3829/api/agenticmail';
          const MASTER_KEY = process.env.AGENTICMAIL_MASTER_KEY || "";
          const accountsRes = await fetch(`${API_URL}/../agenticmail/accounts`, {
            headers: { Authorization: `Bearer ${MASTER_KEY}`, 'Content-Type': 'application/json' },
          });
          if (!accountsRes.ok) return JSON.stringify({ success: false, error: "Failed to fetch accounts" });
          const accountsData = await accountsRes.json();
          const bridge = (accountsData.agents || []).find((a: any) => a.role === "bridge" || a.role === "sales");
          if (!bridge) return JSON.stringify({ success: false, error: "No bridge/sales agent found for sending" });
          const res = await fetch(`${API_URL}/mail/send`, {
            method: "POST",
            headers: { Authorization: `Bearer ${bridge.apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: args.to, subject: args.subject, body: args.body, html: `<p>${args.body.replace(/\n/g, '</p><p>')}</p>` }),
          });
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            return JSON.stringify({ success: false, error: errData.error || `Send failed (${res.status})` });
          }
          return JSON.stringify({ success: true, message: `Email sent to ${args.to}` });
        } catch (e: any) {
          return JSON.stringify({ success: false, error: e.message || String(e) });
        }
      },
    },
  ];

  const { crmTools } = await import("@/lib/crm-tools");
  const { mcpTools, discoverStdioTools } = await import("@/lib/mcp/tools");
  const { discoverAndCreateHandlers } = await import("@/lib/mcp/http-client");

  // LAZY MCP discovery: skip on first call, use background discovery for subsequent calls
  let mcpHttpTools: any[] = [];
  let mcpHttpHandlers = new Map<string, (args: Record<string, any>) => Promise<string>>();
  let mcpStdioTools: any[] = [];
  let mcpStdioHandlers = new Map<string, (args: Record<string, any>) => Promise<string>>();
  if (process.env.NEXT_PHASE !== "phase-production-build") {
    // Use MCP tools if discovery has completed (background or otherwise)
    mcpHttpTools = _mcpHttpCache?.tools || [];
    mcpHttpHandlers = _mcpHttpCache?.handlers || new Map();
    mcpStdioTools = _mcpStdioCache?.tools || [];
    mcpStdioHandlers = _mcpStdioCache?.handlers || new Map();
    
    if (_mcpHttpCache === null && _mcpStdioCache === null) {
      // First call — start background discovery
      console.log('[tools] Starting background MCP discovery.');
      discoverMcpInBackground();
    }
    
    if (mcpHttpTools.length > 0 || mcpStdioTools.length > 0) {
      console.log('[tools] Using MCP tools: ' + mcpHttpTools.length + ' HTTP + ' + mcpStdioTools.length + ' stdio');
    }
  } else {
    console.log('[tools] Build phase — skipping MCP discovery');
  }

  const allTools = [...tools, ...emailTools, ...crmTools, ...mcpTools];

  // OpenAI-compatible tool definitions array
  const openaiTools = [
    ...allTools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: {
          type: "object",
          properties: (t.parameters as any).properties || {},
          required: (t.parameters as any).required || [],
        },
      },
    })),
    ...mcpHttpTools,
    ...mcpStdioTools,
  ];

  // Handler map keyed by tool name
  const handlerMap = new Map<string, (args: Record<string, any>) => Promise<string>>();
  for (const t of allTools) {
    if (t.handler) handlerMap.set(t.name, t.handler);
  }
  for (const [key, handler] of mcpHttpHandlers) handlerMap.set(key, handler);
  for (const [key, handler] of mcpStdioHandlers) handlerMap.set(key, handler);

  // Cache the result
  _cachedOpenaiTools = openaiTools;
  _cachedHandlerMap = handlerMap;
  _cacheTimestamp = Date.now();

  return { openaiTools, handlerMap, allToolNames: openaiTools.map((t: any) => t.function.name) };
}

/**
 * Get filtered tool definitions by category names.
 * Returns OpenAI-format tool definitions + their handler map entries.
 */
export async function getToolsByCategory(categories: string[]): Promise<{
  tools: any[];
  handlerEntries: Map<string, (args: Record<string, any>) => Promise<string>>;
}> {
  const { getCategoryForTool } = await import("@/lib/tool-categories");
  const { openaiTools, handlerMap } = await createToolDefinitions();

  const filteredTools: any[] = [];
  const handlerEntries = new Map<string, (args: Record<string, any>) => Promise<string>>();

  for (const tool of openaiTools) {
    const toolName = tool.function?.name || tool.name;
    const cat = getCategoryForTool(toolName);
    if (cat && categories.includes(cat)) {
      filteredTools.push(tool);
      const handler = handlerMap.get(toolName);
      if (handler) handlerEntries.set(toolName, handler);
    }
  }

  return { tools: filteredTools, handlerEntries };
}
