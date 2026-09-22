"use client";

export const dynamic = "force-dynamic";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import MeetingRoom from "@/components/MeetingRoom";

export default function MeetingPage() {
  const params = useParams();
  const uid = params.uid as string;
  const [displayName, setDisplayName] = useState("");
  const [joined, setJoined] = useState(false);
  const [booking, setBooking] = useState<any>(null);
  const [meetingEnded, setMeetingEnded] = useState(false);

  useEffect(() => {
    // Try to fetch booking details
    fetch(`/api/scheduling/bookings?uid=${uid}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.booking) setBooking(data.booking);
      })
      .catch(() => {
        // Booking not found — still allow joining
      });
  }, [uid]);

  const roomName = `smyth-${uid}`;

  if (meetingEnded) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-4">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-green-400">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold mb-2">Meeting Ended</h2>
          <p className="text-sm text-white/60 mb-4">Thanks for using Smyth Meetings</p>
          <button
            onClick={() => window.close()}
            className="px-4 py-2 bg-white/10 text-white rounded-lg text-sm hover:bg-white/20 transition-colors cursor-pointer"
          >
            Close Window
          </button>
        </div>
      </div>
    );
  }

  if (!joined) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          {/* Logo */}
          <div className="flex items-center justify-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-lg bg-indigo-600 flex items-center justify-center text-lg font-bold">
              S
            </div>
            <span className="text-xl font-semibold">Smyth Meeting</span>
          </div>

          {/* Meeting info */}
          {booking && (
            <div className="bg-white/5 rounded-lg p-4 mb-6 border border-white/10">
              <h2 className="text-base font-medium mb-1">{booking.title}</h2>
              <div className="text-sm text-white/60">
                {new Date(booking.startTime).toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}{" "}
                at{" "}
                {new Date(booking.startTime).toLocaleTimeString("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </div>
              {booking.location && (
                <div className="text-sm text-white/40 mt-1">{booking.location}</div>
              )}
            </div>
          )}

          {/* Join form */}
          <div className="bg-white/5 rounded-lg p-6 border border-white/10">
            <h3 className="text-sm font-medium mb-4">Join Meeting</h3>

            <div className="mb-4">
              <label className="block text-xs text-white/40 mb-1.5">Your Name</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Enter your name"
                className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-indigo-500 transition-colors"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && displayName.trim()) setJoined(true);
                }}
              />
            </div>

            <button
              onClick={() => setJoined(true)}
              disabled={!displayName.trim()}
              className="w-full py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium cursor-pointer hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15.6 11.6L22 7v10l-6.4-4.6v1zM3.4 5h13.2c1.1 0 2 .9 2 2v10c0 1.1-.9 2-2 2H3.4c-1.1 0-2-.9-2-2V7c0-1.1.9-2 2-2z" />
              </svg>
              Join Now
            </button>

            <p className="text-[10px] text-white/30 text-center mt-3">
              By joining, you agree to the meeting terms of service.
            </p>
          </div>

          {/* Powered by */}
          <div className="text-center mt-6 text-[10px] text-white/20">
            Powered by Smyth Super Agent
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-[#0a0a0a]">
      <MeetingRoom
        roomName={roomName}
        displayName={displayName || "Guest"}
        isHost={false}
        onMeetingEnd={() => setMeetingEnded(true)}
      />
    </div>
  );
}