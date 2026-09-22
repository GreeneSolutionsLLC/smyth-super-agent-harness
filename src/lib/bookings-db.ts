/**
 * Bookings Database — persistent JSON file storage
 *
 * Replaces the in-memory demo store. All bookings saved to disk so they
 * survive server restarts. Writes are synchronous to avoid race conditions
 * on a single-user system (will move to SQLite when auth lands).
 */

import fs from "fs";
import path from "path";

// ═══════════════════════════════════════════
// Types
// ═══════════════════════════════════════════

export interface Booking {
  id: string;
  uid: string;
  title: string;
  description: string;
  status: "pending" | "confirmed" | "cancelled" | "rescheduled";
  startTime: string; // ISO
  endTime: string;   // ISO
  attendeeName: string;
  attendeeEmail: string;
  attendeePhone?: string;
  location: string;
  locationUrl: string;
  notes?: string;
  createdBy: "human" | "agent" | "public";
  eventTypeName: string;
  eventTypeColor: string;
  createdAt: string; // ISO
}

export interface EventType {
  id: string;
  slug: string;
  title: string;
  description?: string;
  lengthMinutes: number;
  color: string;
  hidden?: boolean;
  locations?: ("smyth_meeting" | "phone" | "in_person")[];
}

// ═══════════════════════════════════════════
// Storage
// ═══════════════════════════════════════════

const DATA_DIR = process.env.BOOKINGS_DATA_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), "data");
const BOOKINGS_FILE = path.join(DATA_DIR, "bookings.json");
const EVENT_TYPES_FILE = path.join(DATA_DIR, "event-types.json");

function ensureDir() {
  // Top-level fs checks during build cause overly-broad file tracing.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (!fs.existsSync(/*turbopackIgnore: true*/ DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readBookings(): Booking[] {
  ensureDir();
  try {
    const raw = fs.readFileSync(BOOKINGS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeBookings(bookings: Booking[]) {
  ensureDir();
  fs.writeFileSync(BOOKINGS_FILE, JSON.stringify(bookings, null, 2), "utf-8");
}

function readEventTypes(): EventType[] {
  ensureDir();
  try {
    const raw = fs.readFileSync(EVENT_TYPES_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return getDefaultEventTypes();
  }
}

function writeEventTypes(types: EventType[]) {
  ensureDir();
  fs.writeFileSync(EVENT_TYPES_FILE, JSON.stringify(types, null, 2), "utf-8");
}

// ═══════════════════════════════════════════
// Defaults
// ═══════════════════════════════════════════

export function getDefaultEventTypes(): EventType[] {
  return [
    {
      id: "et1",
      slug: "30min-call",
      title: "30min Call",
      description: "Quick sync or consultation",
      lengthMinutes: 30,
      color: "#4F46E5",
      hidden: false,
      locations: ["smyth_meeting"],
    },
    {
      id: "et2",
      slug: "1hr-consultation",
      title: "1hr Consultation",
      description: "In-depth strategy session",
      lengthMinutes: 60,
      color: "#7C3AED",
      hidden: false,
      locations: ["smyth_meeting"],
    },
    {
      id: "et3",
      slug: "15min-standup",
      title: "15min Standup",
      description: "Quick check-in",
      lengthMinutes: 15,
      color: "#10B981",
      hidden: true,
      locations: ["smyth_meeting"],
    },
  ];
}

// ═══════════════════════════════════════════
// Booking API
// ═══════════════════════════════════════════

export function getAllBookings(): Booking[] {
  return readBookings();
}

export function getBookingByUid(uid: string): Booking | undefined {
  return readBookings().find((b) => b.uid === uid);
}

export function getBookingById(id: string): Booking | undefined {
  return readBookings().find((b) => b.id === id);
}

export function createBooking(data: {
  title: string;
  startTime: string;
  endTime: string;
  attendeeName: string;
  attendeeEmail: string;
  attendeePhone?: string;
  description?: string;
  location?: string;
  eventTypeName?: string;
  eventTypeColor?: string;
  createdBy?: "human" | "agent" | "public";
}): Booking {
  const bookings = readBookings();

  const uid = data.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    + "-" + Date.now().toString(36);

  const booking: Booking = {
    id: `b_${Date.now()}`,
    uid,
    title: data.title,
    description: data.description || "",
    status: "pending",
    startTime: data.startTime,
    endTime: data.endTime,
    attendeeName: data.attendeeName,
    attendeeEmail: data.attendeeEmail,
    attendeePhone: data.attendeePhone || "",
    location: data.location || "Smyth Meeting",
    locationUrl: `/meeting/${uid}`,
    createdBy: data.createdBy || "public",
    eventTypeName: data.eventTypeName || "30min Call",
    eventTypeColor: data.eventTypeColor || "#4F46E5",
    createdAt: new Date().toISOString(),
  };

  bookings.push(booking);
  writeBookings(bookings);

  return booking;
}

export function updateBookingStatus(
  id: string,
  status: Booking["status"]
): Booking | undefined {
  const bookings = readBookings();
  const idx = bookings.findIndex((b) => b.id === id);
  if (idx === -1) return undefined;

  bookings[idx].status = status;
  writeBookings(bookings);
  return bookings[idx];
}

export function cancelBooking(id: string): boolean {
  const bookings = readBookings();
  const idx = bookings.findIndex((b) => b.id === id);
  if (idx === -1) return false;

  bookings[idx].status = "cancelled";
  writeBookings(bookings);
  return true;
}

// ═══════════════════════════════════════════
// Event Type API
// ═══════════════════════════════════════════

export function getAllEventTypes(): EventType[] {
  return readEventTypes();
}

export function getEventTypeBySlug(slug: string): EventType | undefined {
  return readEventTypes().find((et) => et.slug === slug);
}

export function createEventType(data: {
  title: string;
  slug: string;
  description?: string;
  lengthMinutes: number;
  color: string;
  locations?: ("smyth_meeting" | "phone" | "in_person")[];
}): EventType {
  const types = readEventTypes();

  const et: EventType = {
    id: `et_${Date.now()}`,
    slug: data.slug,
    title: data.title,
    description: data.description,
    lengthMinutes: data.lengthMinutes,
    color: data.color,
    hidden: false,
    locations: data.locations || ["smyth_meeting"],
  };

  types.push(et);
  writeEventTypes(types);
  return et;
}
