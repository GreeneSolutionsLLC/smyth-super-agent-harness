import { NextRequest, NextResponse } from "next/server";
import {
  getAllEventTypes,
  getEventTypeBySlug,
  createEventType,
} from "@/lib/bookings-db";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get("slug");

  if (slug) {
    const eventType = getEventTypeBySlug(slug);
    if (!eventType) {
      return NextResponse.json({ error: "Event type not found" }, { status: 404 });
    }
    return NextResponse.json({ eventType });
  }

  const types = getAllEventTypes().filter((et) => !et.hidden);
  return NextResponse.json({ eventTypes: types });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, slug, description, lengthMinutes, color, locations } = body;

    if (!title || !slug || !lengthMinutes) {
      return NextResponse.json(
        { error: "title, slug, and lengthMinutes are required" },
        { status: 400 }
      );
    }

    const eventType = createEventType({
      title,
      slug,
      description,
      lengthMinutes,
      color: color || "#4F46E5",
      locations,
    });

    return NextResponse.json({ eventType }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to create event type" },
      { status: 500 }
    );
  }
}
