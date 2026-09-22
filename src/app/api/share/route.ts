import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ error: "Use /api/share/start or /api/share/status" }, { status: 400 });
}

export async function POST() {
  return NextResponse.json({ error: "Use /api/share/start or /api/share/stop" }, { status: 400 });
}
