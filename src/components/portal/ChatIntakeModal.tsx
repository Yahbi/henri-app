"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { FocusTrap } from "@/components/ui/focus-trap";
import {
  TOTAL_STEPS,
  HENRI_MESSAGES,
  ProgressDots,
  HenriBubble,
  UserBubble,
  type MatchContractor,
} from "./ChatIntakeModal.parts";
import { IntakeStepArea } from "./ChatIntakeModal.steps";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ChatIntakeModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialZip?: string;
  initialTrade?: string;
}

interface Message {
  /** Monotonic id assigned at creation time — used as the React key for
   *  the chat bubble list. The log is truncated on back-nav (handleBack)
   *  and re-seeded on open, so index-derived keys would re-bind bubble
   *  state across unrelated messages. */
  id: number;
  from: "henri" | "user";
  text: string;
}

/* Module-scoped counter: ids only need to be unique within a rendered
 * list, and a module counter survives re-renders without a ref dance.
 * Monotonic across modal opens — never reused, never reset. */
let nextMessageId = 0;
function makeMessage(from: Message["from"], text: string): Message {
  return { id: nextMessageId++, from, text };
}

/**
 * Pull a 5-digit US ZIP out of whatever the homeowner typed at Step 1.
 *
 * Step 1 explicitly offers "Or type the full street address — both work",
 * and the hero field on /portal has no validation at all, so the value
 * reaching submit can be a street address, a city name, or a partial ZIP.
 * `POST /api/intake` requires `/^\d{5}$/` and 400s on anything else.
 * Returns null when no ZIP is present so callers can ask for one instead
 * of shipping an unsubmittable payload.
 */
export function extractZip(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.trim().match(/\b\d{5}\b/);
  return m ? m[0] : null;
}

/* Audit-04-29 priority D step 2 — refactor map:
 *   - Constants + presentational primitives → ./ChatIntakeModal.parts
 *     (TRADES, TIMELINES, BUDGETS, ProgressDots, HenriBubble,
 *      UserBubble, OptionCard, ScoreResult, MatchCard, StarIcon)
 *   - 7-step input UI dispatcher           → ./ChatIntakeModal.steps
 *     (Step0Trade … Step6Result, RefinementInput)
 *
 * What's left in this file: the modal shell (FocusTrap + scrim + header
 * with ProgressDots), the chat bubble log, and the state machine
 * (step counter, refinement loop, /api/intake submission). */

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export function ChatIntakeModal({
  isOpen,
  onClose,
  initialZip = "",
  initialTrade = "",
}: ChatIntakeModalProps) {
  /* ---- state ---- */
  const [step, setStep] = useState(0);
  const [messages, setMessages] = useState<Message[]>(() => [
    makeMessage("henri", HENRI_MESSAGES[0]),
  ]);

  // Answers
  const [selectedTrade, setSelectedTrade] = useState(initialTrade);
  const [address, setAddress] = useState(initialZip);
  // Inline Step-1 validation message. Without it a non-ZIP entry sailed
  // through to a terminal 400 seven steps later.
  const [addressError, setAddressError] = useState<string | null>(null);
  const [timeline, setTimeline] = useState("");
  const [budget, setBudget] = useState("");
  const [description, setDescription] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  // Module 5 (2026-05-09) — TCPA-style consent. Submit is gated on this.
  // Persisted as `homeowner_intakes.consent_given_at` + `consent_text_version`.
  const [consentGiven, setConsentGiven] = useState(false);
  const [contactErrors, setContactErrors] = useState<Record<string, string>>({});
  // `null` means "intake wasn't scored by the server" — render no score
  // in the UI rather than faking one (prior random-80s fallback removed).
  const [score, setScore] = useState<number | null>(0);
  const [isComputing, setIsComputing] = useState(false);
  // True when the /api/intake POST failed — gates the Retry button so the
  // user can re-submit the already-collected payload without redoing the
  // whole flow (all answers are still in state).
  const [submitFailed, setSubmitFailed] = useState(false);
  // Distinguishes "the server rejected a field" (a Retry can never fix
  // it — the user must go back) from "the request didn't land" (Retry is
  // the right control). Before this, both rendered the same dead-end
  // Retry button plus a message blaming the homeowner's connection.
  const [submitFieldError, setSubmitFieldError] = useState<"zip" | "other" | null>(null);
  const [matchedContractor, setMatchedContractor] = useState<MatchContractor | null>(null);
  // Captured from the /api/intake POST response so the "Done" button can
  // redirect the homeowner to their persistent project page rather than
  // closing the modal into the void.
  const [intakeId, setIntakeId] = useState<string | null>(null);

  // Refinement state (between description step 4 and contact step 5)
  const [isRefinement, setIsRefinement] = useState(false);
  const [refinementIndex, setRefinementIndex] = useState(0);
  const [refinementAnswers, setRefinementAnswers] = useState<string[]>([]);
  const [refinementInput, setRefinementInput] = useState("");
  const [refinementLoading, setRefinementLoading] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);

  /* ---- auto-scroll ---- */
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, step]);

  /* ---- reset on open ----
   *
   * Skip-ahead policy (audit-04-30 fix #1):
   * - Both initialTrade + valid 5-digit initialZip → start at Step2 (Timeline).
   *   The user already gave us trade + ZIP on the /portal hero; asking again
   *   was a UX bug.
   * - initialTrade only → start at Step1 (Address). They picked a trade card
   *   without typing a ZIP first.
   * - initialZip only → start at Step0 (Trade). They typed a ZIP and hit
   *   "Find my contractor" without picking a card. We still ask for trade
   *   first; the ZIP is pre-filled when they reach Step1, and Step1 will
   *   auto-confirm + advance.
   * - neither → start at Step0.
   *
   * Messages are hydrated to match the starting step so the chat looks like
   * a normal conversation that began at that point. */
  useEffect(() => {
    if (isOpen) {
      const zipIsValid = /^\d{5}$/u.test(initialZip.trim());
      const hasTrade = !!initialTrade;
      let startStep = 0;
      const seedMessages: Message[] = [
        makeMessage("henri", HENRI_MESSAGES[0]),
      ];
      if (hasTrade && zipIsValid) {
        // Both pre-filled — jump to Step2.
        seedMessages.push(makeMessage("user", initialTrade));
        seedMessages.push(makeMessage("henri", HENRI_MESSAGES[1]));
        seedMessages.push(makeMessage("user", initialZip.trim()));
        seedMessages.push(makeMessage("henri", HENRI_MESSAGES[2]));
        startStep = 2;
      } else if (hasTrade) {
        // Trade only — jump to Step1.
        seedMessages.push(makeMessage("user", initialTrade));
        seedMessages.push(makeMessage("henri", HENRI_MESSAGES[1]));
        startStep = 1;
      }
      setStep(startStep);
      setMessages(seedMessages);
      setSelectedTrade(initialTrade);
      setAddress(initialZip);
      setAddressError(null);
      setTimeline("");
      setBudget("");
      setDescription("");
      setContactName("");
      setContactPhone("");
      setContactEmail("");
      setConsentGiven(false);
      setContactErrors({});
      setScore(0);
      setIsComputing(false);
      setSubmitFailed(false);
      setSubmitFieldError(null);
      setIsRefinement(false);
      setRefinementIndex(0);
      setRefinementAnswers([]);
      setRefinementInput("");
      setRefinementLoading(false);
    }
  }, [isOpen, initialTrade, initialZip]);

  /* ---- advance helper ---- */
  const advance = useCallback((userText: string, nextStep: number) => {
    setMessages((prev) => [
      ...prev,
      makeMessage("user", userText),
      makeMessage("henri", HENRI_MESSAGES[nextStep]),
    ]);
    setStep(nextStep);
  }, []);

  /* ---- back nav helper (audit-04-30 fix #1) ----
   *
   * Lets the user revise an earlier answer without losing the in-progress
   * state (their answers stay in useState; only `step` rewinds). The
   * Henri/User bubbles for steps after `targetStep` are dropped from the
   * message log so the conversation visually rewinds. The next forward
   * advance() will re-add bubbles as needed.
   *
   * Refinement-loop state (the AI follow-up Q&A between Step4 + Step5)
   * is intentionally NOT preserved when going back from ≥5 to ≤4 — those
   * answers depend on the description and become stale if the description
   * changes. Reset them so the loop re-runs cleanly. */
  const handleBack = useCallback(() => {
    setStep((current) => {
      if (current <= 0) return 0;
      const target = current - 1;
      // Rewind the visible chat: keep up to (and including) the henri-prompt
      // for `target`. Each step adds 2 messages: user-answer + henri-prompt
      // for next step. Truncate accordingly.
      setMessages((prev) => {
        // Find indices of henri prompts
        const promptIndices = prev
          .map((m, i) => (m.from === "henri" ? i : -1))
          .filter((i) => i >= 0);
        // Keep prompts 0..target inclusive
        const keepThrough = promptIndices[target] ?? prev.length - 1;
        return prev.slice(0, keepThrough + 1);
      });
      // If rewinding past Step5, reset the refinement loop state
      if (current >= 5 && target < 5) {
        setIsRefinement(false);
        setRefinementIndex(0);
        setRefinementAnswers([]);
        setRefinementInput("");
        setRefinementLoading(false);
      }
      return target;
    });
  }, []);

  /* ---- step handlers ---- */
  const handleTradeSelect = useCallback(
    (trade: string) => {
      setSelectedTrade(trade);
      /* Skip-ahead policy (audit-04-30 fix #1):
       * When the homeowner already typed a ZIP on the /portal hero,
       * `address` state is pre-filled. Asking for it again at Step1
       * was the double-zip UX bug. Instead, seed the address bubble
       * + Step2 prompt and jump straight to the Timeline question. */
      const zipIsValid = /^\d{5}$/u.test(address.trim());
      if (zipIsValid) {
        setMessages((prev) => [
          ...prev,
          makeMessage("user", trade),
          makeMessage("henri", HENRI_MESSAGES[1]),
          makeMessage("user", address.trim()),
          makeMessage("henri", HENRI_MESSAGES[2]),
        ]);
        setStep(2);
        return;
      }
      advance(trade, 1);
    },
    [advance, address],
  );

  const handleAddressSubmit = useCallback(() => {
    const typed = address.trim();
    if (!typed) return;
    // Step 1 invites "ZIP code or address", but POST /api/intake requires
    // /^\d{5}$/ and the raw string was sent through unvalidated. A
    // homeowner who typed a street address completed all seven steps,
    // handed over name/phone/email/consent, then hit a 400 rendered as
    // "check your connection" with a Retry button that could never
    // succeed and no Back link at the terminal step. Validate here, where
    // the user can still fix it.
    if (!extractZip(typed)) {
      setAddressError(
        "I need a 5-digit ZIP to find contractors near you — include it in the address, or just enter the ZIP.",
      );
      return;
    }
    setAddressError(null);
    advance(typed, 2);
  }, [address, advance]);

  const handleTimelineSelect = useCallback(
    (t: string) => {
      setTimeline(t);
      advance(t, 3);
    },
    [advance],
  );

  const handleBudgetSelect = useCallback(
    (b: string) => {
      setBudget(b);
      advance(b, 4);
    },
    [advance],
  );

  const handleDescriptionSubmit = useCallback(async () => {
    if (!description.trim()) return;
    setMessages((prev) => [...prev, makeMessage("user", description.trim())]);

    setIsRefinement(true);
    setRefinementLoading(true);
    try {
      const res = await fetch("/api/chat/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trade: selectedTrade || initialTrade,
          answers_so_far: [],
          question_index: 0,
        }),
      });
      const data = await res.json();
      if (data.done || !data.question) {
        setIsRefinement(false);
        setMessages((prev) => [...prev, makeMessage("henri", HENRI_MESSAGES[5])]);
        setStep(5);
      } else {
        setRefinementIndex(0);
        setMessages((prev) => [...prev, makeMessage("henri", data.question)]);
      }
    } catch {
      setIsRefinement(false);
      setMessages((prev) => [...prev, makeMessage("henri", HENRI_MESSAGES[5])]);
      setStep(5);
    } finally {
      setRefinementLoading(false);
    }
  }, [description, selectedTrade, initialTrade]);

  const handleRefinementAnswer = useCallback(async () => {
    const answer = refinementInput.trim();
    if (!answer || refinementLoading) return;
    setRefinementInput("");

    const nextAnswers = [...refinementAnswers, answer];
    setRefinementAnswers(nextAnswers);
    const nextIndex = refinementIndex + 1;
    setMessages((prev) => [...prev, makeMessage("user", answer)]);
    setRefinementLoading(true);

    try {
      const res = await fetch("/api/chat/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trade: selectedTrade || initialTrade,
          answers_so_far: nextAnswers,
          question_index: nextIndex,
        }),
      });
      const data = await res.json();
      if (data.done || !data.question) {
        setIsRefinement(false);
        setRefinementIndex(0);
        setMessages((prev) => [...prev, makeMessage("henri", HENRI_MESSAGES[5])]);
        setStep(5);
      } else {
        setRefinementIndex(nextIndex);
        setMessages((prev) => [...prev, makeMessage("henri", data.question)]);
      }
    } catch {
      setIsRefinement(false);
      setMessages((prev) => [...prev, makeMessage("henri", HENRI_MESSAGES[5])]);
      setStep(5);
    } finally {
      setRefinementLoading(false);
    }
  }, [refinementInput, refinementAnswers, refinementIndex, selectedTrade, initialTrade, refinementLoading]);

  const validateContact = useCallback(() => {
    const errors: Record<string, string> = {};
    if (!contactName.trim()) errors.name = "Name is required";
    if (!contactPhone.trim()) {
      errors.phone = "Phone is required";
    } else if (!/^\+?[\d\s\-().]{7,}$/.test(contactPhone.trim())) {
      errors.phone = "Enter a valid phone number";
    }
    if (!contactEmail.trim()) {
      errors.email = "Email is required";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim())) {
      errors.email = "Enter a valid email address";
    }
    setContactErrors(errors);
    return Object.keys(errors).length === 0;
  }, [contactName, contactPhone, contactEmail]);

  /* Submit intake to API → match contractor → notify.
   * Extracted from handleContactSubmit so the Retry button on the failure
   * path can re-POST the already-collected payload without making the
   * homeowner redo the whole flow. */
  const submitIntake = useCallback(async () => {
    setIsComputing(true);
    setSubmitFailed(false);
    setSubmitFieldError(null);
    // Live state wins over the frozen props. `initialZip`/`initialTrade`
    // are set once by openChat() and never change while the modal is
    // mounted, but Back navigation deliberately preserves answers, so a
    // homeowner can correct their ZIP or trade at Step 0/1 — and the old
    // `initialZip || address` precedence threw that correction away and
    // submitted the stale value. Lines 280 and 319 already used
    // `selectedTrade || initialTrade`; only the submit payload inverted
    // it. Also derive the ZIP so a street address (which Step 1 invites)
    // doesn't 400 against the server's /^\d{5}$/.
    const resolvedZip = extractZip(address) ?? extractZip(initialZip) ?? "";
    const resolvedTrade = (selectedTrade || initialTrade || "").trim();
    try {
      const res = await fetch("/api/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          zip: resolvedZip,
          trade: resolvedTrade,
          timeline: timeline || null,
          budget_range: budget || null,
          description: description || null,
          refinement_answers: refinementAnswers,
          contact_name: contactName,
          contact_phone: contactPhone,
          contact_email: contactEmail,
          henri_score: null, // Let server compute
          // Module 5 — when this is true the API stamps consent_given_at +
          // consent_text_version on the intake row. Without it, the
          // outreach hygiene gate refuses every send for this intake.
          consent_given: consentGiven,
          consent_text_version: "v1.2026-05-09",
        }),
      });
      if (res.status === 400) {
        // Validation rejection, not a network problem. The generic catch
        // below blamed the homeowner's connection and offered a Retry
        // that re-POSTed the identical invalid payload forever. Read the
        // Zod `issues` the API already returns, name the field, and let
        // the user go back and fix it.
        const body = (await res.json().catch(() => null)) as
          | { error?: string; issues?: Array<{ path?: (string | number)[]; message?: string }> }
          | null;
        const issues = body?.issues ?? [];
        const zipIssue = issues.find((i) => i.path?.[0] === "zip");
        const firstIssue = issues[0];
        setScore(null);
        setSubmitFailed(true);
        setSubmitFieldError(zipIssue ? "zip" : firstIssue ? "other" : "other");
        setMessages((prev) => [
          ...prev,
          makeMessage(
            "henri",
            zipIssue
              ? "I couldn't read a valid 5-digit ZIP code for this project. Go back to the location step and enter your ZIP, then submit again."
              : firstIssue?.message
                ? `I couldn't submit this: ${firstIssue.message}. Go back and fix that, then try again.`
                : (body?.error ?? "Some of the details didn't look right. Go back and check them, then try again."),
          ),
        ]);
        setIsComputing(false);
        return;
      }
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const result = await res.json();
      setSubmitFieldError(null);
      // Server computes the real score via the deterministic scoring
      // engine. If it's missing for any reason, omit the score from
      // the UI rather than faking one with Math.random — the prior
      // `85 + random(0-15)` fallback misled homeowners into thinking
      // they had a real scored match when we silently failed.
      const computed: number | null =
        typeof result.henri_score === "number" ? result.henri_score : null;
      setScore(computed);
      if (result.intake_id) setIntakeId(result.intake_id);
      // The API returns `contractors[]` (array); the first entry is the
      // primary match.
      const primary = Array.isArray(result.contractors)
        ? result.contractors[0]
        : result.contractor;
      if (primary) setMatchedContractor(primary);
      setMessages((prev) => [
        ...prev,
        makeMessage(
          "henri",
          computed != null
            ? (result.matched
                ? `Your project scored ${computed}/100. We found a great contractor for you.`
                : `Your project scored ${computed}/100. We're matching the best contractor in your area — you'll hear back shortly.`)
            : "Your project is in. We're matching you with a local contractor now — you'll hear back shortly.",
        ),
      ]);
    } catch {
      // Submission failed entirely. Don't fake a score; tell the user
      // and surface a Retry button (the answers are all still in state,
      // so retrying re-POSTs without redoing the steps).
      setScore(null);
      setSubmitFailed(true);
      setMessages((prev) => [
        ...prev,
        makeMessage(
          "henri",
          "Something went wrong submitting your project. Please check your connection and retry — we don't want to lose your details.",
        ),
      ]);
    } finally {
      setIsComputing(false);
    }
  }, [initialZip, initialTrade, address, selectedTrade, timeline, budget, description, refinementAnswers, contactName, contactPhone, contactEmail, consentGiven]);

  /* Recover from a server-side validation rejection at the terminal
   * step. Step 6 renders no Back link (going back after a successful
   * submit would be confusing), so without this a 400 was terminal. All
   * answers stay in state — only `step` rewinds. */
  const handleFixStep = useCallback((target: number) => {
    setSubmitFailed(false);
    setSubmitFieldError(null);
    setScore(0);
    if (target === 1) setAddressError(null);
    setStep(target);
    setMessages((prev) => [
      ...prev,
      makeMessage("henri", HENRI_MESSAGES[target] ?? HENRI_MESSAGES[0]),
    ]);
  }, []);

  const handleContactSubmit = useCallback(() => {
    if (!validateContact()) return;
    setMessages((prev) => [
      ...prev,
      makeMessage("user", `${contactName} | ${contactPhone} | ${contactEmail}`),
      makeMessage("henri", HENRI_MESSAGES[6]),
    ]);
    setStep(6);
    void submitIntake();
  }, [validateContact, contactName, contactPhone, contactEmail, submitIntake]);

  /* ---- ESC to close ---- */
  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    // Lock body scroll while open
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen, onClose]);

  /* ---- render nothing if closed ---- */
  if (!isOpen) return null;

  // Avoid the unused-import warning for TOTAL_STEPS without sacrificing
  // the module-level reference, which keeps the dispatcher's prop count
  // single-sourced should we add a ninth step later.
  void TOTAL_STEPS;

  return (
    <FocusTrap active={isOpen}>
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Project intake chat"
    >
      {/* Scrim */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal panel */}
      <div className="relative z-10 flex h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl sm:h-[680px]">
        {/* ---- Header ---- */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-cta text-sm font-bold text-cta-foreground">
              H
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Henri AI</p>
              <p className="text-xs text-muted-foreground">Project intake</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <ProgressDots step={step} />
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Close chat"
            >
              <svg
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* ---- Chat area ---- */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div
            className="flex flex-col gap-4"
            role="log"
            aria-live="polite"
            aria-atomic="false"
          >
            {messages.map((msg) =>
              msg.from === "henri" ? (
                <HenriBubble key={msg.id} text={msg.text} />
              ) : (
                <UserBubble key={msg.id} text={msg.text} />
              ),
            )}

            {/* ---- Step-specific inputs (extracted to ./ChatIntakeModal.steps) ---- */}
            <IntakeStepArea
              step={step}
              onBack={handleBack}
              selectedTrade={selectedTrade}
              onTradeSelect={handleTradeSelect}
              address={address}
              onAddressChange={(v) => { setAddress(v); setAddressError(null); }}
              onAddressSubmit={handleAddressSubmit}
              addressError={addressError}
              timeline={timeline}
              onTimelineSelect={handleTimelineSelect}
              budget={budget}
              onBudgetSelect={handleBudgetSelect}
              description={description}
              onDescriptionChange={setDescription}
              onDescriptionSubmit={handleDescriptionSubmit}
              isRefinement={isRefinement}
              refinementInput={refinementInput}
              refinementLoading={refinementLoading}
              onRefinementInputChange={setRefinementInput}
              onRefinementAnswer={handleRefinementAnswer}
              contactName={contactName}
              contactPhone={contactPhone}
              contactEmail={contactEmail}
              contactErrors={contactErrors}
              onContactNameChange={setContactName}
              onContactPhoneChange={setContactPhone}
              onContactEmailChange={setContactEmail}
              consentGiven={consentGiven}
              onConsentChange={setConsentGiven}
              onContactSubmit={handleContactSubmit}
              isComputing={isComputing}
              score={score}
              matchedContractor={matchedContractor}
              intakeId={intakeId}
              submitFailed={submitFailed}
              submitFieldError={submitFieldError}
              onRetrySubmit={submitIntake}
              onFixStep={handleFixStep}
              onClose={onClose}
            />

            <div ref={chatEndRef} />
          </div>
        </div>
      </div>
    </div>
    </FocusTrap>
  );
}
