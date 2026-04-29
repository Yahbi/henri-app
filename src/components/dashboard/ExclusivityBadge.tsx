"use client";

import { Lock } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { formatRemaining, type ExclusivityLockSummary } from "@/lib/exclusivity/locks";

/**
 * Phase 0a wedge #1 — per-permit exclusivity lock badge.
 *
 * Three visual states:
 *   - `held_by_caller=true` + >24h left  → muted terracotta pill "14d left"
 *   - `held_by_caller=true` + ≤24h left  → warm-tone warning "4h left"
 *   - `held_by_caller=true` + expired    → muted red "expired"
 *
 * Never rendered when another contractor holds the lock — our lead-list
 * scoper already hides those rows. Never rendered when locks feature is
 * inactive (summary undefined / migration pending).
 */
export function ExclusivityBadge({
  summary,
  size = "sm",
}: {
  summary: ExclusivityLockSummary | undefined | null;
  size?: "sm" | "xs";
}) {
  if (!summary || !summary.held_by_caller) return null;

  const ms = summary.ms_remaining;
  const expired = ms <= 0;
  const urgent = !expired && ms < 24 * 60 * 60 * 1000;

  // Tone classes — color-mix() over canonical tokens so future palette
  // shifts (warm/primary) propagate. Migrated 2026-04-25.
  const tone = expired
    ? "text-muted-foreground bg-bg-subtle border-border"
    : urgent
      ? "text-warm bg-[color-mix(in_srgb,var(--warm)_12%,transparent)] border-[color-mix(in_srgb,var(--warm)_25%,transparent)]"
      : "text-primary bg-primary-10 border-[color-mix(in_srgb,var(--primary)_25%,transparent)]";

  const sizeCls =
    size === "xs"
      ? "px-1.5 py-0 text-[9px] gap-1"
      : "px-2 py-0.5 text-[10px] gap-1";

  const iconSize = size === "xs" ? "h-2.5 w-2.5" : "h-3 w-3";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border font-semibold whitespace-nowrap",
        tone,
        sizeCls,
      )}
      title={
        expired
          ? "Your exclusivity window expired — this lead is about to open to the next contractor in your ZIP"
          : `You hold exclusivity on this permit for ${formatRemaining(ms)}`
      }
    >
      <Lock className={cn(iconSize, "shrink-0")} aria-hidden="true" />
      {expired ? "expired" : formatRemaining(ms)}
    </span>
  );
}
