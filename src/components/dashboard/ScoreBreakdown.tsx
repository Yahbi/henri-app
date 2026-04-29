"use client";

interface ScoreBarProps {
  label: string;
  value: number;
  max?: number;
  color: string;
}

function ScoreBar({ label, value, max = 20, color }: ScoreBarProps) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-fg-subtle w-20 shrink-0">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-bg-subtle overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-[11px] font-semibold text-foreground w-5 text-right">
        {value}
      </span>
    </div>
  );
}

interface ScoreBreakdownProps {
  freshness: number;
  value: number;
  contact: number;
  demand: number;
  engagement?: number;
  conversion?: number;
}

export function ScoreBreakdown({
  freshness,
  value,
  contact,
  demand,
  engagement,
  conversion,
}: ScoreBreakdownProps) {
  /* Bar colours — sourced from semantic CSS tokens so the score-signal
   * palette propagates from globals.css. Engagement (purple) and
   * Conversion (pink) have no semantic token in the brand palette and
   * stay as hex literals; replace if/when the brand adds them. Migrated
   * from raw hex on 2026-04-25 per design-system audit. */
  return (
    <div className="space-y-2">
      <ScoreBar label="Freshness"  value={freshness} max={20} color="var(--hot)" />
      <ScoreBar label="Value"      value={value}     max={20} color="var(--warm)" />
      <ScoreBar label="Contact"    value={contact}   max={15} color="hsl(var(--success))" />
      <ScoreBar label="Demand"     value={demand}    max={15} color="var(--cool)" />
      {engagement != null && engagement > 0 && (
        <ScoreBar label="Engagement" value={engagement} max={15} color="#8B5CF6" />
      )}
      {conversion != null && conversion > 0 && (
        <ScoreBar label="Conversion" value={conversion} max={15} color="#EC4899" />
      )}
    </div>
  );
}
