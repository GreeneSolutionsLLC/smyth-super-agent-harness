import { NextRequest, NextResponse } from "next/server";
import {
  getAllBookings,
  getBookingByUid,
  createBooking,
  updateBookingStatus,
  cancelBooking,
  EventType,
} from "@/lib/bookings-db";

// ── Booking Notifications ──

async function notifyNewBooking(booking: any) {
  try {
    const meetingUrl = `https://smythagentapp.greene-solutions.com${booking.locationUrl}`;
    const startDate = new Date(booking.startTime);
    const formattedTime = startDate.toLocaleString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "Asia/Saigon",
    });
    const endDate = new Date(booking.endTime);
    const formattedEnd = endDate.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "Asia/Saigon",
    });

    const message = `📅 **New Booking!**
${booking.attendeeName} (${booking.attendeeEmail}) booked *${booking.title}*
${formattedTime} – ${formattedEnd}

Join: ${meetingUrl}`;

    // Try to send via OpenClaw internal chat
    try {
      await fetch("http://127.0.0.1:18789/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: message,
          channel: "owner",
        }),
      });
    } catch {}

    // Also log it so it shows up in the dev server
    console.log("\n🔔 NEW BOOKING:", message, "\n");
  } catch {}
}

/**
 * Scheduling API — Bookings
 *
 * GET  /api/scheduling/bookings — list bookings
 * POST /api/scheduling/bookings — create booking
 * PATCH /api/scheduling/bookings — update booking status
 * DELETE /api/scheduling/bookings — cancel booking
 *
 * Data persisted to disk via bookings-db.ts
 */

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const uid = searchParams.get("uid");
  const status = searchParams.get("status");

  if (uid) {
    const booking = getBookingByUid(uid);
    if (!booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }
    return NextResponse.json({ booking });
  }

  let result = getAllBookings();

  if (status) {
    result = result.filter((b) => b.status === status);
  }

  // Return only today+future for the booking page
  // But all for the admin panel
  return NextResponse.json({ bookings: result, count: result.length });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      title,
      startTime,
      endTime,
      attendeeName,
      attendeeEmail,
      attendeePhone,
      description,
      location,
      eventTypeName,
      eventTypeColor,
      createdBy,
    } = body;

    if (!title || !startTime || !endTime || !attendeeName || !attendeeEmail) {
      return NextResponse.json(
        { error: "title, startTime, endTime, attendeeName, and attendeeEmail are required" },
        { status: 400 }
      );
    }

    const booking = createBooking({
      title,
      startTime,
      endTime,
      attendeeName,
      attendeeEmail,
      attendeePhone,
      description,
      location,
      eventTypeName,
      eventTypeColor,
      createdBy: createdBy || "public",
    });

    // Notify Rob — fire and forget
    notifyNewBooking(booking).catch(() => {});

    return NextResponse.json({ booking }, { status: 201 });
  } catch (err: any) {
    console.error("[scheduling/bookings] Error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to create booking" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, status } = body;

    if (!id || !status) {
      return NextResponse.json(
        { error: "id and status are required" },
        { status: 400 }
      );
    }

    const booking = updateBookingStatus(id, status);
    if (!booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    return NextResponse.json({ booking });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to update booking" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const success = cancelBooking(id);
    if (!success) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to cancel booking" },
      { status: 500 }
    );
  }
}