# Scheduling Architecture — Smyth Super Agent

## Overview

Add a **Scheduling** panel (calendar icon) to the right sidebar alongside Voice, Mail, and Camera. This gives both the human and the agent collaborative access to manage the schedule, plus a public booking page for external clients.

## Architecture

### 1. Data Layer — SQLite (local-first, no external DB)

We use a local SQLite database (via better-sqlite3) to store all scheduling data. No external Postgres needed.

**Tables:**

```sql
-- Event types (what you're offering: "30min call", "1hr consultation", etc.)
CREATE TABLE event_types (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  length_minutes INTEGER NOT NULL DEFAULT 30,
  color TEXT DEFAULT '#4F46E5',
  hidden BOOLEAN DEFAULT 0,
  requires_confirmation BOOLEAN DEFAULT 0,
  min_booking_notice_minutes INTEGER DEFAULT 120,
  buffer_before_minutes INTEGER DEFAULT 0,
  buffer_after_minutes INTEGER DEFAULT 0,
  max_bookings_per_day INTEGER,
  slot_interval_minutes INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Availability schedules (recurring weekly patterns)
CREATE TABLE schedules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  timezone TEXT DEFAULT 'Asia/Makassar',
  is_default BOOLEAN DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Availability slots (per-schedule, per-day-of-week)
CREATE TABLE availability (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  event_type_id TEXT REFERENCES event_types(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL, -- 0=Sun, 1=Mon, ..., 6=Sat
  start_time TEXT NOT NULL,      -- '09:00'
  end_time TEXT NOT NULL,        -- '17:00'
  date_override TEXT             -- specific date for one-off availability
);

-- Bookings (confirmed/pending/cancelled)
CREATE TABLE bookings (
  id TEXT PRIMARY KEY,
  uid TEXT UNIQUE NOT NULL,       -- public-facing ID for booking page URLs
  event_type_id TEXT NOT NULL REFERENCES event_types(id),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, confirmed, cancelled, rescheduled
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  attendee_name TEXT NOT NULL,
  attendee_email TEXT NOT NULL,
  attendee_phone TEXT,
  location TEXT,                  -- 'in-person', 'zoom', 'google-meet', custom URL
  location_url TEXT,
  notes TEXT,
  created_by TEXT NOT NULL,       -- 'human' or 'agent'
  cancellation_reason TEXT,
  rescheduled_from TEXT REFERENCES bookings(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Calendar sync (optional: Google/Outlook calendar integration)
CREATE TABLE calendar_connections (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,         -- 'google', 'outlook', 'apple', 'caldav'
  provider_account_id TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TEXT,
  calendar_id TEXT,               -- provider's calendar ID
  sync_enabled BOOLEAN DEFAULT 1,
  last_synced_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Booking page settings (public-facing config)
CREATE TABLE booking_page_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  page_title TEXT DEFAULT 'Book a Time',
  page_description TEXT,
  brand_color TEXT DEFAULT '#4F46E5',
  logo_url TEXT,
  custom_domain TEXT,
  confirmation_message TEXT DEFAULT 'Your booking is confirmed!',
  redirect_url TEXT,
  require_phone BOOLEAN DEFAULT 0,
  require_notes BOOLEAN DEFAULT 0,
  timezone TEXT DEFAULT 'Asia/Makassar',
  updated_at TEXT DEFAULT (datetime('now'))
);
```

### 2. API Layer — Next.js Routes

All scheduling API routes live under `/api/scheduling/`:

```
/api/scheduling/event-types          GET    → list event types
/api/scheduling/event-types          POST   → create event type
/api/scheduling/event-types/[id]     PATCH  → update event type
/api/scheduling/event-types/[id]     DELETE → delete event type

/api/scheduling/availability          GET    → get availability for a schedule
/api/scheduling/availability          POST   → set availability slots
/api/scheduling/availability/[id]     DELETE → remove availability slot

/api/scheduling/bookings              GET    → list bookings (with filters)
/api/scheduling/bookings              POST   → create booking (agent or human)
/api/scheduling/bookings/[id]         GET    → get booking details
/api/scheduling/bookings/[id]         PATCH  → update booking (confirm/cancel/reschedule)
/api/scheduling/bookings/[id]         DELETE → cancel booking

/api/scheduling/slots                 GET    → get available time slots (for booking page)

/api/scheduling/settings              GET    → get booking page settings
/api/scheduling/settings              PATCH  → update booking page settings

/api/scheduling/calendars             GET    → list connected calendars
/api/scheduling/calendars             POST   → connect a calendar
/api/scheduling/calendars/[id]       DELETE → disconnect calendar
/api/scheduling/calendars/[id]/sync   POST   → trigger sync

/book/[slug]                          GET    → public booking page (Next.js page)
```

### 3. Agent Integration — AgenticMail MCP Tools

New tools for the agent (exposed via AgenticMail OpenClaw plugin or direct API):

```typescript
// Agent scheduling tools
agenticmail_schedule_list(params)        // List upcoming bookings
agenticmail_schedule_create(params)      // Create a booking
agenticmail_schedule_cancel(params)      // Cancel a booking
agenticmail_schedule_reschedule(params)  // Reschedule a booking
agenticmail_schedule_availability(params)// Check available slots
agenticmail_schedule_search(params)      // Search bookings by attendee/date
```

**Agent capabilities:**
- "Check my schedule for tomorrow" → lists bookings
- "Book a call with John on Thursday at 3pm" → creates booking
- "Cancel my 2pm meeting" → cancels booking
- "Reschedule the Thursday call to Friday" → reschedules
- "What times are available next week?" → shows slots
- "Send John my booking link" → sends link via email

### 4. UI Components

#### 4a. SchedulingPanel (right sidebar, like EmailPanel)

```
┌─────────────────────────┐
│ 📅 Schedule          ✕  │
│                         │
│ ┌─ Today ─────────────┐ │
│ │ 09:00  Call w/ John  │ │
│ 10:30  Team standup    │ │
│ 14:00  Client demo     │ │
│ ─── Available ──────── │ │
│ 11:00-12:00            │ │
│ 15:00-17:00            │ │
│ └──────────────────────┘ │
│                         │
│ ┌─ Tomorrow ──────────┐ │
│ │ 10:00  Strategy call │ │
│ ─── Available ──────── │ │
│ 09:00-10:00            │ │
│ 11:00-17:00            │ │
│ └──────────────────────┘ │
│                         │
│ [+ New Event Type]      │
│ [🔗 Share Booking Link] │
│ [⚙ Settings]            │
└─────────────────────────┘
```

**Features:**
- Day/week view of upcoming bookings
- Color-coded by event type
- Agent-sent bookings marked with 🤖 badge (same pattern as email)
- Quick actions: confirm, cancel, reschedule
- "Share booking link" copies the public URL
- Settings gear opens full config

#### 4b. Public Booking Page (`/book/[slug]`)

```
┌─────────────────────────────┐
│         📅                   │
│   Book a Time with Rob      │
│   Pick a time that works    │
│                              │
│ ┌─ 30min Call ──────────────┐│
│ │ 🟢 Available slots:       ││
│ │ Mon 9:00  Mon 10:30       ││
│ │ Mon 14:00 Tue 9:00        ││
│ │ Tue 11:00  Wed 9:00       ││
│ └────────────────────────────┘│
│                              │
│ ┌─ 1hr Consultation ────────┐│
│ │ 🟢 Available slots:       ││
│ │ Mon 15:00  Wed 14:00      ││
│ │ Thu 10:00                  ││
│ └────────────────────────────┘│
│                              │
│ [Select a time →]            │
└─────────────────────────────┘
```

After selecting a slot:
```
┌─────────────────────────────┐
│   📅 30min Call             │
│   Monday, Jul 14 at 9:00   │
│                              │
│   Your Name: [___________]  │
│   Email:     [___________]  │
│   Phone:     [___________]  │
│   Notes:     [___________]  │
│                              │
│   [Confirm Booking]         │
└─────────────────────────────┘
```

### 5. Availability Engine

The slot calculation engine:

```typescript
function getAvailableSlots(
  eventType: EventType,
  schedule: Schedule,
  availability: Availability[],
  bookings: Booking[],
  calendarEvents: ExternalEvent[],
  dateRange: { start: Date, end: Date }
): TimeSlot[] {
  // 1. Generate candidate slots from availability rules
  // 2. Remove slots that conflict with existing bookings
  // 3. Remove slots that conflict with external calendar events
  // 4. Apply buffer times (before/after existing bookings)
  // 5. Apply min booking notice
  // 6. Apply max bookings per day limit
  // 7. Return available slots
}
```

### 6. Notification Flow

```
New booking created
  → Email confirmation to attendee (via AgenticMail)
  → Email notification to human (via AgenticMail)
  → Agent awareness (via OpenClaw heartbeat/wake)
  → Push to calendar (if connected)

Booking cancelled/rescheduled
  → Email notification to attendee
  → Email notification to human
  → Agent awareness
  → Calendar update

Agent creates booking
  → Same flow, but marked as "created_by: agent"
  → 🤖 badge in UI
```

### 7. Calendar Sync (Phase 2)

Initially, we build without external calendar sync. Phase 2 adds:
- Google Calendar OAuth integration
- Outlook Calendar integration
- CalDAV support
- Two-way sync: external events block availability; bookings push to external calendar

### 8. File Structure

```
src/
├── app/
│   ├── api/scheduling/
│   │   ├── event-types/
│   │   │   └── route.ts
│   │   ├── availability/
│   │   │   └── route.ts
│   │   ├── bookings/
│   │   │   ├── [id]/
│   │   │   │   └── route.ts
│   │   │   └── route.ts
│   │   ├── slots/
│   │   │   └── route.ts
│   │   ├── settings/
│   │   │   └── route.ts
│   │   └── calendars/
│   │       └── route.ts
│   └── book/
│       └── [slug]/
│           └── page.tsx          # Public booking page
├── components/
│   ├── SchedulingPanel.tsx       # Right sidebar panel
│   ├── BookingPage.tsx           # Public booking page component
│   ├── EventTypeEditor.tsx       # Create/edit event types
│   ├── AvailabilityEditor.tsx    # Weekly availability grid
│   └── CalendarView.tsx          # Day/week calendar view
├── lib/
│   ├── scheduling/
│   │   ├── db.ts                 # SQLite database setup
│   │   ├── slots.ts              # Availability engine
│   │   ├── notifications.ts      # Email notifications via AgenticMail
│   │   └── types.ts              # TypeScript types
│   └── ...
```

### 9. Implementation Phases

**Phase 1 — Core (Build Now)**
- SQLite database + migrations
- Event types CRUD
- Availability editor (weekly schedule)
- Bookings CRUD
- Available slots API
- SchedulingPanel UI (right sidebar)
- Public booking page (`/book/[slug]`)
- Agent tools (list/create/cancel/reschedule)
- Email notifications via AgenticMail

**Phase 2 — Polish**
- Calendar sync (Google/Outlook)
- Recurring bookings
- Timezone detection
- Booking confirmation flow (requires_confirmation flag)
- Custom booking form fields
- Webhook notifications

**Phase 3 — Advanced**
- Round-robin scheduling (multiple team members)
- Group bookings (seats per time slot)
- Payment integration (Stripe)
- Custom domains for booking page
- Analytics dashboard

### 10. Key Design Decisions

1. **SQLite, not Postgres** — Smyth is a single-user app. No need for a heavy DB. SQLite is embedded, fast, and zero-config. We can always migrate later.

2. **No Cal.com dependency** — We're building a lightweight scheduling system *inspired by* Cal.com's data model, not embedding Cal.diy. That monorepo is 7,693 files and requires Postgres + Redis + a dozen services. Our scheduling is purpose-built for Smyth.

3. **Collaborative by design** — Both human and agent can create/modify bookings. The `created_by` field tracks who made each booking. Agent actions show the 🤖 badge.

4. **AgenticMail for notifications** — All booking confirmations, reminders, and notifications go through the existing AgenticMail infrastructure. No separate email system needed.

5. **Public booking page** — A clean, shareable URL (`/book/30min-call`) that external people can use to book time slots. No login required.

6. **API-first** — Every scheduling action has an API endpoint. The agent uses the same API the UI uses. This means agent capabilities are always in sync with the UI.