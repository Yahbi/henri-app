"use client";

import { cn } from "@/lib/utils/cn";
import {
  TRADES,
  TIMELINES,
  BUDGETS,
  OptionCard,
  ScoreResult,
  MatchCard,
  type MatchContractor,
} from "./ChatIntakeModal.parts";

/**
 * ChatIntakeModal.steps.tsx
 *
 * Audit-04-29 priority D step 2: extracts the step JSX state machine
 * (7 steps since the 2026-06-10 photo-step removal — photos were collected
 * as filenames only and silently discarded, so the step was cut)
 * out of `ChatIntakeModal.tsx` so the parent file becomes a thin owner of
 * state + handlers, and the per-step input UI lives in one place.
 *
 * Architecture:
 *   - Parent (`ChatIntakeModal`) owns ALL state (step, answers, refinement
 *     loop, contractor match) and the `/api/intake` submission logic.
 *   - This file exports `<IntakeStepArea>`, a switch that renders the
 *     correct step's input UI for the current `step` value.
 *   - Each step's JSX is a small subcomponent in this file — none of them
 *     own state. They take controlled-input values + setters + a primary
 *     submit handler from the parent.
 *
 * Why one file, not 7: the steps share the same prop dictionary (parent
 * state lives in one component), and React's bundler can't tree-shake
 * individual step components anyway. One file with named exports is
 * the same shipped JS, fewer imports for the parent. If a single step
 * grows past ~100 LOC, split it then.
 */

/* ── Step input shape ─────────────────────────────────────────────────── */

export interface IntakeStepAreaProps {
  step: number;
  /* Back-nav callback (audit-04-30 fix #1). Decrements step + rewinds the
   * visible chat log. Each step except Step0 + Step7 renders a "← Back"
   * link that calls this. */
  onBack: () => void;

  // Step 0 — Trade
  selectedTrade: string;
  onTradeSelect: (trade: string) => void;

  // Step 1 — Address / ZIP
  address: string;
  onAddressChange: (value: string) => void;
  onAddressSubmit: () => void;
  /* Set when the typed value contains no 5-digit ZIP. The API requires
   * /^\d{5}$/, so without this the flow ran to completion and 400'd at
   * the terminal step with no way back. */
  addressError: string | null;

  // Step 2 — Timeline
  timeline: string;
  onTimelineSelect: (value: string) => void;

  // Step 3 — Budget
  budget: string;
  onBudgetSelect: (value: string) => void;

  // Step 4 — Description
  description: string;
  onDescriptionChange: (value: string) => void;
  onDescriptionSubmit: () => void;

  // Refinement (intermediate, between 4 and 5)
  isRefinement: boolean;
  refinementInput: string;
  refinementLoading: boolean;
  onRefinementInputChange: (value: string) => void;
  onRefinementAnswer: () => void;

  // Step 5 — Contact
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  contactErrors: Record<string, string>;
  onContactNameChange: (value: string) => void;
  onContactPhoneChange: (value: string) => void;
  onContactEmailChange: (value: string) => void;
  onContactSubmit: () => void;
  // Module 5 (2026-05-09) — TCPA-style consent. Submit is gated on this.
  consentGiven: boolean;
  onConsentChange: (value: boolean) => void;

  // Step 6 — Result
  isComputing: boolean;
  score: number | null;
  matchedContractor: MatchContractor | null;
  intakeId: string | null;
  /* True when the /api/intake POST failed. Renders a Retry button that
   * re-POSTs the already-collected payload — the answers are all still in
   * the parent's state, so the homeowner never redoes the steps. */
  submitFailed: boolean;
  /* "zip" when the server rejected the ZIP, "other" for any other
   * validation rejection, null when the failure was a network/5xx (the
   * only case where a plain Retry can ever succeed). */
  submitFieldError: "zip" | "other" | null;
  onRetrySubmit: () => void;
  /* Jump back to a specific step so a validation rejection is fixable —
   * Step 6 renders no Back link by design. */
  onFixStep: (step: number) => void;
  onClose: () => void;
}

/* ── Dispatcher ───────────────────────────────────────────────────────── */

export function IntakeStepArea(props: IntakeStepAreaProps) {
  const { step } = props;

  return (
    <>
      {step === 0 && <Step0Trade {...props} />}
      {step === 1 && <Step1Address {...props} />}
      {step === 2 && <Step2Timeline {...props} />}
      {step === 3 && <Step3Budget {...props} />}
      {step === 4 && <Step4Description {...props} />}
      {props.isRefinement && <RefinementInput {...props} />}
      {step === 5 && <Step5Contact {...props} />}
      {step === 6 && <Step6Result {...props} />}
    </>
  );
}

/* ── BackLink ─────────────────────────────────────────────────────────────
 *
 * Tiny shared component for the "← Back" affordance. Rendered in every
 * step except Step0 (no previous step) and Step6 (terminal — submission
 * already fired, going back would be confusing). Refinement input also
 * skips it: the refinement loop is server-driven and rewinding mid-loop
 * has no clean state. */
function BackLink({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="self-start text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
      aria-label="Go back to previous step"
    >
      ← Back
    </button>
  );
}

/* ── Step 0: Trade selection ─────────────────────────────────────────── */

function Step0Trade({
  selectedTrade,
  onTradeSelect,
}: IntakeStepAreaProps) {
  return (
    <div className="grid grid-cols-2 gap-2 pt-2 sm:grid-cols-3">
      {TRADES.map((trade) => (
        <OptionCard
          key={trade}
          label={trade}
          selected={selectedTrade === trade}
          onClick={() => onTradeSelect(trade)}
        />
      ))}
    </div>
  );
}

/* ── Step 1: Address / ZIP ───────────────────────────────────────────── */

function Step1Address({
  address,
  onAddressChange,
  onAddressSubmit,
  addressError,
  onBack,
}: IntakeStepAreaProps) {
  /* Live input-intent hint — updates as the user types so the disabled-
   * Next state is never mysterious. Three states:
   *   - empty    → no hint (placeholder carries the ask)
   *   - digits <5 → "Keep typing — N digits for a ZIP"
   *   - digits =5 → "ZIP code recognised"
   *   - non-digit → "Or type the full street address" */
  const trimmed = address.trim();
  const digitsOnly = /^\d+$/.test(trimmed);
  const isZip = digitsOnly && trimmed.length === 5;
  // A street address is only accepted when it CONTAINS a ZIP — the API
  // requires one. Say so up front rather than at the terminal step.
  const hasEmbeddedZip = !digitsOnly && /\b\d{5}\b/.test(trimmed);
  const hint = !trimmed
    ? null
    : isZip
      ? "ZIP code recognised"
      : hasEmbeddedZip
        ? "Address with ZIP recognised"
        : digitsOnly
          ? `Keep typing — ${5 - trimmed.length} more digit${5 - trimmed.length === 1 ? "" : "s"} for a ZIP`
          : "A full street address works too — just include the ZIP";
  const tone = isZip ? "text-[color:var(--success,_#3D9970)]" : "text-muted-foreground";

  return (
    <div className="flex flex-col gap-2 pt-2">
      <BackLink onBack={onBack} />
      <div className="flex gap-2">
        <input
          type="text"
          value={address}
          onChange={(e) => onAddressChange(e.target.value)}
          placeholder="Enter ZIP code or address..."
          aria-label="ZIP code or address"
          aria-invalid={!!addressError}
          aria-describedby={addressError ? "intake-address-error" : undefined}
          className="flex-1 rounded-lg border border-input bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          onKeyDown={(e) => {
            if (e.key === "Enter") onAddressSubmit();
          }}
          /* `inputMode="text"` not `numeric` — we accept either a ZIP or a
           * full street address, so a digits-only keyboard would block the
           * second path. */
          inputMode="text"
          autoComplete="postal-code"
          autoFocus
        />
        <button
          onClick={onAddressSubmit}
          disabled={!address.trim()}
          className="rounded-lg bg-cta px-4 py-2.5 text-sm font-semibold text-cta-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          Next
        </button>
      </div>
      {addressError ? (
        <p
          id="intake-address-error"
          role="alert"
          className="mt-1.5 text-[11px] text-destructive"
        >
          {addressError}
        </p>
      ) : (
        hint && (
          <p className={`mt-1.5 text-[11px] ${tone}`} aria-live="polite">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

/* ── Step 2: Timeline ────────────────────────────────────────────────── */

function Step2Timeline({
  timeline,
  onTimelineSelect,
  onBack,
}: IntakeStepAreaProps) {
  return (
    <div className="flex flex-col gap-2 pt-2">
      <BackLink onBack={onBack} />
      <div className="grid grid-cols-2 gap-2">
        {TIMELINES.map((t) => (
          <OptionCard
            key={t}
            label={t}
            selected={timeline === t}
            onClick={() => onTimelineSelect(t)}
          />
        ))}
      </div>
    </div>
  );
}

/* ── Step 3: Budget ──────────────────────────────────────────────────── */

function Step3Budget({
  budget,
  onBudgetSelect,
  onBack,
}: IntakeStepAreaProps) {
  return (
    <div className="flex flex-col gap-2 pt-2">
      <BackLink onBack={onBack} />
      <div className="flex flex-wrap gap-2">
        {BUDGETS.map((b) => (
          <OptionCard
            key={b}
            label={b}
            selected={budget === b}
            onClick={() => onBudgetSelect(b)}
          />
        ))}
      </div>
    </div>
  );
}

/* ── Step 4: Description ─────────────────────────────────────────────── */

function Step4Description({
  description,
  onDescriptionChange,
  onDescriptionSubmit,
  onBack,
}: IntakeStepAreaProps) {
  return (
    <div className="flex flex-col gap-2 pt-2">
      <BackLink onBack={onBack} />
      <textarea
        value={description}
        onChange={(e) => onDescriptionChange(e.target.value)}
        rows={4}
        placeholder="Describe your project... (e.g., need to replace a 20-year-old roof, approx 2000 sq ft)"
        aria-label="Project description"
        className="w-full rounded-lg border border-input bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        autoFocus
      />
      <button
        onClick={onDescriptionSubmit}
        disabled={!description.trim()}
        className="self-end rounded-lg bg-cta px-5 py-2.5 text-sm font-semibold text-cta-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
      >
        Continue
      </button>
    </div>
  );
}

/* ── Refinement input (between 4 and 5) ──────────────────────────────── */

function RefinementInput({
  refinementInput,
  refinementLoading,
  onRefinementInputChange,
  onRefinementAnswer,
}: IntakeStepAreaProps) {
  return (
    <div className="flex gap-2 pt-2">
      {refinementLoading ? (
        <div className="flex items-center gap-2 px-4 py-2.5 text-sm text-muted-foreground">
          <span className="inline-block h-2 w-2 rounded-full bg-primary animate-pulse" />
          Henri is thinking...
        </div>
      ) : (
        <>
          <input
            type="text"
            value={refinementInput}
            onChange={(e) => onRefinementInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onRefinementAnswer();
            }}
            placeholder="Your answer..."
            aria-label="Your answer"
            className="flex-1 rounded-lg border border-input bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            autoFocus
          />
          <button
            onClick={onRefinementAnswer}
            disabled={!refinementInput.trim()}
            className="rounded-lg bg-cta px-4 py-2.5 text-sm font-semibold text-cta-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            Next
          </button>
        </>
      )}
    </div>
  );
}

/* ── Step 5: Contact info ────────────────────────────────────────────── */

function Step5Contact({
  contactName,
  contactPhone,
  contactEmail,
  consentGiven,
  onConsentChange,
  contactErrors,
  onContactNameChange,
  onContactPhoneChange,
  onContactEmailChange,
  onContactSubmit,
  onBack,
}: IntakeStepAreaProps) {
  return (
    <div className="flex flex-col gap-3 pt-2">
      <BackLink onBack={onBack} />
      <div>
        <input
          type="text"
          value={contactName}
          onChange={(e) => onContactNameChange(e.target.value)}
          placeholder="Full name"
          aria-label="Full name"
          aria-invalid={!!contactErrors.name}
          aria-describedby={contactErrors.name ? "contact-name-error" : undefined}
          className={cn(
            "w-full rounded-lg border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring",
            contactErrors.name
              ? "border-destructive focus:ring-destructive"
              : "border-input",
          )}
          autoFocus
        />
        {contactErrors.name && (
          <p id="contact-name-error" className="mt-1 text-xs text-destructive">{contactErrors.name}</p>
        )}
      </div>
      <div>
        <input
          type="tel"
          value={contactPhone}
          onChange={(e) => onContactPhoneChange(e.target.value)}
          placeholder="Phone number"
          aria-label="Phone number"
          aria-invalid={!!contactErrors.phone}
          aria-describedby={contactErrors.phone ? "contact-phone-error" : undefined}
          className={cn(
            "w-full rounded-lg border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring",
            contactErrors.phone
              ? "border-destructive focus:ring-destructive"
              : "border-input",
          )}
        />
        {contactErrors.phone && (
          <p id="contact-phone-error" className="mt-1 text-xs text-destructive">{contactErrors.phone}</p>
        )}
      </div>
      <div>
        <input
          type="email"
          value={contactEmail}
          onChange={(e) => onContactEmailChange(e.target.value)}
          placeholder="Email address"
          aria-label="Email address"
          aria-invalid={!!contactErrors.email}
          aria-describedby={contactErrors.email ? "contact-email-error" : undefined}
          className={cn(
            "w-full rounded-lg border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring",
            contactErrors.email
              ? "border-destructive focus:ring-destructive"
              : "border-input",
          )}
          onKeyDown={(e) => {
            if (e.key === "Enter") onContactSubmit();
          }}
        />
        {contactErrors.email && (
          <p id="contact-email-error" className="mt-1 text-xs text-destructive">{contactErrors.email}</p>
        )}
      </div>
      {/* Module 5 (2026-05-09) — TCPA-style consent checkbox. The
          outreach hygiene gate (src/lib/outreach/hygiene.ts) refuses
          every send when consent_given_at is NULL on the intake row, so
          this checkbox is the only path to homeowner outreach. We make
          it explicit + opt-in (unchecked by default) so the homeowner
          consciously agrees. Copy is intentionally plain English, no
          legalese — this is the founder voice. */}
      <label className="flex items-start gap-2 rounded-lg border border-border bg-bg-subtle/50 px-3 py-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={consentGiven}
          onChange={(e) => onConsentChange(e.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 rounded border-border accent-primary"
        />
        <span className="text-[11px] text-foreground/85 leading-snug">
          I authorize Henri to share my contact info with one matched contractor in my territory.
          I can opt out anytime by withdrawing my project from my homeowner dashboard.
        </span>
      </label>
      <button
        onClick={onContactSubmit}
        disabled={!consentGiven}
        className="rounded-lg bg-cta px-5 py-2.5 text-sm font-semibold text-cta-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        title={consentGiven ? undefined : "Please check the consent box to continue"}
      >
        Find my contractor
      </button>
    </div>
  );
}

/* ── Step 6: Score + Match ───────────────────────────────────────────── */

function Step6Result({
  isComputing,
  score,
  matchedContractor,
  intakeId,
  submitFailed,
  submitFieldError,
  onRetrySubmit,
  onFixStep,
  onClose,
}: IntakeStepAreaProps) {
  if (isComputing) {
    return (
      <div className="pt-2">
        <div className="flex flex-col items-center gap-3 py-8">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-border border-t-primary" />
          <p className="text-sm text-muted-foreground">
            Scoring your project and finding the best match...
          </p>
        </div>
      </div>
    );
  }

  // Three render paths after submit:
  //   1. Score + match card + "Go to project" CTA (real match)
  //   2. Just the "Go to project" CTA (submit succeeded but no contractor
  //      matched yet — intake is still persisted so the homeowner can
  //      revisit the page later)
  //   3. Submit failed → Retry button. The error chat bubble explains;
  //      this button re-POSTs the in-memory payload so the homeowner
  //      never redoes the steps.
  if (submitFailed) {
    // A validation rejection can never be fixed by re-POSTing the same
    // payload, and Step 6 renders no Back link — so the only control here
    // used to be a Retry that was guaranteed to fail forever. Offer the
    // step that actually needs correcting.
    if (submitFieldError) {
      return (
        <div className="flex flex-col gap-2 pt-2">
          <button
            onClick={() => onFixStep(submitFieldError === "zip" ? 1 : 0)}
            className="w-full rounded-lg bg-cta px-5 py-3 text-sm font-semibold text-cta-foreground transition-colors hover:bg-primary/90"
          >
            {submitFieldError === "zip"
              ? "Go back and fix my ZIP code"
              : "Go back and review my answers"}
          </button>
          <button
            onClick={onClose}
            className="w-full rounded-lg border border-border px-5 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Close
          </button>
        </div>
      );
    }
    return (
      <div className="pt-2">
        <button
          onClick={onRetrySubmit}
          className="w-full rounded-lg bg-cta px-5 py-3 text-sm font-semibold text-cta-foreground transition-colors hover:bg-primary/90"
        >
          Retry submission
        </button>
      </div>
    );
  }

  if (score == null && !intakeId) return null;

  return (
    <div className="pt-2">
      <div className="flex flex-col gap-4">
        {score != null && score > 0 && (
          <>
            <ScoreResult score={score} />
            <MatchCard contractor={matchedContractor} />
          </>
        )}
        {/* The /portal funnel is anonymous by design (POST /api/intake has
            no auth), but /homeowner/* is session-gated by middleware — so
            this button used to hard-navigate every submitter into a login
            wall for an account they were never asked to create. Explain
            the step instead of redirecting blindly. */}
        {intakeId && (
          <p className="rounded-lg border border-border bg-bg-subtle px-3 py-2.5 text-[11px] leading-snug text-muted-foreground">
            Your project is saved and we&apos;ve emailed you a confirmation.
            To track it, sign in with the same email address you gave us —
            we&apos;ll send a magic link, no password needed.
          </p>
        )}
        <button
          onClick={() => {
            if (intakeId) {
              // Carry the destination so /login returns the homeowner to
              // their project after the magic link lands, instead of
              // dropping them on a generic page.
              window.location.href = `/login?redirect=${encodeURIComponent(
                `/homeowner/intakes/${intakeId}`,
              )}&role=homeowner`;
            } else {
              onClose();
            }
          }}
          className="mt-2 w-full rounded-lg bg-cta px-5 py-3 text-sm font-semibold text-cta-foreground transition-colors hover:bg-primary/90"
        >
          {intakeId ? "Sign in to track your project →" : "Done"}
        </button>
        {intakeId && (
          <button
            onClick={onClose}
            className="w-full rounded-lg border border-border px-5 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Maybe later
          </button>
        )}
      </div>
    </div>
  );
}
