"use client";

/**
 * Smyth Splash — "Greene Solutions" Cyberpunk Intro
 *
 * Matrix-style characters (katakana, numbers, code) rain down BUT
 * get caught and flow along sacred geometry paths — Flower of Life,
 * Metatron's Cube, golden spirals, mandalas. The shapes ARE made of
 * the falling characters.
 *
 * 100% original — blue palette, no Matrix green.
 * Duration: ~5.5s
 */

import { useState, useEffect, useRef, useCallback } from "react";

const TAU = Math.PI * 2;

// ── Color palette: cyan/blue code rain over hero video (matches chat UI) ──
// Hue band sits around 195-215 (cyan-blue) with slight drift on geometry chars.
const HUE_RAIN_BASE = 195;       // blue base hue for rain columns
const HUE_GEOM_BASE = 205;       // geometry characters — slightly more cyan
const COLOR_BRIGHT = "rgba(0, 200, 255,";   // bright rain glyph
const COLOR_GLYPH  = "rgba(60, 140, 230,";  // normal rain glyph
const COLOR_GLITCH = "rgba(80, 220, 255,";  // glitch rain glyph
const SHADOW_BRIGHT = "rgba(0, 200, 255,";
const SHADOW_DIM    = "rgba(40, 100, 200,";
const SHADOW_GEOM   = "rgba(0, 200, 255,";
const SHADOW_GEOM_2 = "rgba(0, 80, 180,";
const PROGRESS_GRAD_FROM = "#0a2a55";
const PROGRESS_GRAD_TO   = "#00b4ff";
const PROGRESS_TRACK     = "rgba(0, 180, 255, 0.1)";
const GRID_LINE          = "rgba(0, 180, 255, 0.02)";
const SCANLINE_LINE      = "linear-gradient(90deg, transparent 0%, rgba(0, 180, 255, 0.2) 30%, rgba(0, 180, 255, 0.5) 50%, rgba(0, 180, 255, 0.2) 70%, transparent 100%)";
const SCANLINE_SHADOW    = "0 0 12px rgba(0, 180, 255, 0.4), 0 0 30px rgba(0, 80, 200, 0.2)";
const CORNER_COLOR       = "rgba(0, 180, 255, 0.6)";
const RING_COLOR         = "rgba(0, 180, 255, 0.2)";
const RING_COLOR_2       = "rgba(0, 100, 220, 0.2)";
const LOGO_DROP_SHADOW_1 = "drop-shadow(0 0 30px rgba(0, 200, 255, 0.8)) drop-shadow(0 0 60px rgba(0, 80, 200, 0.5))";
const LOGO_DROP_SHADOW_2 = "drop-shadow(0 0 40px rgba(0, 200, 255, 1)) drop-shadow(0 0 80px rgba(0, 80, 200, 0.8))";
const CENTRAL_GLOW_NEAR  = "rgba(0, 180, 255,";
const CENTRAL_GLOW_FAR   = "rgba(0, 100, 220,";
const CHAR_POOLS = [
  "01アイウエオカキクケコサシスセソ",
  "0123456789ABCDEF",
  "01タチツテトナニヌネノハヒフヘホ",
  "SMYTHGRENE01",
  "0123456789マミムメモヤユヨラリルレロ",
  "01ワヲン゛゜0123456789",
];

function getChar(seed: number): string {
  const pool = CHAR_POOLS[Math.abs(seed) % CHAR_POOLS.length];
  return pool[Math.abs(seed * 13 + 7) % pool.length];
}

// ── Geometry path generators ──

interface Point { x: number; y: number; }

/** Generate points along a circle */
function circlePath(cx: number, cy: number, r: number, segments: number): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (TAU / segments) * i;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

/** Generate Flower of Life path — all circles */
function flowerOfLifePaths(cx: number, cy: number, r: number): Point[][] {
  const paths: Point[][] = [];
  // Center
  paths.push(circlePath(cx, cy, r, 48));
  // 6 surrounding
  for (let i = 0; i < 6; i++) {
    const a = (TAU / 6) * i;
    paths.push(circlePath(cx + Math.cos(a) * r, cy + Math.sin(a) * r, r, 48));
  }
  // 6 outer
  for (let i = 0; i < 6; i++) {
    const a = (TAU / 6) * i + TAU / 12;
    paths.push(circlePath(cx + Math.cos(a) * r * 2, cy + Math.sin(a) * r * 2, r, 48));
  }
  return paths;
}

/** Generate Metatron's Cube — circles at nodes + connecting lines */
function metatronsCubePaths(cx: number, cy: number, r: number): Point[][] {
  const paths: Point[][] = [];
  const nodes: Point[] = [{ x: cx, y: cy }];

  for (let i = 0; i < 6; i++) {
    const a = (TAU / 6) * i;
    nodes.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    nodes.push({ x: cx + Math.cos(a) * r * 2, y: cy + Math.sin(a) * r * 2 });
  }

  // Lines between all nodes
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[j].x - nodes[i].x;
      const dy = nodes[j].y - nodes[i].y;
      if (Math.hypot(dx, dy) < r * 3) {
        const linePts: Point[] = [];
        const segs = 20;
        for (let s = 0; s <= segs; s++) {
          const t = s / segs;
          linePts.push({
            x: nodes[i].x + dx * t,
            y: nodes[i].y + dy * t,
          });
        }
        paths.push(linePts);
      }
    }
  }

  // Small circles at each node
  for (const n of nodes) {
    paths.push(circlePath(n.x, n.y, r * 0.3, 24));
  }

  return paths;
}

/** Golden spiral path */
function goldenSpiralPath(cx: number, cy: number, maxR: number, turns: number): Point[][] {
  const paths: Point[][] = [];
  const phi = 1.618033988749895;

  for (let arm = 0; arm < 3; arm++) {
    const armOffset = (TAU / 3) * arm;
    const pts: Point[] = [];
    const totalPts = 200;
    for (let i = 0; i < totalPts; i++) {
      const t = (i / totalPts) * TAU * turns;
      const r = (t / (TAU * turns)) * maxR;
      const wobble = Math.sin(t * 3) * maxR * 0.01;
      pts.push({
        x: cx + Math.cos(t + armOffset) * (r + wobble),
        y: cy + Math.sin(t + armOffset) * (r + wobble),
      });
    }
    paths.push(pts);
  }

  return paths;
}

/** Mandala — concentric rings of petals */
function mandalaPaths(cx: number, cy: number, r: number): Point[][] {
  const paths: Point[][] = [];

  // Concentric circles
  for (let ring = 0; ring < 5; ring++) {
    const ringR = r * (0.4 + ring * 0.3);
    paths.push(circlePath(cx, cy, ringR, 40 + ring * 10));
  }

  // Radial lines (petals)
  for (let ring = 0; ring < 4; ring++) {
    const ringR = r * (0.4 + ring * 0.3);
    const petals = 8 + ring * 4;
    for (let p = 0; p < petals; p++) {
      const a = (TAU / petals) * p;
      const pts: Point[] = [];
      const segs = 12;
      for (let s = 0; s <= segs; s++) {
        const t = s / segs;
        pts.push({
          x: cx + Math.cos(a) * ringR * t,
          y: cy + Math.sin(a) * ringR * t,
        });
      }
      paths.push(pts);
    }
  }

  return paths;
}

// ── Main Canvas Engine ──

interface RainChar {
  // Normal rain column
  col: number;
  row: number;
  speed: number;
  delay: number;
  pool: number;
  bright: boolean;
  glitch: boolean;
  // Geometry tracking
  onGeometry: boolean;
  geoPath: number;   // which path index
  geoT: number;      // 0..1 along path
  geoSpeed: number;
  geoOpacity: number;
}

function GeometryRainCanvas({ phase }: { phase: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const charsRef = useRef<RainChar[]>([]);
  const startRef = useRef(Date.now());
  const rafRef = useRef(0);
  const sizeRef = useRef({ w: 0, h: 0 });

  // Pre-compute geometry paths (will be regenerated on resize)
  const geoPathsRef = useRef<Point[][]>([]);
  const geoPathIndexRef = useRef<number[]>([]); // which chars belong to which path

  const buildGeometry = useCallback((w: number, h: number) => {
    const cx = w / 2;
    const cy = h / 2;
    const baseR = Math.min(w, h) * 0.12;

    const allPaths: Point[][] = [];

    // Flower of Life — large, center
    const flower = flowerOfLifePaths(cx, cy, baseR * 1.8);
    allPaths.push(...flower);

    // Metatron's Cube — slightly offset
    const metatron = metatronsCubePaths(cx, cy, baseR * 0.7);
    allPaths.push(...metatron);

    // Golden spirals — large, radiating from center
    const spirals = goldenSpiralPath(cx, cy, Math.min(w, h) * 0.42, 3);
    allPaths.push(...spirals);

    // Mandala rings — outer
    const mandala = mandalaPaths(cx, cy, baseR * 2.8);
    allPaths.push(...mandala);

    // Extra: Vesica Piscis circles on sides
    const vLeft = circlePath(cx - baseR * 2.5, cy, baseR * 0.8, 36);
    const vRight = circlePath(cx + baseR * 2.5, cy, baseR * 0.8, 36);
    allPaths.push(vLeft, vRight);

    geoPathsRef.current = allPaths;

    // Count total path points
    let totalPathPoints = 0;
    for (const p of allPaths) totalPathPoints += p.length;

    // Assign ~60% of rain chars to geometry paths
    const chars = charsRef.current;
    const charsPerPath = Math.floor(totalPathPoints > 0 ? (chars.length * 0.65) / totalPathPoints : 0);

    // Reset assignments
    for (const c of chars) {
      c.onGeometry = false;
    }

    let assigned = 0;
    for (let pi = 0; pi < allPaths.length; pi++) {
      const path = allPaths[pi];
      for (let pt = 0; pt < path.length; pt++) {
        // Assign a char to this path point
        const idx = assigned % chars.length;
        chars[idx].onGeometry = true;
        chars[idx].geoPath = pi;
        chars[idx].geoT = pt / path.length;
        chars[idx].geoSpeed = 0.0008 + Math.random() * 0.001;
        chars[idx].geoOpacity = 0;
        assigned++;
      }
    }

    sizeRef.current = { w, h };
  }, []);

  // Initialize rain columns
  useEffect(() => {
    const COLS = 100;
    const ROWS = 60;
    const chars: RainChar[] = [];

    for (let idx = 0; idx < COLS * ROWS; idx++) {
      const col = idx % COLS;
      const row = Math.floor(idx / COLS);
      chars.push({
        col, row,
        speed: 2.0 + (col % 7) * 0.3 + (row % 5) * 0.1,
        delay: (col / COLS) * 1.5 + (row / ROWS) * 0.3,
        pool: (col + row) % CHAR_POOLS.length,
        bright: (col + Math.floor(row / 3)) % 11 === 0,
        glitch: ((col * 17) % 9) === 0,
        onGeometry: false,
        geoPath: 0,
        geoT: 0,
        geoSpeed: 0,
        geoOpacity: 0,
      });
    }
    charsRef.current = chars;
  }, []);

  // Build geometry on mount and resize
  useEffect(() => {
    const build = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      buildGeometry(w, h);
    };
    build();
    window.addEventListener("resize", build);
    return () => window.removeEventListener("resize", build);
  }, [buildGeometry]);

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const animate = () => {
      // 2026-08-25 (Rob): TEMP — skip code-rain/geometry entirely so we can
      // evaluate the hero image + video without the swarm. The render loop
      // still runs (keeps the canvas sized correctly) but paints nothing.
      // To restore, delete this early return.
      const DISABLE_CODE_RAIN = true;
      if (DISABLE_CODE_RAIN) {
        requestAnimationFrame(animate);
        return;
      }
      const w = window.innerWidth;
      const h = window.innerHeight;
      const elapsed = (Date.now() - startRef.current) / 1000;
      const fadeIn = Math.min(elapsed / 1.5, 1);

      ctx.clearRect(0, 0, w, h);

      const chars = charsRef.current;
      const paths = geoPathsRef.current;
      const COLS = 100;
      const cellW = w / COLS;
      const charSize = Math.max(10, Math.min(cellW * 0.8, 13));
      ctx.font = `bold ${charSize}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      for (let i = 0; i < chars.length; i++) {
        const c = chars[i];

        let x: number, y: number;
        let color: string;
        let shadow: string;
        let opacity: number;

        if (c.onGeometry && paths[c.geoPath]) {
          // ── GEOMETRY MODE: character flows along sacred geometry path ──
          const path = paths[c.geoPath];
          const pathLen = path.length;

          // Advance along path
          c.geoT += c.geoSpeed;
          if (c.geoT >= 1) c.geoT -= 1;

          const ptIdx = Math.floor(c.geoT * pathLen) % pathLen;
          const pt = path[ptIdx];

          // Slight offset perpendicular to path for natural look
          const nextIdx = (ptIdx + 1) % pathLen;
          const nextPt = path[nextIdx];
          const dx = nextPt.x - pt.x;
          const dy = nextPt.y - pt.y;
          const len = Math.hypot(dx, dy) || 1;
          const perpX = -dy / len;
          const perpY = dx / len;
          const jitter = Math.sin(elapsed * 3 + i * 0.7) * 2;

          x = pt.x + perpX * jitter;
          y = pt.y + perpY * jitter;

          // Fade in geometry chars gradually
          c.geoOpacity = Math.min(c.geoOpacity + 0.008, 0.9);
          opacity = c.geoOpacity * fadeIn;

          // Geometry chars are brighter, electric green/cyan
          const hue = HUE_GEOM_BASE + Math.sin(elapsed * 0.5 + i * 0.1) * 15;
          const sat = 80 + Math.sin(elapsed + i) * 15;
          const lit = 65 + Math.sin(elapsed * 1.5 + i * 0.3) * 15;
          color = `hsla(${hue}, ${sat}%, ${lit}%, ${opacity})`;
          shadow = `0 0 8px ${SHADOW_GEOM} ${opacity * 0.7}), 0 0 16px ${SHADOW_GEOM_2} ${opacity * 0.4})`;
        } else {
          // ── RAIN MODE: normal matrix-style falling ──
          const fallSpeed = c.speed;
          const fallDelay = c.delay;
          const cycleTime = fallSpeed + fallDelay;
          const t = (elapsed / cycleTime) % 1;

          x = c.col * cellW + cellW / 2;
          y = -charSize + t * (h + charSize * 2);

          // Wrap around
          if (y > h + charSize) {
            y = -charSize + ((elapsed / cycleTime) % 1) * charSize;
          }

          // Rain chars are dimmer
          const dimBase = c.glitch ? 0.4 : c.bright ? 0.35 : 0.12 + (c.col % 5) * 0.03;
          opacity = dimBase * fadeIn;

          color = c.bright
            ? `${COLOR_BRIGHT} ${opacity})`
            : c.glitch
              ? `${COLOR_GLITCH} ${opacity})`
              : `${COLOR_GLYPH} ${opacity})`;
          shadow = c.bright
            ? `0 0 6px ${SHADOW_BRIGHT} ${opacity * 0.6})`
            : `0 0 2px ${SHADOW_DIM} ${opacity * 0.3})`;
        }

        // Pick a character — cycle characters over time for "flickering" effect
        const charIdx = (i * 13 + Math.floor(elapsed * 2 + i * 0.1)) % CHAR_POOLS[c.pool].length;
        const ch = CHAR_POOLS[c.pool][charIdx];

        ctx.save();
        ctx.fillStyle = color;
        ctx.shadowColor = shadow;
        ctx.shadowBlur = c.onGeometry ? 12 : 3;
        ctx.fillText(ch, x, y);
        ctx.restore();
      }

      // ── Central glow when geometry is active ──
      if (elapsed > 1.0) {
        const glowFade = Math.min((elapsed - 1.0) / 2.0, 0.4);
        const pulse = Math.sin(elapsed * 0.8) * 0.1 + 0.9;
        const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.min(w, h) * 0.35);
        grad.addColorStop(0, `${CENTRAL_GLOW_NEAR} ${glowFade * pulse * 0.12})`);
        grad.addColorStop(0.5, `${CENTRAL_GLOW_FAR} ${glowFade * pulse * 0.05})`);
        grad.addColorStop(1, "transparent");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }

      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 1,
        opacity: phase === 0 ? 0.2 : 1,
        transition: "opacity 1.2s ease-in",
      }}
    />
  );
}

// ── Main Splash ──

export function SmythSplash({ onDone }: { onDone: () => void }) {
  const [phase, setPhase] = useState<0 | 1 | 2 | 3 | 4>(0);
  const [progress, setProgress] = useState(0);
  const [subtitleText, setSubtitleText] = useState("");
  const [scanlineY, setScanlineY] = useState(-10);

  const subtitle = "BY GREENE SOLUTIONS LLC";
  const tagline = "// human + ai automation";

  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 250);
    const t2 = setTimeout(() => setPhase(2), 1200);
    const t3 = setTimeout(() => setPhase(3), 2400);
    const t4 = setTimeout(() => setPhase(4), 3600);
    const tEnd = setTimeout(() => onDone(), 5500);
    return () => {
      clearTimeout(t1); clearTimeout(t2);
      clearTimeout(t3); clearTimeout(t4); clearTimeout(tEnd);
    };
  }, [onDone]);

  // Dev/debug: click anywhere to skip splash
  const skip = () => onDone();

  useEffect(() => {
    const iv = setInterval(() => setProgress((p) => Math.min(p + 1, 100)), 50);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    let raf: number;
    const start = Date.now();
    const tick = () => {
      setScanlineY(((Date.now() - start) / 1000 * 12) % 110 - 5);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (phase < 3) return;
    let i = 0;
    const iv = setInterval(() => {
      i++;
      setSubtitleText(subtitle.slice(0, i));
      if (i >= subtitle.length) clearInterval(iv);
    }, 65);
    return () => clearInterval(iv);
  }, [phase]);

  return (
    <div onClick={skip} style={{
      position: "fixed", top: 0, left: 0,
      width: "100vw", height: "100vh",
      background: "#040810",
      overflow: "hidden", zIndex: 9999,
      display: "flex", alignItems: "center", justifyContent: "center",
      cursor: "pointer",
    }}>
      <style>{`
        @keyframes logo-glitch {
          0%   { clip-path: inset(0 0 100% 0); opacity: 0; transform: scale(1.02); }
          25%  { clip-path: inset(10% 0 75% 0); opacity: 0.4; }
          50%  { clip-path: inset(25% 0 45% 0); opacity: 0.7; }
          75%  { clip-path: inset(50% 0 20% 0); opacity: 0.9; }
          100% { clip-path: inset(0); opacity: 1; }
        }
        @keyframes neon-pulse-blue {
          0%, 100% { filter: ${LOGO_DROP_SHADOW_1}; }
          50% { filter: ${LOGO_DROP_SHADOW_2}; }
        }
        @keyframes grid-move {
          0% { transform: perspective(500px) rotateX(60deg) translateY(0); }
          100% { transform: perspective(500px) rotateX(60deg) translateY(50px); }
        }
        @keyframes ring-expand {
          0%   { transform: translate(-50%,-50%) scale(0.3); opacity: 0.8; }
          100% { transform: translate(-50%,-50%) scale(1.8); opacity: 0; }
        }
        @keyframes ring-expand-2 {
          0%   { transform: translate(-50%,-50%) scale(0.3); opacity: 0.6; }
          100% { transform: translate(-50%,-50%) scale(2.4); opacity: 0; }
        }
        @keyframes subtitle-blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
        @keyframes corner-blink {
          0%, 90%, 100% { opacity: 0.7; }
          95% { opacity: 0.1; }
        }
        .splash-glitch { animation: logo-glitch 0.4s cubic-bezier(0.2,0.8,0.2,1) forwards; }
        .splash-cursor { animation: subtitle-blink 0.7s steps(1) infinite; }
        .corner-blink { animation: corner-blink 2.5s ease-in-out infinite; }
        .ring-1 { animation: ring-expand 2.5s ease-out infinite; }
        .ring-2 { animation: ring-expand-2 2.5s ease-out 0.6s infinite; }
        .neon-glow-blue { animation: neon-pulse-blue 3s ease-in-out infinite; }
      `}</style>

      {/* HERO VIDEO — background layer from landing page */}
      <video
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        src="/workspace/singularity-zoom-video.mp4"
        style={{
          position: "absolute",
          top: 0, left: 0,
          width: "100%", height: "100%",
          objectFit: "cover",
          zIndex: 0,
          pointerEvents: "none",
          opacity: phase === 0 ? 0.5 : 0.85,
          transition: "opacity 1.2s ease-in",
        }}
      />

      {/* Dark tint over video — keeps code rain readable */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
        background: "radial-gradient(ellipse at center, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.65) 100%)",
        zIndex: 0, pointerEvents: "none",
      }} />

      {/* Grid bg */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
        backgroundImage: `linear-gradient(${GRID_LINE} 1px,transparent 1px),linear-gradient(90deg,${GRID_LINE} 1px,transparent 1px)`,
        backgroundSize: "60px 60px",
        animation: "grid-move 25s linear infinite",
        zIndex: 0, pointerEvents: "none",
      }} />

      {/* THE MAIN EVENT: Characters forming sacred geometry */}
      <GeometryRainCanvas phase={phase} />

      {/* Scanline */}
      <div style={{
        position: "absolute", top: `${scanlineY}%`, left: 0, right: 0, height: 1.5,
        background: SCANLINE_LINE,
        boxShadow: SCANLINE_SHADOW,
        zIndex: 3, pointerEvents: "none",
        opacity: phase >= 1 ? 0.6 : 0, transition: "opacity 1s ease-in",
      }} />

      {/* CRT scanlines */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
        backgroundImage: "repeating-linear-gradient(0deg,rgba(0,0,0,0) 0px,rgba(0,0,0,0) 2px,rgba(0,0,0,0.12) 3px,rgba(0,0,0,0) 4px)",
        backgroundSize: "100% 4px",
        zIndex: 4, pointerEvents: "none", opacity: 0.4,
      }} />

      {/* Logo + text */}
      <div style={{
        position: "relative", zIndex: 10,
        display: "flex", flexDirection: "column", alignItems: "center",
        opacity: phase >= 2 ? 1 : 0, transition: "opacity 0.8s ease-in",
      }}>
        <div className={phase >= 2 ? "splash-glitch neon-glow-blue" : ""} style={{
          marginTop: "420px", marginBottom: "32px",
          fontFamily: "'Rajdhani','Orbitron',sans-serif",
          fontWeight: 700,
          fontSize: "112px",
          lineHeight: 1,
          color: "#ffffff",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          textAlign: "center",
          filter: LOGO_DROP_SHADOW_1,
        }}>
          SMYTH AI AGENT
        </div>
        <div style={{
          fontFamily: "'Rajdhani','Orbitron',monospace", fontSize: "22px",
          color: "#ffffff", letterSpacing: "6px", textTransform: "uppercase",
          textShadow: "0 0 10px rgba(255,255,255,0.6), 0 0 20px rgba(255,255,255,0.3)",
          marginBottom: "8px",
        }}>
          {subtitleText}
          {subtitleText.length < subtitle.length && (
            <span className="splash-cursor" style={{ color: "#ffffff", textShadow: "none" }}>█</span>
          )}
        </div>
        <div style={{
          fontFamily: "'Space Mono',monospace", fontSize: "16px",
          color: "rgba(255,255,255,0.45)", letterSpacing: "2px", marginTop: "4px",
        }}>
          {tagline}
        </div>
      </div>

      {/* Progress bar */}
      <div style={{
        position: "absolute", bottom: "60px", left: "50%",
        transform: "translateX(-50%)", zIndex: 10, width: "200px",
      }}>
        <div style={{ height: "2px", background: PROGRESS_TRACK, borderRadius: "1px", overflow: "hidden" }}>
          <div style={{
            height: "100%", width: `${progress}%`,
            background: `linear-gradient(90deg, ${PROGRESS_GRAD_FROM}, ${PROGRESS_GRAD_TO})`,
            boxShadow: "0 0 15px rgba(0, 180, 255, 0.6)",
            transition: "width 0.1s linear",
          }} />
        </div>
        <div style={{
          textAlign: "center", fontFamily: "'Space Mono',monospace",
          fontSize: "10px", color: "rgba(0, 180, 255, 0.5)", marginTop: "8px", letterSpacing: "3px",
        }}>
          {progress}%
        </div>
      </div>

      {/* Corners */}
      {[
        { text: "SYS::INIT", top: 20, left: 20 },
        { text: "v1.0.0", top: 20, right: 20 },
        { text: "GREENE SOLUTIONS", bottom: 20, left: 20 },
        { text: "TOKYO JP", bottom: 20, right: 20 },
      ].map((item, i) => (
        <div key={i} className="corner-blink" style={{
          position: "absolute", top: item.top, left: item.left,
          right: item.right, bottom: item.bottom, zIndex: 10,
          fontFamily: "'Space Mono',monospace", fontSize: "10px",
          color: CORNER_COLOR,
        }}>{item.text}</div>
      ))}

      {/* Soft cyan glow halo behind the character — gives the silhouette something to read against */}
      <div style={{
        position: "absolute", top: "50%", left: "50%",
        width: "480px", height: "480px",
        transform: "translate(-50%,-50%)",
        background: "radial-gradient(circle, rgba(220, 240, 255, 0.5) 0%, rgba(160, 210, 255, 0.28) 28%, rgba(100, 170, 240, 0.1) 52%, transparent 75%)",
        zIndex: 3, pointerEvents: "none",
        opacity: phase >= 2 ? 1 : 0, transition: "opacity 1.2s ease-in",
        borderRadius: "50%",
        filter: "blur(20px)",
      }} />

      {/* Character outline — silhouette behind the headline, lifted by white-blue glow */}
      <img
        src="/Artwork/blank-bg-opener.png"
        alt=""
        style={{
          position: "absolute", top: "50%", left: "50%",
          width: "360px", height: "360px",
          objectFit: "contain",
          transform: "translate(-50%, -50%)",
          filter: "drop-shadow(0 0 24px rgba(220, 240, 255, 1)) drop-shadow(0 0 48px rgba(160, 210, 255, 0.7)) drop-shadow(0 0 80px rgba(120, 180, 255, 0.45)) brightness(0.85) contrast(1.4) saturate(1.1)",
          opacity: phase >= 2 ? 0.95 : 0,
          transition: "opacity 1.2s ease-in",
          zIndex: 4, pointerEvents: "none",
        }}
      />

      {/* Pulse rings */}
      <div className="ring-1" style={{
        position: "absolute", top: "50%", left: "50%",
        width: "300px", height: "300px", borderRadius: "50%",
        border: `1px solid ${RING_COLOR}`,
        transform: "translate(-50%,-50%)",
        zIndex: 5, pointerEvents: "none",
        opacity: phase >= 2 ? 0.5 : 0, transition: "opacity 1s ease-in",
      }} />
      <div className="ring-2" style={{
        position: "absolute", top: "50%", left: "50%",
        width: "300px", height: "300px", borderRadius: "50%",
        border: `1px solid ${RING_COLOR_2}`,
        transform: "translate(-50%,-50%)",
        zIndex: 5, pointerEvents: "none",
        opacity: phase >= 2 ? 0.4 : 0, transition: "opacity 1s ease-in",
      }} />
    </div>
  );
}
