"use client";

/**
 * IntentChip — surfaces `opportunity_stage` + top reason codes in the
 * lead drawer header.
 *
 * Module 1 of the 18-module enhancement plan (2026-05-09 plan §9.1).
 *
 * Renders as a single chip with a stage label. Hover (or focus) shows
 * a tooltip with the top 3 reason codes in plain English.
 *
 * Keeps Henri's visual language: terracotta `#D4886A` accents, no
 * emojis, lucide-react icons only, font-heading reserved for marketing.
 */

import { Compass, Target, FileText, Hammer, AlertCircle, Clock, CheckCircle2, Recycle, Sparkles, Archive } from "lucide-react";
import { reasonCodeLabel, getReasonCode } from "@/lib/intent/reason-codes";
import { STAGE_LABEL_MAP } from "@/lib/intent/stage-colors";
import { cn } from "@/lib/utils/cn";

export interface IntentChipProps {
  stage?: string | null;
  reasonCodes?: string[] | null;
  /** Limit how many reason-code rows render in the tooltip. */
  topN?: number;
  /** ISO timestamp of when this lead entered its CURRENT stage. When
   *  supplied, a small "for Nd" badge follows the stage label. Sourced
   *  from `stage_history` (migration 00092) — the most-recent row's
   *  `changed_at` for this lead. */
  stageEnteredAt?: string | null;
  className?: string;
}

/** Stage labels — re-exported from the canonical palette (Module 22). */
const STAGE_LABEL = STAGE_LABEL_MAP;

/** Stage → lucide icon. Keeps each chip recognisable at a glance. */
const STAGE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  pre_intent: Compass,
  active_intent: Target,
  homeowner_submitted: Sparkles,
  permit_filed_no_contractor: FileText,
  permit_filed_with_contractor: Hammer,
  project_moving: Hammer,
  stalled: AlertCircle,
  expired: Clock,
  completed: CheckCircle2,
  maintenance_upsell: Recycle,
  archived: Archive,
};

/** Stage → terracotta-tinted accent + neutral fallback. Tailwind only.
 *  Using opacity-tints of the brand color rather than independent palette
 *  so we stay within the design system. */
const STAGE_TINT: Record<string, string> = {
  pre_intent: "bg-[#D4886A]/10 text-[#7d4f39] border-[#D4886A]/30",
  active_intent: "bg-[#D4886A]/15 text-[#7d4f39] border-[#D4886A]/40",
  homeowner_submitted: "bg-[#D4886A]/20 text-[#7d4f39] border-[#D4886A]/50",
  permit_filed_no_contractor: "bg-[#D4886A]/25 text-[#7d4f39] border-[#D4886A]/60",
  permit_filed_with_contractor: "bg-amber-50 text-amber-900 border-amber-200",
  project_moving: "bg-amber-50 text-amber-900 border-amber-200",
  stalled: "bg-yellow-50 text-yellow-900 border-yellow-200",
  expired: "bg-rose-50 text-rose-900 border-rose-200",
  completed: "bg-emerald-50 text-emerald-900 border-emerald-200",
  maintenance_upsell: "bg-sky-50 text-sky-900 border-sky-200",
  archived: "bg-zinc-50 text-zinc-700 border-zinc-200",
};

export function IntentChip({
  stage,
  reasonCodes,
  topN = 3,
  stageEnteredAt,
  className,
}: IntentChipProps) {
  if (!stage) return null;
  const label = STAGE_LABEL[stage] ?? stage.replace(/_/g, " ");
  const Icon = STAGE_ICON[stage] ?? Target;
  const tint = STAGE_TINT[stage] ?? "bg-bg-subtle text-foreground border-border";
  const codes = (reasonCodes ?? []).slice(0, topN);

  // Plain-language top reason for the "Why this matters today" line.
  const topReason = codes[0] ? getReasonCode(codes[0])?.description : null;

  // Module 7 — duration in current stage (e.g. "for 12d"). Sourced from
  // stage_history.changed_at via the lead-context API. Hidden when no
  // history is supplied so legacy callers stay visually unchanged.
  const durationLabel = stageEnteredAt ? formatStageDuration(stageEnteredAt) : null;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-[11px] font-medium",
        "transition-colors",
        tint,
        className,
      )}
      title={
        codes.length
          ? `${label}${durationLabel ? ` (${durationLabel})` : ""}\n${codes.map((c) => `• ${reasonCodeLabel(c)}`).join("\n")}`
          : `${label}${durationLabel ? ` (${durationLabel})` : ""}`
      }
      aria-label={`Opportunity stage: ${label}${durationLabel ? `, ${durationLabel}` : ""}`}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate max-w-[14rem]">{label}</span>
      {durationLabel && (
        <span className="text-[10px] opacity-70 ml-0.5">· {durationLabel}</span>
      )}
      {codes.length > 0 && (
        <span className="text-[10px] opacity-60 ml-0.5">· {codes.length}</span>
      )}
      {topReason && (
        <span className="sr-only">{topReason}</span>
      )}
    </div>
  );
}

/**
 * Format the duration since the lead entered its current stage. Output is
 * the shortest sensible label: "today", "for 1d", "for 12d", "for 3w",
 * "for 4mo". Pure function — easy to unit-test if the format changes
 * later. Returns null when the input is unparseable.
 */
function formatStageDuration(iso: string): string | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const days = Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
  if (days === 0) return "today";
  if (days === 1) return "for 1d";
  if (days < 14) return `for ${days}d`;
  if (days < 60) return `for ${Math.round(days / 7)}w`;
  return `for ${Math.round(days / 30)}mo`;
}

/**
 * IntentChipReasonsList — companion component rendered in
 * PropertyContextSection. Shows the top N reason codes as a vertical
 * list with their descriptions.
 */
export function IntentChipReasonsList({
  reasonCodes,
  topN = 3,
  className,
}: {
  reasonCodes?: string[] | null;
  topN?: number;
  className?: string;
}) {
  if (!reasonCodes || reasonCodes.length === 0) return null;
  const codes = reasonCodes.slice(0, topN);
  return (
    <div className={cn("space-y-1", className)}>
      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
        Why this matters today
      </div>
      <ul className="space-y-0.5">
        {codes.map((code) => {
          const def = getReasonCode(code);
          return (
            <li key={code} className="text-[11px] text-foreground leading-snug">
              <span className="font-medium">{def?.label ?? reasonCodeLabel(code)}</span>
              {def?.description && (
                <span className="text-muted-foreground"> — {def.description}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
