"use client";

import { useState, useRef, useCallback } from "react";

export type RecState = "idle" | "recording";

export interface UseVoiceRecorderReturn {
  state: RecState;
  startRecording: () => Promise<void>;
  stopAndGetBlob: () => Promise<Blob | null>;
  cancelRecording: () => void;
  audioLevel: number;
}

export function useVoiceRecorder(): UseVoiceRecorderReturn {
  const [state, setState] = useState<RecState>("idle");
  const [audioLevel, setAudioLevel] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const animationRef = useRef<number>(0);
  const resolveStopRef = useRef<((blob: Blob | null) => void) | null>(null);

  const startLevelMonitor = useCallback((stream: MediaStream) => {
    if (audioContextRef.current) {
      try { audioContextRef.current.close(); } catch {}
    }
    const audioCtx = new AudioContext();
    audioContextRef.current = audioCtx;
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyserRef.current = analyser;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const update = () => {
      if (!analyserRef.current) return;
      analyserRef.current.getByteFrequencyData(dataArray);
      const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
      setAudioLevel(Math.min(avg / 128, 1));
      animationRef.current = requestAnimationFrame(update);
    };
    update();
  }, []);

  const stopLevelMonitor = useCallback(() => {
    if (animationRef.current) { cancelAnimationFrame(animationRef.current); animationRef.current = 0; }
    const ctx = audioContextRef.current;
    if (ctx && ctx.state !== "closed") {
      ctx.close().catch(() => {});
    }
    audioContextRef.current = null;
    analyserRef.current = null;
    setAudioLevel(0);
  }, []);

  const cleanupStream = useCallback(() => {
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus" : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        chunksRef.current = [];
        cleanupStream();
        stopLevelMonitor();
        if (resolveStopRef.current) { resolveStopRef.current(blob); resolveStopRef.current = null; }
      };
      recorder.start(250);
      startLevelMonitor(stream);
      setState("recording");
    } catch {
      cleanupStream();
      setState("idle");
    }
  }, [startLevelMonitor, cleanupStream, stopLevelMonitor]);

  const stopAndGetBlob = useCallback(async (): Promise<Blob | null> => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      cleanupStream();
      stopLevelMonitor();
      setState("idle");
      return null;
    }
    return new Promise(resolve => {
      resolveStopRef.current = (blob) => {
        setState("idle");
        resolve(blob);
      };
      recorder.stop();
    });
  }, [cleanupStream, stopLevelMonitor]);

  const cancelRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.stop();
    }
    resolveStopRef.current = null;
    chunksRef.current = [];
    cleanupStream();
    stopLevelMonitor();
    setState("idle");
  }, [cleanupStream, stopLevelMonitor]);

  return { state, startRecording, stopAndGetBlob, cancelRecording, audioLevel };
}