"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Check, MapPin, Zap } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { OnboardingProgress } from "@/components/onboarding/OnboardingProgress";

interface Plan {
  id: string;
  name: string;
  price: number;
  zips: number;
  badge: { text: string; variant: "default" | "warning" } | null;
  features: string[];
}

const plans: Plan[] = [
  {
    id: "founder",
    name: "Founder",
    price: 149,
    zips: 3,
    badge: { text: "Beta \u00B7 Limited Early Access", variant: "warning" },
    features: [
      "3 ZIP territories",
      "AI-scored permit leads",
      "Best-effort owner contact enrichment",
      "Email & SMS outreach (compose & send)",
    ],
  },
  {
    id: "starter",
    name: "Starter",
    price: 749,
    zips: 5,
    badge: null,
    features: [
      "Everything in Founder",
      "5 ZIP territories",
      "Storm Center dashboard",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: 1499,
    zips: 12,
    badge: { text: "Most Popular", variant: "default" },
    features: [
      "Everything in Starter",
      "12 ZIP territories",
      "Daily license verification",
      "Priority email support",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: 2555,
    zips: 20,
    badge: null,
    features: [
      "Everything in Pro",
      "20 ZIP territories",
      "Dedicated account manager",
      "Custom onboarding",
    ],
  },
];

function PlanSelectionContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Onboarding resume — when the pre-selection came from profiles.plan
  // (not the URL), show a small "previously selected" hint.
  const [resumedPlan, setResumedPlan] = useState<string | null>(null);

  // Pre-select plan from URL param (e.g. ?plan=pro passed from pricing page).
  // When no URL param, fall back to the previously saved profiles.plan so a
  // returning contractor resumes where they left off.
  useEffect(() => {
    const planParam = searchParams.get("plan");
    const validPlans = plans.map((p) => p.id);
    if (planParam && validPlans.includes(planParam)) {
      setSelected(planParam);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user || cancelled) return;
        const { data: profile } = await supabase
          .from("profiles")
          .select("plan")
          .eq("id", user.id)
          .maybeSingle();
        if (cancelled) return;
        const savedPlan = profile?.plan as string | undefined;
        if (savedPlan && validPlans.includes(savedPlan)) {
          // Don't clobber a click the user made while we were fetching.
          setSelected((current) => current ?? savedPlan);
          setResumedPlan(savedPlan);
        }
      } catch {
        // Best-effort — fall back to no pre-selection.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  async function handleContinue() {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("Not signed in. Please log in again.");
        setSaving(false);
        return;
      }

      // Write to profiles.plan — that's the column the middleware gate
      // (`/onboarding/payment`) and the territory step verifier both
      // read. Prior code wrote to `selected_plan`, which neither reads,
      // so users were stuck or could skip payment.
      const { error: updErr } = await supabase
        .from("profiles")
        .update({ plan: selected })
        .eq("id", user.id);
      if (updErr) throw updErr;

      router.push("/onboarding/payment");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not save plan. Please retry.";
      setError(msg);
      setSaving(false);
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
        <OnboardingProgress currentStep={2} />
      </div>

      <div className="w-full max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="font-heading font-normal text-2xl text-foreground">
            Choose your plan
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Step 2 of 4 &mdash; All plans include a 24-hour free trial.
          </p>
          {resumedPlan && selected === resumedPlan && (
            <p className="text-xs text-muted-foreground mt-2">
              You previously selected{" "}
              <span className="font-medium text-foreground">
                {plans.find((p) => p.id === resumedPlan)?.name ?? resumedPlan}
              </span>
              .
            </p>
          )}
        </div>

        {/* Plan Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
          {plans.map((plan) => {
            const isSelected = selected === plan.id;

            return (
              <Card
                key={plan.id}
                className={cn(
                  "relative cursor-pointer transition-all duration-200",
                  isSelected
                    ? "border-primary ring-2 ring-primary/20"
                    : "hover:border-primary/40"
                )}
                onClick={() => setSelected(plan.id)}
              >
                <CardContent className="p-5">
                  {/* Badge */}
                  {plan.badge && (
                    <div className="mb-3">
                      <Badge variant={plan.badge.variant}>
                        {plan.badge.text}
                      </Badge>
                    </div>
                  )}

                  {/* Plan Header */}
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-heading font-normal text-lg text-foreground">
                        {plan.name}
                      </h3>
                      <div className="flex items-baseline gap-1 mt-1">
                        <span className="text-3xl font-semibold text-foreground">
                          ${plan.price.toLocaleString()}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          /mo
                        </span>
                      </div>
                    </div>
                    <div
                      className={cn(
                        "h-5 w-5 rounded-full border-2 flex items-center justify-center transition-colors",
                        isSelected
                          ? "border-primary bg-primary"
                          : "border-border"
                      )}
                    >
                      {isSelected && (
                        <Check className="h-3 w-3 text-primary-foreground" />
                      )}
                    </div>
                  </div>

                  {/* Trial text */}
                  <p className="text-xs text-muted-foreground mb-3">
                    24-hour free trial
                  </p>

                  {/* ZIPs */}
                  <div className="flex items-center gap-1.5 text-sm text-foreground mb-3">
                    <MapPin className="h-3.5 w-3.5 text-primary" />
                    <span>{plan.zips} ZIP territories</span>
                  </div>

                  {/* Features */}
                  <ul className="space-y-2">
                    {plan.features.map((feature) => (
                      <li
                        key={feature}
                        className="flex items-center gap-2 text-sm text-muted-foreground"
                      >
                        <Zap className="h-3.5 w-3.5 text-primary shrink-0" />
                        {feature}
                      </li>
                    ))}
                  </ul>

                  {/* Select Button */}
                  <Button
                    variant={isSelected ? "primary" : "outline"}
                    size="sm"
                    className="w-full mt-4"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelected(plan.id);
                    }}
                  >
                    {isSelected ? "Selected" : "Select plan"}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {error && (
          <div
            className="mb-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            {error}
          </div>
        )}

        {/* Continue Button */}
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          disabled={!selected || saving}
          onClick={handleContinue}
        >
          {saving ? "Saving..." : "Continue to payment"}
        </Button>
      </div>
    </div>
  );
}

export default function PlanSelectionPage() {
  return (
    <Suspense>
      <PlanSelectionContent />
    </Suspense>
  );
}
