// ── Chat Thinking Effect ──
// DesignPanel chat column ONLY. Self-contained, container-sized canvas with
// morphing sacred-geometry characters + subtle matrix rain. Never touches the
// shared ThinkingBackground used by the main app.

import { useEffect, useRef } from "react";

const TAU = Math.PI * 2;
const CHARS = "01アイウエオカキクケコサシスセソタチツテトABCDEF".split("");

interface Pt { x: number; y: number; }

function circlePts(cx: number, cy: number, r: number, segs: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < segs; i++) {
    const a = (TAU / segs) * i;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

function spiralPts(cx: number, cy: number, maxR: number, count: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / count;
    const a = t * TAU * 3;
    const r = t * maxR;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

export function ChatThinkingEffect() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const parent = canvas.parentElement;
    if (!ctx || !parent) return;

    let raf = 0;
    let w = 0;
    let h = 0;
    let shapes: Pt[][] = [];
    const SLOTS = 220; // small char count — cheap for a narrow column
    const start = Date.now();

    const buildShapes = () => {
      const cx = w / 2;
      const cy = h / 2;
      const baseR = Math.min(w, h) * 0.26;
      shapes = [
        circlePts(cx, cy, baseR, SLOTS),
        spiralPts(cx, cy, baseR * 1.15, SLOTS),
        circlePts(cx, cy, baseR * 0.55, SLOTS),
      ];
    };

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      w = parent.clientWidth;
      h = parent.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildShapes();
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(parent);

    const MORPH_MS = 5000;

    const animate = () => {
      if (!w || !h || shapes.length === 0) {
        raf = requestAnimationFrame(animate);
        return;
      }
      const elapsed = (Date.now() - start) / 1000;
      ctx.clearRect(0, 0, w, h);

      // Soft center glow
      const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.min(w, h) * 0.5);
      grad.addColorStop(0, "rgba(0, 180, 220, 0.07)");
      grad.addColorStop(1, "transparent");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Morph between shapes
      const cycle = (Date.now() % (MORPH_MS * shapes.length)) / MORPH_MS;
      const idx = Math.floor(cycle);
      const next = (idx + 1) % shapes.length;
      const prog = cycle - idx;
      // ease in the last 30% of each window
      const tStart = 0.7;
      let t = 0;
      if (prog > tStart) {
        t = (prog - tStart) / (1 - tStart);
        t = t * t * (3 - 2 * t);
      }

      const breathe = 1 + Math.sin(elapsed * 0.8) * 0.04;
      const fontSize = Math.max(7, Math.min(w / 42, 10));
      ctx.font = `${fontSize}px "Space Mono", monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const a = shapes[idx];
      const b = shapes[next];
      for (let i = 0; i < SLOTS; i++) {
        const p0 = a[i];
        const p1 = b[i];
        if (!p0 || !p1) continue;
        let x = p0.x + (p1.x - p0.x) * t;
        let y = p0.y + (p1.y - p0.y) * t;
        const cx = w / 2;
        const cy = h / 2;
        const dx = x - cx;
        const dy = y - cy;
        x = cx + dx * breathe;
        y = cy + dy * breathe;
        const opacity = 0.28 + Math.sin(elapsed * 2 + i * 0.35) * 0.14;
        ctx.fillStyle = `hsla(${160 + Math.sin(elapsed * 0.5 + i * 0.05) * 30}, 90%, 60%, ${opacity})`;
        ctx.fillText(CHARS[i % CHARS.length], x, y);
      }

      raf = requestAnimationFrame(animate);
    };

    raf = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
      }}
    />
  );
}
