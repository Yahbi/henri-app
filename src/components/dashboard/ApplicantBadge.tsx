"use client";

import { Home, HardHat, Building2 } from "lucide-react";
import {
  classifyApplicant,
  type PermitForClassifier,
  type LeadForClassifier,
} from "@/lib/permits/applicant-classifier";

/**
 * Renders a colored chip with the permit-applicant classification
 * (homeowner / contractor / spec-investor). Drawer surfacing for the
 * Phase 1.3 DIY-vs-pro feature.
 *
 * The chip is tappable on touch devices — opens a tooltip-like
 * popover with the outreach hint. Desktop falls back to the native
 * `title` attribute.
 *
 * Color tokens:
 *   - homeowner → primary (terracotta) — high outreach intent
 *   - contractor → muted — soft outreach only
 *   - spec → warm (gold) — different language entirely
 *
 * Renders nothing when no `permit` is supplied (e.g., the lead's
 * permit row hasn't loaded yet).
 */
interface ApplicantBadgeProps {
  permit: PermitForClassifier | null;
  lead?: LeadForClassifier;
  className?: string;
}

export function ApplicantBadge({ permit, lead, className }: ApplicantBadgeProps) {
  if (!permit) return null;
  const result = classifyApplicant(permit, lead);

  const Icon =
    result.type === "homeowner"
      ? Home
      : result.type === "contractor"
        ? HardHat
        : Building2;

  const toneClass =
    result.type === "homeowner"
      ? "bg-primary/10 text-primary border-primary/30"
      : result.type === "contractor"
        ? "bg-muted text-muted-foreground border-border"
        : "bg-[color-mix(in_srgb,var(--warm)_12%,transparent)] text-warm border-[color-mix(in_srgb,var(--warm)_30%,transparent)]";

  return (
    <span
      title={result.hint}
      className={[
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        toneClass,
        className ?? "",
      ].join(" ")}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="truncate max-w-[180px]">{result.label}</span>
    </span>
  );
}
