// ── Smyth Share — Status route ──

import { NextResponse } from "next/server";
import { getShareStatus } from "@/lib/share-server";

export async function GET() {
  return NextResponse.json(getShareStatus());
}
