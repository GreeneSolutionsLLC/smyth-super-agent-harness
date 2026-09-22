/**
 * Web API for reading/writing individual env keys.
 * Used by the Settings → API Keys editor on non-Electron (web) installs.
 * Reads/writes the same user-scoped .env file the setup wizard uses.
 */

import { NextResponse } from "next/server";
import { readEnvFile, writeEnvFile } from "@/lib/env";
import { clearRuntimeEnvCache } from "@/lib/runtime-keys";

/** GET — return all env keys (values masked for secrets). */
export async function GET() {
  try {
    const env = await readEnvFile();
    // Mask values: show first 4 chars + "..." for keys that look like secrets.
    const masked: Record<string, string> = {};
    for (const [k, v] of Object.entries(env)) {
      if (v.length > 8 && /key|token|secret|password/i.test(k)) {
        masked[k] = v.slice(0, 4) + "•".repeat(Math.min(v.length - 4, 20));
      } else {
        masked[k] = v;
      }
    }
    return NextResponse.json({ env: masked });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Failed to read env." }, { status: 500 });
  }
}

/** POST — update a single env key. Body: { key: string, value: string } */
export async function POST(request: Request) {
  try {
    const { key, value } = await request.json();
    if (!key || typeof key !== "string") {
      return NextResponse.json({ error: "Missing key." }, { status: 400 });
    }
    await writeEnvFile({ [key]: value ?? "" });
    clearRuntimeEnvCache();
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Failed to save." }, { status: 500 });
  }
}
