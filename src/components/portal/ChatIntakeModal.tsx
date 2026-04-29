"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { cn } from "@/lib/utils/cn";
import { FocusTrap } from "@/components/ui/focus-trap";

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
  from: "henri" | "user";
  text: string;
}

/* ------------------------------------------------------------------ */
/*  Data                                                               */
/* ------------------------------------------------------------------ */

const TRADES = [
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

const TIMELINES = [
  "ASAP",
  "Within 2 weeks",
  "Within a month",
  "Flexible",
] as const;

const BUDGETS = [
  "Under $5K",
  "$5K - $15K",
  "$15K - $50K",
  "$50K - $100K",
  "$100K+",
] as const;

const TOTAL_STEPS = 8;

const HENRI_MESSAGES: Record<number, string> = {
  0: "Hi! I'm Henri AI. Let's find the perfect contractor for your project. What type of work do you need?",
  1: "Great choice! What's your project address or ZIP code?",
  2: "Got it. When do you need this done?",
  3: "And what's your approximate budget?",
  4: "Tell me a bit more about your project. What work needs to be done?",
  5: "Do you have any photos of the project area? This helps contractors give better estimates. You can skip this step.",
  6: "Almost done! Just need your contact info so the contractor can reach you.",
  7: "Analyzing your project...",
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function ProgressDots({ step }: { step: number }) {
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

function HenriBubble({ text }: { text: string }) {
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

function UserBubble({ text }: { text: string }) {
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

function OptionCard({
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

function ScoreResult({ score }: { score: number }) {
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
interface MatchContractor {
  name: string;
  trade?: string;
  rating?: number | null;
  review_count?: number | null;
  response_time?: string | null;
  verified?: boolean | null;
  jobs_completed?: number | null;
  years_experience?: number | null;
}

function MatchCard({ contractor }: { contractor?: MatchContractor | null }) {
  const name = contractor?.name ?? "Your Matched Contractor";
  const initials = name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const responseTime = contractor?.response_time ?? "within 24 hours";
  const rating = typeof contractor?.rating === "number" ? contractor.rating : null;
  const reviews = typeof contractor?.review_count === "number" ? contractor.review_count : null;

  const badges: string[] = [];
  if (typeof contractor?.years_experience === "number" && contractor.years_experience > 0) {
    badges.push(`${contractor.years_experience} yrs experience`);
  }
  if (contractor?.verified) badges.push("Licensed & Insured");
  if (typeof contractor?.jobs_completed === "number" && contractor.jobs_completed > 0) {
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

function StarIcon() {
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
  const [messages, setMessages] = useState<Message[]>([
    { from: "henri", text: HENRI_MESSAGES[0] },
  ]);

  // Answers
  const [selectedTrade, setSelectedTrade] = useState(initialTrade);
  const [address, setAddress] = useState(initialZip);
  const [timeline, setTimeline] = useState("");
  const [budget, setBudget] = useState("");
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactErrors, setContactErrors] = useState<Record<string, string>>(
    {}
  );
  // `null` means "intake wasn't scored by the server" — render no score
  // in the UI rather than faking one (prior random-80s fallback removed).
  const [score, setScore] = useState<number | null>(0);
  const [isComputing, setIsComputing] = useState(false);
  const [matchedContractor, setMatchedContractor] = useState<MatchContractor | null>(null);
  // Captured from the /api/intake POST response so the "Done" button can
  // redirect the homeowner to their persistent project page rather than
  // closing the modal into the void. See plan Phase 1.1.
  const [intakeId, setIntakeId] = useState<string | null>(null);

  // Refinement state (between description step 4 and photos step 5)
  const [isRefinement, setIsRefinement] = useState(false);
  const [refinementIndex, setRefinementIndex] = useState(0);
  const [refinementAnswers, setRefinementAnswers] = useState<string[]>([]);
  const [refinementInput, setRefinementInput] = useState("");
  const [refinementLoading, setRefinementLoading] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ---- auto-scroll ---- */
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, step]);

  /* ---- reset on open ---- */
  useEffect(() => {
    if (isOpen) {
      setStep(0);
      setMessages([{ from: "henri", text: HENRI_MESSAGES[0] }]);
      setSelectedTrade(initialTrade);
      setAddress(initialZip);
      setTimeline("");
      setBudget("");
      setDescription("");
      setPhotos([]);
      setContactName("");
      setContactPhone("");
      setContactEmail("");
      setContactErrors({});
      setScore(0);
      setIsComputing(false);
      setIsRefinement(false);
      setRefinementIndex(0);
      setRefinementAnswers([]);
      setRefinementInput("");
      setRefinementLoading(false);
    }
  }, [isOpen, initialTrade, initialZip]);

  /* ---- advance helper ---- */
  const advance = useCallback(
    (userText: string, nextStep: number) => {
      setMessages((prev) => [
        ...prev,
        { from: "user", text: userText },
        { from: "henri", text: HENRI_MESSAGES[nextStep] },
      ]);
      setStep(nextStep);
    },
    []
  );

  /* ---- step handlers ---- */
  const handleTradeSelect = useCallback(
    (trade: string) => {
      setSelectedTrade(trade);
      advance(trade, 1);
    },
    [advance]
  );

  const handleAddressSubmit = useCallback(() => {
    if (!address.trim()) return;
    advance(address.trim(), 2);
  }, [address, advance]);

  const handleTimelineSelect = useCallback(
    (t: string) => {
      setTimeline(t);
      advance(t, 3);
    },
    [advance]
  );

  const handleBudgetSelect = useCallback(
    (b: string) => {
      setBudget(b);
      advance(b, 4);
    },
    [advance]
  );

  const handleDescriptionSubmit = useCallback(async () => {
    if (!description.trim()) return;
    // Add user message for description
    setMessages((prev) => [...prev, { from: "user", text: description.trim() }]);

    // Start refinement phase
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
        // Skip refinement, go to photos
        setIsRefinement(false);
        setMessages((prev) => [...prev, { from: "henri", text: HENRI_MESSAGES[5] }]);
        setStep(5);
      } else {
        setRefinementIndex(0);
        setMessages((prev) => [...prev, { from: "henri", text: data.question }]);
      }
    } catch {
      // On error, skip refinement
      setIsRefinement(false);
      setMessages((prev) => [...prev, { from: "henri", text: HENRI_MESSAGES[5] }]);
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
    setMessages((prev) => [...prev, { from: "user", text: answer }]);
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
        // Done with refinement — proceed to photos
        setIsRefinement(false);
        setRefinementIndex(0);
        setMessages((prev) => [...prev, { from: "henri", text: HENRI_MESSAGES[5] }]);
        setStep(5);
      } else {
        setRefinementIndex(nextIndex);
        setMessages((prev) => [...prev, { from: "henri", text: data.question }]);
      }
    } catch {
      setIsRefinement(false);
      setMessages((prev) => [...prev, { from: "henri", text: HENRI_MESSAGES[5] }]);
      setStep(5);
    } finally {
      setRefinementLoading(false);
    }
  }, [refinementInput, refinementAnswers, refinementIndex, selectedTrade, initialTrade, refinementLoading]);

  const handlePhotoSkip = useCallback(() => {
    advance("Skipped photos", 6);
  }, [advance]);

  const handlePhotoUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      const names = Array.from(files).map((f) => f.name);
      setPhotos(names);
      advance(`Uploaded ${names.length} photo(s)`, 6);
    },
    [advance]
  );

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

  const handleContactSubmit = useCallback(() => {
    if (!validateContact()) return;
    setMessages((prev) => [
      ...prev,
      { from: "user", text: `${contactName} | ${contactPhone} | ${contactEmail}` },
      { from: "henri", text: HENRI_MESSAGES[7] },
    ]);
    setStep(7);
    setIsComputing(true);

    /* Submit intake to API → match contractor → notify */
    (async () => {
      try {
        const res = await fetch("/api/intake", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            zip: initialZip || address || "",
            trade: initialTrade || selectedTrade || "",
            timeline: timeline || null,
            budget_range: budget || null,
            description: description || null,
            refinement_answers: refinementAnswers,
            photos: [],
            contact_name: contactName,
            contact_phone: contactPhone,
            contact_email: contactEmail,
            henri_score: null, // Let server compute
          }),
        });
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const result = await res.json();
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
        // primary match. Keep the MatchCard happy by passing the primary.
        const primary = Array.isArray(result.contractors)
          ? result.contractors[0]
          : result.contractor;
        if (primary) setMatchedContractor(primary);
        setMessages((prev) => [
          ...prev,
          {
            from: "henri",
            text: computed != null
              ? (result.matched
                  ? `Your project scored ${computed}/100. We found a great contractor for you.`
                  : `Your project scored ${computed}/100. We're matching the best contractor in your area — you'll hear back shortly.`)
              : "Your project is in. We're matching you with a local contractor now — you'll hear back shortly.",
          },
        ]);
      } catch {
        // Submission failed entirely. Don't fake a score; tell the user
        // the intake was received and we'll follow up (the record is
        // written server-side only on success, so they may need to retry).
        setScore(null);
        setMessages((prev) => [
          ...prev,
          {
            from: "henri",
            text: "Something went wrong submitting your project. Please check your connection and retry — we don't want to lose your details.",
          },
        ]);
      } finally {
        setIsComputing(false);
      }
    })();
  }, [validateContact, contactName, contactPhone, contactEmail, initialZip, initialTrade, address, selectedTrade, timeline, budget, description, refinementAnswers]);

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
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-white">
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
          <div className="flex flex-col gap-4" role="log" aria-live="polite" aria-atomic="false">
            {messages.map((msg, i) =>
              msg.from === "henri" ? (
                <HenriBubble key={i} text={msg.text} />
              ) : (
                <UserBubble key={i} text={msg.text} />
              )
            )}

            {/* ---- Step-specific inputs ---- */}

            {/* Step 0: Trade selection */}
            {step === 0 && (
              <div className="grid grid-cols-2 gap-2 pt-2 sm:grid-cols-3">
                {TRADES.map((trade) => (
                  <OptionCard
                    key={trade}
                    label={trade}
                    selected={selectedTrade === trade}
                    onClick={() => handleTradeSelect(trade)}
                  />
                ))}
              </div>
            )}

            {/* Step 1: Address / ZIP */}
            {step === 1 && (
              <div className="pt-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Enter ZIP code or address..."
                    className="flex-1 rounded-lg border border-input bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddressSubmit();
                    }}
                    /* `inputMode="text"` not `numeric` — we accept either
                     * a ZIP or a full street address, so a digits-only
                     * keyboard would block the second path. */
                    inputMode="text"
                    autoComplete="postal-code"
                    autoFocus
                  />
                  <button
                    onClick={handleAddressSubmit}
                    disabled={!address.trim()}
                    className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
                {/* Live input-intent hint — updates as the user types so
                 * the disabled-Next state is never mysterious. Design
                 * critique M6 flagged the Next button looking stuck
                 * when `input` events weren't firing correctly (dev-tools
                 * artefact, but the hint also helps real users who type
                 * a partial ZIP). Three states:
                 *   - empty    → no hint (placeholder carries the ask)
                 *   - digits <5 → "Keep typing — 5 digits for a ZIP"
                 *   - digits =5 → "ZIP code recognised"
                 *   - non-digit → "Or type the full street address" */}
                {(() => {
                  const trimmed = address.trim();
                  if (!trimmed) return null;
                  const digitsOnly = /^\d+$/.test(trimmed);
                  const isZip = digitsOnly && trimmed.length === 5;
                  const hint = isZip
                    ? "ZIP code recognised"
                    : digitsOnly
                      ? `Keep typing — ${5 - trimmed.length} more digit${5 - trimmed.length === 1 ? "" : "s"} for a ZIP`
                      : "Or type the full street address — both work";
                  const tone = isZip
                    ? "text-[color:var(--success,_#3D9970)]"
                    : "text-muted-foreground";
                  return (
                    <p className={`mt-1.5 text-[11px] ${tone}`} aria-live="polite">
                      {hint}
                    </p>
                  );
                })()}
              </div>
            )}

            {/* Step 2: Timeline */}
            {step === 2 && (
              <div className="grid grid-cols-2 gap-2 pt-2">
                {TIMELINES.map((t) => (
                  <OptionCard
                    key={t}
                    label={t}
                    selected={timeline === t}
                    onClick={() => handleTimelineSelect(t)}
                  />
                ))}
              </div>
            )}

            {/* Step 3: Budget */}
            {step === 3 && (
              <div className="flex flex-wrap gap-2 pt-2">
                {BUDGETS.map((b) => (
                  <OptionCard
                    key={b}
                    label={b}
                    selected={budget === b}
                    onClick={() => handleBudgetSelect(b)}
                  />
                ))}
              </div>
            )}

            {/* Step 4: Description */}
            {step === 4 && (
              <div className="flex flex-col gap-2 pt-2">
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  placeholder="Describe your project... (e.g., need to replace a 20-year-old roof, approx 2000 sq ft)"
                  className="w-full rounded-lg border border-input bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  autoFocus
                />
                <button
                  onClick={handleDescriptionSubmit}
                  disabled={!description.trim()}
                  className="self-end rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  Continue
                </button>
              </div>
            )}

            {/* Refinement phase: between step 4 and step 5 */}
            {isRefinement && (
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
                      onChange={(e) => setRefinementInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleRefinementAnswer(); }}
                      placeholder="Your answer..."
                      className="flex-1 rounded-lg border border-input bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      autoFocus
                    />
                    <button
                      onClick={handleRefinementAnswer}
                      disabled={!refinementInput.trim()}
                      className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
                    >
                      Next
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Step 5: Photos */}
            {step === 5 && (
              <div className="flex flex-col gap-3 pt-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handleFileChange}
                />
                <button
                  onClick={handlePhotoUpload}
                  className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-card px-6 py-8 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary-04"
                >
                  <svg
                    className="h-6 w-6"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.41a2.25 2.25 0 013.182 0l2.909 2.91m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"
                    />
                  </svg>
                  Click to upload photos
                </button>
                {photos.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {photos.length} file(s) selected
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={handlePhotoSkip}
                    className="rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
                  >
                    Skip this step
                  </button>
                  {photos.length > 0 && (
                    <button
                      onClick={() => advance(`Uploaded ${photos.length} photo(s)`, 6)}
                      className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
                    >
                      Continue
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Step 6: Contact info */}
            {step === 6 && (
              <div className="flex flex-col gap-3 pt-2">
                <div>
                  <input
                    type="text"
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    placeholder="Full name"
                    className={cn(
                      "w-full rounded-lg border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring",
                      contactErrors.name
                        ? "border-destructive focus:ring-destructive"
                        : "border-input"
                    )}
                    autoFocus
                  />
                  {contactErrors.name && (
                    <p className="mt-1 text-xs text-destructive">
                      {contactErrors.name}
                    </p>
                  )}
                </div>
                <div>
                  <input
                    type="tel"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    placeholder="Phone number"
                    className={cn(
                      "w-full rounded-lg border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring",
                      contactErrors.phone
                        ? "border-destructive focus:ring-destructive"
                        : "border-input"
                    )}
                  />
                  {contactErrors.phone && (
                    <p className="mt-1 text-xs text-destructive">
                      {contactErrors.phone}
                    </p>
                  )}
                </div>
                <div>
                  <input
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    placeholder="Email address"
                    className={cn(
                      "w-full rounded-lg border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring",
                      contactErrors.email
                        ? "border-destructive focus:ring-destructive"
                        : "border-input"
                    )}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleContactSubmit();
                    }}
                  />
                  {contactErrors.email && (
                    <p className="mt-1 text-xs text-destructive">
                      {contactErrors.email}
                    </p>
                  )}
                </div>
                <button
                  onClick={handleContactSubmit}
                  className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
                >
                  Find my contractor
                </button>
              </div>
            )}

            {/* Step 7: Score + Match */}
            {step === 7 && (
              <div className="pt-2">
                {isComputing ? (
                  <div className="flex flex-col items-center gap-3 py-8">
                    <div className="h-10 w-10 animate-spin rounded-full border-4 border-border border-t-primary" />
                    <p className="text-sm text-muted-foreground">
                      Scoring your project and finding the best match...
                    </p>
                  </div>
                ) : (
                  // Two render paths after submit:
                  //   1. Score + match card + "Go to project" CTA (real match)
                  //   2. Just the "Go to project" CTA (submit succeeded but no
                  //      contractor matched yet — intake is still persisted so
                  //      the homeowner can revisit the page later)
                  // A third path (submit failed) leaves both null and the
                  // earlier error message in the chat handles it.
                  (score != null || intakeId) && (
                    <div className="flex flex-col gap-4">
                      {score != null && score > 0 && (
                        <>
                          <ScoreResult score={score} />
                          <MatchCard contractor={matchedContractor} />
                        </>
                      )}
                      <button
                        onClick={() => {
                          if (intakeId) {
                            window.location.href = `/homeowner/intakes/${intakeId}`;
                          } else {
                            onClose();
                          }
                        }}
                        className="mt-2 w-full rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
                      >
                        {intakeId ? "View your project →" : "Done"}
                      </button>
                    </div>
                  )
                )}
              </div>
            )}

            <div ref={chatEndRef} />
          </div>
        </div>
      </div>
    </div>
    </FocusTrap>
  );
}
