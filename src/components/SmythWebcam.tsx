"use client";

/**
 * Smyth Webcam — Live camera feed with EchoVision analysis.
 *
 * Browser captures frames via getUserMedia → sends JPEG to backend
 * Backend runs EchoVision structural analysis → returns observations
 * Smyth can "see" in real-time via webcam_capture / webcam_watch tools
 */

import { useState, useRef, useCallback, useEffect } from "react";
import {
  Camera,
  CameraOff,
  Eye,
  RefreshCw,
  X,
  Circle,
  Sparkles,
} from "lucide-react";

interface WebcamAnalysis {
  status: string;
  text: string;
  frameId?: string;
  analysis?: any;
  description?: string;
}

export default function SmythWebcam({ onClose }: { onClose: () => void }) {
  const [isActive, setIsActive] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [analysis, setAnalysis] = useState<WebcamAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [watchInterval, setWatchInterval] = useState(3);
  const [isWatching, setIsWatching] = useState(false);
  const [frames, setFrames] = useState<string[]>([]);
  const [vision, setVision] = useState<string>("");
  const [isDescribing, setIsDescribing] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const watchTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const snapshotTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Capture Frame ──
  const captureFrame = useCallback((): string | null => {
    if (!videoRef.current || !canvasRef.current) return null;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  }, []);

  // ── Persist a frame to /tmp/smyth-webcam/latest.jpg without analyzing ──
  const saveSnapshot = useCallback(async (frameData: string) => {
    try {
      await fetch("/api/webcam/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: { data: frameData },
          analyze: false,
        }),
      });
    } catch {
      // silent — this is just a background heartbeat
    }
  }, []);

  // ── Start Camera (auto-called on mount) ──
  const startCamera = useCallback(async () => {
    try {
      setIsStarting(true);
      setError("");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: "user",
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        // Wait for the video element to be ready before playing
        await new Promise<void>((resolve) => {
          if (videoRef.current!.readyState >= 2) return resolve();
          videoRef.current!.onloadeddata = () => resolve();
        });
        await videoRef.current.play().catch(() => {});
      }
      setIsActive(true);

      // Begin saving snapshots every 10s so webcam_capture always has a fresh frame
      snapshotTimerRef.current = setInterval(() => {
        const frame = captureFrame();
        if (frame) saveSnapshot(frame);
      }, 10000);

      // Save an initial snapshot immediately so the tool works without a manual Peek
      const frame = captureFrame();
      if (frame) saveSnapshot(frame);
    } catch (err: any) {
      if (err.name === "NotAllowedError") {
        setError("Camera access was denied. Allow camera in browser settings.");
      } else if (err.name === "NotFoundError") {
        setError("No camera found on this device.");
      } else {
        setError(`Camera error: ${err.message}`);
      }
    } finally {
      setIsStarting(false);
    }
  }, [captureFrame, saveSnapshot]);

  // ── Auto-start on mount ──
  useEffect(() => {
    startCamera();
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (watchTimerRef.current) {
        clearInterval(watchTimerRef.current);
      }
      if (snapshotTimerRef.current) {
        clearInterval(snapshotTimerRef.current);
      }
    };
  }, [startCamera]);

  // ── Stop Camera ──
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsActive(false);
    setIsWatching(false);
    if (watchTimerRef.current) {
      clearInterval(watchTimerRef.current);
      watchTimerRef.current = null;
    }
    if (snapshotTimerRef.current) {
      clearInterval(snapshotTimerRef.current);
      snapshotTimerRef.current = null;
    }
  }, []);

  // ── Analyze Frame ──
  const analyzeFrame = useCallback(async (frameData: string, captureMode: "peek" | "watch" = "peek") => {
    setIsAnalyzing(true);
    try {
      const res = await fetch("/api/webcam/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: { data: frameData },
          detail: captureMode === "peek" ? "balanced" : "low",
          analyze: true,
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        setError(`Analysis failed: ${err}`);
        return null;
      }
      const data: WebcamAnalysis = await res.json();
      setAnalysis(data);
      if (captureMode === "watch") {
        setFrames((prev) => [...prev.slice(-19), data.text]);
      }
      return data;
    } catch (err: any) {
      setError(`Analysis error: ${err.message}`);
      return null;
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  // ── Describe (AI vision — "what are people doing") ──
  const describe = useCallback(async (frameData?: string) => {
    const frame = frameData || captureFrame();
    if (!frame) { setError("Failed to capture frame"); return null; }
    setIsDescribing(true);
    try {
      const res = await fetch("/api/webcam/vision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: { data: frame } }),
      });
      if (!res.ok) {
        const err = await res.text();
        setError(`Vision failed: ${err}`);
        return null;
      }
      const data = await res.json();
      if (data.description) {
        setVision(data.description);
        return data.description;
      }
      setError(data.error || "No description returned");
      return null;
    } catch (err: any) {
      setError(`Vision error: ${err.message}`);
      return null;
    } finally {
      setIsDescribing(false);
    }
  }, [captureFrame]);

  // ── Peek ──
  const peek = useCallback(async () => {
    const frame = captureFrame();
    if (!frame) { setError("Failed to capture frame"); return; }
    await analyzeFrame(frame, "peek");
  }, [captureFrame, analyzeFrame]);

  // ── Watch ──
  const startWatch = useCallback(() => {
    setIsWatching(true);
    setFrames([]);
    const watch = async () => {
      const frame = captureFrame();
      if (!frame) return;
      await analyzeFrame(frame, "watch");
      // Auto-describe each watch tick so the operator sees "what's happening",
      // not just structural stats.
      const desc = await describe(frame);
      if (desc) {
        setFrames((prev) => [...prev.slice(-19), desc]);
      }
    };
    watch();
    watchTimerRef.current = setInterval(watch, watchInterval * 1000);
  }, [captureFrame, analyzeFrame, describe, watchInterval]);

  const stopWatch = useCallback(() => {
    setIsWatching(false);
    if (watchTimerRef.current) {
      clearInterval(watchTimerRef.current);
      watchTimerRef.current = null;
    }
  }, []);

  return (
    <div className="right-section">
      <div className="flex items-center justify-between mb-2">
        <div className="section-label" style={{ marginBottom: 0 }}>
          <span className="flex items-center gap-1.5">
            <Camera size={12} className="text-accent" />
            Camera
          </span>
        </div>
        <button onClick={onClose} className="text-muted hover:text-foreground bg-none border-none p-0 cursor-pointer">
          <X size={14} />
        </button>
      </div>

      {/* Video feed */}
      <div className="relative bg-black rounded-lg overflow-hidden" style={{ aspectRatio: "4/3" }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover"
          style={{ display: isActive ? "block" : "none", transform: "scaleX(-1)" }}
        />
        <canvas ref={canvasRef} className="hidden" />

        {/* Starting state */}
        {isStarting && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <div className="text-center">
              <span className="w-4 h-4 rounded-full border-2 border-accent animate-spin border-t-transparent inline-block" />
              <div className="text-[11px] text-white mt-2">Starting camera...</div>
            </div>
          </div>
        )}

        {/* Error state */}
        {error && !isActive && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center px-4">
              <Camera size={24} className="mx-auto mb-2 text-red-400" />
              <div className="text-[11px] text-red-300">{error}</div>
              <button
                onClick={startCamera}
                className="mt-2 bg-accent text-[#08080a] border-none rounded-md px-3 py-1 text-xs font-semibold cursor-pointer hover:opacity-90 font-sans"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {/* Idle (no error, not started yet) */}
        {!isActive && !isStarting && !error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="w-4 h-4 rounded-full border-2 border-muted animate-spin border-t-transparent inline-block" />
          </div>
        )}

        {/* Analyzing overlay */}
        {isAnalyzing && isActive && (
          <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1.5 bg-black/70 rounded px-1.5 py-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            <span className="text-[9px] text-white">Analyzing...</span>
          </div>
        )}

        {/* Describing overlay (AI vision — takes ~6s) */}
        {isDescribing && isActive && (
          <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1.5 bg-accent/80 rounded px-1.5 py-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            <span className="text-[9px] text-[#08080a] font-semibold">Describing scene…</span>
          </div>
        )}

        {/* Stop camera button */}
        {isActive && (
          <button
            onClick={stopCamera}
            className="absolute top-1.5 right-1.5 bg-red-500/80 text-white border-none rounded-full p-1 cursor-pointer hover:bg-red-600"
            title="Stop camera"
          >
            <CameraOff size={11} />
          </button>
        )}
      </div>

      {/* Controls */}
      {isActive && (
        <div className="flex gap-1.5 mt-2">
          <button
            onClick={peek}
            disabled={isAnalyzing}
            className="flex-1 bg-accent text-[#08080a] border-none rounded-md py-1.5 text-[11px] font-semibold cursor-pointer hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1 font-sans"
          >
            <Eye size={11} />
            Peek
          </button>

          <button
            onClick={() => describe()}
            disabled={isDescribing}
            className="flex-1 bg-accent/15 border border-accent/40 text-accent rounded-md py-1.5 text-[11px] font-semibold cursor-pointer hover:bg-accent/25 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1 font-sans"
          >
            {isDescribing ? (
              <span className="w-2.5 h-2.5 rounded-full border-2 border-accent animate-spin border-t-transparent inline-block" />
            ) : (
              <Sparkles size={11} />
            )}
            {isDescribing ? "Describing…" : "Describe"}
          </button>

          {!isWatching ? (
            <button
              onClick={startWatch}
              disabled={isAnalyzing}
              className="flex-1 bg-muted-bg border border-border text-foreground rounded-md py-1.5 text-[11px] cursor-pointer hover:border-accent disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1 font-sans"
            >
              <RefreshCw size={11} />
              Watch
            </button>
          ) : (
            <button
              onClick={stopWatch}
              className="flex-1 bg-red-500/10 border border-red-500/30 text-red-400 rounded-md py-1.5 text-[11px] cursor-pointer hover:bg-red-500/20 flex items-center justify-center gap-1 font-sans"
            >
              <Circle size={7} className="fill-red-400 text-red-400 animate-pulse" />
              Stop
            </button>
          )}
        </div>
      )}

      {/* Watch interval slider */}
      {isActive && !isWatching && (
        <div className="flex items-center gap-2 text-[9px] text-muted mt-1">
          <span>Every</span>
          <input
            type="range"
            min={1}
            max={10}
            value={watchInterval}
            onChange={(e) => setWatchInterval(Number(e.target.value))}
            className="flex-1 accent-[#8ab86e]"
          />
          <span>{watchInterval}s</span>
        </div>
      )}

      {/* AI vision description */}
      {vision && (
        <div className="bg-accent/10 border border-accent/30 rounded-md px-2.5 py-1.5 text-[10px] text-foreground leading-relaxed mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap">
          <span className="text-accent font-semibold">AI Vision: </span>
          {vision}
        </div>
      )}

      {/* Analysis result */}
      {analysis && (
        <div className="bg-muted-bg border border-border rounded-md px-2.5 py-1.5 text-[10px] text-foreground leading-relaxed mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap">
          {analysis.text}
        </div>
      )}

      {/* Watch log */}
      {isWatching && frames.length > 0 && (
        <div className="mt-1.5 space-y-1 max-h-24 overflow-y-auto">
          <div className="text-[9px] text-muted font-medium">Watch Log ({frames.length})</div>
          {frames.slice(-3).map((frame, i) => (
            <div key={i} className="text-[9px] text-muted bg-muted-bg rounded px-1.5 py-0.5 border border-border">
              {frame}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}