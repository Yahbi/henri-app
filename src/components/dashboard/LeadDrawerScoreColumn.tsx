"use client";

import { cn } from "@/lib/utils/cn";
import { scoreColor, scoreLabel } from "./LeadDetailDrawer.helpers";
import type { LeadData } from "./LeadCard";

/**
 * LeadDrawerScoreColumn — leftmost column of the LeadDetailDrawer:
 * the big score circle, the urgency badge, and the trade/type label.
 *
 * Audit-04-29 priority D step 2: extracted from `LeadDetailDrawer.tsx`
 * for cleaner composition. Pure JSX — no state, no I/O.
 *
 * The urgency badge tokens (`hot` / `warm` / `cool`) come from the parent's
 * `proposal.urgency` value (computed via `generateProposal(lead)`); we
 * accept a pre-built `urgencyBadge` shape so this component stays trade-
 * agnostic and the proposal-to-color mapping stays single-sourced in the
 * parent.
 */

export interface UrgencyBadge {
  label: string;
  className: string;
}

interface LeadDrawerScoreColumnProps {
  lead: LeadData;
  urgencyBadge: UrgencyBadge;
}

export function LeadDrawerScoreColumn({
  lead,
  urgencyBadge,
}: LeadDrawerScoreColumnProps) {
  return (
    <div className="flex flex-col items-center justify-start shrink-0 w-full sm:w-[100px] pt-1">
      <div
        className={cn(
          "w-14 h-14 rounded-full border-[3px] flex items-center justify-center text-lg font-bold",
          scoreColor(lead.score),
        )}
      >
        {lead.score}
      </div>
      <p className="text-[11px] font-semibold text-foreground mt-1.5">
        {scoreLabel(lead.score)}
      </p>
      <p className="text-[10px] text-muted-foreground capitalize">
        {lead.trade ?? lead.type}
      </p>
      <span
        className={cn(
          "mt-2 px-2 py-0.5 rounded text-[10px] font-semibold",
          urgencyBadge.className,
        )}
      >
        {urgencyBadge.label}
      </span>
    </div>
  );
}
