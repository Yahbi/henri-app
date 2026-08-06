"use client";

import { useState, useEffect, Suspense, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ShieldCheck, Check, CheckCircle2, AlertCircle, Loader2, Info } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { OnboardingProgress } from "@/components/onboarding/OnboardingProgress";
import { TRADE_TYPES, TRADE_LABELS, isTradeType, type TradeType } from "@/lib/territory/trades";

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
  "DC",
] as const;

/* `trade` is required, and it is required HERE rather than anywhere else in
 * onboarding, because migration 00135 made territory exclusivity per
 * (zip, trade) and `claim_territory` freezes `profiles.trade` onto the
 * territory row at claim time.
 *
 * Until 2026-08-06 no onboarding step wrote `profiles.trade` at all, so
 * every contractor kept the column default 'general' and every territory
 * froze as 'general'. That silently collapsed the per-trade model back to
 * one-contractor-per-ZIP: the second contractor to want a ZIP was refused
 * no matter what they do, which contradicts the live promise on
 * /contractors that "a roofer and an HVAC contractor can both hold the same
 * ZIP". It also handed every account the all-trades lead visibility that
 * src/lib/auth/trade-gating.ts only unlocks for Enterprise, because that
 * module treats a 'general' profile as a GC and lifts the gate.
 *
 * The free-text `license_type` below is NOT a substitute: it is the state
 * board's classification string ("C-39 Roofing", "General B"), it is
 * optional, and nothing maps it onto the enum. */
const licenseSchema = z.object({
  license_number: z.string().min(1, "License number is required"),
  state: z.string().min(1, "State is required"),
  trade: z.enum(TRADE_TYPES, {
    error: "Select the trade you'll claim territory for",
  }),
  license_type: z.string().optional(),
  name_on_license: z.string().optional(),
});

type LicenseFormData = z.infer<typeof licenseSchema>;

/** Wave 2.B Phase 2 — live cross-check against state_license_rosters. */
interface VerifyMatch {
  business_name: string | null;
  license_type: string | null;
  license_status: string | null;
  expire_date: string | null;
  city: string | null;
}

interface VerifyResult {
  status: "found" | "missing" | "skipped" | "error" | "idle" | "checking";
  message?: string;
  match?: VerifyMatch;
  available_states?: string[];
  /** Submit-time only — whether the server actually stored the verdict.
   *  A probe response omits both fields. */
  persisted?: boolean;
  verification_status?: string | null;
}

/** Existing contractor_licenses row (onboarding-resume support). */
interface ExistingLicense {
  id: string;
  license_number: string;
  license_state: string;
  verification_status: string;
  verified: boolean;
}

/** Mask a license number to its last 4 characters (e.g. "***4321"). */
function maskLicense(num: string): string {
  if (num.length <= 4) return num;
  return "*".repeat(num.length - 4) + num.slice(-4);
}

function LicenseVerificationContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { addToast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const reason = searchParams?.get("reason");
    if (reason === "onboarding_required" || reason === "step_license_required") {
      addToast({ title: "Please complete license verification to continue.", type: "info" });
    }
  }, [searchParams, addToast]);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verify, setVerify] = useState<VerifyResult>({ status: "idle" });
  /* Server-confirmed outcome of the submit-time roster check. The success
   * screen reads THIS and not the debounced probe: the probe is advisory,
   * only the server's persisted verdict is what a homeowner will ever
   * see. Stays false when the roster didn't match, when the state isn't
   * covered, or when the write didn't land. */
  const [savedVerified, setSavedVerified] = useState(false);
  const verifyTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Onboarding resume — if the contractor already submitted a license,
  // show a "License on file" card instead of the blank form.
  const [existingLicense, setExistingLicense] = useState<ExistingLicense | null>(null);
  const [showReplaceForm, setShowReplaceForm] = useState(false);
  /* Trade currently on the profile. Seeds the form select, and is what the
   * resume card lets the contractor confirm or change — otherwise a
   * contractor who submitted a license before the trade field existed would
   * skip straight past this step and claim territory as 'general'. */
  const [profileTrade, setProfileTrade] = useState<TradeType | null>(null);
  const [resumeTrade, setResumeTrade] = useState<TradeType | "">("");
  const [savingResume, setSavingResume] = useState(false);

  // Forward the pricing-page plan selection through to the plan step.
  const planParam = searchParams?.get("plan");
  const planHref = planParam
    ? `/onboarding/plan?plan=${encodeURIComponent(planParam)}`
    : "/onboarding/plan";

  // Fetch the caller's existing contractor_licenses row on mount (own
  // RLS). Cancellation-safe via the cancelled flag.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user || cancelled) return;
        const [{ data }, { data: profileRow }] = await Promise.all([
          supabase
            .from("contractor_licenses")
            .select("id, license_number, license_state, verification_status, verified")
            .eq("contractor_id", user.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase.from("profiles").select("trade").eq("id", user.id).maybeSingle(),
        ]);
        if (cancelled) return;
        if (data) {
          setExistingLicense(data as ExistingLicense);
        }
        const t = (profileRow as { trade?: unknown } | null)?.trade;
        if (isTradeType(t)) {
          setProfileTrade(t);
          setResumeTrade(t);
        }
      } catch {
        // Best-effort — fall back to the blank form.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<LicenseFormData>({
    resolver: zodResolver(licenseSchema),
  });

  /* Seed the trade select once the profile lands. The form renders before
   * the fetch resolves, so a `defaultValue` would be stale — setValue is
   * the only way to prefill an already-mounted uncontrolled field. */
  useEffect(() => {
    if (profileTrade) setValue("trade", profileTrade);
  }, [profileTrade, setValue]);

  /* Watch (state, license_number) and fire a verification probe
   * 700ms after the user stops typing. Stale-response guard via a
   * mounted-ref so a slow probe doesn't overwrite a newer one. */
  const licenseNumber = watch("license_number");
  const state = watch("state");

  const runVerify = useCallback(
    async (st: string, ln: string) => {
      setVerify({ status: "checking" });
      try {
        const res = await fetch("/api/onboarding/verify-license", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: st, license_number: ln }),
        });
        const body = (await res.json()) as VerifyResult;
        setVerify(body);
      } catch {
        setVerify({ status: "error", message: "Verification probe failed; we'll review manually." });
      }
    },
    [],
  );

  useEffect(() => {
    if (verifyTimerRef.current) clearTimeout(verifyTimerRef.current);
    if (!state || !licenseNumber || licenseNumber.length < 3) {
      setVerify({ status: "idle" });
      return;
    }
    verifyTimerRef.current = setTimeout(() => {
      void runVerify(state, licenseNumber);
    }, 700);
    return () => {
      if (verifyTimerRef.current) clearTimeout(verifyTimerRef.current);
    };
  }, [state, licenseNumber, runVerify]);

  /* Resume path — persist the trade before leaving for the plan step.
   * Deliberately blocking rather than fire-and-forget: if the write fails
   * and we routed anyway, the contractor would reach the territory picker
   * with a stale trade and only find out after checkout. */
  const handleResumeContinue = useCallback(async () => {
    if (!resumeTrade) return;
    setSavingResume(true);
    setError(null);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("Not signed in. Please log in again.");
        return;
      }
      if (resumeTrade !== profileTrade) {
        const { error: tradeErr } = await supabase
          .from("profiles")
          .update({ trade: resumeTrade })
          .eq("id", user.id);
        if (tradeErr) {
          setError(`Couldn't save your trade: ${tradeErr.message}`);
          return;
        }
        setProfileTrade(resumeTrade);
      }
      router.push(planHref);
    } finally {
      setSavingResume(false);
    }
  }, [resumeTrade, profileTrade, router, planHref]);

  async function onSubmit(data: LicenseFormData) {
    setSubmitting(true);
    setError(null);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("Not signed in. Please log in again.");
        setSubmitting(false);
        return;
      }

      /* The browser writes ONLY what the contractor declared. It must not
       * write `verified` / `verification_status` / `last_checked_at` /
       * `expiry_date` / `raw_response`: those are the trust signals that
       * /api/contractors/search and /api/contractors/[id] publish to
       * homeowners, and a browser-computed value there is a badge any
       * contractor could forge from the console. Migration 00127 now
       * rejects such a write outright (42501); the authoritative write
       * happens server-side below, on the service-role client.
       *
       * Schema (migration 00010): license_number, license_state,
       * license_type, holder_name are all user-declared. */
      const licensePayload = {
        license_number: data.license_number,
        license_state: data.state,
        license_type: data.license_type || null,
        holder_name: data.name_on_license || null,
      };

      // Onboarding resume — when a row already exists for this contractor,
      // UPDATE it instead of inserting a duplicate. Target the specific
      // row id we loaded, not every row owned by the contractor: the
      // contractor_id filter would overwrite additional licences (a
      // multi-state contractor's other rows) with this submission.
      const { data: savedRow, error: licenseErr } = existingLicense
        ? await supabase
            .from("contractor_licenses")
            .update(licensePayload)
            .eq("id", existingLicense.id)
            .eq("contractor_id", user.id)
            .select("id")
            .single()
        : await supabase
            .from("contractor_licenses")
            .insert({ contractor_id: user.id, ...licensePayload })
            .select("id")
            .single();
      if (licenseErr) throw licenseErr;

      // Mirror the license state + number onto profiles so the middleware
      // gate at /onboarding/plan can unlock. Without this the gate reads
      // profiles.license_state as null forever and kicks the user back here.
      //
      // `trade` rides along on the SAME update, two steps ahead of
      // /onboarding/territory. claim_territory reads profiles.trade and
      // freezes it onto the territory row, so it has to be right before the
      // territory step runs — and the territory step's availability check
      // asks about that trade, so a wrong value there is only visible after
      // the card has been charged.
      const { error: profileErr } = await supabase
        .from("profiles")
        .update({
          license_state: data.state,
          license_number: data.license_number,
          trade: data.trade,
        })
        .eq("id", user.id);
      if (profileErr) throw profileErr;
      setProfileTrade(data.trade);

      /* Hand the roster check to the server, which re-runs it and records
       * the verdict with the service-role client. Best-effort: if it
       * fails the licence is still on file, just unverified — the safe
       * direction. Never fail onboarding on it. */
      try {
        const res = await fetch("/api/onboarding/verify-license", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            state: data.state,
            license_number: data.license_number,
            license_id: savedRow?.id,
            persist: true,
          }),
        });
        const outcome = (await res.json()) as VerifyResult;
        setVerify(outcome);
        setSavedVerified(outcome.status === "found" && outcome.persisted === true);
      } catch {
        setSavedVerified(false);
      }

      setSubmitted(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not save license. Please retry.";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col items-center min-h-screen bg-background p-6">
      {/* Logo */}
      <Link
        href="/contractors"
        className="mt-8 mb-6 font-heading font-normal text-2xl text-foreground tracking-tight"
      >
        Henri.
      </Link>

      {/* Progress */}
      <div className="mb-8">
        <OnboardingProgress currentStep={1} />
      </div>

      <Card className="w-full max-w-2xl mx-auto">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <ShieldCheck className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="font-heading font-normal text-2xl">
            License Verification
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Step 1 of 4 &mdash; Submit your contractor license for verification.
          </p>
        </CardHeader>

        <CardContent>
          {!submitted && existingLicense && !showReplaceForm ? (
            /* Onboarding resume — license already on file */
            <div className="flex flex-col items-center py-6 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[rgba(61,153,112,0.12)]">
                <ShieldCheck className="h-7 w-7 text-[#3D9970]" />
              </div>
              <h3 className="font-heading font-normal text-lg text-foreground mb-1">
                License on file
              </h3>
              <div className="rounded-lg border border-border bg-bg-subtle px-4 py-3 text-sm text-foreground my-4 w-full max-w-xs">
                <div className="flex items-center justify-between py-1">
                  <span className="text-muted-foreground">Number</span>
                  <span className="font-medium">{maskLicense(existingLicense.license_number)}</span>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-muted-foreground">State</span>
                  <span className="font-medium">{existingLicense.license_state}</span>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-muted-foreground">Status</span>
                  <span className="font-medium">
                    {existingLicense.verified
                      ? "Verified"
                      : existingLicense.verification_status.replace(/_/g, " ")}
                  </span>
                </div>
              </div>

              {/* The resume card skips the form, so without this the trade
                  would never be collected for anyone who filed a license
                  before the field existed — they would reach the territory
                  step as 'general' and claim the wrong exclusivity. */}
              <div className="w-full max-w-xs text-left mb-4">
                <label
                  htmlFor="resume_trade"
                  className="text-sm font-medium text-foreground mb-1.5 block"
                >
                  Your trade <span className="text-destructive">*</span>
                </label>
                <Select
                  id="resume_trade"
                  value={resumeTrade}
                  onChange={(e) => setResumeTrade(e.target.value as TradeType | "")}
                >
                  <option value="">Select your trade</option>
                  {TRADE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TRADE_LABELS[t]}
                    </option>
                  ))}
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  Each ZIP is exclusive to one contractor per trade, so this is
                  what your territory claims are locked to.
                </p>
              </div>

              {error && (
                <div
                  className="w-full max-w-xs rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive mb-3"
                  role="alert"
                >
                  {error}
                </div>
              )}

              <Button
                variant="primary"
                size="lg"
                className="w-full max-w-xs"
                disabled={!resumeTrade || savingResume}
                onClick={handleResumeContinue}
              >
                {savingResume ? "Saving..." : "Continue to plan selection"}
              </Button>
              <button
                type="button"
                onClick={() => setShowReplaceForm(true)}
                className="mt-3 text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
              >
                Replace license
              </button>
            </div>
          ) : !submitted ? (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              {/* License Number */}
              <div>
                <label
                  htmlFor="license_number"
                  className="text-sm font-medium text-foreground mb-1.5 block"
                >
                  License Number <span className="text-destructive">*</span>
                </label>
                <Input
                  id="license_number"
                  {...register("license_number")}
                  placeholder="e.g. 1098765"
                  error={!!errors.license_number}
                  errorMessageId="license_number-error"
                />
                {errors.license_number && (
                  <p id="license_number-error" className="text-xs text-destructive mt-1">
                    {errors.license_number.message}
                  </p>
                )}
              </div>

              {/* State */}
              <div>
                <label
                  htmlFor="license_state"
                  className="text-sm font-medium text-foreground mb-1.5 block"
                >
                  State <span className="text-destructive">*</span>
                </label>
                <Select
                  id="license_state"
                  {...register("state")}
                  error={!!errors.state}
                  errorMessageId="license_state-error"
                >
                  <option value="">Select a state</option>
                  {US_STATES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
                {errors.state && (
                  <p id="license_state-error" className="text-xs text-destructive mt-1">
                    {errors.state.message}
                  </p>
                )}
              </div>

              {/* Trade — required. This is the value territory exclusivity
                  is keyed on (migration 00135), not a profile nicety. */}
              <div>
                <label
                  htmlFor="trade"
                  className="text-sm font-medium text-foreground mb-1.5 block"
                >
                  Your trade <span className="text-destructive">*</span>
                </label>
                <Select
                  id="trade"
                  {...register("trade")}
                  error={!!errors.trade}
                  errorMessageId="trade-error"
                >
                  <option value="">Select your trade</option>
                  {TRADE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TRADE_LABELS[t]}
                    </option>
                  ))}
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  Each ZIP is exclusive to one contractor per trade, so this is
                  what your territory claims are locked to. You can change it
                  later in Settings, but territories you already hold keep the
                  trade they were claimed for.
                </p>
                {errors.trade && (
                  <p id="trade-error" className="text-xs text-destructive mt-1">
                    {errors.trade.message}
                  </p>
                )}
              </div>

              {/* License Type */}
              <div>
                <label
                  htmlFor="license_type"
                  className="text-sm font-medium text-foreground mb-1.5 block"
                >
                  License Type / Classification
                </label>
                <Input
                  id="license_type"
                  {...register("license_type")}
                  placeholder='e.g. "C-39 Roofing", "General B"'
                />
              </div>

              {/* Name on License */}
              <div>
                <label
                  htmlFor="name_on_license"
                  className="text-sm font-medium text-foreground mb-1.5 block"
                >
                  Name on License
                </label>
                <Input
                  id="name_on_license"
                  {...register("name_on_license")}
                  placeholder="Full name as shown on license"
                />
              </div>

              {/* Wave 2.B Phase 2 — live cross-check status pill.
                  Renders below the form once the user has typed
                  enough for a probe (state + 3+ char license). */}
              {verify.status !== "idle" && (
                <div
                  className={`rounded-lg px-3 py-2.5 text-sm flex items-start gap-2.5 ${
                    verify.status === "found"
                      ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-700"
                      : verify.status === "skipped"
                        ? "bg-amber-500/10 border border-amber-500/20 text-amber-700"
                        : verify.status === "missing"
                          ? "bg-rose-500/10 border border-rose-500/20 text-rose-700"
                          : verify.status === "checking"
                            ? "bg-muted/40 border border-border text-muted-foreground"
                            : "bg-muted/40 border border-border text-muted-foreground"
                  }`}
                  role="status"
                >
                  {verify.status === "checking" ? (
                    <Loader2 className="h-4 w-4 animate-spin shrink-0 mt-0.5" />
                  ) : verify.status === "found" ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                  ) : verify.status === "skipped" ? (
                    <Info className="h-4 w-4 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1 min-w-0">
                    {verify.status === "checking" && (
                      <span>Checking the {state} licensing roster…</span>
                    )}
                    {verify.status === "found" && verify.match && (
                      <>
                        <div className="font-medium flex items-center gap-1">
                          {/* lucide Check icon — never raw unicode glyphs
                              (brand rule: SVG icons or text labels only). */}
                          <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          Verified against the {state} licensing roster
                        </div>
                        <div className="text-[12px] mt-0.5 opacity-90">
                          {verify.match.business_name}
                          {verify.match.license_status &&
                            ` · ${verify.match.license_status}`}
                          {verify.match.expire_date &&
                            ` · expires ${verify.match.expire_date}`}
                        </div>
                      </>
                    )}
                    {verify.status === "missing" && (
                      <>
                        <div className="font-medium">License not found in {state} roster</div>
                        <div className="text-[12px] mt-0.5 opacity-90">
                          Double-check the number. We&rsquo;ll review manually if you continue.
                        </div>
                      </>
                    )}
                    {verify.status === "skipped" && (
                      <>
                        <div className="font-medium">Manual review for {state}</div>
                        <div className="text-[12px] mt-0.5 opacity-90">
                          {state} isn&rsquo;t in our auto-verify roster yet. You can still
                          submit — we&rsquo;ll review your license manually.
                          {verify.available_states && verify.available_states.length > 0 && (
                            <span className="block mt-0.5">
                              Currently auto-verifying:{" "}
                              {verify.available_states.join(", ")}.
                            </span>
                          )}
                        </div>
                      </>
                    )}
                    {verify.status === "error" && (
                      <span>{verify.message ?? "Verification probe failed."}</span>
                    )}
                  </div>
                </div>
              )}

              {error && (
                <div
                  className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  role="alert"
                >
                  {error}
                </div>
              )}

              <Button
                type="submit"
                variant="primary"
                size="lg"
                className="w-full"
                disabled={submitting}
              >
                {submitting ? "Verifying..." : "Submit License"}
              </Button>
            </form>
          ) : (
            /* Success State */
            <div className="flex flex-col items-center py-8 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[rgba(61,153,112,0.12)]">
                <CheckCircle2 className="h-7 w-7 text-[#3D9970]" />
              </div>
              <h3 className="font-heading font-normal text-lg text-foreground mb-1">
                {savedVerified
                  ? "License verified"
                  : "License submitted for verification"}
              </h3>
              {/* Two honest outcomes, keyed off what the SERVER actually
               * stored (`savedVerified`) rather than the advisory probe.
               * Claiming "verified" for a verdict that never reached the
               * database would be the same fiction the badge rework was
               * meant to remove. When the check didn't match, the review
               * is manual and there is no automated approval notification
               * to promise — say where to check instead. */}
              <p className="text-sm text-muted-foreground mb-6">
                {savedVerified
                  ? `We matched your license against the ${state} state roster. You're all set — keep going.`
                  : "Your license is on file and pending manual review. That doesn't block you: keep setting up your account, and you can check the status any time in Settings."}
              </p>
              <Button
                variant="primary"
                size="lg"
                className="w-full max-w-xs"
                onClick={() => router.push(planHref)}
              >
                Continue to plan selection
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function LicenseVerificationPage() {
  return (
    <Suspense>
      <LicenseVerificationContent />
    </Suspense>
  );
}
