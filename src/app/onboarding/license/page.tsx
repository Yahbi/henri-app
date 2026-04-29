"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ShieldCheck, CheckCircle2 } from "lucide-react";
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

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LicenseFormData>({
    resolver: zodResolver(licenseSchema),
  });

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

      const { error: licenseErr } = await supabase.from("contractor_licenses").insert({
        contractor_id: user.id,
        license_number: data.license_number,
        state: data.state,
        license_type: data.license_type || null,
        name_on_license: data.name_on_license || null,
        status: "pending_verification",
      });
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
          {!submitted ? (
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
                onClick={() => router.push("/onboarding/plan")}
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
