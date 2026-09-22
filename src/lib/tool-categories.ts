// ── Tool Category Registry ──
// Maps tool name prefixes to categories for lazy loading.
// The request_tools meta-tool uses these categories to inject
// only the relevant tool definitions when the model needs them.

export type ToolCategory =
  | "email"
  | "crm"
  | "social"
  | "video"
  | "scraping"
  | "shell"
  | "files"
  | "design"
  | "screen"
  | "web"
  | "planning"
  | "webcam"
  | "canva"
  | "mcp"
  | "media"
  | "system"
  | "macos";

export interface CategoryDef {
  name: ToolCategory;
  description: string;
  // Prefixes or exact tool names that belong to this category
  toolMatchers: string[];
  // Human-readable examples of when to request this category
  examples: string;
}

export const TOOL_CATEGORIES: CategoryDef[] = [
  {
    name: "email",
    description: "Email inbox management — check, read, send, reply, forward messages",
    toolMatchers: ["email_"],
    examples: "check inbox, read email, send message, reply to email",
  },
  {
    name: "crm",
    description: "CRM operations — manage contacts, deals, pipeline, Twenty CRM",
    toolMatchers: ["crm_", "mcp_twenty"],
    examples: "find contacts, manage deals, CRM lookup",
  },
  {
    name: "social",
    description: "Social media scheduling via Zernio — create/list/delete posts, analytics, channels",
    toolMatchers: ["zernio_"],
    examples: "schedule a post, list social posts, check analytics",
  },
  {
    name: "video",
    description: "Video production — init/build/render projects, editing, Velorn, OpenCut, video info",
    toolMatchers: ["video_", "velorn", "opencut_", "mcp_velorn"],
    examples: "create video, edit timeline, render project, add text overlay",
  },
  {
    name: "scraping",
    description: "Web scraping — URL scraping, sitemap crawling, browser automation, bulk scraping",
    toolMatchers: ["scrape_"],
    examples: "scrape a website, crawl sitemap, extract page content",
  },
  {
    name: "shell",
    description: "Shell/terminal commands — run, status, kill processes",
    toolMatchers: ["shell", "shell_status", "shell_kill"],
    examples: "run a command, execute script, check process status",
  },
  {
    name: "files",
    description: "File operations — read, write, list files and directories, transcribe audio files",
    toolMatchers: ["read_file", "write_file", "list_files", "transcribe_audio"],
    examples: "read a file, write content, list directory contents",
  },
  {
    name: "design",
    description: "Design tools — brand analysis, design systems, templates, critiques",
    toolMatchers: ["design_"],
    examples: "analyze brand, generate design system, list templates, critique design",
  },
  {
    name: "screen",
    description: "Screen capture — screenshots, window listing, screen capture",
    toolMatchers: ["screen_", "screenshot"],
    examples: "take a screenshot, list windows, capture screen",
  },
  {
    name: "web",
    description: "Web search, browsing, and research — browser navigation (Robbi Operator Browser/Chromium), Google search, deep research, fetch URLs. Full browser automation via CDP.",
    toolMatchers: ["web_search", "deep_research", "web_fetch", "browser_navigate", "browser_search"],
    examples: "search the web, browse a URL, read a GitHub repo, research a topic, fetch a URL",
  },
  {
    name: "planning",
    description: "Planning and task breakdown — structured project planning",
    toolMatchers: ["planning"],
    examples: "plan a project, break down tasks, create roadmap",
  },
  {
    name: "webcam",
    description: "Webcam capture and monitoring — capture frames, continuous watch",
    toolMatchers: ["webcam_"],
    examples: "capture webcam, watch webcam feed",
  },
  {
    name: "canva",
    description: "Canva design operations — list/create/export designs, browse templates",
    toolMatchers: ["canva_", "mcp_canva"],
    examples: "list Canva designs, create design, export design, browse templates",
  },
  {
    name: "macos",
    description: "Native macOS desktop automation — control apps, UI elements, keyboard/mouse, screen capture, AppleScript, window management",
    toolMatchers: ["mcp_macos_"],
    examples: "open Safari, click a button, type text, take a screenshot, run AppleScript, manage windows",
  },
  {
    name: "mcp",
    description: "MCP protocol tools — call MCP tools, list available MCP tools",
    toolMatchers: ["mcp_call_tool", "mcp_list_tools", "mcp_"],
    examples: "call MCP tool, list MCP capabilities",
  },
  {
    name: "media",
    description: "Media generation — images, video, audio, TTS, scripts",
    toolMatchers: ["generate_image", "generate_video", "speak_text", "watch_video", "search_scripts", "run_script"],
    examples: "generate image, create video, speak text, run a script",
  },
  {
    name: "system",
    description: "System tools — shell, files, screen, planning, web — basic operational tools",
    toolMatchers: ["read_file", "write_file", "list_files", "transcribe_audio", "shell", "shell_status", "shell_kill", "planning", "screenshot", "screen_"],
    examples: "read/write files, run commands, take screenshots, plan tasks",
  },
];

// Build a quick lookup: toolName → category
const toolToCategory = new Map<string, ToolCategory>();
for (const cat of TOOL_CATEGORIES) {
  for (const matcher of cat.toolMatchers) {
    // We'll match by prefix at runtime, but store for exact matches
    toolToCategory.set(matcher, cat.name);
  }
}

/**
 * Given a tool name, return which category it belongs to.
 * Uses prefix matching (e.g. "email_check_inbox" matches "email_" prefix).
 */
export function getCategoryForTool(toolName: string): ToolCategory | null {
  // Check exact matches first
  if (toolToCategory.has(toolName)) {
    return toolToCategory.get(toolName)!;
  }
  // Check prefix matches
  for (const cat of TOOL_CATEGORIES) {
    for (const matcher of cat.toolMatchers) {
      if (toolName.startsWith(matcher) || toolName === matcher) {
        return cat.name;
      }
    }
  }
  return null;
}

/**
 * Given a category name, return all tool names that belong to it.
 * Works against the full list of tool names from the registry.
 */
export function getToolNamesForCategory(category: ToolCategory, allToolNames: string[]): string[] {
  const cat = TOOL_CATEGORIES.find(c => c.name === category);
  if (!cat) return [];
  return allToolNames.filter(name =>
    cat.toolMatchers.some(matcher => name.startsWith(matcher) || name === matcher)
  );
}

/**
 * The request_tools meta-tool definition (OpenAI format).
 * This is the ONLY tool always included in every payload.
 * ~60 tokens — negligible overhead.
 */
export const REQUEST_TOOLS_DEFINITION = {
  type: "function" as const,
  function: {
    name: "request_tools",
    description: `Request tool access for a specific category. Call this FIRST when you need to use any tool — before attempting to use it directly. Your system prompt describes all available capabilities, but tools are loaded on demand to save resources.

Available categories:
${TOOL_CATEGORIES.map(c => `  - "${c.name}": ${c.description} (e.g. ${c.examples})`).join("\n")}

Usage: Call this with the category name, then the system will load those tools and you can use them in your next response. You can request multiple categories at once by passing an array.`,
    parameters: {
      type: "object",
      properties: {
        categories: {
          type: "array",
          items: {
            type: "string",
            enum: TOOL_CATEGORIES.map(c => c.name),
            description: "Tool categories to load",
          },
          description: "Array of tool category names to request (e.g. [\"email\", \"crm\"])",
        },
      },
      required: ["categories"],
    },
  },
};

/**
 * Get the list of all category names for quick reference.
 */
export function getAllCategoryNames(): string[] {
  return TOOL_CATEGORIES.map(c => c.name);
}

/**
 * Build a compact capability manifest for the system prompt.
 * Takes the live tool registry (allToolNames) and produces a per-category
 * listing of actual tool names so the model knows exactly what it can call
 * after request_tools returns — no guessing, no panic loops.
 *
 * Format per line: `- <category>: tool_a, tool_b, tool_c (…+N more)`
 * Capped at ~6 names per category so the prompt stays under ~400 tokens.
 */
export function buildCapabilityManifest(allToolNames: string[]): string {
  const lines: string[] = [];
  for (const cat of TOOL_CATEGORIES) {
    const names = getToolNamesForCategory(cat.name, allToolNames);
    if (names.length === 0) continue;
    const shown = names.slice(0, 6);
    const extra = names.length - shown.length;
    const suffix = extra > 0 ? ` …+${extra} more` : "";
    lines.push(`- ${cat.name}: ${shown.join(", ")}${suffix}`);
  }
  return lines.join("\n");
}