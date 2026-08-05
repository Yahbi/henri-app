"use client";

import { Eye } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { WatcherBucket } from "@/lib/exclusivity/locks";

/**
 * Wedge contract #6 — coarse competitive-intel pill.
 *
 *   "N other contractors are watching this permit" shown as a bucketed
 *   count (1-2 / 3-5 / 5+), never the raw number. This design choice
 *   is load-bearing: revealing a precise count re-creates the Angi
 *   "race to respond first" pathology we're explicitly avoiding.
 *
 * Visual states:
 *   - "0"   → null (nothing to show; you're alone)
 *   - "1-2" → muted pill, informational tone
 *   - "3-5" → attention tone (warm amber)
 *   - "5+"  → stronger attention (urgency without panic)
 *
 * Never renders the numeric bucket without the label "watching" —
 * keeps the semantics obvious to a contractor glancing at the row.
 */
export function WatchersBadge({
  bucket,
  size = "sm",
}: {
  bucket: WatcherBucket | undefined | null;
  size?: "sm" | "xs";
}) {
  if (!bucket || bucket === "0") return null;

  const tone =
    bucket === "5+"
      ? "text-warm bg-warm/16 border-warm/30"
      : bucket === "3-5"
        ? "text-warm bg-warm/10 border-warm/22"
        : "text-muted-foreground bg-bg-subtle border-border";

  const sizeCls =
    size === "xs"
      ? "px-1.5 py-0 text-[9px] gap-1"
      : "px-2 py-0.5 text-[10px] gap-1";

  const iconSize = size === "xs" ? "h-2.5 w-2.5" : "h-3 w-3";

  // Human label — bucket is the count, "watching" is the action.
  const label = `${bucket} watching`;

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border font-semibold whitespace-nowrap",
        tone,
        sizeCls,
      )}
      title={`${bucket} other contractors are also looking at this permit. Exact count is deliberately hidden to discourage racing.`}
    >
      <Eye className={cn(iconSize, "shrink-0")} aria-hidden="true" />
      {label}
    </span>
  );
}
