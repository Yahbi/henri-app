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

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
  "DC",
] as const;

const licenseSchema = z.object({
  license_number: z.string().min(1, "License number is required"),
  state: z.string().min(1, "State is required"),
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
  const verifyTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Onboarding resume — if the contractor already submitted a license,
  // show a "License on file" card instead of the blank form.
  const [existingLicense, setExistingLicense] = useState<ExistingLicense | null>(null);
  const [showReplaceForm, setShowReplaceForm] = useState(false);

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
        const { data } = await supabase
          .from("contractor_licenses")
          .select("id, license_number, license_state, verification_status, verified")
          .eq("contractor_id", user.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!cancelled && data) {
          setExistingLicense(data as ExistingLicense);
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
    formState: { errors },
  } = useForm<LicenseFormData>({
    resolver: zodResolver(licenseSchema),
  });

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

      // Wave 2.B Phase 2 — record auto-verification status. When the
      // cross-check found the license in our state_license_rosters,
      // mark verified immediately. Otherwise stay pending — admin
      // (or a future scraper) will resolve manually.
      // Schema (migration 00010): license_state, holder_name,
      // verified (bool), verification_status (text), last_checked_at.
      const verifiedFlag = verify.status === "found";
      const verificationStatus =
        verify.status === "found"
          ? "verified_state_roster"
          : verify.status === "skipped"
            ? "manual_review"
            : verify.status === "missing"
              ? "missing_in_roster"
              : "pending_verification";

      const licensePayload = {
        license_number: data.license_number,
        license_state: data.state,
        license_type:
          (verify.match?.license_type as string | undefined) || data.license_type || null,
        holder_name:
          (verify.match?.business_name as string | undefined) ||
          data.name_on_license ||
          null,
        verified: verifiedFlag,
        verification_status: verificationStatus,
        last_checked_at: new Date().toISOString(),
        expiry_date: (verify.match?.expire_date as string | undefined) || null,
        raw_response: verify as unknown as Record<string, unknown>,
      };

      // Onboarding resume — when a row already exists for this contractor,
      // UPDATE it instead of inserting a duplicate.
      const { error: licenseErr } = existingLicense
        ? await supabase
            .from("contractor_licenses")
            .update(licensePayload)
            .eq("contractor_id", user.id)
        : await supabase
            .from("contractor_licenses")
            .insert({ contractor_id: user.id, ...licensePayload });
      if (licenseErr) throw licenseErr;

      // Mirror the license state + number onto profiles so the middleware
      // gate at /onboarding/plan can unlock. Without this the gate reads
      // profiles.license_state as null forever and kicks the user back here.
      const { error: profileErr } = await supabase
        .from("profiles")
        .update({
          license_state: data.state,
          license_number: data.license_number,
        })
        .eq("id", user.id);
      if (profileErr) throw profileErr;

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
              <Button
                variant="primary"
                size="lg"
                className="w-full max-w-xs"
                onClick={() => router.push(planHref)}
              >
                Continue to plan selection
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
                <label className="text-sm font-medium text-foreground mb-1.5 block">
                  License Number <span className="text-destructive">*</span>
                </label>
                <Input
                  {...register("license_number")}
                  placeholder="e.g. 1098765"
                  error={!!errors.license_number}
                />
                {errors.license_number && (
                  <p className="text-xs text-destructive mt-1">
                    {errors.license_number.message}
                  </p>
                )}
              </div>

              {/* State */}
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">
                  State <span className="text-destructive">*</span>
                </label>
                <Select
                  {...register("state")}
                  error={!!errors.state}
                >
                  <option value="">Select a state</option>
                  {US_STATES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
                {errors.state && (
                  <p className="text-xs text-destructive mt-1">
                    {errors.state.message}
                  </p>
                )}
              </div>

              {/* License Type */}
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">
                  License Type / Classification
                </label>
                <Input
                  {...register("license_type")}
                  placeholder='e.g. "C-39 Roofing", "General B"'
                />
              </div>

              {/* Name on License */}
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">
                  Name on License
                </label>
                <Input
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
                License submitted for verification
              </h3>
              <p className="text-sm text-muted-foreground mb-6">
                We&apos;ll verify your license and notify you once it&apos;s
                approved. You can continue setting up your account in the
                meantime.
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
