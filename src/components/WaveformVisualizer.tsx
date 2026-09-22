"use client";

interface WaveformVisualizerProps {
  level: number; // 0-1
  barCount?: number;
  className?: string;
}

/**
 * Animated waveform bars that respond to audio level in real-time.
 * When level is 0, shows a gentle idle pulse.
 */
export default function WaveformVisualizer({
  level,
  barCount = 5,
  className = "",
}: WaveformVisualizerProps) {
  const bars = Array.from({ length: barCount }, (_, i) => {
    // Distribute level across bars with some randomness for natural feel
    const offset = Math.sin((i / barCount) * Math.PI) * 0.4;
    const height = Math.max(4, Math.min(32, level * 32 + offset * 4));
    const delay = i * 0.08;

    return (
      <div
        key={i}
        className="w-[3px] rounded-full bg-current transition-all duration-75"
        style={{
          height: `${height}px`,
          animationDelay: `${delay}s`,
          opacity: level > 0.05 ? 0.9 : 0.3,
        }}
      />
    );
  });

  return (
    <div className={`flex items-center gap-[2.5px] text-accent ${className}`}>
      {bars}
    </div>
  );
}
