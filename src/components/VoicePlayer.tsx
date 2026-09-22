"use client";

/**
 * VoicePlayer — inline audio player for Smyth TTS messages.
 * Renders a small play/pause bar with waveform animation.
 */

import { useState, useRef, useEffect } from "react";
import { Play, Pause, Volume2 } from "lucide-react";

interface VoicePlayerProps {
  src: string; // URL or local path to audio file
  label?: string;
  autoPlay?: boolean;
}

export default function VoicePlayer({ src, label, autoPlay }: VoicePlayerProps) {
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const barsRef = useRef<HTMLDivElement>(null);

  // Resolve audio source
  const audioSrc = src.startsWith("http") || src.startsWith("/")
    ? src
    : `/api/workspace?file=${encodeURIComponent(src.split("/").pop() || src)}`;

  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio(audioSrc);
      audioRef.current.onloadedmetadata = () => {
        setDuration(audioRef.current?.duration || 0);
      };
      audioRef.current.onended = () => {
        setPlaying(false);
        setCurrentTime(0);
      };
      audioRef.current.ontimeupdate = () => {
        setCurrentTime(audioRef.current?.currentTime || 0);
      };
    }

    if (autoPlay && audioRef.current && !playing) {
      togglePlay();
    }

    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, [src]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(() => {});
    }
    setPlaying(!playing);
  };

  const formatTime = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Generate waveform bars
  const bars = Array.from({ length: 20 }, (_, i) => {
    const h = 20 + Math.abs(Math.sin(i * 0.8 + currentTime * 2)) * 24;
    return h;
  });

  return (
    <div className="flex items-center gap-2 bg-muted-bg border border-border rounded-lg px-3 py-2 my-1.5 min-w-0">
      <button
        onClick={togglePlay}
        className="w-7 h-7 rounded-full bg-accent hover:bg-accent/80 text-[#08080a] flex items-center justify-center cursor-pointer border-none flex-shrink-0 transition-all"
        title={playing ? "Pause" : "Play"}
      >
        {playing ? <Pause size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" className="ml-0.5" />}
      </button>

      {/* Waveform visualization */}
      <div ref={barsRef} className="flex items-end gap-[2px] h-8 flex-1">
        {bars.map((h, i) => (
          <div
            key={i}
            className="w-[3px] rounded-full transition-all duration-100"
            style={{
              height: `${h}%`,
              backgroundColor: playing ? "var(--accent)" : "var(--muted)",
              opacity: playing ? (0.5 + Math.abs(Math.sin(i * 0.5 + currentTime * 3)) * 0.5) : 0.3,
            }}
          />
        ))}
      </div>

      {/* Time + label */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-[10px] text-muted font-mono tabular-nums">
          {formatTime(currentTime || 0)} / {formatTime(duration || 0)}
        </span>
        {label && (
          <span className="text-[9px] text-muted truncate max-w-[60px]">{label}</span>
        )}
        <Volume2 size={11} className="text-muted" />
      </div>
    </div>
  );
}
