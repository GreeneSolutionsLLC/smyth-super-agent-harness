// ── Thinking Indicator ──
// Agent avatar with pulsing status text below it — no bubble
// Shows "thinking..." during normal processing, "working..." during tool use

export function ThinkingIndicator({ mode = "thinking" }: { mode?: string }) {
  const text = mode === "working" ? "working" : "thinking";
  const tagline = mode === "working" ? "// routing through tool chain" : "// routing through hive mind";

  return (
    <div className="flex items-start gap-2" style={{ position: 'relative', zIndex: 2, padding: '8px 16px' }}>
      <div className="flex flex-col items-center gap-1">
        <span className="w-8 h-8 rounded-full overflow-hidden shrink-0 bg-white flex items-center justify-center">
          <img src="/Artwork/Logocircle2-circle.png" alt="" className="w-full h-full object-contain" />
        </span>
        <div className="thinking-inline" style={{
          fontFamily: 'monospace',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.2em',
          color: 'rgba(140, 245, 255, 0.8)',
          textTransform: 'lowercase',
          textShadow: '0 0 6px rgba(120, 240, 255, 0.4)',
        }}>
          {text}
          <span className="thinking-cursor-inline" style={{ marginLeft: 2 }}>...</span>
        </div>
        <div style={{
          fontFamily: 'monospace',
          fontSize: 8,
          letterSpacing: '0.15em',
          color: 'rgba(120, 200, 220, 0.4)',
          marginTop: 1,
        }}>
          {tagline}
        </div>
      </div>
      <style>{`
        @keyframes think-pulse-inline {
          0%, 100% { text-shadow: 0 0 6px rgba(120, 240, 255, 0.4); }
          50%      { text-shadow: 0 0 14px rgba(120, 240, 255, 0.8), 0 0 28px rgba(120, 240, 255, 0.3); }
        }
        @keyframes think-blink-inline {
          0%, 50%   { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
        .thinking-inline {
          animation: think-pulse-inline 2s ease-in-out infinite;
        }
        .thinking-cursor-inline {
          animation: think-blink-inline 0.7s steps(1) infinite;
        }
      `}</style>
    </div>
  );
}
