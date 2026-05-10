"use client";

import { useState, useTransition } from "react";
import { Bookmark, BookmarkCheck, EyeOff, Loader2 } from "lucide-react";

/**
 * Save / Hide action buttons rendered in the lead drawer header next
 * to the close button.
 *
 * Module 11 of the 18-module enhancement plan (2026-05-09 plan §9.13.D).
 *
 * Both actions optimistically toggle local state, then call the API
 * routes. On error the toggle reverts and a console.warn fires (no
 * user-facing toast since these are tertiary actions).
 */

interface LeadActionButtonsProps {
  leadId: string;
  /** Initial saved state — typically false for newly opened drawers,
   *  true if the contractor previously saved this lead. Owner of the
   *  state (parent of LeadDetailDrawer) refreshes from /api/saved-leads
   *  on mount and passes the current value. */
  initialSaved?: boolean;
  initialHidden?: boolean;
  /** Called after a successful Hide so the parent list can remove the
   *  row immediately (it's now in the hidden_leads table and the next
   *  fetch would filter it anyway, but we want instant feedback). */
  onHidden?: () => void;
}

export function LeadActionButtons({
  leadId,
  initialSaved = false,
  initialHidden = false,
  onHidden,
}: LeadActionButtonsProps) {
  const [saved, setSaved] = useState(initialSaved);
  const [hidden, setHidden] = useState(initialHidden);
  const [pending, startTransition] = useTransition();

  const toggleSave = () => {
    const next = !saved;
    setSaved(next);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/leads/${leadId}/save`, {
          method: next ? "POST" : "DELETE",
          headers: { "Content-Type": "application/json" },
          body: next ? JSON.stringify({}) : undefined,
        });
        if (!res.ok) throw new Error(`save failed: ${res.status}`);
      } catch (e) {
        console.warn("[LeadActionButtons] save toggle failed", e);
        setSaved(!next);  // revert
      }
    });
  };

  const toggleHide = () => {
    const next = !hidden;
    setHidden(next);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/leads/${leadId}/hide`, {
          method: next ? "POST" : "DELETE",
          headers: { "Content-Type": "application/json" },
          body: next ? JSON.stringify({}) : undefined,
        });
        if (!res.ok) throw new Error(`hide failed: ${res.status}`);
        if (next && onHidden) onHidden();
      } catch (e) {
        console.warn("[LeadActionButtons] hide toggle failed", e);
        setHidden(!next);
      }
    });
  };

  return (
    <div className="absolute top-3 right-12 flex items-center gap-1 z-10">
      <button
        onClick={toggleSave}
        disabled={pending}
        className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        aria-label={saved ? "Unsave lead" : "Save lead"}
        aria-pressed={saved}
        title={saved ? "Saved · click to unsave" : "Save this lead"}
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : saved ? (
          <BookmarkCheck className="h-4 w-4 text-[#D4886A]" />
        ) : (
          <Bookmark className="h-4 w-4" />
        )}
      </button>
      <button
        onClick={toggleHide}
        disabled={pending}
        className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        aria-label={hidden ? "Unhide lead" : "Hide lead"}
        aria-pressed={hidden}
        title={hidden ? "Hidden · click to unhide" : "Hide this lead"}
      >
        <EyeOff className={`h-4 w-4 ${hidden ? "text-rose-600" : ""}`} />
      </button>
    </div>
  );
}
