"use client";

import { useState, useCallback } from "react";

/* ================================================================== */
/*  PROPS                                                              */
/* ================================================================== */

interface ReviewFormProps {
  token: string;
  contractorId: string;
  contractorName: string;
  customerName: string;
  customerEmail: string | null;
  trade: string | null;
}

/* ================================================================== */
/*  STAR RATING COMPONENT                                              */
/* ================================================================== */

function StarRating({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (rating: number) => void;
  disabled: boolean;
}) {
  const [hovered, setHovered] = useState(0);

  return (
    <div className="flex gap-1" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = star <= (hovered || value);
        return (
          <button
            key={star}
            type="button"
            disabled={disabled}
            className="group rounded-md p-1 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 enabled:hover:scale-110 disabled:cursor-not-allowed"
            onClick={() => onChange(star)}
            onMouseEnter={() => setHovered(star)}
            onMouseLeave={() => setHovered(0)}
            aria-label={`${star} star${star !== 1 ? "s" : ""}`}
            aria-checked={star === value}
            role="radio"
          >
            <svg
              className={`h-10 w-10 transition-colors ${
                filled
                  ? "text-primary"
                  : "text-border group-hover:text-primary/30"
              }`}
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
          </button>
        );
      })}
    </div>
  );
}

/* ================================================================== */
/*  RATING LABELS                                                      */
/* ================================================================== */

const ratingLabels: Record<number, string> = {
  1: "Poor",
  2: "Below Average",
  3: "Average",
  4: "Great",
  5: "Excellent",
};

/* ================================================================== */
/*  REVIEW FORM                                                        */
/* ================================================================== */

export function ReviewForm({
  token,
  contractorId,
  contractorName,
  customerName,
  customerEmail,
  trade,
}: ReviewFormProps) {
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bodyCharLimit = 500;
  const bodyCharsRemaining = bodyCharLimit - body.length;

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (rating === 0) {
        setError("Please select a rating.");
        return;
      }

      setSubmitting(true);
      setError(null);

      try {
        const res = await fetch("/api/reviews", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token,
            contractor_id: contractorId,
            rating,
            title: title.trim() || null,
            body: body.trim() || null,
            reviewer_name: customerName,
            reviewer_email: customerEmail,
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(
            data.error ?? "Something went wrong. Please try again."
          );
        }

        setSubmitted(true);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Something went wrong. Please try again."
        );
      } finally {
        setSubmitting(false);
      }
    },
    [rating, title, body, token, contractorId, customerName, customerEmail]
  );

  /* ── Success state ── */
  if (submitted) {
    return (
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
          <svg
            className="h-8 w-8 text-primary"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4.5 12.75l6 6 9-13.5"
            />
          </svg>
        </div>
        <h1 className="font-heading text-2xl font-normal tracking-tight text-foreground">
          Thank you for your review!
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Your feedback helps {contractorName} improve and helps other
          homeowners find quality contractors.
        </p>
      </div>
    );
  }

  /* ── Form ── */
  return (
    <div className="w-full max-w-lg">
      {/* Header */}
      <div className="mb-8 text-center">
        <h1 className="font-heading text-3xl font-normal tracking-tight text-foreground sm:text-4xl">
          How was your experience?
        </h1>
        <p className="mt-3 text-base text-muted-foreground">
          Share your experience with{" "}
          <span className="font-medium text-foreground">{contractorName}</span>
        </p>
        {trade && (
          <p className="mt-1 text-sm text-muted-foreground">{trade}</p>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Star rating */}
        <div className="flex flex-col items-center gap-2">
          <StarRating
            value={rating}
            onChange={setRating}
            disabled={submitting}
          />
          {rating > 0 && (
            <span className="text-sm font-medium text-foreground">
              {ratingLabels[rating]}
            </span>
          )}
        </div>

        {/* Title */}
        <div>
          <label
            htmlFor="review-title"
            className="mb-1.5 block text-sm font-medium text-foreground"
          >
            Title{" "}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </label>
          <input
            id="review-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={submitting}
            placeholder="Summarize your experience"
            maxLength={120}
            className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
          />
        </div>

        {/* Body */}
        <div>
          <label
            htmlFor="review-body"
            className="mb-1.5 block text-sm font-medium text-foreground"
          >
            Your review{" "}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </label>
          <textarea
            id="review-body"
            value={body}
            onChange={(e) => {
              if (e.target.value.length <= bodyCharLimit) {
                setBody(e.target.value);
              }
            }}
            disabled={submitting}
            placeholder="Tell us about your experience..."
            rows={4}
            className="w-full resize-none rounded-lg border border-input bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
          />
          <p
            className={`mt-1 text-right text-xs ${
              bodyCharsRemaining < 50
                ? "text-destructive"
                : "text-muted-foreground"
            }`}
          >
            {bodyCharsRemaining} characters remaining
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={submitting || rating === 0}
          className="w-full rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Submitting..." : "Submit Review"}
        </button>

        {/* Privacy note */}
        <p className="text-center text-xs text-muted-foreground">
          Your review will be visible on {contractorName}&apos;s public profile.
          By submitting, you confirm this reflects your genuine experience.
        </p>
      </form>
    </div>
  );
}
