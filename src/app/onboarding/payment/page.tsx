"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CreditCard, Clock } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { OnboardingProgress } from "@/components/onboarding/OnboardingProgress";

const planDetails: Record<string, { name: string; price: number }> = {
  founder: { name: "Founder", price: 149 },
  starter: { name: "Starter", price: 749 },
  pro: { name: "Pro", price: 1499 },
  enterprise: { name: "Enterprise", price: 2555 },
};

export default function PaymentPage() {
  const router = useRouter();
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // devMode + its render branch were removed entirely. Prior code flipped
  // `setDevMode(true)` on any Stripe failure and let users skip payment,
  // which leaked into production preview builds. Any checkout error now
  // stays on this step with an inline error message.

  useEffect(() => {
    async function loadPlan() {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (user) {
          const { data: profile } = await supabase
            .from("profiles")
            .select("plan")
            .eq("id", user.id)
            .single();

          if (profile?.plan) {
            setSelectedPlan(profile.plan);
          }
        }
      } catch {
        // Fallback to no plan
      } finally {
        setLoading(false);
      }
    }

    loadPlan();
  }, []);

  const plan = selectedPlan ? planDetails[selectedPlan] : null;

  async function handleStartTrial() {
    if (!selectedPlan) return;
    setProcessing(true);
    setError(null);

    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: selectedPlan }),
      });

      if (!response.ok) {
        // Surface a clear error and STAY on this step. Earlier code flipped
        // `devMode=true` and skipped forward to territory, which in prod
        // (where Stripe is usually just mis-configured, not intentionally
        // absent) let users onboard without paying — a launch blocker.
        const j = (await response.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `Payment setup failed (${response.status}). Please try again.`);
        setProcessing(false);
        return;
      }

      const { url } = await response.json();
      if (url) {
        window.location.href = url;
        return;
      }
      setError("Stripe returned no checkout URL. Please retry — if this persists, contact support.");
      setProcessing(false);
    } catch (e) {
      setError(
        e instanceof Error
          ? `Couldn't reach payment service: ${e.message}`
          : "Couldn't reach payment service. Check your connection and retry.",
      );
      setProcessing(false);
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
        <OnboardingProgress currentStep={3} />
      </div>

      <Card className="w-full max-w-2xl mx-auto">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <CreditCard className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="font-heading font-normal text-2xl">
            Start your free trial
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Step 3 of 4 &mdash; No charge until your trial ends.
          </p>
        </CardHeader>

        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : (
            <div className="space-y-6">
              {/* Plan Summary Card */}
              {plan && (
                <div
                  className={cn(
                    "rounded-lg border border-border bg-card p-5"
                  )}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h3 className="font-heading font-normal text-lg text-foreground">
                        {plan.name} Plan
                      </h3>
                      <div className="flex items-baseline gap-1 mt-0.5">
                        <span className="text-2xl font-semibold text-foreground">
                          ${plan.price.toLocaleString()}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          /mo
                        </span>
                      </div>
                    </div>
                    <Badge variant="success">24-hour free trial</Badge>
                  </div>

                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    <span>
                      You won&apos;t be charged until your trial ends
                    </span>
                  </div>
                </div>
              )}

              {!plan && (
                <div className="rounded-lg border border-border bg-card p-5 text-center">
                  <p className="text-sm text-muted-foreground">
                    No plan selected.{" "}
                    <Link
                      href="/onboarding/plan"
                      className="text-primary hover:underline"
                    >
                      Go back to select a plan
                    </Link>
                  </p>
                </div>
              )}

              {/* Error surface — rendered above the CTA so the user can
                * fix the condition before retrying. Payment failures now
                * stay on this step; no silent bypass to territory. */}
              {error && (
                <div
                  className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  role="alert"
                >
                  {error}
                </div>
              )}

              {/* CTA */}
              <Button
                variant="primary"
                size="lg"
                className="w-full"
                disabled={!plan || processing}
                onClick={handleStartTrial}
              >
                {processing ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                    Redirecting to checkout...
                  </span>
                ) : (
                  "Start my free trial"
                )}
              </Button>

              <p className="text-xs text-center text-muted-foreground">
                By continuing, you agree to our Terms of Service and Privacy
                Policy. Cancel anytime during your trial.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
