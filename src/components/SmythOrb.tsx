"use client";

/**
 * SmythOrb — Animated avatar orb for voice mode.
 * Shows speaking state with audio-reactive animation.
 * Mic recording is handled by the existing voice recorder.
 */

import { VolumeX } from "lucide-react";

interface SmythOrbProps {
  /** Size in pixels (default 120) */
  size?: number;
  /** Show inline in sidebar (compact) or standalone (full) */
  compact?: boolean;
  /** Voice conversation state */
  voiceState?: "idle" | "listening" | "processing" | "speaking" | "error";
  /** Audio level for animation */
  audioLevel?: number;
  /** Last response text */
  lastResponse?: string;
  /** Error message */
  error?: string | null;
  /** Stop speaking callback */
  onStopSpeaking?: () => void;
}

export default function SmythOrb({
  size = 120,
  compact = false,
  voiceState = "idle",
  audioLevel = 0,
  lastResponse = "",
  error = null,
  onStopSpeaking,
}: SmythOrbProps) {
  // Audio-reactive scale
  const scale = voiceState === "speaking"
    ? 1 + (audioLevel * 0.12)
    : 1;

  // Glow intensity
  const glowIntensity = voiceState === "speaking"
    ? 0.4 + (audioLevel * 0.6)
    : 0.12;

  // Ring color
  const ringColor = voiceState === "speaking"
    ? "var(--accent)"
    : voiceState === "listening"
    ? "#22c55e" // green
    : voiceState === "error"
    ? "#ef4444" // red
    : "var(--muted)";

  const ringWidth = voiceState === "speaking"
    ? 2 + (audioLevel * 3)
    : voiceState === "listening"
    ? 2.5
    : 1.5;

  const stateLabel = voiceState === "speaking"
    ? "Speaking"
    : voiceState === "listening"
    ? "Listening"
    : voiceState === "error"
    ? "Error"
    : "";

  return (
    <div className={`flex flex-col items-center gap-3 ${compact ? "py-2" : "py-4"}`}>
      {/* The Orb */}
      <div
        className="relative cursor-default transition-transform duration-150 ease-out"
        style={{
          width: size,
          height: size,
          transform: `scale(${scale})`,
        }}
      >
        {/* Outer glow ring */}
        <div
          className="absolute inset-0 rounded-full transition-all duration-200"
          style={{
            boxShadow: `0 0 ${8 + glowIntensity * 24}px ${2 + glowIntensity * 10}px ${ringColor}`,
            opacity: 0.5 + glowIntensity * 0.5,
          }}
        />

        {/* Ring border */}
        <div
          className="absolute inset-0 rounded-full transition-all duration-200"
          style={{
            border: `${ringWidth}px solid ${ringColor}`,
            boxShadow: `inset 0 0 ${4 + glowIntensity * 10}px ${ringColor}`,
          }}
        />

        {/* Inner circle with logo */}
        <div
          className="absolute rounded-full overflow-hidden transition-all duration-200"
          style={{
            inset: `${3 + ringWidth}px`,
            background: voiceState === "speaking"
              ? "radial-gradient(circle at 40% 35%, #1a2a1a, #0a0a0a)"
              : "radial-gradient(circle at 40% 35%, #1a1a1a, #0a0a0a)",
          }}
        >
          {/* Logo */}
          <img
            src="/Artwork/Smyth-Logo-NoBg.png"
            alt="Smyth"
            className="w-full h-full object-contain"
            style={{
              filter: voiceState === "speaking"
                ? `brightness(${0.9 + audioLevel * 0.3})`
                : "brightness(0.85)",
              transition: "filter 0.15s ease-out",
            }}
            draggable={false}
          />
        </div>

        {/* Idle breathing pulse */}
        {voiceState === "idle" && (
          <div
            className="absolute inset-0 rounded-full animate-pulse"
            style={{
              border: "1px solid var(--muted)",
              opacity: 0.15,
              animationDuration: "3s",
            }}
          />
        )}

        {/* Listening pulse (green, slow) */}
        {voiceState === "listening" && (
          <div
            className="absolute inset-0 rounded-full"
            style={{
              border: "3px solid #22c55e",
              animation: "ping 2s cubic-bezier(0, 0, 0.2, 1) infinite",
              opacity: 0.25 + audioLevel * 0.5,
            }}
          />
        )}

        {/* Speaking pulse */}
        {voiceState === "speaking" && (
          <div
            className="absolute inset-0 rounded-full"
            style={{
              border: `${2 + audioLevel * 2}px solid var(--accent)`,
              animation: "ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite",
              opacity: 0.15 + audioLevel * 0.3,
            }}
          />
        )}
      </div>

      {/* State label */}
      {stateLabel && (
        <div
          className="text-[10px] font-medium tracking-wider uppercase"
          style={{
            color: voiceState === "speaking" ? "var(--accent)" : "#ef4444",
          }}
        >
          {stateLabel}
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="text-[9px] text-red-400 bg-red-500/10 border border-red-500/30 rounded px-2 py-1 max-w-[200px] text-center">
          {error}
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-2">
        {/* Stop speaking */}
        {voiceState === "speaking" && onStopSpeaking && (
          <button
            onClick={onStopSpeaking}
            className="w-8 h-8 rounded-full border bg-red-500/10 border-red-400 text-red-400 flex items-center justify-center cursor-pointer hover:bg-red-500/20 transition-all"
            title="Stop speaking"
          >
            <VolumeX size={14} />
          </button>
        )}


      </div>

      {/* Last response (truncated) */}
      {lastResponse && voiceState === "idle" && !compact && (
        <div className="text-[9px] text-muted max-w-[200px] text-center line-clamp-3 mt-1">
          {lastResponse.slice(0, 120)}{lastResponse.length > 120 ? "..." : ""}
        </div>
      )}
    </div>
  );
}