// ── MCP Client ──
// Wraps the platform's MCP tools (mcp_call_tool, mcp_list_tools) with
// discovery, caching, error handling, and retry logic.
// Inspired by lastmile-ai/mcp-agent's client_proxy + aggregator

import { getRegistry, type MCPTool, type MCPToolCallResult } from "./registry";

// Re-export types for downstream consumers
export type { MCPTool, MCPToolCallResult } from "./registry";

// ── Tool Discovery ──

/**
 * Discover tools from a specific MCP server.
 * Uses platform's mcp_list_tools under the hood.
 */
export async function discoverServerTools(serverName: string): Promise<MCPTool[]> {
  const registry = getRegistry();
  const config = registry.getServerConfig(serverName);

  if (!config) {
    throw new Error(`Server "${serverName}" not found in registry`);
  }

  if (!config.enabled) {
    throw new Error(`Server "${serverName}" is disabled`);
  }

  try {
    // Call the platform's mcp_list_tools
    const response = await callPlatformMCP("list_tools", serverName, {});
    const tools: MCPTool[] = (response.tools || []).map((t: any) => ({
      serverName,
      name: t.name,
      description: t.description || "",
      inputSchema: t.inputSchema || {},
    }));

    // Apply allowed_tools filter
    const filteredTools = config.allowedTools
      ? tools.filter(t => config.allowedTools!.includes(t.name))
      : tools;

    registry.cacheTools(serverName, filteredTools);
    console.log(`[mcp-client] Discovered ${filteredTools.length} tools from "${serverName}"`);

    return filteredTools;
  } catch (err: any) {
    registry.recordError(serverName, err.message);
    console.error(`[mcp-client] Failed to discover tools from "${serverName}":`, err.message);
    return [];
  }
}

/**
 * Discover tools from ALL enabled servers.
 */
export async function discoverAllTools(): Promise<MCPTool[]> {
  const registry = getRegistry();
  const servers = registry.getEnabledServers();

  const results = await Promise.allSettled(
    servers.map(s => discoverServerTools(s.name))
  );

  const allTools: MCPTool[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      allTools.push(...result.value);
    }
  }

  return allTools;
}

/**
 * Get all cached tools (no network calls).
 */
export function getAllTools(): MCPTool[] {
  return getRegistry().getAllCachedTools();
}

// ── Tool Calling ──

/**
 * Call a specific tool on an MCP server.
 */
export async function callTool(
  serverName: string,
  toolName: string,
  args: Record<string, any> = {},
  retries = 2
): Promise<MCPToolCallResult> {
  const start = Date.now();

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await callPlatformMCP("call_tool", serverName, {
        toolName,
        toolArgs: args,
      });

      return {
        serverName,
        toolName,
        result: response.result,
        durationMs: Date.now() - start,
      };
    } catch (err: any) {
      if (attempt === retries) {
        getRegistry().recordError(serverName, err.message);
        return {
          serverName,
          toolName,
          result: null,
          error: err.message,
          durationMs: Date.now() - start,
        };
      }
      // Exponential backoff
      await sleep(1000 * Math.pow(2, attempt));
    }
  }

  // Unreachable but TypeScript needs it
  return {
    serverName,
    toolName,
    result: null,
    error: "Max retries exceeded",
    durationMs: Date.now() - start,
  };
}

/**
 * Auto-route a tool call to the correct server based on cached tool discovery.
 */
export async function callToolAuto(
  toolName: string,
  args: Record<string, any> = {}
): Promise<MCPToolCallResult> {
  const allTools = getAllTools();
  const match = allTools.find(t => t.name === toolName);

  if (!match) {
    return {
      serverName: "unknown",
      toolName,
      result: null,
      error: `Tool "${toolName}" not found in any connected MCP server`,
      durationMs: 0,
    };
  }

  return callTool(match.serverName, toolName, args);
}

/**
 * Call multiple tools in parallel (fan-out).
 */
export async function callToolsParallel(
  calls: Array<{ serverName: string; toolName: string; args?: Record<string, any> }>
): Promise<MCPToolCallResult[]> {
  return Promise.all(
    calls.map(c => callTool(c.serverName, c.toolName, c.args))
  );
}

/**
 * Call tools sequentially (pipeline).
 */
export async function callToolsSequential(
  calls: Array<{ serverName: string; toolName: string; args?: Record<string, any>; transform?: (result: any) => any }>
): Promise<MCPToolCallResult[]> {
  const results: MCPToolCallResult[] = [];
  let context: any = undefined;

  for (const call of calls) {
    const args = { ...(call.args || {}), _context: context };
    const result = await callTool(call.serverName, call.toolName, args);
    results.push(result);

    if (result.error) break;
    context = call.transform ? call.transform(result.result) : result.result;
  }

  return results;
}

// ── OpenAI Compatibility ──

/**
 * Convert cached MCP tools to OpenAI function-calling format.
 */
export function toOpenAITools(tools?: MCPTool[]): any[] {
  const source = tools || getAllTools();
  return source.map(t => ({
    type: "function",
    function: {
      name: `mcp_${t.serverName}_${t.name}`,
      description: `[MCP:${t.serverName}] ${t.description}`,
      parameters: t.inputSchema || { type: "object", properties: {} },
    },
  }));
}

/**
 * Create a handler map for MCP tools (OpenAI-compatible).
 */
export function createMCPToolHandlers(): Map<string, (args: Record<string, any>) => Promise<string>> {
  const map = new Map<string, (args: Record<string, any>) => Promise<string>>();
  const tools = getAllTools();

  for (const tool of tools) {
    const key = `mcp_${tool.serverName}_${tool.name}`;
    map.set(key, async (args) => {
      const result = await callTool(tool.serverName, tool.name, args);
      if (result.error) return `Error: ${result.error}`;
      return typeof result.result === "string" ? result.result : JSON.stringify(result.result);
    });
  }

  return map;
}

// ── Internal Helpers ──

async function callPlatformMCP(action: string, serverName: string, params: any): Promise<any> {
  // In the platform environment, these are available as global tools
  // When running standalone, we'd need to spawn the MCP server process
  if (typeof globalThis !== "undefined" && (globalThis as any).__mcp_tools) {
    const tools = (globalThis as any).__mcp_tools;
    if (action === "list_tools") return await tools.list_tools({ serverName });
    if (action === "call_tool") return await tools.call_tool({ serverName, ...params });
  }

  // Fallback: try spawning via child_process
  const { execSync } = require("child_process");
  const config = getRegistry().getServerConfig(serverName);
  if (!config) throw new Error(`Server "${serverName}" not found`);

  if (action === "list_tools") {
    // For stdio servers, we can't easily query without MCP SDK
    // Return cached tools if available
    const cached = getRegistry().getCachedTools(serverName);
    if (cached) return { tools: cached };
    throw new Error("No cached tools and platform MCP tools not available");
  }

  throw new Error(`Platform MCP tools not available for action: ${action}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
