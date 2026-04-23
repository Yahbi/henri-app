"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Dialog } from "@/components/ui/dialog";
import { Star, Loader2, Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * Feedback dialog — one form, used by both contractor and homeowner
 * surfaces via their respective trigger buttons. Posts to
 * /api/feedback with category + optional rating + message + the
 * page the user is currently on.
 *
 * Fields are intentionally short: category pill row, star row, single
 * textarea. Longer forms discourage people from actually sending
 * feedback. Category is auto-default "other"; the only hard
 * requirement is the message body.
 *
 * For anonymous (logged-out) use we show an email field so ops can
 * follow up. Authenticated submitters get their email pulled from the
 * server session — no email field shown.
 */

type Category = "bug" | "feature_request" | "praise" | "complaint" | "question" | "other";

interface FeedbackDialogProps {
  open: boolean;
  onClose: () => void;
  /** Render the email field even when authenticated (e.g. for testing). */
  forceAnonymous?: boolean;
  /** Hint the dialog's default category. */
  defaultCategory?: Category;
}

const CATEGORIES: { key: Category; label: string }[] = [
  { key: "bug", label: "Bug" },
  { key: "feature_request", label: "Feature request" },
  { key: "praise", label: "Praise" },
  { key: "complaint", label: "Complaint" },
  { key: "question", label: "Question" },
  { key: "other", label: "Other" },
];

export function FeedbackDialog({
  open,
  onClose,
  forceAnonymous = false,
  defaultCategory = "other",
}: FeedbackDialogProps) {
  const pathname = usePathname();

  const [category, setCategory] = useState<Category>(defaultCategory);
  const [rating, setRating] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function reset() {
    setCategory(defaultCategory);
    setRating(null);
    setMessage("");
    setEmail("");
    setError(null);
    setDone(false);
  }

  async function submit() {
    if (!message.trim()) {
      setError("Please add a message.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          rating,
          message: message.trim(),
          page_path: pathname ?? null,
          email: forceAnonymous && email ? email : undefined,
        }),
      });
      const body = await res.json().catch(() => ({ error: "Unknown error" }));
      if (!res.ok) {
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setDone(true);
      // Auto-close a moment after success so the "thanks" state is
      // visible without trapping the user in a modal.
      setTimeout(() => {
        onClose();
        reset();
      }, 1400);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (submitting) return; // Don't close while an in-flight POST is pending.
        onClose();
        reset();
      }}
      title="Send feedback"
      description="Bug report, feature idea, or just hello — tell us what's on your mind."
    >
      {done ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="w-12 h-12 rounded-full bg-primary-10 flex items-center justify-center mb-3">
            <Check className="w-6 h-6 text-primary" aria-hidden="true" />
          </div>
          <p className="text-base font-medium text-foreground">Thanks for the note.</p>
          <p className="text-sm text-muted-foreground mt-1">
            We read every message and will follow up if needed.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Category pills */}
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
              Category
            </label>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setCategory(c.key)}
                  className={cn(
                    "px-2.5 py-1 rounded-full text-xs border transition-colors",
                    category === c.key
                      ? "bg-primary text-white border-primary"
                      : "bg-background text-foreground border-border hover:bg-accent",
                  )}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* Star rating */}
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
              Overall rating <span className="font-normal normal-case text-[10px]">(optional)</span>
            </label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRating(rating === n ? null : n)}
                  aria-label={`${n} star${n === 1 ? "" : "s"}`}
                  className="p-1 rounded hover:bg-accent transition-colors"
                >
                  <Star
                    className={cn(
                      "w-5 h-5 transition-colors",
                      rating && n <= rating
                        ? "fill-primary text-primary"
                        : "text-muted-foreground",
                    )}
                  />
                </button>
              ))}
            </div>
          </div>

          {/* Message */}
          <div>
            <label
              htmlFor="feedback-message"
              className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block"
            >
              Message
            </label>
            <textarea
              id="feedback-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What's working? What isn't? What would you like to see?"
              rows={5}
              maxLength={4000}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              {message.length} / 4000
            </p>
          </div>

          {/* Email (only for anonymous submissions) */}
          {forceAnonymous && (
            <div>
              <label
                htmlFor="feedback-email"
                className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block"
              >
                Email <span className="font-normal normal-case text-[10px]">(so we can reply)</span>
              </label>
              <input
                id="feedback-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          )}

          {error && (
            <p className="text-xs text-red-500" role="alert">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                onClose();
                reset();
              }}
              disabled={submitting}
              className="px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={submitting || !message.trim()}
              className="px-4 py-1.5 rounded-lg text-sm font-semibold bg-primary text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Send feedback
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
