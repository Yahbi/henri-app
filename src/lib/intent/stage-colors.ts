/**
 * Single source of truth for the opportunity-stage palette.
 *
 * Module 22 of the enhancement plan (2026-05-09). Same colors used by:
 *   - src/components/dashboard/IntentChip.tsx        (drawer chip + tooltip)
 *   - src/components/dashboard/LeadCard.tsx           (left border + dot)
 *   - src/app/(dashboard)/dashboard/map/page.tsx     (map pin paint)
 *   - src/components/dashboard/PropertyContextSection (insight chips, future)
 *
 * Each entry maps a stage value to:
 *   - color:    primary HEX used for pins, dots, borders
 *   - label:    user-facing copy on chips + tooltips
 *   - tintBg:   Tailwind class for chip background (10% opacity tint)
 *   - tintFg:   Tailwind class for chip text
 *   - tintBorder: Tailwind class for chip border
 *
 * The Tailwind triplet is generated from the HEX so theme overrides
 * stay consistent. We hard-code rather than compute at runtime to avoid
 * Tailwind JIT misses on dynamic class names.
 */

import type { OpportunityStage } from "./reason-codes";

export interface StagePalette {
  color: string;
  label: string;
  tintBg: string;
  tintFg: string;
  tintBorder: string;
}

export const STAGE_PALETTE: Record<OpportunityStage, StagePalette> = {
  pre_intent: {
    color: "#E0B7A4",
    label: "Pre-intent",
    tintBg: "bg-[#E0B7A4]/15",
    tintFg: "text-[#7d4f39]",
    tintBorder: "border-[#E0B7A4]/40",
  },
  active_intent: {
    color: "#D49E7A",
    label: "Active intent",
    tintBg: "bg-[#D49E7A]/15",
    tintFg: "text-[#7d4f39]",
    tintBorder: "border-[#D49E7A]/40",
  },
  homeowner_submitted: {
    color: "#D4886A",
    label: "Homeowner submitted",
    tintBg: "bg-[#D4886A]/15",
    tintFg: "text-[#7d4f39]",
    tintBorder: "border-[#D4886A]/40",
  },
  permit_filed_no_contractor: {
    color: "#C3724E",
    label: "Permit filed — no contractor",
    tintBg: "bg-[#C3724E]/15",
    tintFg: "text-[#5a3a29]",
    tintBorder: "border-[#C3724E]/40",
  },
  permit_filed_with_contractor: {
    color: "#D4A24A",
    label: "Permit filed — contractor listed",
    tintBg: "bg-[#D4A24A]/15",
    tintFg: "text-[#7a5b1f]",
    tintBorder: "border-[#D4A24A]/40",
  },
  project_moving: {
    color: "#E8B931",
    label: "Project moving",
    tintBg: "bg-[#E8B931]/15",
    tintFg: "text-[#7a5b1f]",
    tintBorder: "border-[#E8B931]/40",
  },
  stalled: {
    color: "#F0C548",
    label: "Stalled",
    tintBg: "bg-yellow-50",
    tintFg: "text-yellow-900",
    tintBorder: "border-yellow-200",
  },
  expired: {
    color: "#E0716E",
    label: "Expired",
    tintBg: "bg-rose-50",
    tintFg: "text-rose-900",
    tintBorder: "border-rose-200",
  },
  completed: {
    color: "#5DAA68",
    label: "Completed",
    tintBg: "bg-emerald-50",
    tintFg: "text-emerald-900",
    tintBorder: "border-emerald-200",
  },
  maintenance_upsell: {
    color: "#5BA4C9",
    label: "Maintenance upsell",
    tintBg: "bg-sky-50",
    tintFg: "text-sky-900",
    tintBorder: "border-sky-200",
  },
  archived: {
    color: "#A0A0A0",
    label: "Archived",
    tintBg: "bg-zinc-50",
    tintFg: "text-zinc-700",
    tintBorder: "border-zinc-200",
  },
};

/** Lookup palette for any stage string, with a graceful default for
 *  unknown / null values. Used by the LeadCard left-border helper. */
export function paletteFor(stage: string | null | undefined): StagePalette | null {
  if (!stage) return null;
  return (STAGE_PALETTE as Record<string, StagePalette>)[stage] ?? null;
}

/** Just the color hex — convenience for inline `style={{ background: ... }}`. */
export function stageColor(stage: string | null | undefined): string | null {
  return paletteFor(stage)?.color ?? null;
}

/** All stages as a flat record `{ stage_value: hex }` — used by the map's
 *  MapLibre `match` expression where we need a plain object. */
export const STAGE_COLOR_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(STAGE_PALETTE).map(([k, v]) => [k, v.color]),
);

/** Stage → label only (chip text + filter dropdowns). */
export const STAGE_LABEL_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(STAGE_PALETTE).map(([k, v]) => [k, v.label]),
);
