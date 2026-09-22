"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Phone,
  PhoneOff,
  Mic,
  MicOff,
  Video,
  VideoOff,
  X,
  Loader2,
  ExternalLink,
  Copy,
  Users,
} from "lucide-react";

// ── Types ──

interface MeetingRoomProps {
  roomName: string;
  displayName: string;
  isHost?: boolean;
  bookingId?: string;
  onClose?: () => void;
  onMeetingEnd?: () => void;
  onTranscriptReady?: (transcript: any) => void;
}

// ── Component ──

export default function MeetingRoom({
  roomName,
  displayName,
  isHost = false,
  bookingId,
  onClose,
  onMeetingEnd,
  onTranscriptReady,
}: MeetingRoomProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [meetingActive, setMeetingActive] = useState(false);
  const [participantCount, setParticipantCount] = useState(0);
  const [JitsiMeeting, setJitsiMeeting] = useState<React.ComponentType<any> | null>(null);
  const [notetakerPid, setNotetakerPid] = useState<number | null>(null);
  const meetingStartRef = useRef<number | null>(null);

  // Dynamically import JitsiMeeting to avoid SSR issues
  useEffect(() => {
    import("@jitsi/react-sdk").then((mod) => {
      setJitsiMeeting(() => mod.JitsiMeeting);
    }).catch((err) => {
      console.error("[meeting] Failed to load Jitsi SDK:", err);
      setError("Failed to load meeting SDK. Please try again.");
    });
  }, []);

  const handleApiReady = useCallback((api: any) => {
    apiRef.current = api;
    setLoading(false);
    setMeetingActive(true);
    meetingStartRef.current = Date.now();

    // Start notetaker if bookingId provided
    if (bookingId) {
      fetch("/api/notetaker/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomName,
          bookingId,
          displayName: "Smyth Notetaker",
        }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.pid) {
            setNotetakerPid(data.pid);
            console.log(`[meeting] Notetaker started, PID: ${data.pid}`);
          }
        })
        .catch((err) => console.error("[meeting] Failed to start notetaker:", err));
    }

    // Track participants
    api.addEventListener("participantJoined", () => {
      setParticipantCount((prev) => prev + 1);
    });
    api.addEventListener("participantLeft", () => {
      setParticipantCount((prev) => Math.max(0, prev - 1));
    });

    // Track meeting end
    api.addEventListener("videoConferenceEnded", () => {
      setMeetingActive(false);
      onMeetingEnd?.();
    });

    api.addEventListener("videoConferenceJoined", () => {
      setMeetingActive(true);
      setParticipantCount(1);
    });
  }, [onMeetingEnd, bookingId, roomName]);

  const handleReadyToClose = useCallback(() => {
    setMeetingActive(false);
    if (meetingStartRef.current) {
      const duration = Math.floor((Date.now() - meetingStartRef.current) / 1000);
      console.log(`[meeting] Meeting duration: ${duration}s`);
    }
    // Fetch transcript if bookingId provided
    if (bookingId) {
      setTimeout(() => {
        fetch(`http://localhost:5001/api/bookings/${bookingId}/transcript`)
          .then((res) => res.json())
          .then((data) => {
            if (data && !data.error) {
              onTranscriptReady?.(data);
            }
          })
          .catch(() => {});
      }, 3000);
    }
    onMeetingEnd?.();
  }, [onMeetingEnd, onTranscriptReady, bookingId]);

  // Copy meeting link
  const copyMeetingLink = () => {
    const url = `https://meet.greene-solutions.com/${roomName}`;
    navigator.clipboard.writeText(url);
  };

  // Open in new tab
  const openInNewTab = () => {
    const url = `https://meet.greene-solutions.com/${roomName}`;
    window.open(url, "_blank");
  };

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-surface text-foreground p-6">
        <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mb-4">
          <PhoneOff size={28} className="text-red-400" />
        </div>
        <h3 className="text-lg font-semibold mb-2">Meeting Error</h3>
        <p className="text-sm text-muted text-center mb-4">{error}</p>
        <button
          onClick={onClose}
          className="px-4 py-2 bg-accent text-accent-foreground rounded text-sm cursor-pointer hover:bg-accent/80"
        >
          Close
        </button>
      </div>
    );
  }

  // Loading state (before Jitsi loads)
  if (!JitsiMeeting) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-surface text-foreground p-6">
        <Loader2 size={32} className="animate-spin text-accent mb-4" />
        <h3 className="text-sm font-semibold mb-1">Loading Meeting</h3>
        <p className="text-[10px] text-muted">Connecting to {roomName}...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-surface text-foreground">
      {/* Meeting Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-surface z-10">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${meetingActive ? "bg-green-400 animate-pulse" : "bg-amber-400"}`} />
          <span className="text-xs font-medium">{isHost ? "Hosting" : "Joining"} {roomName.replace("smyth-", "Meeting ")}</span>
          {meetingActive && participantCount > 0 && (
            <span className="text-[10px] text-muted flex items-center gap-1">
              <Users size={10} /> {participantCount}
            </span>
          )}
          {notetakerPid && (
            <span className="text-[10px] text-green-400 flex items-center gap-1" title="AI Notetaker recording">
              🤖 Recording
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={copyMeetingLink}
            className="p-1.5 text-muted hover:text-foreground cursor-pointer rounded hover:bg-muted-bg"
            title="Copy meeting link"
          >
            <Copy size={13} />
          </button>
          <button
            onClick={openInNewTab}
            className="p-1.5 text-muted hover:text-foreground cursor-pointer rounded hover:bg-muted-bg"
            title="Open in new tab"
          >
            <ExternalLink size={13} />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 text-muted hover:text-foreground cursor-pointer rounded hover:bg-muted-bg"
              title="Leave meeting"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Jitsi Meeting iframe */}
      <div ref={containerRef} className="flex-1 relative min-h-0" style={{ position: "relative", height: "100%" }}>
        <JitsiMeeting
          domain={process.env.NEXT_PUBLIC_JITSI_DOMAIN || "meet.greene-solutions.com"}
          roomName={roomName}
          userInfo={{
            displayName,
          }}
          configOverwrite={{
            startWithAudioMuted: !isHost,
            startWithVideoMuted: !isHost,
            prejoinPageEnabled: !isHost,
            disableInviteFunctions: !isHost,
            lobby: { enabled: true },
            startWithReactions: false,
            startSilent: false,
            audioProcessors: [],
            toolbarButtons: isHost
              ? ["microphone", "camera", "desktop", "chat", "raisehand", "tileview", "hangup", "recording"]
              : ["microphone", "camera", "chat", "raisehand", "tileview", "hangup"],
            customToolbarButtons: [],
            defaultLogoUrl: "/favicon.ico",
            showJitsiWatermark: false,
            showBrandWatermark: false,
            hidePromoBanner: true,
            SHOW_PROMOTIONAL_CLOSE_PAGE: false,
            SHOW_JITSI_WATERMARK: false,
            resolution: 720,
            constraints: {
              video: { height: { ideal: 720 } },
            },
            enableNoAudioDetection: true,
            enableNoisyMicDetection: true,
          }}
          interfaceConfigOverwrite={{
            SHOW_JITSI_WATERMARK: false,
            SHOW_WATERMARK_FOR_GUESTS: false,
            SHOW_PROMOTIONAL_CLOSE_PAGE: false,
            SHOW_BRAND_WATERMARK: false,
            DEFAULT_BACKGROUND: "#0a0a0a",
            TOOLBAR_BUTTONS: isHost
              ? ["microphone", "camera", "desktop", "chat", "raisehand", "tileview", "hangup"]
              : ["microphone", "camera", "chat", "raisehand", "tileview", "hangup"],
          }}
          onApiReady={handleApiReady}
          onReadyToClose={handleReadyToClose}
          getIFrameRef={(iframe: HTMLIFrameElement) => {
            iframe.style.borderRadius = "0";
            iframe.style.overflow = "hidden";
            iframe.style.width = "100%";
            iframe.style.height = "100%";
            iframe.style.position = "absolute";
            iframe.style.top = "0";
            iframe.style.left = "0";
            iframe.style.border = "none";
          }}
        />
      </div>
    </div>
  );
}