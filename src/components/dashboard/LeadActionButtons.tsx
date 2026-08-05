"use client";

import { useState, useTransition } from "react";
import { Bookmark, BookmarkCheck, EyeOff, Loader2 } from "lucide-react";
// Project logger — client-safe (console-backed; same import pattern as
// useLeads.ts). Structured output in production, pretty in development.
import { logger } from "@/lib/logger";

/**
 * Save / Hide action buttons rendered in the lead drawer header next
 * to the close button.
 *
 * Module 11 of the 18-module enhancement plan (2026-05-09 plan §9.13.D).
 *
 * Both actions optimistically toggle local state, then call the API
 * routes. On error the toggle reverts, a logger.warn fires, AND a short
 * inline message renders under the buttons — a state that silently snaps
 * back reads as a bug rather than a failure the contractor can retry.
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
  /** Called after a successful Save toggle (in either direction) so the
   *  parent can sync the shared saved-leads set — keeps the "Saved"
   *  filter accurate and makes a reopened lead show its true saved state. */
  onSaved?: (saved: boolean) => void;
}

export function LeadActionButtons({
  leadId,
  initialSaved = false,
  initialHidden = false,
  onHidden,
  onSaved,
}: LeadActionButtonsProps) {
  const [saved, setSaved] = useState(initialSaved);
  const [hidden, setHidden] = useState(initialHidden);
  const [pending, startTransition] = useTransition();
  /** Which action is in flight. A single shared `pending` flag used to grey
   *  out BOTH buttons while only one had a spinner, so the other looked
   *  dead for no visible reason. */
  const [busy, setBusy] = useState<"save" | "hide" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const toggleSave = () => {
    const next = !saved;
    setSaved(next);
    setBusy("save");
    setActionError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/leads/${leadId}/save`, {
          method: next ? "POST" : "DELETE",
          headers: { "Content-Type": "application/json" },
          body: next ? JSON.stringify({}) : undefined,
        });
        if (!res.ok) throw new Error(`save failed: ${res.status}`);
        if (onSaved) onSaved(next);
      } catch (e) {
        logger.warn("LeadActionButtons: save toggle failed", {
          leadId,
          error: e instanceof Error ? e.message : String(e),
        });
        setSaved(!next);  // revert
        setActionError(
          next ? "Couldn't save that lead — try again." : "Couldn't unsave — try again.",
        );
      } finally {
        setBusy(null);
      }
    });
  };

  const toggleHide = () => {
    const next = !hidden;
    setHidden(next);
    setBusy("hide");
    setActionError(null);
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
        logger.warn("LeadActionButtons: hide toggle failed", {
          leadId,
          error: e instanceof Error ? e.message : String(e),
        });
        setHidden(!next);
        setActionError(
          next ? "Couldn't hide that lead — try again." : "Couldn't unhide — try again.",
        );
      } finally {
        setBusy(null);
      }
    });
  };

  return (
    <div className="absolute top-3 right-12 flex items-center gap-1 z-10">
      {actionError && (
        <span
          role="alert"
          className="mr-1 rounded-md bg-destructive/10 px-1.5 py-0.5 text-[10px] text-destructive"
        >
          {actionError}
        </span>
      )}
      <button
        onClick={toggleSave}
        disabled={pending && busy === "save"}
        className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        aria-label={saved ? "Unsave lead" : "Save lead"}
        aria-pressed={saved}
        title={saved ? "Saved · click to unsave" : "Save this lead"}
      >
        {pending && busy === "save" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : saved ? (
          <BookmarkCheck className="h-4 w-4 text-primary" />
        ) : (
          <Bookmark className="h-4 w-4" />
        )}
      </button>
      <button
        onClick={toggleHide}
        disabled={pending && busy === "hide"}
        className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        aria-label={hidden ? "Unhide lead" : "Hide lead"}
        aria-pressed={hidden}
        title={hidden ? "Hidden · click to unhide" : "Hide this lead"}
      >
        {pending && busy === "hide" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <EyeOff className={`h-4 w-4 ${hidden ? "text-rose-600" : ""}`} />
        )}
      </button>
    </div>
  );
}
