/**
 * Velorn MCP Client
 * Connects Smyth's agent to Velorn's built-in MCP server via Next.js API proxy
 * (avoids CORS issues — Velorn only allows 127.0.0.1 origin)
 */

const PROXY_URL = '/api/velorn';

export interface McpToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

/**
 * Send a raw MCP request through the proxy
 */
async function mcpRequest(method: string, params: Record<string, unknown> = {}): Promise<any> {
  try {
    const res = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method,
        params,
      }),
      signal: AbortSignal.timeout(30000),
    });
    return await res.json();
  } catch (err: any) {
    return { error: { message: err.message || 'Connection failed' } };
  }
}

/**
 * Check if Velorn's MCP server is reachable
 */
export async function isVelornConnected(): Promise<boolean> {
  try {
    const res = await fetch('/api/velorn', { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    return data.connected === true;
  } catch {
    return false;
  }
}

/**
 * Call a Velorn MCP tool
 */
export async function callVelornTool(
  name: string,
  args: Record<string, unknown> = {}
): Promise<McpToolResult> {
  const data = await mcpRequest('tools/call', { name, arguments: args });
  if (data.error) {
    return { content: [{ type: 'text', text: `Error: ${data.error.message}` }], isError: true };
  }
  return data.result || { content: [{ type: 'text', text: 'No result' }] };
}

/**
 * List available Velorn tools
 */
export async function listVelornTools(): Promise<string[]> {
  const data = await mcpRequest('tools/list', {});
  return (data.result?.tools || []).map((t: any) => t.name);
}

// === Convenience wrappers ===

export async function createProject(name: string, width = 1920, height = 1080, fps = 24) {
  return callVelornTool('create_project', { name, width, height, fps });
}

export async function importAsset(filePath: string) {
  return callVelornTool('import_asset_from_path', { path: filePath });
}

export async function addClipToTimeline(trackId: string, assetId: string, startTime?: number, duration?: number) {
  return callVelornTool('add_asset_to_timeline', {
    trackId, assetId,
    ...(startTime != null && { startTime }),
    ...(duration != null && { duration }),
  });
}

export async function setPlayhead(position: number) {
  return callVelornTool('set_playhead', { position });
}

export async function undo() {
  return callVelornTool('undo');
}

export async function redo() {
  return callVelornTool('redo');
}

export async function exportProject(format = 'mp4') {
  return callVelornTool('export_project', { format });
}
