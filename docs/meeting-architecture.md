# Meeting Architecture v2 — Smyth Super Agent

## Updated Comparison: Jitsi Meet vs LiveKit

After evaluating both, here's the real tradeoff:

### Jitsi Meet

**What it is:** A complete, battle-tested video conferencing app (like Zoom/Meet) that you self-host.

| Aspect | Detail |
|--------|--------|
| **Backend** | 4 Docker containers (web, prosody, jicofo, jvb) |
| **RAM** | ~1.5GB minimum |
| **Disk** | ~1GB for images |
| **Ports** | 6+ (80, 443, 5222, 5347, 5280, 4443, 10000/udp) |
| **Config** | 57 env vars |
| **React SDK** | `@jitsi/react-sdk` — **but it's an iframe wrapper** |
| **UI** | Full Zoom-like UI: video tiles, screen share, chat, polls, reactions, breakout rooms, E2EE, recording |
| **Auth** | JWT tokens, lobby, password protection |
| **License** | Apache 2.0 |
| **Embedding** | `<JitsiMeeting domain="your-server" roomName="room" />` — done |
| **Customization** | Limited without forking. The iframe is a black box. |

### LiveKit

**What it is:** A WebRTC SFU (media relay) with React component primitives.

| Aspect | Detail |
|--------|--------|
| **Backend** | 1 Docker container |
| **RAM** | ~256MB minimum |
| **Disk** | ~50MB for image |
| **Ports** | 3 (7880, 7881, 7882/udp) |
| **Config** | 5-10 lines YAML |
| **React SDK** | `@livekit/components-react` — **actual React components** |
| **UI** | We build it. `VideoConference` pre-built component exists but needs assembly. |
| **Auth** | JWT tokens, scoped per-room |
| **License** | Apache 2.0 |
| **Embedding** | Import components, compose UI, full control |
| **Customization** | Total. Every pixel is ours. But we build everything. |

## The Decision: Jitsi Meet

**For Smyth, Jitsi Meet is the better choice.** Here's why:

1. **It just works.** 4 containers sounds heavy, but Docker Compose makes it a single `docker compose up`. Jitsi has been production-tested for 15+ years. Screen share, chat, polls, reactions, recording, breakout rooms, E2EE — all built-in and working.

2. **The React SDK is good enough.** Yes, it's an iframe wrapper. But that iframe contains a complete, polished meeting UI. For our use case — click a link, join a video call — we don't need to customize every pixel. We need it to work reliably.

3. **Feature parity with Zoom out of the box.** LiveKit gives us video tiles and audio. We'd have to build screen share, chat, polls, reactions, recording, lobby, breakout rooms ourselves. That's months of work. Jitsi gives us all of it today.

4. **Self-hosted on our terms.** No third-party dependency. The Jitsi stack runs on our VPS. Data stays ours.

5. **The Smyth integration is simple:**
   ```tsx
   import { JitsiMeeting } from "@jitsi/react-sdk";
   
   function MeetingRoom({ roomName, displayName }) {
     return (
       <JitsiMeeting
         domain="meet.smyth.app"
         roomName={roomName}
         userInfo={{ displayName }}
         configOverwrite={{
           startWithAudioMuted: false,
           startWithVideoMuted: false,
           prejoinPageEnabled: true,
           disableInviteFunctions: true,
         }}
         onApiReady={(api) => {
           api.addEventListener('participantLeft', () => { /* update booking status */ });
           api.addEventListener('videoConferenceEnded', () => { /* close meeting */ });
         }}
         getIFrameRef={(iframe) => {
           iframe.style.borderRadius = '12px';
         }}
       />
     );
   }
   ```

6. **When we need custom UI, we can fork.** Jitsi Meet is React. If we ever need pixel-level control, we fork the UI and customize. But we start with the full product and customize later if needed.

## Architecture

### Docker Compose Addition

```yaml
# docker-compose.meeting.yml
services:
  web:
    image: jitsi/web:latest
    ports:
      - "8443:8443"
      - "8080:8000"
    environment:
      - ENABLE_AUTH=1
      - ENABLE_GUESTS=1
      - ENABLE_LOBBY=1
      - AUTH_TYPE=jwt
      - JWT_APP_ID=smyth-meeting
      - JWT_APP_SECRET=${JWT_SECRET}
      - JWT_ACCEPTED_ISSUERS=smyth
      - PUBLIC_URL=https://meet.smyth.app
    volumes:
      - ./jitsi/web:/config
      - ./jitsi/transcripts:/usr/share/jitsi-meet/transcripts

  prosody:
    image: jitsi/prosody:latest
    environment:
      - AUTH_TYPE=jwt
      - JWT_APP_ID=smyth-meeting
      - JWT_APP_SECRET=${JWT_SECRET}
      - ENABLE_AUTH=1
      - ENABLE_GUESTS=1
      - ENABLE_LOBBY=1
    volumes:
      - ./jitsi/prosody:/config

  jicofo:
    image: jitsi/jicofo:latest
    environment:
      - AUTH_TYPE=jwt
    volumes:
      - ./jitsi/jicofo:/config

  jvb:
    image: jitsi/jvb:latest
    ports:
      - "10000:10000/udp"
      - "4443:4443"
    environment:
      - JVB_AUTH_USER=jvb
      - JVB_AUTH_PASSWORD=${JVB_SECRET}
      - PUBLIC_URL=https://meet.smyth.app
    volumes:
      - ./jitsi/jvb:/config
```

### Token Generation API

```typescript
// /api/meeting/token/route.ts
import jwt from 'jsonwebtoken';

export async function POST(req: Request) {
  const { roomName, participantName, isHost } = await req.json();
  
  const token = jwt.sign(
    {
      context: {
        user: {
          name: participantName,
          moderator: isHost,
        },
      },
      aud: 'smyth-meeting',
      iss: 'smyth-meeting',
      sub: 'meet.smyth.app',
      room: roomName,
    },
    process.env.JWT_SECRET!,
    { expiresIn: '24h' }
  );
  
  return Response.json({ 
    token,
    url: `https://meet.smyth.app/${roomName}`,
    roomName 
  });
}
```

### Meeting Room Component

```tsx
// /src/components/MeetingRoom.tsx
import { JitsiMeeting } from "@jitsi/react-sdk";

interface MeetingRoomProps {
  roomName: string;
  displayName: string;
  isHost?: boolean;
  onMeetingEnd?: () => void;
}

export default function MeetingRoom({ roomName, displayName, isHost, onMeetingEnd }: MeetingRoomProps) {
  return (
    <div className="w-full h-full">
      <JitsiMeeting
        domain={process.env.NEXT_PUBLIC_JITSI_DOMAIN || "meet.smyth.app"}
        roomName={roomName}
        userInfo={{ displayName }}
        configOverwrite={{
          startWithAudioMuted: false,
          startWithVideoMuted: false,
          prejoinPageEnabled: true,
          disableInviteFunctions: !isHost,
          lobby: { enabled: isHost },
          toolbarButtons: isHost 
            ? ['microphone', 'camera', 'desktop', 'chat', 'recording', 'raisehand', 'tileview', 'hangup']
            : ['microphone', 'camera', 'chat', 'raisehand', 'tileview', 'hangup'],
        }}
        onApiReady={(api) => {
          api.addEventListener('videoConferenceEnded', () => onMeetingEnd?.());
          api.addEventListener('participantLeft', () => { /* track attendance */ });
        }}
        getIFrameRef={(iframe) => {
          iframe.style.borderRadius = '12px';
          iframe.style.overflow = 'hidden';
        }}
      />
    </div>
  );
}
```

### Public Meeting Page

```tsx
// /app/meeting/[uid]/page.tsx
import MeetingRoom from "@/components/MeetingRoom";

export default async function MeetingPage({ params }: { params: { uid: string } }) {
  const booking = await getBooking(params.uid);
  
  return (
    <div className="h-screen bg-background">
      <MeetingRoom
        roomName={`smyth-${params.uid}`}
        displayName={booking?.attendeeName || "Guest"}
        isHost={false}
      />
    </div>
  );
}
```

### Scheduling Integration

When a booking is created, the `location` field gets set to the meeting link:

```typescript
const meetingUrl = `${process.env.NEXT_PUBLIC_URL}/meeting/${booking.uid}`;
// OR directly: `https://meet.smyth.app/smyth-${booking.uid}`
```

The SchedulingPanel shows a "Join Meeting" button for confirmed bookings that opens the meeting room.

### Agent Integration

The agent can:
- Create a booking → automatically generates a meeting link
- Share the link via email: "Your meeting link is https://meet.smyth.app/smyth-abc123"
- Join the meeting as a participant (via browser automation)
- Record meeting attendance (via Jitsi API events)

## Resource Requirements

| Resource | Jitsi (4 containers) | Notes |
|----------|----------------------|-------|
| RAM | ~1.5GB | Fine on a 4GB+ VPS |
| Disk | ~1GB | Images + config |
| CPU | Low when idle, spikes during calls | |
| Ports | 8080, 8443, 10000/udp | Behind reverse proxy |
| Domain | meet.smyth.app (subdomain) | SSL via Let's Encrypt |

**For Smyth's use case** (1-10 person meetings, not a conferencing platform), this is more than enough. A $6-12/month VPS handles it easily.

## Implementation Phases

### Phase 1 — Core Meeting (Build Now)

1. Install `@jitsi/react-sdk`
2. Docker Compose for Jitsi Meet backend
3. `/api/meeting/token` — JWT token generation
4. `MeetingRoom` component — JitsiMeeting iframe wrapper
5. `/meeting/[uid]` — public meeting page
6. SchedulingPanel integration — "Join Meeting" button
7. Agent integration — create bookings with meeting links

### Phase 2 — Polish

- Custom branding (Smyth logo, colors in Jitsi config)
- Meeting lobby (host must admit guests)
- Meeting recording (Jibri container)
- Meeting end → auto-update booking status
- Meeting attendance tracking

### Phase 3 — Advanced

- Breakout rooms
- SIP gateway (Jigasi — phone dial-in)
- Meeting transcription (via Whisper)
- AI meeting notes (agent listens and summarizes)
- Custom Jitsi UI fork (if iframe isn't enough)

## Cost

| Item | Cost |
|------|------|
| Jitsi Meet server | $0 (self-hosted) |
| VPS (4GB RAM) | $6-12/month |
| Domain (meet.smyth.app) | ~$10/year |
| SSL (Let's Encrypt) | $0 |
| **Total** | **~$6-12/month** |

vs Zoom: $13-22/month per user
vs Google Meet: requires Workspace ($72/year minimum)
vs Teams: $4-22/month per user

**Smyth: $6-12/month total, unlimited users, self-hosted.**