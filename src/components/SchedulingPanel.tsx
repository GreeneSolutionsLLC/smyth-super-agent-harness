"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Calendar,
  Clock,
  Plus,
  X,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Edit3,
  RefreshCw,
  ExternalLink,
  Settings,
  Check,
  AlertCircle,
  Loader2,
  MapPin,
  Users,
  Copy,
  Video,
} from "lucide-react";

// ── Types ──

type Booking = {
  id: string;
  uid: string;
  title: string;
  description?: string;
  status: "pending" | "confirmed" | "cancelled" | "rescheduled";
  startTime: string;
  endTime: string;
  attendeeName: string;
  attendeeEmail: string;
  attendeePhone?: string;
  location?: string;
  locationUrl?: string;
  notes?: string;
  createdBy: "human" | "agent";
  eventTypeName?: string;
  eventTypeColor?: string;
};

type EventType = {
  id: string;
  slug: string;
  title: string;
  description?: string;
  lengthMinutes: number;
  color: string;
  hidden: boolean;
};

type ViewMode = "calendar" | "booking" | "settings" | "create-event-type";

// ── API ──

const FLASK_URL = "http://localhost:5001";

// Map Flask booking to our Booking type
function mapFlaskBooking(b: any): Booking {
  return {
    id: b.id,
    uid: b.id.slice(0, 8),
    title: b.event_type_title || b.title || "Meeting",
    description: b.attendee_notes || "",
    status: b.status || "pending",
    startTime: b.start_time,
    endTime: b.end_time,
    attendeeName: b.attendee_name,
    attendeeEmail: b.attendee_email,
    attendeePhone: b.attendee_phone,
    location: b.location_type || b.video_link || "Smyth Meeting",
    locationUrl: b.meeting_link || b.video_link || "",
    notes: b.attendee_notes || "",
    createdBy: b.created_by || "human",
    eventTypeName: b.event_type_title || "",
    eventTypeColor: b.color || "#4F46E5",
  };
}

// Map Flask event type to our EventType type
function mapFlaskEventType(et: any): EventType {
  return {
    id: et.id,
    slug: et.slug,
    title: et.title,
    description: et.description || "",
    lengthMinutes: et.duration,
    color: et.color || "#4F46E5",
    hidden: !et.is_active,
  };
}

// ── Helpers ──

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function formatFullDate(iso: string): string {
  const d = new Date(iso);
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function getBookingsForDay(bookings: Booking[], date: Date): Booking[] {
  return bookings.filter((b) => {
    const start = new Date(b.startTime);
    return isSameDay(start, date);
  });
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  confirmed: "bg-green-500/10 text-green-400 border-green-500/20",
  cancelled: "bg-red-500/10 text-red-400 border-red-500/20",
  rescheduled: "bg-blue-500/10 text-blue-400 border-blue-500/20",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
  rescheduled: "Rescheduled",
};

// ── Component ──

export default function SchedulingPanel({ onClose, onJoinMeeting }: { onClose: () => void; onJoinMeeting?: (roomName: string, displayName: string, bookingId?: string) => void }) {
  const [view, setView] = useState<ViewMode>("calendar");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [eventTypes, setEventTypes] = useState<EventType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [transcript, setTranscript] = useState<any | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);

  // ── Create Event Type form ──
  const [newTitle, setNewTitle] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [newLength, setNewLength] = useState(30);
  const [newColor, setNewColor] = useState("#4F46E5");
  const [newDesc, setNewDesc] = useState("");

  // ── Fetch bookings ──
  const fetchBookings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${FLASK_URL}/api/bookings`);
      if (res.ok) {
        const data = await res.json();
        const rawBookings = Array.isArray(data) ? data : data.bookings || [];
        setBookings(rawBookings.map(mapFlaskBooking));
      } else {
        setBookings(getDemoBookings());
      }
    } catch {
      setBookings(getDemoBookings());
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Fetch event types ──
  const fetchEventTypes = useCallback(async () => {
    try {
      const res = await fetch(`${FLASK_URL}/api/event-types`);
      if (res.ok) {
        const data = await res.json();
        const rawTypes = Array.isArray(data) ? data : data.eventTypes || [];
        setEventTypes(rawTypes.map(mapFlaskEventType));
      } else {
        setEventTypes(getDemoEventTypes());
      }
    } catch {
      setEventTypes(getDemoEventTypes());
    }
  }, []);

  useEffect(() => {
    fetchBookings();
    fetchEventTypes();
  }, [fetchBookings, fetchEventTypes]);

  // ── Fetch transcript ──
  const fetchTranscript = useCallback(async (bookingId: string) => {
    setTranscriptLoading(true);
    try {
      const res = await fetch(`${FLASK_URL}/api/bookings/${bookingId}/transcript`);
      if (res.ok) {
        const data = await res.json();
        if (data && !data.error) {
          setTranscript(data);
        } else {
          setTranscript(null);
        }
      } else {
        setTranscript(null);
      }
    } catch {
      setTranscript(null);
    } finally {
      setTranscriptLoading(false);
    }
  }, []);

  // ── Calendar grid ──
  const monthStart = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
  const monthEnd = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
  const startDay = monthStart.getDay();
  const daysInMonth = monthEnd.getDate();
  const today = new Date();

  const calendarDays: (Date | null)[] = [];
  for (let i = 0; i < startDay; i++) calendarDays.push(null);
  for (let d = 1; d <= daysInMonth; d++) calendarDays.push(new Date(currentMonth.getFullYear(), currentMonth.getMonth(), d));

  // ── Selected day bookings ──
  const dayBookings = getBookingsForDay(bookings, selectedDate);

  // ── Booking actions ──
  const updateBookingStatus = async (id: string, status: string) => {
    try {
      const res = await fetch(`${FLASK_URL}/api/bookings/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        setBookings((prev) => prev.map((b) => (b.id === id ? { ...b, status: status as Booking["status"] } : b)));
      }
    } catch {
      // Fallback: update locally
      setBookings((prev) => prev.map((b) => (b.id === id ? { ...b, status: status as Booking["status"] } : b)));
    }
  };

  const cancelBooking = async (id: string) => {
    try {
      await fetch(`${FLASK_URL}/api/bookings/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });
    } catch {
      // Fallback: update locally
    }
    setBookings((prev) => prev.filter((b) => b.id !== id));
    setSelectedBooking(null);
  };

  // ── Create event type ──
  const createEventType = async () => {
    if (!newTitle.trim()) return;
    const slug = newSlug.trim() || newTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    try {
      const res = await fetch(`${FLASK_URL}/api/event-types`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle.trim(),
          slug,
          description: newDesc.trim() || undefined,
          duration: newLength,
          color: newColor,
          location_type: "smyth_meeting",
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setEventTypes((prev) => [...prev, mapFlaskEventType(data)]);
        // Refresh from server
        fetchEventTypes();
      } else {
        // Fallback: add locally
        const newET: EventType = {
          id: `et_${Date.now()}`,
          slug,
          title: newTitle.trim(),
          description: newDesc.trim() || undefined,
          lengthMinutes: newLength,
          color: newColor,
          hidden: false,
        };
        setEventTypes((prev) => [...prev, newET]);
      }
    } catch {
      const newET: EventType = {
        id: `et_${Date.now()}`,
        slug,
        title: newTitle.trim(),
        description: newDesc.trim() || undefined,
        lengthMinutes: newLength,
        color: newColor,
        hidden: false,
      };
      setEventTypes((prev) => [...prev, newET]);
    }
    setNewTitle("");
    setNewSlug("");
    setNewLength(30);
    setNewColor("#4F46E5");
    setNewDesc("");
    setView("settings");
  };

  // ── Copy booking link ──
  const copyBookingLink = (slug: string) => {
    const url = `https://smythagentapp.greene-solutions.com/book/${slug}`;
    navigator.clipboard.writeText(url);
  };

  // ── Render ──

  if (view === "settings") {
    return (
      <div className="flex flex-col h-full bg-surface text-foreground font-sans">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <button onClick={() => setView("calendar")} className="flex items-center gap-1 text-xs text-muted hover:text-foreground cursor-pointer">
            <ChevronLeft size={14} /> Back
          </button>
          <h2 className="text-sm font-semibold">Event Types</h2>
          <button onClick={() => setView("create-event-type")} className="flex items-center gap-1 text-xs text-accent hover:text-accent/80 cursor-pointer">
            <Plus size={14} /> New
          </button>
        </div>

        {/* Event Types List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {eventTypes.map((et) => (
            <div key={et.id} className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted-bg/30 hover:bg-muted-bg/50 transition-colors">
              <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: et.color }} />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate">{et.title}</div>
                <div className="text-[10px] text-muted">{et.lengthMinutes}min · /book/{et.slug}</div>
              </div>
              <button onClick={() => copyBookingLink(et.slug)} className="p-1 text-muted hover:text-accent cursor-pointer" title="Copy booking link">
                <Copy size={12} />
              </button>
            </div>
          ))}
          {eventTypes.length === 0 && (
            <div className="text-center py-8 text-muted text-xs">No event types yet. Create one to start booking.</div>
          )}
        </div>
      </div>
    );
  }

  if (view === "create-event-type") {
    return (
      <div className="flex flex-col h-full bg-surface text-foreground font-sans">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <button onClick={() => setView("settings")} className="flex items-center gap-1 text-xs text-muted hover:text-foreground cursor-pointer">
            <ChevronLeft size={14} /> Back
          </button>
          <h2 className="text-sm font-semibold">New Event Type</h2>
          <div className="w-10" />
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div>
            <label className="text-[10px] text-muted uppercase tracking-wider">Title</label>
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="30min Call"
              className="w-full mt-1 px-3 py-2 bg-muted-bg border border-border rounded text-sm text-foreground focus:outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted uppercase tracking-wider">Slug (URL path)</label>
            <input
              value={newSlug}
              onChange={(e) => setNewSlug(e.target.value)}
              placeholder="30min-call"
              className="w-full mt-1 px-3 py-2 bg-muted-bg border border-border rounded text-sm text-foreground focus:outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted uppercase tracking-wider">Duration (minutes)</label>
            <select
              value={newLength}
              onChange={(e) => setNewLength(Number(e.target.value))}
              className="w-full mt-1 px-3 py-2 bg-muted-bg border border-border rounded text-sm text-foreground focus:outline-none focus:border-accent"
            >
              {[15, 30, 45, 60, 90, 120].map((m) => (
                <option key={m} value={m}>{m} minutes</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-muted uppercase tracking-wider">Color</label>
            <div className="flex gap-2 mt-1">
              {["#4F46E5", "#7C3AED", "#EC4899", "#EF4444", "#F59E0B", "#10B981", "#3B82F6", "#6366F1"].map((c) => (
                <button
                  key={c}
                  onClick={() => setNewColor(c)}
                  className={`w-6 h-6 rounded-full cursor-pointer border-2 ${newColor === c ? "border-foreground" : "border-transparent"}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <div>
            <label className="text-[10px] text-muted uppercase tracking-wider">Description</label>
            <textarea
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Optional description shown on booking page..."
              rows={3}
              className="w-full mt-1 px-3 py-2 bg-muted-bg border border-border rounded text-sm text-foreground focus:outline-none focus:border-accent resize-none"
            />
          </div>

          <button
            onClick={createEventType}
            disabled={!newTitle.trim()}
            className="w-full py-2 bg-accent text-accent-foreground rounded text-sm font-medium cursor-pointer hover:bg-accent/80 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Create Event Type
          </button>
        </div>
      </div>
    );
  }

  if (view === "booking" && selectedBooking) {
    const b = selectedBooking;
    return (
      <div className="flex flex-col h-full bg-surface text-foreground font-sans">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <button onClick={() => { setSelectedBooking(null); setView("calendar"); }} className="flex items-center gap-1 text-xs text-muted hover:text-foreground cursor-pointer">
            <ChevronLeft size={14} /> Back
          </button>
          <h2 className="text-sm font-semibold">Booking Details</h2>
          <div className="w-10" />
        </div>

        {/* Booking Info */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <h3 className="text-base font-semibold">{b.title}</h3>
            <span className={`inline-block mt-1 text-[10px] px-2 py-0.5 rounded-full border ${STATUS_COLORS[b.status]}`}>
              {STATUS_LABELS[b.status]}
            </span>
          </div>

          <div className="space-y-2">
            <div className="flex items-start gap-2 text-xs">
              <Clock size={14} className="text-muted shrink-0 mt-0.5" />
              <div>
                <div className="font-medium">{formatFullDate(b.startTime)}</div>
                <div className="text-muted">{formatTime(b.startTime)} – {formatTime(b.endTime)}</div>
              </div>
            </div>

            <div className="flex items-start gap-2 text-xs">
              <Users size={14} className="text-muted shrink-0 mt-0.5" />
              <div>
                <div className="font-medium">{b.attendeeName}</div>
                <div className="text-muted">{b.attendeeEmail}</div>
                {b.attendeePhone && <div className="text-muted">{b.attendeePhone}</div>}
              </div>
            </div>

            {b.location && (
              <div className="flex items-start gap-2 text-xs">
                <MapPin size={14} className="text-muted shrink-0 mt-0.5" />
                <div>
                  {b.locationUrl ? (
                    <a href={b.locationUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline flex items-center gap-1">
                      {b.location} <ExternalLink size={10} />
                    </a>
                  ) : (
                    <span>{b.location}</span>
                  )}
                </div>
              </div>
            )}

            {b.description && (
              <div className="text-xs text-muted mt-2 p-2 bg-muted-bg/30 rounded border border-border">
                {b.description}
              </div>
            )}

            {b.notes && (
              <div className="text-xs text-muted mt-2">
                <span className="font-medium">Notes:</span> {b.notes}
              </div>
            )}

            {b.createdBy === "agent" && (
              <div className="flex items-center gap-1 text-[10px] text-violet-400 bg-violet-500/10 px-2 py-1 rounded">
                🤖 Booked by Smyth Agent
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2 pt-2 border-t border-border">
            {/* Start Meeting (host) — always available for confirmed/pending */}
            {(b.status === "confirmed" || b.status === "pending") && onJoinMeeting && (
              <button
                onClick={() => onJoinMeeting(`smyth-${b.uid}`, "Rob", b.id)}
                className="flex items-center justify-center gap-1.5 w-full py-2 bg-accent text-accent-foreground rounded text-xs font-medium cursor-pointer hover:bg-accent/80"
              >
                <Video size={14} /> Start Meeting
              </button>
            )}
            {b.status === "pending" && (
              <button
                onClick={() => updateBookingStatus(b.id, "confirmed")}
                className="flex items-center justify-center gap-1.5 w-full py-2 bg-green-600 text-white rounded text-xs font-medium cursor-pointer hover:bg-green-500"
              >
                <Check size={14} /> Confirm Booking
              </button>
            )}
            {b.status !== "cancelled" && (
              <button
                onClick={() => cancelBooking(b.id)}
                className="flex items-center justify-center gap-1.5 w-full py-2 bg-red-500/10 text-red-400 border border-red-500/20 rounded text-xs font-medium cursor-pointer hover:bg-red-500/20"
              >
                <Trash2 size={14} /> Cancel Booking
              </button>
            )}
          </div>

          {/* Transcript */}
          {transcriptLoading && (
            <div className="flex items-center justify-center py-3">
              <Loader2 size={16} className="animate-spin text-muted" />
              <span className="text-[10px] text-muted ml-2">Loading transcript...</span>
            </div>
          )}
          {transcript && !transcriptLoading && (
            <div className="mt-3 pt-3 border-t border-border">
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-xs font-medium">📝 Meeting Transcript</span>
                <span className="text-[10px] text-muted">{transcript.duration_seconds > 0 && `${Math.floor(transcript.duration_seconds / 60)}m ${transcript.duration_seconds % 60}s`}</span>
              </div>
              {transcript.summary && (
                <div className="text-xs text-foreground mb-2 p-2 bg-accent/5 rounded border border-accent/10">
                  <span className="font-medium">Summary: </span>{transcript.summary}
                </div>
              )}
              {transcript.action_items && transcript.action_items.length > 0 && (
                <div className="mb-2">
                  <span className="text-[10px] font-medium text-muted uppercase tracking-wider">Action Items</span>
                  <ul className="text-xs text-foreground mt-1 space-y-0.5">
                    {transcript.action_items.map((item: string, i: number) => (
                      <li key={i} className="flex items-start gap-1"><span className="text-accent">•</span>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              {transcript.key_decisions && transcript.key_decisions.length > 0 && (
                <div className="mb-2">
                  <span className="text-[10px] font-medium text-muted uppercase tracking-wider">Key Decisions</span>
                  <ul className="text-xs text-foreground mt-1 space-y-0.5">
                    {transcript.key_decisions.map((d: string, i: number) => (
                      <li key={i} className="flex items-start gap-1"><span className="text-green-400">✓</span>{d}</li>
                    ))}
                  </ul>
                </div>
              )}
              {transcript.transcript && Array.isArray(transcript.transcript) && transcript.transcript.length > 0 && (
                <details className="mt-1">
                  <summary className="text-[10px] text-muted cursor-pointer hover:text-foreground">Full transcript ({transcript.transcript.length} entries)</summary>
                  <div className="mt-1 max-h-40 overflow-y-auto space-y-1">
                    {transcript.transcript.map((entry: any, i: number) => (
                      <div key={i} className="text-[10px] text-muted">
                        <span className="text-foreground/60">[{entry.time || "??:??"}]</span> {entry.text}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Calendar View ──
  return (
    <div className="flex flex-col h-full bg-surface text-foreground font-sans">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Calendar size={16} className="text-accent" />
          <h2 className="text-sm font-semibold">Schedule</h2>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setView("settings")} className="p-1.5 text-muted hover:text-foreground cursor-pointer" title="Event Types & Settings">
            <Settings size={14} />
          </button>
          <button onClick={onClose} className="p-1.5 text-muted hover:text-foreground cursor-pointer">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Month Navigation */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <button onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1))} className="p-1 text-muted hover:text-foreground cursor-pointer">
          <ChevronLeft size={16} />
        </button>
        <span className="text-xs font-medium">{MONTHS[currentMonth.getMonth()]} {currentMonth.getFullYear()}</span>
        <button onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))} className="p-1 text-muted hover:text-foreground cursor-pointer">
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Calendar Grid */}
      <div className="px-3 pt-2 pb-1">
        {/* Day headers */}
        <div className="grid grid-cols-7 gap-0.5 mb-1">
          {DAYS.map((d) => (
            <div key={d} className="text-[9px] text-muted text-center font-medium">{d}</div>
          ))}
        </div>
        {/* Day cells */}
        <div className="grid grid-cols-7 gap-0.5">
          {calendarDays.map((date, i) => {
            if (!date) return <div key={`empty-${i}`} className="h-7" />;
            const isToday = isSameDay(date, today);
            const isSelected = isSameDay(date, selectedDate);
            const dayBookings = getBookingsForDay(bookings, date);
            return (
              <button
                key={date.toISOString()}
                onClick={() => setSelectedDate(date)}
                className={`h-7 flex flex-col items-center justify-center rounded text-[10px] cursor-pointer transition-colors relative ${
                  isSelected
                    ? "bg-accent text-accent-foreground font-bold"
                    : isToday
                    ? "bg-accent/10 text-accent font-medium"
                    : "text-foreground hover:bg-muted-bg"
                }`}
              >
                {date.getDate()}
                {dayBookings.length > 0 && (
                  <div className="absolute bottom-0.5 flex gap-0.5">
                    {dayBookings.slice(0, 3).map((b, bi) => (
                      <div key={bi} className="w-1 h-1 rounded-full" style={{ backgroundColor: b.eventTypeColor || b.status === "confirmed" ? "#10b981" : "#f59e0b" }} />
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Refresh */}
      <div className="flex items-center justify-between px-4 py-1.5 border-b border-border">
        <span className="text-[10px] text-muted">{formatFullDate(selectedDate.toISOString())}</span>
        <button onClick={fetchBookings} className="p-1 text-muted hover:text-foreground cursor-pointer" title="Refresh">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Day's Bookings */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={20} className="animate-spin text-muted" />
          </div>
        ) : dayBookings.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted">
            <Calendar size={24} className="mb-2 opacity-30" />
            <span className="text-xs">No bookings</span>
            <span className="text-[10px]">for this day</span>
          </div>
        ) : (
          <div className="p-3 space-y-2">
            {dayBookings
              .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
              .map((b) => (
                <button
                  key={b.id}
                  onClick={() => { setSelectedBooking(b); setView("booking"); fetchTranscript(b.id); }}
                  className="w-full text-left p-3 rounded-lg border border-border bg-muted-bg/30 hover:bg-muted-bg/50 cursor-pointer transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: b.eventTypeColor || "#4F46E5" }} />
                      <span className="text-xs font-medium truncate max-w-[180px]">{b.title}</span>
                    </div>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full border ${STATUS_COLORS[b.status]}`}>
                      {STATUS_LABELS[b.status]}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5 text-[10px] text-muted">
                    <Clock size={10} />
                    <span>{formatTime(b.startTime)} – {formatTime(b.endTime)}</span>
                    <span className="mx-0.5">·</span>
                    <span>{b.attendeeName}</span>
                    {b.createdBy === "agent" && (
                      <>
                        <span className="mx-0.5">·</span>
                        <span className="text-violet-400">🤖 Smyth</span>
                      </>
                    )}
                  </div>
                </button>
              ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-border flex items-center gap-2">
        <button
          onClick={() => setView("settings")}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-muted-bg border border-border rounded text-[10px] text-foreground cursor-pointer hover:border-accent transition-colors"
        >
          <Settings size={11} /> Event Types
        </button>
        <button
          onClick={() => {
            const slug = eventTypes[0]?.slug || "30min-call";
            copyBookingLink(slug);
          }}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-accent/10 border border-accent/20 rounded text-[10px] text-accent cursor-pointer hover:bg-accent/20 transition-colors"
        >
          <ExternalLink size={11} /> Share Link
        </button>
      </div>
    </div>
  );
}

// ── Demo Data ──

function getDemoBookings(): Booking[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return [
    {
      id: "b1",
      uid: "demo-1",
      title: "Strategy Call",
      description: "Initial consultation to discuss project scope and timeline.",
      status: "confirmed",
      startTime: new Date(today.getTime() + 10 * 3600000).toISOString(),
      endTime: new Date(today.getTime() + 10.5 * 3600000).toISOString(),
      attendeeName: "Alex Rivera",
      attendeeEmail: "alex@example.com",
      location: "Zoom",
      locationUrl: "https://zoom.us/j/demo",
      createdBy: "human",
      eventTypeName: "30min Call",
      eventTypeColor: "#4F46E5",
    },
    {
      id: "b2",
      uid: "demo-2",
      title: "Product Demo",
      description: "Walk through the platform features with the marketing team.",
      status: "pending",
      startTime: new Date(today.getTime() + 14 * 3600000).toISOString(),
      endTime: new Date(today.getTime() + 15 * 3600000).toISOString(),
      attendeeName: "Sarah Chen",
      attendeeEmail: "sarah@startup.io",
      attendeePhone: "+1 555-0123",
      location: "Google Meet",
      createdBy: "agent",
      eventTypeName: "1hr Consultation",
      eventTypeColor: "#7C3AED",
    },
    {
      id: "b3",
      uid: "demo-3",
      title: "Follow-up: Design Review",
      description: "",
      status: "confirmed",
      startTime: new Date(today.getTime() + 36 * 3600000).toISOString(),
      endTime: new Date(today.getTime() + 36.5 * 3600000).toISOString(),
      attendeeName: "Marcus Johnson",
      attendeeEmail: "marcus@design.co",
      location: "In person",
      createdBy: "human",
      eventTypeName: "30min Call",
      eventTypeColor: "#4F46E5",
    },
    {
      id: "b4",
      uid: "demo-4",
      title: "Investor Update",
      description: "Quarterly update call with Series A investors.",
      status: "rescheduled",
      startTime: new Date(today.getTime() + 60 * 3600000).toISOString(),
      endTime: new Date(today.getTime() + 61 * 3600000).toISOString(),
      attendeeName: "David Park",
      attendeeEmail: "david@vcfund.com",
      location: "Phone",
      createdBy: "agent",
      eventTypeName: "1hr Consultation",
      eventTypeColor: "#7C3AED",
    },
  ];
}

function getDemoEventTypes(): EventType[] {
  return [
    { id: "et1", slug: "30min-call", title: "30min Call", description: "Quick sync or consultation", lengthMinutes: 30, color: "#4F46E5", hidden: false },
    { id: "et2", slug: "1hr-consultation", title: "1hr Consultation", description: "In-depth strategy session", lengthMinutes: 60, color: "#7C3AED", hidden: false },
    { id: "et3", slug: "15min-standup", title: "15min Standup", description: "Quick check-in", lengthMinutes: 15, color: "#10B981", hidden: true },
  ];
}