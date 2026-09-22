"use client";

function colorFor(pct: number) {
  if (pct >= 90) return "bg-red-500";
  if (pct >= 70) return "bg-amber-500";
  return "bg-emerald-500";
}

function statusLabel(pct: number) {
  if (pct >= 90) return "CRITICAL";
  if (pct >= 70) return "WARM";
  return "OK";
}

function statusTextColor(pct: number) {
  if (pct >= 90) return "text-red-500";
  if (pct >= 70) return "text-amber-500";
  return "text-emerald-500";
}

function numColor(pct: number) {
  if (pct >= 90) return "text-red-500";
  if (pct >= 70) return "text-amber-500";
  return "text-muted";
}

const BAR_COUNT = 20;

function Bars({ filled, color, isActive }: { filled: number; color: string; isActive?: boolean }) {
  return (
    <div className="flex gap-[3px] items-center h-[14px]">
      {Array.from({ length: BAR_COUNT }).map((_, i) => (
        <div
          key={i}
          className={`flex-1 h-full min-w-[4px] rounded-[2px] transition-colors ${
            i < filled ? color : "bg-muted-bg"
          } ${isActive && i < filled ? "gas-burning" : ""}`}
        />
      ))}
    </div>
  );
}

export function TokenGauge({ used, limit, isActive }: { used: number; limit: number; isActive?: boolean }) {
  const pct = Math.min((used / limit) * 100, 100);
  // Floor at 1 so a non-zero readout never renders an empty bar
  const filled = Math.max(Math.round(pct / 5), used > 0 ? 1 : 0);
  const color = colorFor(pct);

  return (
    <div className="token-gauge">
      <div className="flex justify-between items-center">
        <span className="section-label">Token Usage</span>
        <span className={`text-xs font-mono ${numColor(pct)}`}>
          {formatNum(used)} / {formatNum(limit)}
        </span>
      </div>
      <Bars filled={filled} color={color} isActive={isActive} />
      <div className="flex justify-between text-[9.5px] text-muted">
        <span className={`${statusTextColor(pct)} font-semibold`}>{statusLabel(pct)}</span>
        <span>{Math.round(pct)}% used</span>
      </div>
      <div className="text-[9.5px] text-muted -mt-1">1B Token Plan</div>
    </div>
  );
}

export function SessionContextGauge({ used, limit }: { used: number; limit: number }) {
  const pct = Math.min((used / limit) * 100, 100);
  // Floor at 1 so a non-zero readout never renders an empty bar
  const filled = Math.max(Math.round(pct / 5), used > 0 ? 1 : 0);
  const color = colorFor(pct);

  return (
    <div className="token-gauge">
      <div className="flex justify-between items-center">
        <span className="section-label">Context</span>
        <span className={`text-xs font-mono ${numColor(pct)}`}>
          {Math.round(pct)}% used
        </span>
      </div>
      <Bars filled={filled} color={color} />
      <div className="flex justify-between text-[9.5px] text-muted">
        <span className={`${statusTextColor(pct)} font-semibold`}>
          {pct >= 90 ? "FULL" : pct >= 70 ? "WARM" : "OK"}
        </span>
        <span>{formatNum(used)} / {formatNum(limit)}</span>
      </div>
    </div>
  );
}

function formatNum(n: number): string {
  if (!isFinite(n)) return "—";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(n >= 10_000_000_000 ? 0 : 2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 100_000_000 ? 0 : 2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}K`;
  return Math.round(n).toString();
}
