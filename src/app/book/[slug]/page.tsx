"use client";

export const dynamic = "force-dynamic";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { Calendar, Clock, ChevronLeft, ChevronRight, Loader2, Check, Copy, Camera } from "lucide-react";

interface EventType {
  slug: string;
  title: string;
  description?: string;
  lengthMinutes: number;
  color: string;
}

interface TimeSlot {
  time: string;
  label: string;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default function BookPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [eventType, setEventType] = useState<EventType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const today = new Date();
  const [currentMonth, setCurrentMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ url: string; time: string } | null>(null);

  useEffect(() => {
    const fetchEventType = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/scheduling/event-types?slug=${slug}`);
        if (res.ok) {
          const data = await res.json();
          if (data.eventType) {
            setEventType(data.eventType);
            setLoading(false);
            return;
          }
        }
      } catch {}

      const commonTypes: Record<string, EventType> = {
        "30min-call": { slug: "30min-call", title: "30min Call", description: "Quick sync or consultation", lengthMinutes: 30, color: "#4F46E5" },
        "1hr-consultation": { slug: "1hr-consultation", title: "1hr Consultation", description: "In-depth strategy session", lengthMinutes: 60, color: "#7C3AED" },
        "15min-standup": { slug: "15min-standup", title: "15min Standup", description: "Quick check-in", lengthMinutes: 15, color: "#10B981" },
      };

      if (commonTypes[slug]) {
        setEventType(commonTypes[slug]);
      } else {
        setEventType({
          slug,
          title: slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          lengthMinutes: 30,
          color: "#4F46E5",
        });
      }
      setLoading(false);
    };
    fetchEventType();
  }, [slug]);

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  const getCalendarDays = () => {
    const start = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
    const end = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
    const days: (Date | null)[] = [];
    for (let i = 0; i < start.getDay(); i++) days.push(null);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) days.push(new Date(d));
    return days;
  };

  const calendarDays = getCalendarDays();

  const isDateAvailable = (date: Date) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return d >= t && d.getDay() !== 0 && d.getDay() !== 6;
  };

  const timeSlots: TimeSlot[] = [];
  if (selectedDate) {
    for (let h = 9; h <= 17; h++) {
      const timeStr = `${h.toString().padStart(2, "0")}:00`;
      const ampm = h < 12 ? "AM" : "PM";
      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      timeSlots.push({ time: timeStr, label: `${h12}:00 ${ampm}` });
    }
  }

  const handleBook = async () => {
    if (!name.trim() || !email.trim() || !selectedDate || !selectedTime) return;
    setSubmitting(true);

    const startTime = new Date(selectedDate);
    const [h, m] = selectedTime.split(":").map(Number);
    startTime.setHours(h, m, 0, 0);
    const endTime = new Date(startTime.getTime() + (eventType?.lengthMinutes || 30) * 60000);

    try {
      const res = await fetch("/api/scheduling/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: eventType?.title || "Meeting",
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          attendeeName: name.trim(),
          attendeeEmail: email.trim(),
          description: notes.trim(),
          location: "Smyth Meeting",
          eventTypeName: eventType?.title,
          eventTypeColor: eventType?.color,
        }),
      });

      if (!res.ok) throw new Error("Failed to create booking");

      const data = await res.json();
      const meetingUrl = data.booking.locationUrl
        ? `https://smythagentapp.greene-solutions.com${data.booking.locationUrl}`
        : `https://smythagentapp.greene-solutions.com/meeting/${data.booking.uid}`;

      setSuccess({
        url: meetingUrl,
        time: `${startTime.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} – ${endTime.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`,
      });
    } catch (err: any) {
      setError(err.message || "Failed to book");
    } finally {
      setSubmitting(false);
    }
  };

  const copyLink = () => {
    if (success?.url) navigator.clipboard.writeText(success.url);
  };

  // ── Branded Components ──

  const BrandBar = () => (
    <div className="w-full border-b border-[rgba(0,255,136,0.2)] bg-[rgba(10,10,26,0.95)] backdrop-blur-sm">
      <div className="max-w-6xl mx-auto px-4 sm:px-8 h-14 flex items-center gap-3">
        <img src="https://ai.greene-solutions.com/logo-white.png" alt="Greene Solutions" className="h-8 w-auto drop-shadow-[0_0_8px_rgba(0,255,136,0.3)]" />
        <span className="font-['Orbitron',monospace] text-[10px] text-[rgba(255,255,255,0.5)] tracking-[3px] uppercase hidden sm:inline">Schedule a Call</span>
      </div>
    </div>
  );

  const LoadingScreen = () => (
    <div className="min-h-screen bg-[#0a0a1a] flex items-center justify-center">
      <div className="relative">
        <div className="absolute inset-0 animate-ping rounded-full bg-[rgba(0,255,136,0.15)]" />
        <Loader2 size={28} className="animate-spin text-[#00ff88] relative" />
      </div>
    </div>
  );

  const ErrorScreen = () => (
    <div className="min-h-screen bg-[#0a0a1a] text-white flex items-center justify-center p-4">
      <div className="text-center">
        <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4 border border-red-500/30">
          <span className="text-red-400 text-lg">!</span>
        </div>
        <h2 className="text-base font-semibold mb-1 font-['Rajdhani',sans-serif]">Connection Error</h2>
        <p className="text-xs text-white/50 mb-6">{error}</p>
        <button onClick={() => window.location.reload()} className="px-6 py-2 bg-[rgba(0,255,136,0.1)] border border-[#00ff88] text-[#00ff88] text-sm font-['Orbitron',monospace] tracking-[2px] cursor-pointer hover:bg-[rgba(0,255,136,0.2)] transition-all">
          RETRY
        </button>
      </div>
    </div>
  );

  // ── Shared UI: Back button, progress dots ──

  const StepProgress = ({ step }: { step: 1 | 2 | 3 | 4 }) => (
    <div className="flex items-center gap-2 mb-8">
      {[1, 2, 3].map((s) => (
        <div key={s} className={`h-1 rounded-full transition-all duration-500 ${s <= step ? "bg-[#00ff88] w-10" : "bg-[rgba(255,255,255,0.1)] w-6"}`} />
      ))}
    </div>
  );

  // ── SUCCESS ──

  if (success) {
    return (
      <div className="min-h-screen bg-[#0a0a1a] text-white font-['Rajdhani',sans-serif]" style={{ backgroundImage: `linear-gradient(rgba(0,102,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,102,255,0.03) 1px, transparent 1px)`, backgroundSize: '50px 50px' }}>
        <BrandBar />
        <div className="flex items-center justify-center min-h-[calc(100vh-56px)] p-4">
          <div className="w-full max-w-md text-center">
            <div className="w-16 h-16 rounded-full bg-[rgba(0,255,136,0.1)] flex items-center justify-center mx-auto mb-5 border border-[rgba(0,255,136,0.3)]">
              <Check size={32} className="text-[#00ff88]" />
            </div>
            <h1 className="text-2xl font-bold font-['Orbitron',monospace] tracking-[2px] mb-2">BOOKED</h1>
            <p className="text-base text-[rgba(255,255,255,0.7)]">{eventType?.title}</p>
            <p className="text-sm text-[rgba(255,255,255,0.4)] mb-8">{success.time}</p>

            <div className="space-y-3">
              <button
                onClick={() => window.open(success.url, "_blank")}
                className="w-full py-3 bg-gradient-to-r from-[#0066ff] to-[#00ff88] text-[#0a0a1a] rounded text-sm font-bold font-['Orbitron',monospace] tracking-[2px] cursor-pointer hover:opacity-90 transition-all flex items-center justify-center gap-2"
              >
                <Camera size={16} /> JOIN MEETING
              </button>

              <button
                onClick={copyLink}
                className="w-full py-2.5 bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded text-xs text-[rgba(255,255,255,0.6)] cursor-pointer hover:bg-[rgba(255,255,255,0.1)] flex items-center justify-center gap-2 font-['Orbitron',monospace] tracking-[1px]"
              >
                <Copy size={12} /> COPY LINK
              </button>
            </div>

            <button
              onClick={() => {
                setSuccess(null);
                setSelectedDate(null);
                setSelectedTime(null);
                setName("");
                setEmail("");
                setNotes("");
              }}
              className="mt-6 text-xs text-[rgba(255,255,255,0.3)] hover:text-[rgba(255,255,255,0.6)] cursor-pointer font-['Orbitron',monospace] tracking-[2px]"
            >
              BOOK ANOTHER
            </button>

            <p className="mt-8 text-[10px] text-[rgba(255,255,255,0.15)] font-['Orbitron',monospace] tracking-[2px]">
              GREENE SOLUTIONS LLC
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── ERROR ──

  if (error) return <ErrorScreen />;

  // ── LOADING ──

  if (loading) return <LoadingScreen />;

  // ── DATE PICKER ──

  if (!selectedDate) {
    return (
      <div className="min-h-screen bg-[#0a0a1a] text-white font-['Rajdhani',sans-serif]" style={{
        backgroundImage: `linear-gradient(rgba(0,102,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,102,255,0.03) 1px, transparent 1px)`,
        backgroundSize: '50px 50px'
      }}>
        <BrandBar />
        <div className="flex items-start justify-center min-h-[calc(100vh-56px)] p-4 sm:p-8 pt-8 sm:pt-12">
          <div className="w-full max-w-5xl">
            {/* Two-column layout on desktop */}
            <div className="flex flex-col lg:flex-row gap-8 lg:gap-16 items-start">

              {/* LEFT: Event info */}
              <div className="w-full lg:w-64 lg:sticky lg:top-24 shrink-0">
                <StepProgress step={1} />
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: eventType?.color }} />
                  <span className="text-xs text-[rgba(255,255,255,0.4)] font-['Orbitron',monospace] tracking-[2px]">{eventType?.lengthMinutes} MIN</span>
                </div>
                <h1 className="text-2xl sm:text-3xl font-bold font-['Orbitron',monospace] tracking-[2px] mb-2">{eventType?.title}</h1>
                {eventType?.description && (
                  <p className="text-sm text-[rgba(255,255,255,0.5)] leading-relaxed">{eventType.description}</p>
                )}
                <p className="mt-4 text-xs text-[rgba(255,255,255,0.2)] font-['Orbitron',monospace] tracking-[2px]">
                  Select a date below to continue
                </p>
              </div>

              {/* RIGHT: Calendar */}
              <div className="w-full lg:flex-1">
                <div className="bg-[rgba(13,22,40,0.8)] border border-[rgba(0,102,255,0.2)] rounded-none p-6 sm:p-8">
                  {/* Month nav */}
                  <div className="flex items-center justify-between mb-6">
                    <button
                      onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1))}
                      className="p-2 text-[rgba(255,255,255,0.4)] hover:text-[#00ff88] cursor-pointer transition-colors"
                    >
                      <ChevronLeft size={20} />
                    </button>
                    <span className="text-base font-semibold font-['Orbitron',monospace] tracking-[2px]">
                      {MONTHS[currentMonth.getMonth()]} {currentMonth.getFullYear()}
                    </span>
                    <button
                      onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))}
                      className="p-2 text-[rgba(255,255,255,0.4)] hover:text-[#00ff88] cursor-pointer transition-colors"
                    >
                      <ChevronRight size={20} />
                    </button>
                  </div>

                  {/* Day headers */}
                  <div className="grid grid-cols-7 gap-2 mb-3">
                    {DAYS.map((d) => (
                      <div key={d} className="text-[11px] text-[rgba(255,255,255,0.3)] text-center font-['Orbitron',monospace] tracking-[2px]">{d}</div>
                    ))}
                  </div>

                  {/* Calendar grid */}
                  <div className="grid grid-cols-7 gap-2">
                    {calendarDays.map((date, i) => {
                      if (!date) return <div key={`e${i}`} />;
                      const available = isDateAvailable(date);
                      const isToday = isSameDay(date, new Date());
                      return (
                        <button
                          key={date.toISOString()}
                          disabled={!available}
                          onClick={() => setSelectedDate(date)}
                          className={`aspect-square flex items-center justify-center text-sm cursor-pointer transition-all relative
                            ${isToday && available
                              ? "bg-[#00ff88] text-[#0a0a1a] font-bold"
                              : available
                              ? "text-white hover:bg-[rgba(0,255,136,0.1)] hover:border hover:border-[rgba(0,255,136,0.4)]"
                              : "text-[rgba(255,255,255,0.15)] cursor-not-allowed"
                            }
                          `}
                        >
                          {date.getDate()}
                          {isToday && available && (
                            <span className="absolute -top-0.5 right-0.5 text-[7px] text-[rgba(0,255,136,0.6)]">●</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <p className="text-[10px] text-[rgba(255,255,255,0.15)] text-center mt-4 font-['Orbitron',monospace] tracking-[2px]">
                  ALL TIMES ARE ASIA/SAIGON (GMT+7)
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── TIME PICKER ──

  if (!selectedTime) {
    return (
      <div className="min-h-screen bg-[#0a0a1a] text-white font-['Rajdhani',sans-serif]" style={{
        backgroundImage: `linear-gradient(rgba(0,102,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,102,255,0.03) 1px, transparent 1px)`,
        backgroundSize: '50px 50px'
      }}>
        <BrandBar />
        <div className="flex items-start justify-center min-h-[calc(100vh-56px)] p-4 sm:p-8 pt-8 sm:pt-12">
          <div className="w-full max-w-5xl">
            <div className="flex flex-col lg:flex-row gap-8 lg:gap-16 items-start">

              {/* LEFT */}
              <div className="w-full lg:w-64 lg:sticky lg:top-24 shrink-0">
                <StepProgress step={2} />
                <button onClick={() => setSelectedDate(null)} className="flex items-center gap-1 text-xs text-[rgba(255,255,255,0.4)] hover:text-[#00ff88] cursor-pointer mb-4 font-['Orbitron',monospace] tracking-[1px] transition-colors">
                  <ChevronLeft size={14} /> BACK
                </button>
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: eventType?.color }} />
                  <span className="text-xs text-[rgba(255,255,255,0.4)] font-['Orbitron',monospace] tracking-[2px]">{eventType?.lengthMinutes} MIN</span>
                </div>
                <h1 className="text-xl font-bold font-['Orbitron',monospace] tracking-[2px] mb-1">{eventType?.title}</h1>
                <div className="flex items-center gap-2 text-sm text-[rgba(255,255,255,0.6)] mt-2">
                  <Calendar size={14} className="text-[#00ff88]" />
                  <span>{selectedDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</span>
                </div>
              </div>

              {/* RIGHT: Time slots */}
              <div className="w-full lg:flex-1">
                <div className="bg-[rgba(13,22,40,0.8)] border border-[rgba(0,102,255,0.2)] rounded-none p-6 sm:p-8">
                  <h3 className="text-sm font-semibold font-['Orbitron',monospace] tracking-[2px] text-[rgba(255,255,255,0.5)] mb-5 uppercase">Available Times</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {timeSlots.map((slot) => (
                      <button
                        key={slot.time}
                        onClick={() => setSelectedTime(slot.time)}
                        className="py-3 px-4 border border-[rgba(0,102,255,0.3)] text-sm cursor-pointer hover:border-[#00ff88] hover:bg-[rgba(0,255,136,0.05)] transition-all text-center"
                      >
                        <Clock size={14} className="inline mr-2 text-[#00ff88]" />
                        {slot.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── FORM ──

  return (
    <div className="min-h-screen bg-[#0a0a1a] text-white font-['Rajdhani',sans-serif]" style={{
      backgroundImage: `linear-gradient(rgba(0,102,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,102,255,0.03) 1px, transparent 1px)`,
      backgroundSize: '50px 50px'
    }}>
      <BrandBar />
      <div className="flex items-start justify-center min-h-[calc(100vh-56px)] p-4 sm:p-8 pt-8 sm:pt-12">
        <div className="w-full max-w-5xl">
          <div className="flex flex-col lg:flex-row gap-8 lg:gap-16 items-start">

            {/* LEFT */}
            <div className="w-full lg:w-64 lg:sticky lg:top-24 shrink-0">
              <StepProgress step={3} />
              <button onClick={() => setSelectedTime(null)} className="flex items-center gap-1 text-xs text-[rgba(255,255,255,0.4)] hover:text-[#00ff88] cursor-pointer mb-4 font-['Orbitron',monospace] tracking-[1px] transition-colors">
                <ChevronLeft size={14} /> BACK
              </button>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: eventType?.color }} />
                <span className="text-xs text-[rgba(255,255,255,0.4)] font-['Orbitron',monospace] tracking-[2px]">{eventType?.lengthMinutes} MIN</span>
              </div>
              <h1 className="text-xl font-bold font-['Orbitron',monospace] tracking-[2px] mb-1">{eventType?.title}</h1>
              <div className="flex flex-col gap-1 text-sm text-[rgba(255,255,255,0.5)] mt-2">
                <div className="flex items-center gap-2">
                  <Calendar size={14} className="text-[#00ff88]" />
                  <span>{selectedDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock size={14} className="text-[#00ff88]" />
                  <span>
                    {(() => {
                      const [h, m] = (selectedTime || "09:00").split(":").map(Number);
                      const ampm = h < 12 ? "AM" : "PM";
                      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
                      return `${h12}:${m.toString().padStart(2, "0")} ${ampm}`;
                    })()}
                  </span>
                </div>
              </div>
            </div>

            {/* RIGHT: Form */}
            <div className="w-full lg:flex-1">
              <div className="bg-[rgba(13,22,40,0.8)] border border-[rgba(0,102,255,0.2)] rounded-none p-6 sm:p-8">
                <h3 className="text-sm font-semibold font-['Orbitron',monospace] tracking-[2px] text-[rgba(255,255,255,0.5)] mb-6 uppercase">Your Details</h3>
                <div className="space-y-5">
                  <div>
                    <label className="text-xs text-[rgba(255,255,255,0.4)] uppercase tracking-[2px] font-['Orbitron',monospace]">Name *</label>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Your name"
                      className="w-full mt-1.5 px-4 py-3 bg-[rgba(10,10,26,0.6)] border border-[rgba(0,102,255,0.3)] text-white text-sm focus:outline-none focus:border-[#00ff88] transition-colors placeholder:text-[rgba(255,255,255,0.2)]"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[rgba(255,255,255,0.4)] uppercase tracking-[2px] font-['Orbitron',monospace]">Email *</label>
                    <input
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="your@email.com"
                      type="email"
                      className="w-full mt-1.5 px-4 py-3 bg-[rgba(10,10,26,0.6)] border border-[rgba(0,102,255,0.3)] text-white text-sm focus:outline-none focus:border-[#00ff88] transition-colors placeholder:text-[rgba(255,255,255,0.2)]"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[rgba(255,255,255,0.4)] uppercase tracking-[2px] font-['Orbitron',monospace]">Notes (optional)</label>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Anything you'd like to discuss..."
                      rows={3}
                      className="w-full mt-1.5 px-4 py-3 bg-[rgba(10,10,26,0.6)] border border-[rgba(0,102,255,0.3)] text-white text-sm focus:outline-none focus:border-[#00ff88] transition-colors resize-none placeholder:text-[rgba(255,255,255,0.2)]"
                    />
                  </div>
                  <button
                    onClick={handleBook}
                    disabled={!name.trim() || !email.trim() || submitting}
                    className="w-full py-3.5 bg-gradient-to-r from-[#0066ff] to-[#00ff88] text-[#0a0a1a] text-sm font-bold font-['Orbitron',monospace] tracking-[2px] cursor-pointer hover:opacity-90 transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {submitting ? <Loader2 size={16} className="animate-spin" /> : null}
                    {submitting ? "CONFIRMING..." : `CONFIRM ${eventType?.title?.toUpperCase() || "MEETING"}`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
