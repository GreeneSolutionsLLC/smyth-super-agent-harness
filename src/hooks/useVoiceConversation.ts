"use client";

/**
 * useVoiceConversation — Full voice conversation loop with silence detection.
 *
 * Flow: startConversation() → listening → silence 4s → transcribe → LLM → TTS → listening again
 *
 * Caller provides `onUserMessage(text)` and `onAssistantReply(text)` to update chat.
 * State machine: idle → listening → processing → speaking → listening → ...
 */

import { useState, useRef, useCallback, useEffect } from "react";

export type ConvState = "idle" | "listening" | "processing" | "speaking";

export interface VoiceConversationReturn {
  state: ConvState;
  audioLevel: number;
  error: string | null;
  startConversation: () => void;
  stopConversation: () => void;
  /** Latest assistant reply text from the current conversation turn */
  lastTranscript: string;
  lastReply: string;
}

/** How long silence must last (ms) before auto-stopping recording */
const SILENCE_TIMEOUT = 4000;
/** Normalised RMS below this threshold counts as silence */
const SILENCE_THRESHOLD = 0.06;
/** Minimum recording length before silence triggers (prevents false starts) */
const MIN_RECORDING_MS = 800;

export function useVoiceConversation(
  onUserMessage: (text: string) => void,
  onAssistantReply: (text: string) => void,
  voiceName?: string,
): VoiceConversationReturn {
  const [state, setState] = useState<ConvState>("idle");
  const [audioLevel, setAudioLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [lastTranscript, setLastTranscript] = useState("");
  const [lastReply, setLastReply] = useState("");

  // ── Message history — built up turn by turn for context ──
  const historyRef = useRef<{ role: string; content: string }[]>([]);

  // Keep voice name in a ref so speak() always reads the latest
  const voiceNameRef = useRef(voiceName);
  voiceNameRef.current = voiceName;

  // ── Persistent refs ──
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const silenceRafRef = useRef<number>(0);
  const levelRafRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const lastLoudRef = useRef<number>(Date.now());
  const runningRef = useRef<boolean>(false);
  const stoppedRef = useRef<boolean>(false);
  const ttsAbortRef = useRef<AbortController | null>(null);

  // ── Cleanup ──
  const cleanup = useCallback(() => {
    // Null out onstop before stopping so processTurn doesn't fire
    const rec = recorderRef.current;
    if (rec) {
      rec.onstop = null;
      if (rec.state !== "inactive") {
        try { rec.stop(); } catch {}
      }
    }
    recorderRef.current = null;

    // Stop stream
    const str = streamRef.current;
    if (str) {
      str.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }

    // Close audio context
    const ctx = audioCtxRef.current;
    if (ctx && ctx.state !== "closed") {
      try { ctx.close(); } catch {}
    }
    audioCtxRef.current = null;
    analyserRef.current = null;

    // Cancel RAFs
    if (silenceRafRef.current) { cancelAnimationFrame(silenceRafRef.current); silenceRafRef.current = 0; }
    if (levelRafRef.current) { cancelAnimationFrame(levelRafRef.current); levelRafRef.current = 0; }

    // Abort any ongoing TTS
    if (ttsAbortRef.current) { ttsAbortRef.current.abort(); ttsAbortRef.current = null; }

    chunksRef.current = [];
    setAudioLevel(0);
  }, []);

  // ── Stop everything ──
  const stopConversation = useCallback(() => {
    stoppedRef.current = true;
    runningRef.current = false;
    cleanup();
    setState("idle");
    setError(null);
  }, [cleanup]);

  // ── TTS speak (same logic as useVoiceChat but fixed) ──
  const speak = useCallback(async (text: string): Promise<void> => {
    try {
      const controller = new AbortController();
      ttsAbortRef.current = controller;

      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.slice(0, 5000), voice: voiceNameRef.current || "smyth" }),
        signal: controller.signal,
      });
      if (!res.ok) {
        let errMsg = `TTS failed (${res.status})`;
        try { const d = await res.json(); errMsg = d.error || errMsg; } catch {}
        throw new Error(errMsg);
      }
      const blob = await res.blob();
      if (blob.size < 100) throw new Error("Empty audio");

      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.volume = 1;

      // Try to wire audio through analyser for orb animation
      // If AudioContext fails, play falls back to normal HTMLAudioElement
      let useAnalyser = false;
      try {
        const ctx = new AudioContext();
        if (ctx.state === "suspended") await ctx.resume();
        const source = ctx.createMediaElementSource(audio);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyser.connect(ctx.destination);
        audioCtxRef.current = ctx;
        analyserRef.current = analyser;
        useAnalyser = true;
      } catch {
        // Analyser wiring failed — audio plays natively, no orb level
      }

      if (useAnalyser) {
        const data = new Uint8Array(analyserRef.current!.frequencyBinCount);
        const updateLevel = () => {
          if (!runningRef.current) return;
          if (!audio.paused && analyserRef.current) {
            analyserRef.current.getByteFrequencyData(data);
            const avg = data.reduce((a, b) => a + b, 0) / data.length;
            setAudioLevel(Math.min(avg / 128, 1));
          }
          levelRafRef.current = requestAnimationFrame(updateLevel);
        };
        updateLevel();
      }

      return new Promise<void>((resolve) => {
        audio.onended = () => {
          URL.revokeObjectURL(url);
          if (levelRafRef.current) { cancelAnimationFrame(levelRafRef.current); levelRafRef.current = 0; }
          setAudioLevel(0);
          resolve();
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          if (levelRafRef.current) { cancelAnimationFrame(levelRafRef.current); levelRafRef.current = 0; }
          setAudioLevel(0);
          resolve();
        };
        audio.play().catch((e) => {
          console.error("[voice-conv] play failed:", e);
          URL.revokeObjectURL(url);
          if (levelRafRef.current) { cancelAnimationFrame(levelRafRef.current); levelRafRef.current = 0; }
          setAudioLevel(0);
          resolve();
        });
      });
    } catch (err: any) {
      if (err.name === "AbortError") return;
      console.error("[voice-conv] TTS error:", err.message);
    }
  }, []);

  // ── Transcribe audio blob ──
  const transcribe = useCallback(async (blob: Blob): Promise<string> => {
    const formData = new FormData();
    formData.append("audio", blob, "recording.webm");
    const res = await fetch("/api/transcribe", { method: "POST", body: formData });
    if (!res.ok) throw new Error(`Transcription failed: ${res.status}`);
    const data = await res.json();
    return (data.text || "").trim();
  }, []);

  // ── Send to LLM streaming, get reply ──
  const getAssistantReply = useCallback(async (text: string): Promise<string> => {
    const payload = {
      message: text,
      history: historyRef.current,
    };
    const res = await fetch("/api/voice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`LLM failed: ${res.status}`);
    if (!res.body) throw new Error("No response body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let reply = "";
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const event = JSON.parse(line.slice(6));
          if (event.type === "complete" && event.reply) reply = event.reply;
        } catch {}
      }
    }
    // Last line
    if (buffer.startsWith("data: ")) {
      try {
        const event = JSON.parse(buffer.slice(6));
        if (event.type === "complete" && event.reply) reply = event.reply;
      } catch {}
    }
    return reply.trim();
  }, []);

  // ── Silence detection loop ──
  // This runs on a separate rAF watching the analyser from the recording stream.
  const runSilenceDetection = useCallback(() => {
    if (!runningRef.current) return;

    const analyser = analyserRef.current;
    if (!analyser) {
      silenceRafRef.current = requestAnimationFrame(runSilenceDetection);
      return;
    }

    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    const avg = data.reduce((a, b) => a + b, 0) / data.length;
    const level = avg / 128;

    // Update orb level
    setAudioLevel(Math.min(level, 1));

    const now = Date.now();
    if (level > SILENCE_THRESHOLD) {
      lastLoudRef.current = now;
    }

    const silenceDuration = now - lastLoudRef.current;
    const recordingDuration = now - startTimeRef.current;

    // Auto-stop on sustained silence
    if (
      silenceDuration > SILENCE_TIMEOUT &&
      recordingDuration > MIN_RECORDING_MS
    ) {
      // Stop recording → processTurn fires via onstop.
      // runningRef stays true so the loop continues.
      const rec = recorderRef.current;
      if (rec && rec.state !== "inactive") {
        rec.stop();
      }
      return;
    }

    silenceRafRef.current = requestAnimationFrame(runSilenceDetection);
  }, []);

  // ── Conversation loop heart ──
  const processTurn = useCallback(async () => {
    // Silence detector set runningRef=false before stopping the recorder.
    // Set it back to true since we're still in the conversation loop.
    runningRef.current = true;

    setState("processing");

    try {
      const blob = new Blob(chunksRef.current, { type: recorderRef.current?.mimeType || "audio/webm" });
      chunksRef.current = [];

      if (blob.size < 200) {
        // Too short — skip back to listening
        if (runningRef.current && !stoppedRef.current) await startListeningInternal();
        return;
      }

      const text = await transcribe(blob);
      if (!text) {
        if (runningRef.current && !stoppedRef.current) await startListeningInternal();
        return;
      }

      // Push user message to chat and into history
      setLastTranscript(text);
      onUserMessage(text);
      historyRef.current.push({ role: "user", content: text });

      // Get LLM reply
      const reply = await getAssistantReply(text);
      if (!reply) {
        if (runningRef.current && !stoppedRef.current) await startListeningInternal();
        return;
      }

      // Push assistant reply to chat and into history
      setLastReply(reply);
      onAssistantReply(reply);
      historyRef.current.push({ role: "assistant", content: reply });

      // Speak via TTS
      setState("speaking");
      await speak(reply);

      // Continue loop — only if not explicitly stopped
      if (runningRef.current && !stoppedRef.current) await startListeningInternal();
    } catch (err: any) {
      console.error("[voice-conv] turn error:", err);
      setError(err.message);
      setState("idle");
    }
  }, [transcribe, getAssistantReply, speak, onUserMessage, onAssistantReply]);

  // ── Start listening (internal) ──
  const startListeningInternal = useCallback(async () => {
    if (!runningRef.current || stoppedRef.current) return;
    setState("listening");
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!runningRef.current) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }

      streamRef.current = stream;
      chunksRef.current = [];

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus" : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        // Stream cleanup happens in processTurn or cleanup
        processTurn();
      };

      recorder.start(250);

      // Set up AnalyserNode for silence detection
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      // Don't connect to destination (no need to hear ourselves)
      analyserRef.current = analyser;

      startTimeRef.current = Date.now();
      lastLoudRef.current = Date.now();

      // Start silence detection rAF
      if (silenceRafRef.current) cancelAnimationFrame(silenceRafRef.current);
      silenceRafRef.current = requestAnimationFrame(runSilenceDetection);

    } catch {
      setError("Microphone access denied");
      setState("idle");
      runningRef.current = false;
    }
  }, [runSilenceDetection, processTurn]);

  // ── Public: start conversation ──
  const startConversation = useCallback(() => {
    if (runningRef.current) return;
    stoppedRef.current = false;
    runningRef.current = true;
    startListeningInternal();
  }, [startListeningInternal]);

  // ── Cleanup on unmount ──
  useEffect(() => {
    return () => {
      runningRef.current = false;
      cleanup();
    };
  }, [cleanup]);

  return {
    state,
    audioLevel,
    error,
    startConversation,
    stopConversation,
    lastTranscript,
    lastReply,
  };
}
