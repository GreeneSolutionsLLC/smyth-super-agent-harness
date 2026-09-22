import { NextRequest, NextResponse } from "next/server";

/**
 * MCP Bridge — lists all available MCP tools across all servers.
 * Used by the Smyth UI to show what MCP tools are available.
 */

export const maxDuration = 60;

// Cache the tool list for 5 minutes to avoid repeated discovery
let cachedTools: any[] | null = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ── List all available MCP tools ──
export async function GET() {
  try {
    // Return cached result if fresh
    if (cachedTools && Date.now() - cacheTime < CACHE_TTL) {
      return NextResponse.json({ tools: cachedTools, cached: true });
    }

    const { createToolDefinitions, isMcpDiscoverySettled } = await import("@/lib/tools");
    const { openaiTools } = await createToolDefinitions().catch(() => ({ openaiTools: [] }));
    
    // Filter to only MCP tools (they start with mcp_)
    const mcpTools = openaiTools
      .filter((t: any) => t.function?.name?.startsWith("mcp_"))
      .map((t: any) => ({
        name: t.function.name,
        description: t.function.description,
      }));
    
    // 2026-09-09: only populate the 5-min cache once background MCP discovery
    // has settled. Previously the first call after a module reload cached a
    // pre-discovery (near-empty) list for 5 minutes.
    if (isMcpDiscoverySettled?.()) {
      cachedTools = mcpTools;
      cacheTime = Date.now();
    }
    
    return NextResponse.json({ tools: mcpTools });
  } catch (error: any) {
    return NextResponse.json(
      { error: `Failed to list MCP tools: ${error.message}` },
      { status: 500 }
    );
  }
}

// ── Call an MCP tool by name ──
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tool, args } = body;

    if (!tool) {
      return NextResponse.json({ error: "Missing 'tool' parameter" }, { status: 400 });
    }

    const { createToolDefinitions } = await import("@/lib/tools");
    const { handlerMap } = await createToolDefinitions().catch(() => ({ handlerMap: new Map() }));
    
    const handler = handlerMap.get(tool);
    if (!handler) {
      return NextResponse.json({ error: `Unknown MCP tool: ${tool}` }, { status: 404 });
    }
    
    const result = await handler(args || {});
    try {
      return NextResponse.json(JSON.parse(result));
    } catch {
      return NextResponse.json({ text: result });
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: `Failed to call MCP tool: ${error.message}` },
      { status: 500 }
    );
  }
}