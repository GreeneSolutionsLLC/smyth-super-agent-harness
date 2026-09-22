// ── MCP Merge Helpers ──
// Utility functions to merge MCP tools with other tool arrays.

import type { ToolHandler } from "@/lib/tools";
import { mcpTools } from "./tools";
import { toOpenAITools, createMCPToolHandlers } from "./client";
import type { MCPTool } from "./registry";

/**
 * Merge MCP tool definitions into an existing array of OpenAI-format tools.
 * Returns a new array with MCP tools appended.
 */
export function mergeMCPTools(
  existingTools: any[],
  mcpServerTools?: MCPTool[]
): any[] {
  const mcpOpenAITools = toOpenAITools(mcpServerTools);
  return [...existingTools, ...mcpOpenAITools];
}

/**
 * Get all MCP tool handlers as a Map (name → handler function),
 * suitable for merging into a handler map.
 */
export function getMCPTools(): Map<string, (args: Record<string, any>) => Promise<string>> {
  return createMCPToolHandlers();
}