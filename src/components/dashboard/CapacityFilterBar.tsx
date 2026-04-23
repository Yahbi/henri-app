"use client";

import Link from "next/link";
import { SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  hasActivePrefs,
  summarizePrefs,
  type CapacityPrefs,
} from "@/lib/capacity/types";

/**
 * Phase 0a wedge #7 — capacity filter bar.
 *
 * Renders inline on the Leads tab (next to the existing urgency /
 * sort filters). Two states:
 *   - No capacity set: muted "Set capacity" link to Settings
 *   - Active: terracotta pill summarizing the filter, with an
 *     inline "clear" X. Clicking the pill body goes to Settings.
 *
 * The filtering itself happens in the Leads panel (see applyCapacityFilter)
 * — this component is pure UI.
 */
export function CapacityFilterBar({
  prefs,
  filteredOutCount,
  onClear,
}: {
  prefs: CapacityPrefs;
  /** How many leads the capacity filter is currently hiding. Shown
   *  in the tooltip / aria-label so contractors always know what's
   *  being held back. Never silently drop rows. */
  filteredOutCount: number;
  onClear: () => void;
}) {
  const active = hasActivePrefs(prefs);

  if (!active) {
    return (
      <Link
        href="/settings/capacity"
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-dashed border-border text-[11px] text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors"
        title="Hide leads outside your working envelope (radius, project value, start window)"
      >
        <SlidersHorizontal className="h-3 w-3" />
        Set capacity
      </Link>
    );
  }

  const summary = summarizePrefs(prefs);
  const title =
    filteredOutCount > 0
      ? `Capacity filter active: ${summary} (hiding ${filteredOutCount} leads). Click to edit.`
      : `Capacity filter active: ${summary}. Click to edit.`;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-full border text-[11px] font-medium",
        "border-primary/30 bg-primary-08 text-primary",
      )}
    >
      <Link
        href="/settings/capacity"
        className="inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1"
        title={title}
      >
        <SlidersHorizontal className="h-3 w-3" />
        <span className="truncate max-w-[220px]">{summary}</span>
        {filteredOutCount > 0 && (
          <span className="text-muted-foreground/80 ml-0.5">
            · {filteredOutCount} hidden
          </span>
        )}
      </Link>
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear capacity filter"
        title="Clear capacity filter"
        className="h-5 w-5 flex items-center justify-center rounded-full hover:bg-primary/10 transition-colors mr-1"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
