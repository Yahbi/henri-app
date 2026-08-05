"use client";

import { useState, useEffect } from "react";
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
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Already paying. /api/checkout now 409s on a duplicate, but the UI
  // shouldn't offer an action that can only fail — and a second Stripe
  // subscription on the same customer is a double charge.
  const [alreadySubscribed, setAlreadySubscribed] = useState(false);
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
            .select("plan, stripe_subscription_id")
            .eq("id", user.id)
            .single();

          if (profile?.plan) {
            setSelectedPlan(profile.plan);
          }
          // stripe_subscription_id is written only by the
          // checkout.session.completed webhook, so it's the honest
          // "already paying" fact (stripe_customer_id is stamped before
          // payment and would false-positive on an abandoned checkout).
          if (profile?.stripe_subscription_id) {
            setAlreadySubscribed(true);
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
            <div
              className="flex items-center justify-center py-12"
              role="status"
              aria-live="polite"
            >
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <span className="sr-only">Loading your selected plan…</span>
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

                  {/* A user who picked the wrong tier previously had no way
                      back from this step — the "go back" link only rendered
                      in the no-plan branch. The plan step re-reads
                      profiles.plan, so the current selection is preserved. */}
                  <div className="mt-3 border-t border-border pt-3">
                    <Link
                      href="/onboarding/plan"
                      className="text-xs text-primary hover:underline"
                    >
                      Change plan
                    </Link>
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

              {/* Already-subscribed short-circuit — offering checkout
                  again would open a second concurrent Stripe
                  subscription (double charge). */}
              {alreadySubscribed ? (
                <div className="space-y-3">
                  <div
                    className="rounded-lg border border-success/30 bg-success/10 px-3 py-2.5 text-sm text-success"
                    role="status"
                  >
                    Your subscription is already active — no need to pay again.
                  </div>
                  <Button
                    variant="primary"
                    size="lg"
                    className="w-full"
                    onClick={() => { window.location.href = "/onboarding/territory"; }}
                  >
                    Continue to territory selection
                  </Button>
                  <p className="text-center text-xs text-muted-foreground">
                    Need a different plan?{" "}
                    <Link href="/settings/billing" className="text-primary hover:underline">
                      Change it in billing settings
                    </Link>{" "}
                    instead — that swaps your existing subscription rather than
                    starting a second one.
                  </p>
                </div>
              ) : (
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
              )}

              {/* Terms + Privacy were plain text; both pages exist at
                  /terms and /privacy, so a user asked to agree to them
                  had no way to read them. Now linked. */}
              <p className="text-xs text-center text-muted-foreground">
                By continuing, you agree to our{" "}
                <Link
                  href="/terms"
                  target="_blank"
                  className="text-primary hover:underline"
                >
                  Terms of Service
                </Link>{" "}
                and{" "}
                <Link
                  href="/privacy"
                  target="_blank"
                  className="text-primary hover:underline"
                >
                  Privacy Policy
                </Link>
                . A card is required to start the 24-hour trial. Cancel anytime
                before it ends and you won&apos;t be charged.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
