/**
 * ChatIntakeModal.parts.tsx
 *
 * Constants + presentational sub-components extracted from
 * `ChatIntakeModal.tsx` so the giant component body (1,028 LOC) drops by
 * ~270 lines and these UI primitives become reusable.
 *
 * Audit-04-29 (priority D): the intake modal was the second-largest
 * component in the codebase. Step 1 of the refactor was to pull out the
 * pure data + dumb UI helpers — none of these touch state, API, or props
 * from the parent. The remaining body of `ChatIntakeModal.tsx` is the
 * step-by-step state machine that owns the React state and the /api/intake
 * submission flow; that's the deeper refactor.
 *
 * Contents:
 *   - TRADES / TIMELINES / BUDGETS  — option lists for the option cards
 *   - TOTAL_STEPS                    — count for ProgressDots
 *   - HENRI_MESSAGES                 — per-step Henri prompt copy
 *   - ProgressDots                   — top-of-modal step indicator
 *   - HenriBubble / UserBubble       — chat bubble primitives
 *   - OptionCard                     — selectable card for trade/timeline/budget
 *   - ScoreResult                    — concentric-ring score reveal
 *   - MatchCard + MatchContractor    — final contractor card
 *   - StarIcon                       — small SVG used inside MatchCard
 */
"use client";

import { cn } from "@/lib/utils/cn";

/* ------------------------------------------------------------------ */
/*  Data                                                               */
/* ------------------------------------------------------------------ */

export const TRADES = [
  "Roofing",
  "HVAC",
  "Solar",
  "Electrical",
  "Plumbing",
  "Addition",
  "ADU",
  "Windows",
  "Painting",
  "Landscaping",
  "General Remodel",
  "Foundation",
] as const;

export const TIMELINES = [
  "ASAP",
  "Within 2 weeks",
  "Within a month",
  "Flexible",
] as const;

export const BUDGETS = [
  "Under $5K",
  "$5K - $15K",
  "$15K - $50K",
  "$50K - $100K",
  "$100K+",
] as const;

/* Photo step removed 2026-06-10 (truthfulness): photos were collected as
 * filenames only and POSTed as an empty array — silently discarded. Don't
 * collect what we drop. Flow is now 7 steps:
 * trade → address → timeline → budget → description → contact → result. */
export const TOTAL_STEPS = 7;

export const HENRI_MESSAGES: Record<number, string> = {
  0: "Hi! I'm Henri AI. Let's find the perfect contractor for your project. What type of work do you need?",
  1: "Great choice! What's your project address or ZIP code?",
  2: "Got it. When do you need this done?",
  3: "And what's your approximate budget?",
  4: "Tell me a bit more about your project. What work needs to be done?",
  5: "Almost done! Just need your contact info so the contractor can reach you.",
  6: "Analyzing your project...",
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

export function ProgressDots({ step }: { step: number }) {
  return (
    <div
      className="flex items-center gap-1.5"
      role="progressbar"
      aria-valuenow={step + 1}
      aria-valuemin={1}
      aria-valuemax={TOTAL_STEPS}
      aria-label={`Step ${step + 1} of ${TOTAL_STEPS}`}
    >
      {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className={cn(
            "h-2 w-2 rounded-full transition-colors duration-200",
            i < step
              ? "bg-primary"
              : i === step
              ? "bg-primary/60"
              : "bg-border"
          )}
        />
      ))}
    </div>
  );
}

export function HenriBubble({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-white">
        H
      </div>
      <div className="max-w-[80%] rounded-2xl rounded-tl-sm bg-primary-10 px-4 py-3 text-sm text-foreground">
        {text}
      </div>
    </div>
  );
}

export function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex items-start justify-end gap-3">
      <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-secondary px-4 py-3 text-sm text-foreground">
        {text}
      </div>
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
        You
      </div>
    </div>
  );
}

export function OptionCard({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-xl border px-4 py-3 text-sm font-medium transition-all duration-150",
        selected
          ? "border-primary bg-primary-10 text-primary"
          : "border-border bg-card text-foreground hover:border-primary/40 hover:bg-primary-04"
      )}
    >
      {label}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Score display                                                      */
/* ------------------------------------------------------------------ */

export function ScoreResult({ score }: { score: number }) {
  const grade =
    score >= 85 ? "Excellent" : score >= 70 ? "Great" : "Good";
  const gradeColor =
    score >= 85
      ? "text-[#3D9970]"
      : score >= 70
      ? "text-primary"
      : "text-[#C09A4A]";

  return (
    <div className="flex flex-col items-center gap-4 py-4">
      {/* Score ring */}
      <div className="relative flex h-28 w-28 items-center justify-center">
        <svg className="absolute inset-0" viewBox="0 0 112 112">
          <circle
            cx="56"
            cy="56"
            r="48"
            fill="none"
            stroke="hsl(var(--border))"
            strokeWidth="8"
          />
          <circle
            cx="56"
            cy="56"
            r="48"
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${(score / 100) * 301.6} 301.6`}
            transform="rotate(-90 56 56)"
            className="transition-all duration-1000 ease-out"
          />
        </svg>
        <span className="text-3xl font-bold text-foreground">{score}</span>
      </div>
      <p className={cn("text-lg font-semibold", gradeColor)}>
        {grade} Match
      </p>
      <p className="text-center text-sm text-muted-foreground">
        Based on your project details, we found an outstanding contractor match
        in your area.
      </p>
    </div>
  );
}

/** Shape returned by /api/intake in `contractors[]` — see the server route
 * for the canonical list. All non-name fields are optional because the
 * engine sometimes only knows the company name (e.g. newly onboarded
 * contractors with no jobs). Render honest — hide a field if null rather
 * than filling it with a made-up number. */
export interface MatchContractor {
  name: string;
  trade?: string;
  rating?: number | null;
  review_count?: number | null;
  response_time?: string | null;
  verified?: boolean | null;
  jobs_completed?: number | null;
  years_experience?: number | null;
}

export function MatchCard({
  contractor,
}: {
  contractor?: MatchContractor | null;
}) {
  const name = contractor?.name ?? "Your Matched Contractor";
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const responseTime = contractor?.response_time ?? "within 24 hours";
  const rating =
    typeof contractor?.rating === "number" ? contractor.rating : null;
  const reviews =
    typeof contractor?.review_count === "number"
      ? contractor.review_count
      : null;

  const badges: string[] = [];
  if (
    typeof contractor?.years_experience === "number" &&
    contractor.years_experience > 0
  ) {
    badges.push(`${contractor.years_experience} yrs experience`);
  }
  if (contractor?.verified) badges.push("Licensed & Insured");
  if (
    typeof contractor?.jobs_completed === "number" &&
    contractor.jobs_completed > 0
  ) {
    badges.push(`${contractor.jobs_completed} jobs completed`);
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-lg font-bold text-white">
          {initials}
        </div>
        <div className="flex-1">
          <p className="font-semibold text-foreground">{name}</p>
          {contractor?.verified && (
            <p className="text-xs text-muted-foreground">
              Verified &middot; Licensed &amp; Insured
            </p>
          )}
        </div>
        {rating != null && (
          <div className="flex flex-col items-end">
            <div className="flex items-center gap-1">
              <StarIcon />
              <span className="text-sm font-semibold text-foreground">
                {rating.toFixed(1)}
              </span>
            </div>
            {reviews != null && reviews > 0 && (
              <span className="text-xs text-muted-foreground">
                {reviews} {reviews === 1 ? "review" : "reviews"}
              </span>
            )}
          </div>
        )}
      </div>
      {badges.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {badges.map((b) => (
            <span
              key={b}
              className="rounded-full bg-primary-10 px-2.5 py-0.5 text-xs font-medium text-primary"
            >
              {b}
            </span>
          ))}
        </div>
      )}
      <p className="mt-3 text-sm text-muted-foreground">
        They will contact you {responseTime} to discuss your project.
      </p>
    </div>
  );
}

export function StarIcon() {
  return (
    <svg
      className="h-4 w-4 text-[#D4A24A]"
      viewBox="0 0 20 20"
      fill="currentColor"
    >
      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
    </svg>
  );
}
