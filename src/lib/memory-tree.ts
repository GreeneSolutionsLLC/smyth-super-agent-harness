// ── Memory Tree — Graph-structured knowledge (markdown-based)
// Inspired by OpenHuman's tinycortex::memory::tree.
//
// Knowledge stored as linked markdown files with YAML frontmatter.
// Each node can have: parent, children, related nodes.
// Supports BFS traversal, "cover" (summarize a subtree), and keyword search.
//
// FEATURE FLAG: Only runs when ENABLE_MEMORY_TREE=true
// Storage: memory/tree/<category>/<slug>.md
//
// Usage:
//   await createNode("architecture", {
//     title: "TokenJuice",
//     content: "Content-aware compression...",
//     tags: ["compression", "tokens"],
//     parent: "context-management",
//     related: ["microcompact"],
//   });
//   const cover = await getCover("architecture", 2); // summarize 2 levels deep

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, dirname, basename } from "path";
import { getWorkspacePath } from "@/lib/env";

const WORKSPACE = getWorkspacePath();
const TREE_DIR = join(WORKSPACE, "memory", "tree");

interface TreeNode {
  slug: string;
  category: string;
  title: string;
  content: string;
  tags: string[];
  parent?: string;
  children: string[];
  related: string[];
  created: string;
  updated: string;
  depth: number;
}

// ── Ensure directories ──
function ensureCategoryDir(category: string) {
  const dir = join(TREE_DIR, category);
  try { mkdirSync(dir, { recursive: true }); } catch {}
  return dir;
}

function getNodePath(category: string, slug: string): string {
  return join(TREE_DIR, category, `${slug}.md`);
}

// ── Serialize node to markdown ──
function nodeToMarkdown(node: TreeNode): string {
  const fm = [
    "---",
    `slug: ${node.slug}`,
    `title: "${node.title.replace(/"/g, '\\"')}"`,
    `category: ${node.category}`,
    `depth: ${node.depth}`,
    `tags: [${node.tags.map(t => `"${t}"`).join(", ")}]`,
    `parent: ${node.parent ? `"${node.parent}"` : "null"}`,
    `children: [${node.children.map(c => `"${c}"`).join(", ")}]`,
    `related: [${node.related.map(r => `"${r}"`).join(", ")}]`,
    `created: ${node.created}`,
    `updated: ${node.updated}`,
    "---",
    "",
    node.content,
  ].join("\n");
  return fm;
}

// ── Parse markdown to node ──
function markdownToNode(filepath: string, raw: string): TreeNode | null {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;

  const fm = parseFrontmatter(match[1]);
  const category = dirname(filepath).split("/").pop() || "general";

  return {
    slug: fm.slug || basename(filepath, ".md"),
    category,
    title: fm.title || "Untitled",
    content: match[2].trim(),
    tags: Array.isArray(fm.tags) ? fm.tags : [],
    parent: fm.parent || undefined,
    children: Array.isArray(fm.children) ? fm.children : [],
    related: Array.isArray(fm.related) ? fm.related : [],
    created: fm.created || new Date().toISOString(),
    updated: fm.updated || new Date().toISOString(),
    depth: typeof fm.depth === "number" ? fm.depth : 0,
  };
}

function parseFrontmatter(text: string): Record<string, any> {
  const result: Record<string, any> = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^([\w]+):\s*(.*)$/);
    if (!m) continue;
    const [, key, val] = m;
    const trimmed = val.trim();
    if (trimmed === "null" || trimmed === "undefined") {
      result[key] = null;
    } else if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try { result[key] = JSON.parse(trimmed); } catch { result[key] = trimmed; }
    } else if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
      result[key] = trimmed.slice(1, -1);
    } else if (/^-?\d+$/.test(trimmed)) {
      result[key] = parseInt(trimmed, 10);
    } else {
      result[key] = trimmed;
    }
  }
  return result;
}

// ── Create or update a node ──
export async function createNode(
  category: string,
  data: {
    slug: string;
    title: string;
    content: string;
    tags?: string[];
    parent?: string;
    related?: string[];
  }
): Promise<string> {
  if (process.env.ENABLE_MEMORY_TREE !== "true") return "disabled";

  ensureCategoryDir(category);
  const filepath = getNodePath(category, data.slug);
  const now = new Date().toISOString();

  // Load existing if present
  let existing: TreeNode | null = null;
  if (existsSync(filepath)) {
    try {
      existing = markdownToNode(filepath, readFileSync(filepath, "utf-8"));
    } catch {}
  }

  // Compute depth from parent
  let depth = 0;
  if (data.parent) {
    const parentPath = getNodePath(category, data.parent);
    if (existsSync(parentPath)) {
      const parentNode = markdownToNode(parentPath, readFileSync(parentPath, "utf-8"));
      if (parentNode) depth = parentNode.depth + 1;
    }
  }

  const node: TreeNode = {
    slug: data.slug,
    category,
    title: data.title,
    content: data.content,
    tags: data.tags || [],
    parent: data.parent,
    children: existing?.children || [],
    related: data.related || existing?.related || [],
    created: existing?.created || now,
    updated: now,
    depth,
  };

  // If parent specified, add this node as child of parent
  if (data.parent) {
    const parentPath = getNodePath(category, data.parent);
    if (existsSync(parentPath)) {
      const parentRaw = readFileSync(parentPath, "utf-8");
      const parentNode = markdownToNode(parentPath, parentRaw);
      if (parentNode && !parentNode.children.includes(data.slug)) {
        parentNode.children.push(data.slug);
        writeFileSync(parentPath, nodeToMarkdown(parentNode), "utf-8");
      }
    }
  }

  writeFileSync(filepath, nodeToMarkdown(node), "utf-8");
  return filepath;
}

// ── Get a single node ──
export async function getNode(category: string, slug: string): Promise<TreeNode | null> {
  if (process.env.ENABLE_MEMORY_TREE !== "true") return null;

  const filepath = getNodePath(category, slug);
  if (!existsSync(filepath)) return null;
  try {
    const raw = readFileSync(filepath, "utf-8");
    return markdownToNode(filepath, raw);
  } catch {
    return null;
  }
}

// ── BFS traversal from a root node ──
export async function traverseBFS(
  category: string,
  rootSlug: string,
  maxDepth: number = 3
): Promise<TreeNode[]> {
  if (process.env.ENABLE_MEMORY_TREE !== "true") return [];

  const result: TreeNode[] = [];
  const visited = new Set<string>();
  const queue: Array<{ slug: string; depth: number }> = [{ slug: rootSlug, depth: 0 }];

  while (queue.length > 0) {
    const { slug, depth } = queue.shift()!;
    if (visited.has(slug) || depth > maxDepth) continue;
    visited.add(slug);

    const node = await getNode(category, slug);
    if (!node) continue;
    result.push(node);

    for (const childSlug of node.children) {
      queue.push({ slug: childSlug, depth: depth + 1 });
    }
  }

  return result;
}

// ── Get "cover" (summary of a subtree) ──
export async function getCover(
  category: string,
  rootSlug: string,
  maxDepth: number = 2
): Promise<{ title: string; summary: string; nodes: number; keyPoints: string[] }> {
  if (process.env.ENABLE_MEMORY_TREE !== "true") {
    return { title: "", summary: "Memory tree disabled", nodes: 0, keyPoints: [] };
  }

  const nodes = await traverseBFS(category, rootSlug, maxDepth);
  if (nodes.length === 0) {
    return { title: rootSlug, summary: "No nodes found", nodes: 0, keyPoints: [] };
  }

  const root = nodes[0];
  const keyPoints = nodes
    .slice(1)
    .map(n => `${n.title}: ${n.content.slice(0, 120)}${n.content.length > 120 ? "..." : ""}`);

  return {
    title: root.title,
    summary: root.content.slice(0, 500),
    nodes: nodes.length,
    keyPoints: keyPoints.slice(0, 10),
  };
}

// ── Search nodes by keyword ──
export async function searchTree(
  query: string,
  options: { category?: string; limit?: number } = {}
): Promise<Array<{ node: TreeNode; score: number }>> {
  if (process.env.ENABLE_MEMORY_TREE !== "true") return [];

  const limit = options.limit || 10;
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  if (words.length === 0) return [];

  const results: Array<{ node: TreeNode; score: number }> = [];

  const categories = options.category
    ? [options.category]
    : readdirSync(TREE_DIR).filter(d => statSync(join(TREE_DIR, d)).isDirectory());

  for (const cat of categories) {
    const catDir = join(TREE_DIR, cat);
    if (!existsSync(catDir)) continue;
    const files = readdirSync(catDir).filter(f => f.endsWith(".md"));

    for (const file of files) {
      const filepath = join(catDir, file);
      try {
        const raw = readFileSync(filepath, "utf-8");
        const node = markdownToNode(filepath, raw);
        if (!node) continue;

        let score = 0;
        const searchable = (node.title + " " + node.content + " " + node.tags.join(" ")).toLowerCase();
        for (const word of words) {
          if (searchable.includes(word)) score++;
        }
        if (score > 0) {
          results.push({ node, score });
        }
      } catch {}
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

// ── List all nodes in a category ──
export async function listCategory(category: string): Promise<TreeNode[]> {
  if (process.env.ENABLE_MEMORY_TREE !== "true") return [];

  const catDir = join(TREE_DIR, category);
  if (!existsSync(catDir)) return [];

  const nodes: TreeNode[] = [];
  for (const file of readdirSync(catDir).filter(f => f.endsWith(".md"))) {
    try {
      const raw = readFileSync(join(catDir, file), "utf-8");
      const node = markdownToNode(join(catDir, file), raw);
      if (node) nodes.push(node);
    } catch {}
  }
  return nodes.sort((a, b) => a.depth - b.depth || a.title.localeCompare(b.title));
}

// ── Seed the tree with initial knowledge ──
export async function seedInitialKnowledge(): Promise<void> {
  if (process.env.ENABLE_MEMORY_TREE !== "true") return;

  const knowledge = [
    {
      category: "architecture",
      slug: "agent-loop",
      title: "Agent Tool Loop",
      content: "Core execution pattern: send messages to LLM, parse tool_calls, execute handlers, feed results back. Repeat until final answer or max turns.",
      tags: ["core", "execution"],
      children: ["middleware", "context-compaction"],
    },
    {
      category: "architecture",
      slug: "middleware",
      title: "Middleware Stack",
      content: "Pre/post hooks around tool execution. Provides retries, circuit breaker, no-progress detection, telemetry logging.",
      tags: ["middleware", "reliability"],
      parent: "agent-loop",
    },
    {
      category: "architecture",
      slug: "context-compaction",
      title: "Context Compaction",
      content: "Multiple layers: TokenJuice (content-aware compression), Microcompact (clear old tool bodies), ContextCompactor (turn protector).",
      tags: ["compression", "tokens", "context"],
      parent: "agent-loop",
    },
    {
      category: "architecture",
      slug: "memory",
      title: "Memory System",
      content: "Three layers: Session JSON (ephemeral), Episodic Memory (auto-archive per turn), Memory Tree (graph-structured knowledge).",
      tags: ["memory", "persistence"],
      children: ["episodic-memory", "memory-tree"],
    },
    {
      category: "architecture",
      slug: "episodic-memory",
      title: "Episodic Memory",
      content: "Auto-archives every turn to memory/episodic/ with YAML frontmatter (timestamp, tools, tokens, outcome). Keyword-searchable.",
      tags: ["memory", "archive"],
      parent: "memory",
    },
    {
      category: "architecture",
      slug: "memory-tree",
      title: "Memory Tree",
      content: "Graph-structured knowledge with parent/child/related links. Markdown files with YAML frontmatter. Supports BFS traversal and cover summaries.",
      tags: ["memory", "graph", "tree"],
      parent: "memory",
    },
    {
      category: "architecture",
      slug: "tokenjuice",
      title: "TokenJuice",
      content: "Content-aware compression for tool results. Detects JSON, logs, code, diff, HTML. Applies domain-specific shrinking.",
      tags: ["compression", "tokens"],
      related: ["microcompact", "context-compaction"],
    },
    {
      category: "architecture",
      slug: "microcompact",
      title: "Microcompact",
      content: "Clears old tool-result bodies while keeping structure. 'Tool X returned [CLEARED: 45KB]'. Keeps last N results in full.",
      tags: ["compression", "context"],
      related: ["tokenjuice", "context-compaction"],
    },
  ];

  for (const item of knowledge) {
    await createNode(item.category, {
      slug: item.slug,
      title: item.title,
      content: item.content,
      tags: item.tags,
      related: item.related,
    });
  }

  // Now wire up parent/child relationships
  for (const item of knowledge) {
    if (item.parent) {
      await createNode(item.category, {
        slug: item.slug,
        title: item.title,
        content: item.content,
        tags: item.tags,
        parent: item.parent,
        related: item.related,
      });
    }
  }
}
