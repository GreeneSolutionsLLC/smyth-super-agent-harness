// ── Smyth Share — Stop route ──

import { NextResponse } from "next/server";
import { stopShareServer } from "@/lib/share-server";

export async function POST() {
  await stopShareServer();
  return NextResponse.json({ running: false });
}
