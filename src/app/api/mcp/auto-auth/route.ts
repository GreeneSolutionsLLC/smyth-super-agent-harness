import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

// 2026-08-22: per-server "auto-auth on token expiry" kill switch.
// Rob can flip a server's autoAuth to false in the MCP status panel
// and the system will never pop the OAuth browser. When he wants to
// re-auth, he toggles it back on and clicks Reconnect.

const AUTO_AUTH_FILE = path.join(process.cwd(), ".mcp-auto-auth.json");

type Map = Record<string, { autoAuth: boolean }>;

function readMap(): Map {
  try {
    if (fs.existsSync(AUTO_AUTH_FILE)) {
      return JSON.parse(fs.readFileSync(AUTO_AUTH_FILE, "utf-8"));
    }
  } catch (err) {
    console.warn("[mcp/auto-auth] read failed:", err);
  }
  return {};
}

function writeMap(map: Map): void {
  try {
    fs.writeFileSync(AUTO_AUTH_FILE, JSON.stringify(map, null, 2));
  } catch (err: any) {
    console.warn("[mcp/auto-auth] write failed:", err.message);
  }
}

// GET /api/mcp/auto-auth       → { "<server>": { autoAuth: bool } }
export async function GET() {
  return NextResponse.json(readMap());
}

// PATCH /api/mcp/auto-auth
// Body: { serverName: string, autoAuth: boolean }
export async function PATCH(req: NextRequest) {
  try {
    const { serverName, autoAuth } = await req.json();
    if (!serverName || typeof autoAuth !== "boolean") {
      return NextResponse.json(
        { error: "Missing serverName or autoAuth (boolean)" },
        { status: 400 },
      );
    }
    const map = readMap();
    map[serverName] = { autoAuth };
    writeMap(map);
    // 2026-08-22: bust the /api/mcp/status cache so the panel reflects
    // the new toggle state within the next 5s window (no manual refresh).
    try {
      const { revalidatePath } = await import("next/cache");
      revalidatePath("/api/mcp/status");
    } catch {}
    return NextResponse.json({ ok: true, serverName, autoAuth });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
