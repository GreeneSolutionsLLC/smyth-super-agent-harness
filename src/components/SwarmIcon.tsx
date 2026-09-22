"use client";

/**
 * SwarmIcon — Honeycomb beehive with buzzing bee orbit.
 *
 * Two adjacent hex cells + a bee dot tracing an arc between them.
 * Reads as "swarm" at 18-24px, scales cleanly larger.
 */

interface SwarmIconProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
  active?: boolean;
}

export function SwarmIcon({
  size = 18,
  strokeWidth = 1.5,
  className,
  active,
}: SwarmIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Left cell — hexagon */}
      <path
        d="M12 4 L8 6.8 L8 12 L12 14.8 L16 12 L16 6.8 Z"
        fill={active ? "currentColor" : "none"}
        fillOpacity={active ? 0.15 : 0}
      />
      {/* Right cell — hexagon, sharing the right wall */}
      <path
        d="M16 9.2 L12 12 L12 17.2 L16 20 L20 17.2 L20 12 Z"
        fill={active ? "currentColor" : "none"}
        fillOpacity={active ? 0.15 : 0}
      />
      {/* Bee body */}
      <circle cx="14" cy="12" r="1.2" fill="currentColor" stroke="none" className={active ? "animate-pulse" : ""} />
      {/* Bee wing arc — orbit trail */}
      <path
        d="M14 9.5 C16 9.5 17.5 11 17.5 13"
        strokeDasharray="1.5 1.5"
        strokeWidth={strokeWidth * 0.7}
        opacity={0.5}
      />
    </svg>
  );
}
