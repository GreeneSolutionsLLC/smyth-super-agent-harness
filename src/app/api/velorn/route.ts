import { NextRequest, NextResponse } from 'next/server';

/**
 * API proxy to Velorn MCP server
 * Bypasses CORS by making the request server-side
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    const res = await fetch('http://127.0.0.1:19790/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json(
      { error: { message: err.message || 'Velorn MCP connection failed' } },
      { status: 502 }
    );
  }
}

export async function GET() {
  // Health check — is Velorn running?
  try {
    const res = await fetch('http://127.0.0.1:19790/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 0,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'smyth-health', version: '1.0.0' }
        }
      }),
      signal: AbortSignal.timeout(3000),
    });
    const data = await res.json();
    return NextResponse.json({ connected: true, server: data.result?.serverInfo });
  } catch {
    return NextResponse.json({ connected: false });
  }
}
