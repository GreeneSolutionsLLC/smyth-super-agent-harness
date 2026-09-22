"use client";

/**
 * useVoiceChat — Voice conversation loop that piggybacks on the existing
 * recorder + transcribe pipeline, then adds LLM → TTS for voice mode.
 *
 * When voice mode is OFF: mic button does dictation (existing behavior)
 * When voice mode is ON: mic button triggers this hook's conversation loop
 *
 * Flow: existing recorder → existing /api/transcribe → send message → TTS response
 */

import { useState, useRef, useCallback } from "react";

type VoiceState = "idle" | "speaking" | "error";

export interface VoiceChatReturn {
  state: VoiceState;
  audioLevel: number;
  lastResponse: string;
  error: string | null;
  /** Speak a text string through TTS */
  speak: (text: string) => Promise<void>;
  /** Stop current TTS playback */
  stopSpeaking: () => void;
}

export function useVoiceChat(): VoiceChatReturn {
  const [state, setState] = useState<VoiceState>("idle");
  const [audioLevel, setAudioLevel] = useState(0);
  const [lastResponse, setLastResponse] = useState("");
  const [error, setError] = useState<string | null>(null);

  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const abortRef = useRef<AbortController | null>(null);

  // ── Stop Speaking ──
  const stopSpeaking = useCallback(() => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.src = "";
      currentAudioRef.current = null;
    }
    if (playbackCtxRef.current) {
      try { playbackCtxRef.current.close(); } catch {}
      playbackCtxRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = 0;
    }
    analyserRef.current = null;
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setAudioLevel(0);
    setState("idle");
  }, []);

  // ── Speak (TTS) ──
  const speak = useCallback(async (text: string): Promise<void> => {
    // Stop any current playback first
    stopSpeaking();
    setState("speaking");
    setError(null);

    try {
      const controller = new AbortController();
      abortRef.current = controller;

      console.log("[voice-chat] Speaking:", text.slice(0, 80));

      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text.slice(0, 5000),
          voice: "smyth",
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        let errMsg = `TTS failed (${res.status})`;
        try {
          const errData = await res.json();
          errMsg = errData.error || errMsg;
        } catch {}
        throw new Error(errMsg);
      }

      const blob = await res.blob();
      if (blob.size < 100) {
        throw new Error("TTS returned empty audio");
      }

      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      currentAudioRef.current = audio;

      // Monitor playback level for the orb animation
      // Use AudioContext only if available from user gesture (running state)
      let ctx: AudioContext | null = null;
      try {
        ctx = new AudioContext();
        if (ctx.state === "suspended") {
          // Browser requires user gesture — resume or skip analyser
          await ctx.resume();
        }
      } catch {
        ctx = null;
      }

      if (ctx) {
        playbackCtxRef.current = ctx;
        const source = ctx.createMediaElementSource(audio);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyser.connect(ctx.destination);
        analyserRef.current = analyser;

        const data = new Uint8Array(analyser.frequencyBinCount);
        const updateLevel = () => {
          if (!currentAudioRef.current || currentAudioRef.current.paused) {
            setAudioLevel(0);
            return;
          }
          analyser.getByteFrequencyData(data);
          const avg = data.reduce((a, b) => a + b, 0) / data.length;
          setAudioLevel(Math.min(avg / 128, 1));
          animFrameRef.current = requestAnimationFrame(updateLevel);
        };
      }

      return new Promise<void>((resolve) => {
        audio.onended = () => {
          currentAudioRef.current = null;
          if (playbackCtxRef.current) {
            try { playbackCtxRef.current.close(); } catch {}
            playbackCtxRef.current = null;
          }
          analyserRef.current = null;
          if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
          URL.revokeObjectURL(url);
          setAudioLevel(0);
          setState("idle");
          resolve();
        };
        audio.onerror = () => {
          currentAudioRef.current = null;
          if (playbackCtxRef.current) {
            try { playbackCtxRef.current.close(); } catch {}
            playbackCtxRef.current = null;
          }
          analyserRef.current = null;
          if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
          URL.revokeObjectURL(url);
          setAudioLevel(0);
          setState("idle");
          resolve();
        };
        audio.play().catch((playErr) => {
          console.error("[voice-chat] Audio playback failed:", playErr);
          setError("Audio playback failed");
          setState("error");
          // Still resolve so the chain doesn't hang
          currentAudioRef.current = null;
          if (playbackCtxRef.current) {
            try { playbackCtxRef.current.close(); } catch {}
            playbackCtxRef.current = null;
          }
          analyserRef.current = null;
          if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
          URL.revokeObjectURL(url);
          setAudioLevel(0);
          setState("idle");
          resolve();
        });
      });
    } catch (err: any) {
      if (err.name === "AbortError") return;
      console.error("[voice-chat] TTS error:", err.message);
      setError(err.message);
      setState("error");
    }
  }, [stopSpeaking]);

  return {
    state,
    audioLevel,
    lastResponse,
    error,
    speak,
    stopSpeaking,
  };
}