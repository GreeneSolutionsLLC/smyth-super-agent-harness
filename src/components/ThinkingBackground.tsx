// ── Thinking Background ──
// Morphing sacred geometry (flower of life → metatron's cube → golden
// spiral → mandala) rendered in flowing characters, with matrix rain.
// Theme-aware, brand-colored (green accent, blue depth), breathing,
// rotating, pulsing. Greene Solutions DNA.

import { useEffect, useRef } from "react";

const TAU = Math.PI * 2;

const CHAR_POOLS = [
  "01アイウエオカキクケコサシスセソ",
  "0123456789ABCDEF",
  "01タチツテトナニヌネノハヒフヘホ",
  "MAETRYXXGRENE01",
  "0123456789マミムメモヤユヨラリルレロ",
];

interface Point { x: number; y: number; }

function circlePath(cx: number, cy: number, r: number, segs: number): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= segs; i++) {
    const a = (TAU / segs) * i;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

function flowerOfLifePaths(cx: number, cy: number, r: number): Point[][] {
  const paths: Point[][] = [circlePath(cx, cy, r, 40)];
  for (let i = 0; i < 6; i++) {
    const a = (TAU / 6) * i;
    paths.push(circlePath(cx + Math.cos(a) * r, cy + Math.sin(a) * r, r, 40));
  }
  return paths;
}

function metatronsCubePaths(cx: number, cy: number, r: number): Point[][] {
  const paths: Point[][] = [];
  const nodes: Point[] = [{ x: cx, y: cy }];
  for (let i = 0; i < 6; i++) {
    const a = (TAU / 6) * i;
    nodes.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    nodes.push({ x: cx + Math.cos(a) * r * 1.8, y: cy + Math.sin(a) * r * 1.8 });
  }
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[j].x - nodes[i].x;
      const dy = nodes[j].y - nodes[i].y;
      if (Math.hypot(dx, dy) < r * 2.5) {
        const pts: Point[] = [];
        for (let s = 0; s <= 16; s++) {
          const t = s / 16;
          pts.push({ x: nodes[i].x + dx * t, y: nodes[i].y + dy * t });
        }
        paths.push(pts);
      }
    }
  }
  for (const n of nodes) paths.push(circlePath(n.x, n.y, r * 0.25, 20));
  return paths;
}

function mandalaPaths(cx: number, cy: number, r: number): Point[][] {
  const paths: Point[][] = [];
  for (let ring = 0; ring < 4; ring++) {
    const ringR = r * (0.35 + ring * 0.35);
    paths.push(circlePath(cx, cy, ringR, 32 + ring * 8));
    const petals = 8 + ring * 6;
    for (let p = 0; p < petals; p++) {
      const a = (TAU / petals) * p;
      const pts: Point[] = [];
      for (let s = 0; s <= 10; s++) {
        const t = s / 10;
        pts.push({ x: cx + Math.cos(a) * ringR * t, y: cy + Math.sin(a) * ringR * t });
      }
      paths.push(pts);
    }
  }
  return paths;
}

function goldenSpiralPath(cx: number, cy: number, maxR: number): Point[][] {
  const paths: Point[][] = [];
  for (let arm = 0; arm < 3; arm++) {
    const offset = (TAU / 3) * arm;
    const pts: Point[] = [];
    for (let i = 0; i < 150; i++) {
      const t = (i / 150) * TAU * 2.5;
      const r = (t / (TAU * 2.5)) * maxR;
      pts.push({ x: cx + Math.cos(t + offset) * r, y: cy + Math.sin(t + offset) * r });
    }
    paths.push(pts);
  }
  return paths;
}

// ── Morph engine ──────────────────────────────────────────────
// Each shape is a set of paths. To morph, we resample every shape
// to the same number of "slots" and lerp each slot between shapes.

const MORPH_CYCLE_MS = 15000; // time per shape
const MORPH_TRANSITION_MS = 3000; // crossfade duration

interface MorphSlot {
  // Current interpolated position
  x: number;
  y: number;
  // Per-shape target positions (indexed by shape)
  targets: Point[];
}

function resamplePaths(paths: Point[][], totalSlots: number): Point[] {
  // Flatten all paths into a single evenly-spaced point list
  const allPts: Point[] = [];
  for (const p of paths) for (const pt of p) allPts.push(pt);
  const result: Point[] = [];
  for (let i = 0; i < totalSlots; i++) {
    result.push(allPts[Math.floor((i / totalSlots) * allPts.length) % allPts.length]);
  }
  return result;
}

interface RainChar {
  col: number;
  row: number;
  speed: number;
  delay: number;
  pool: number;
  bright: boolean;
  glitch: boolean;
  glitchBurst: number; // timestamp of last glitch burst
}

function ThinkingGeometryCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const charsRef = useRef<RainChar[]>([]);
  const startRef = useRef(Date.now());
  const rafRef = useRef(0);
  const morphSlotsRef = useRef<MorphSlot[]>([]);
  const shapesRef = useRef<Point[][]>([]); // resampled shapes, each is Point[] of length SLOTS
  const themeRef = useRef<"dark" | "light">("dark");

  const SLOTS = 800; // number of geometry characters

  useEffect(() => {
    // Detect theme
    const detectTheme = () => {
      themeRef.current = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
    };
    detectTheme();
    const observer = new MutationObserver(detectTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    // Generate rain chars
    const COLS = 80;
    const ROWS = 30;
    const chars: RainChar[] = [];
    for (let idx = 0; idx < COLS * ROWS; idx++) {
      const col = idx % COLS;
      const row = Math.floor(idx / COLS);
      chars.push({
        col, row,
        speed: 4 + (col % 5) * 0.4 + (row % 4) * 0.2,
        delay: (col / COLS) * 1.2 + (row / ROWS) * 0.3,
        pool: (col + row) % CHAR_POOLS.length,
        bright: (col + Math.floor(row / 3)) % 11 === 0,
        glitch: ((col * 17) % 11) === 0,
        glitchBurst: 0,
      });
    }
    charsRef.current = chars;

    // Build shape targets
    const buildShapes = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const cx = w / 2;
      const cy = h / 2;
      const baseR = Math.min(w, h) * 0.12;

      const shapes: Point[][] = [
        resamplePaths(flowerOfLifePaths(cx, cy, baseR * 1.8), SLOTS),
        resamplePaths(metatronsCubePaths(cx, cy, baseR * 0.9), SLOTS),
        resamplePaths(goldenSpiralPath(cx, cy, Math.min(w, h) * 0.45), SLOTS),
        resamplePaths(mandalaPaths(cx, cy, baseR * 2.8), SLOTS),
      ];
      shapesRef.current = shapes;

      // Initialize morph slots at first shape
      if (morphSlotsRef.current.length === 0) {
        morphSlotsRef.current = shapes[0].map((pt) => ({
          x: pt.x,
          y: pt.y,
          targets: shapes.map((shape) => ({ x: 0, y: 0 })),
        }));
      }
      // Update targets for all shapes
      for (let i = 0; i < SLOTS; i++) {
        morphSlotsRef.current[i].targets = shapes.map((shape) => shape[i]);
      }
    };
    buildShapes();
    window.addEventListener("resize", buildShapes);
    return () => {
      window.removeEventListener("resize", buildShapes);
      observer.disconnect();
    };
  }, []);

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
      const w = window.innerWidth;
      const h = window.innerHeight;
      const now = Date.now();
      const elapsed = (now - startRef.current) / 1000;
      const isLight = themeRef.current === "light";

      ctx.clearRect(0, 0, w, h);

      // ── Breathing scale ──
      const breathe = 1 + Math.sin(elapsed * 0.5) * 0.03;
      // ── Slow rotation for mandala layer ──
      const rotation = (elapsed / 60) * TAU; // one turn per 60s
      // ── Pulse wave ──
      const pulsePhase = (elapsed % 4) / 4; // 0→1 every 4s
      const pulseRadius = pulsePhase * Math.min(w, h) * 0.5;

      // ── Background radial glow ──
      const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.min(w, h) * 0.35);
      if (isLight) {
        grad.addColorStop(0, "rgba(0, 102, 255, 0.06)");
        grad.addColorStop(1, "transparent");
      } else {
        grad.addColorStop(0, "rgba(0, 102, 255, 0.12)");
        grad.addColorStop(1, "transparent");
      }
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // ── Morph state ──
      const numShapes = shapesRef.current.length || 1;
      const cyclePos = (now % (MORPH_CYCLE_MS * numShapes)) / MORPH_CYCLE_MS;
      const shapeIdx = Math.floor(cyclePos);
      const nextShapeIdx = (shapeIdx + 1) % numShapes;
      const shapeProgress = cyclePos - shapeIdx; // 0→1 within current shape
      // Transition kicks in during the last portion of each shape's window
      const transitionStart = 1 - MORPH_TRANSITION_MS / MORPH_CYCLE_MS;
      let morphT = 0;
      if (shapeProgress > transitionStart) {
        morphT = (shapeProgress - transitionStart) / (1 - transitionStart);
        // Smooth ease-in-out
        morphT = morphT * morphT * (3 - 2 * morphT);
      }

      // ── Draw geometry chars ──
      const slots = morphSlotsRef.current;
      const geoSize = Math.max(11, Math.min(w / 80 * 0.75, 14));
      ctx.font = `bold ${geoSize}px "Space Mono", monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        const from = slot.targets[shapeIdx];
        const to = slot.targets[nextShapeIdx];
        if (!from || !to) continue;

        // Lerp position
        let x = from.x + (to.x - from.x) * morphT;
        let y = from.y + (to.y - from.y) * morphT;

        // Apply breathing + rotation around center
        const cx = w / 2;
        const cy = h / 2;
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.hypot(dx, dy);
        const angle = Math.atan2(dy, dx) + rotation * 0.15; // slow rotation
        x = cx + Math.cos(angle) * dist * breathe;
        y = cy + Math.sin(angle) * dist * breathe;

        // Perpendicular jitter for organic feel
        const jitter = Math.sin(elapsed * 2.5 + i * 0.7) * 1.5;
        const perpAngle = angle + Math.PI / 2;
        x += Math.cos(perpAngle) * jitter;
        y += Math.sin(perpAngle) * jitter;

        // Pulse wave brightness
        const distFromCenter = Math.hypot(x - cx, y - cy);
        const pulseDist = Math.abs(distFromCenter - pulseRadius);
        const pulseBoost = Math.max(0, 1 - pulseDist / 60) * 0.5;

        const baseOpacity = 0.65;
        const opacity = Math.min(baseOpacity + pulseBoost, 1);

        // Color: green accent with blue shift
        if (isLight) {
          const lightness = 25 + Math.sin(elapsed * 0.4 + i * 0.1) * 8;
          ctx.fillStyle = `hsla(150, 80%, ${lightness}%, ${opacity * 0.7})`;
          ctx.shadowColor = `rgba(0, 180, 100, ${opacity * 0.3})`;
        } else {
          const hue = 150 + Math.sin(elapsed * 0.4 + i * 0.1) * 20; // green-cyan range
          ctx.fillStyle = `hsla(${hue}, 90%, 60%, ${opacity})`;
          ctx.shadowColor = `rgba(0, 255, 136, ${opacity * 0.5})`;
        }
        ctx.shadowBlur = 8 + pulseBoost * 12;

        const charIdx = (i * 13 + Math.floor(elapsed * 1.8 + i * 0.1)) % CHAR_POOLS[i % CHAR_POOLS.length].length;
        const ch = CHAR_POOLS[i % CHAR_POOLS.length][charIdx];
        ctx.fillText(ch, x, y);
      }

      // ── Draw rain ──
      const chars = charsRef.current;
      const COLS = 80;
      const cellW = w / COLS;
      const charSize = Math.max(11, Math.min(cellW * 0.75, 14));
      ctx.font = `bold ${charSize}px "Space Mono", monospace`;
      ctx.shadowBlur = 0;

      for (let i = 0; i < chars.length; i++) {
        const c = chars[i];
        // Variable speed lanes: some columns 2x faster
        const laneMultiplier = (c.col % 7 === 0) ? 2 : 1;
        const fallSpeed = c.speed * laneMultiplier;
        const cycleTime = fallSpeed + c.delay;
        const t = (elapsed / cycleTime) % 1;

        const x = c.col * cellW + cellW / 2;
        const y = -charSize + t * (h + charSize * 2);

        // Glitch burst: random columns flash green briefly
        let opacity: number;
        let color: string;
        const timeSinceBurst = now - c.glitchBurst;
        if (c.glitch && Math.random() < 0.0003) {
          c.glitchBurst = now;
        }
        if (timeSinceBurst < 150) {
          // Burst active
          opacity = 0.9;
          color = isLight
            ? `rgba(0, 160, 80, ${opacity})`
            : `rgba(0, 255, 136, ${opacity})`;
          ctx.shadowColor = isLight ? `rgba(0, 160, 80, 0.4)` : `rgba(0, 255, 136, 0.5)`;
          ctx.shadowBlur = 6;
        } else {
          const dimBase = c.glitch ? 0.3 : c.bright ? 0.22 : 0.08 + (c.col % 5) * 0.02;
          opacity = dimBase * 0.9;
          if (isLight) {
            color = c.bright
              ? `rgba(0, 80, 160, ${opacity})`
              : `rgba(60, 80, 120, ${opacity * 0.7})`;
          } else {
            color = c.bright
              ? `rgba(0, 200, 255, ${opacity})`
              : c.glitch
                ? `rgba(180, 200, 220, ${opacity})`
                : `rgba(100, 140, 180, ${opacity})`;
          }
          ctx.shadowColor = "transparent";
          ctx.shadowBlur = 0;
        }

        const charIdx = (i * 13 + Math.floor(elapsed * 1.8 + i * 0.1)) % CHAR_POOLS[c.pool].length;
        const ch = CHAR_POOLS[c.pool][charIdx];
        ctx.fillStyle = color;
        ctx.fillText(ch, x, y);
      }

      ctx.shadowBlur = 0;
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
      }}
    />
  );
}

export function ThinkingBackground({ active, label = "thinking" }: { active: boolean; label?: string }) {
  if (!active) return null;

  return (
    <div style={{
      position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
      background: "var(--thinking-overlay-bg, radial-gradient(ellipse at center, rgba(10, 10, 26, 0.7) 0%, rgba(10, 10, 26, 0.9) 70%))",
      overflow: "hidden", pointerEvents: "none",
      zIndex: 0,
    }}>
      <style>{`
        :root {
          --thinking-overlay-bg: radial-gradient(ellipse at center, rgba(10, 10, 26, 0.7) 0%, rgba(10, 10, 26, 0.9) 70%);
        }
        [data-theme="light"] {
          --thinking-overlay-bg: radial-gradient(ellipse at center, rgba(244, 246, 250, 0.7) 0%, rgba(244, 246, 250, 0.9) 70%);
        }
        @keyframes think-blink {
          0%, 50%   { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
        @keyframes think-pulse {
          0%, 100% { text-shadow: 0 0 8px var(--color-accent, rgba(0, 255, 136, 0.5)); }
          50%      { text-shadow: 0 0 18px var(--color-accent, rgba(0, 255, 136, 0.9)), 0 0 36px var(--color-accent, rgba(0, 255, 136, 0.4)); }
        }
        .think-cursor { animation: think-blink 0.7s steps(1) infinite; }
        .think-text { animation: think-pulse 2s ease-in-out infinite; }
      `}</style>

      {/* Morphing sacred geometry character canvas */}
      <ThinkingGeometryCanvas />

      {/* Subtle horizontal scanline */}
      <div style={{
        position: "absolute", top: "50%", left: 0, right: 0, height: 1,
        background: "linear-gradient(90deg, transparent, var(--color-accent, rgba(0, 255, 136, 0.2)), transparent)",
        boxShadow: "0 0 6px var(--color-accent, rgba(0, 255, 136, 0.3))",
        opacity: 0.5,
      }} />

      {/* Center "thinking" text */}
      <div style={{
        position: "absolute", top: "50%", left: "50%",
        transform: "translate(-50%, -50%)",
        zIndex: 2,
        display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
      }}>
        <div className="think-text" style={{
          fontFamily: "var(--font-display, 'Orbitron', monospace)",
          fontSize: 18, fontWeight: 700,
          letterSpacing: "0.3em",
          color: "var(--color-foreground, #ffffff)",
          textTransform: "uppercase",
        }}>
          {label}
          <span className="think-cursor" style={{ marginLeft: 4 }}>...</span>
        </div>
        <div style={{
          fontFamily: "var(--font-mono, 'Space Mono', monospace)",
          fontSize: 10,
          letterSpacing: "0.2em",
          color: "var(--color-muted, rgba(255, 255, 255, 0.5))",
        }}>
          // routing through hive mind
        </div>
      </div>
    </div>
  );
}
