"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, Flame } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";

interface Plan {
  name: string;
  price: string;
  period: string;
  description: string;
  features: string[];
  cta: string;
  ctaHref: string;
  popular?: boolean;
  badge?: string;
  ctaVariant?: "primary" | "glow" | "outline";
  /** Scarcity banner — when present, renders as a warm-gold stripe
   *  across the top of the card. Reserved for the Founder plan where
   *  the 100-slot cap is a load-bearing part of the offer. */
  scarcity?: { remaining: number; total: number };
}

const plans: Plan[] = [
  {
    name: "Founder",
    price: "$149",
    period: "/mo",
    description: "Beta pricing. Locked forever for early supporters.",
    /* `badge` retained as a fallback for scan-readers + the scarcity
     * banner below it; primary emphasis is the banner. Keep the copy
     * in sync if the count updates. */
    badge: "Beta",
    // scarcity is hydrated from /api/founder-seats at mount — see the
    // useEffect inside PricingSection. The placeholder { remaining: 100,
    // total: 100 } is the conservative truth before the fetch resolves
    // (it's never a "lower" number than reality, so we never overclaim
    // urgency during the first paint).
    scarcity: { remaining: 100, total: 100 },
    // 2026-04-30 truthfulness pass on plan feature lists:
    //   - "Full owner contact data" / "Full contact enrichment" -> "Best-
    //     effort owner contact enrichment". Live DB shows 39% of leads
    //     have owner_name, ~1% have phone, 0% have email today; calling
    //     it "full" was overclaiming. Coverage varies by jurisdiction.
    //   - "Storm Center alerts" / "Storm alerts & permit surge" -> "Storm
    //     Center dashboard". The /dashboard/storm page is real, but no
    //     code actually pushes a storm alert (no SMS / push notification
    //     fires from the storm-events cron — it just ingests data). And
    //     "permit surge" had zero implementation in the codebase.
    //   - "Priority lead routing" -> dropped (no implementation; lead
    //     routing today is just contractor-territory scoping, same on
    //     every plan).
    //   - "Team seats (up to 10)" -> dropped (no team / multi-user code
    //     exists in the repo — no team_seat / team_member / invite
    //     surface).
    features: [
      "3 ZIP territories",
      "AI-scored permit leads",
      "Best-effort owner contact enrichment",
      "Email & SMS outreach (compose & send)",
      "Price locked forever",
    ],
    cta: "Claim founder spot",
    ctaHref: "/signup?role=contractor&plan=founder",
    ctaVariant: "outline",
  },
  {
    name: "Starter",
    price: "$749",
    period: "/mo",
    description: "For contractors ready to own their territory.",
    features: [
      "5 ZIP territories",
      "AI-scored permit leads",
      "Best-effort owner contact enrichment",
      "Email & SMS outreach (compose & send)",
      "Storm Center dashboard",
    ],
    cta: "Start free trial",
    ctaHref: "/signup?role=contractor&plan=starter",
    ctaVariant: "primary",
  },
  {
    name: "Pro",
    price: "$1,499",
    period: "/mo",
    description: "Full platform access for serious contractors.",
    features: [
      "12 ZIP territories",
      "Everything in Starter",
      "Daily license verification (compliance)",
      "Storm Center dashboard",
      "Priority email support",
    ],
    cta: "Start free trial",
    ctaHref: "/signup?role=contractor&plan=pro",
    popular: true,
    ctaVariant: "glow",
  },
  {
    name: "Enterprise",
    price: "$2,555",
    period: "/mo",
    description: "Maximum coverage for large operations.",
    features: [
      "20 ZIP territories",
      "Everything in Pro",
      "Dedicated account manager",
      "Custom onboarding",
      "Priority email support",
    ],
    cta: "Start free trial",
    ctaHref: "/signup?role=contractor&plan=enterprise",
    ctaVariant: "outline",
  },
];

export function PricingSection() {
  // Live Founder-seat count. Fetches /api/founder-seats once on mount
  // (route is edge-cached 60s SWR 30s, so this is cheap). Replaces the
  // previous hardcoded "87 of 100 spots" line that drifted out of date
  // the moment any contractor signed up. See ~/.claude/plans for the
  // 2026-04-30 truthfulness audit.
  const [founderSeats, setFounderSeats] = useState<{ remaining: number; total: number } | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/founder-seats", { signal: ctrl.signal });
        if (!res.ok) return;
        const j = (await res.json()) as { total: number; taken: number | null; remaining: number | null };
        if (cancelled) return;
        if (typeof j.total === "number" && typeof j.remaining === "number") {
          setFounderSeats({ total: j.total, remaining: j.remaining });
        }
      } catch {
        // network blip — leave the conservative 100/100 placeholder
      }
    })();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, []);

  // Inject the live count into the Founder plan's scarcity field.
  const plansWithLiveScarcity = plans.map((p) =>
    p.scarcity && founderSeats
      ? { ...p, scarcity: founderSeats }
      : p,
  );

  return (
    <section id="pricing" className="bg-background py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-6">
        {/* Section header */}
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-heading text-3xl font-normal tracking-tight text-foreground sm:text-4xl">
            Simple, flat pricing
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            No per-lead fees. No contracts. 24-hour free trial on all plans.
          </p>
        </div>

        {/* Pricing cards */}
        <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {plansWithLiveScarcity.map((plan) => (
            <Card
              key={plan.name}
              variant="default"
              className={cn(
                "flex flex-col overflow-hidden",
                // Named shadow-glow-primary token replaces the inline
                // arbitrary-value form to dodge a Tailwind v4 + Turbopack
                // 16.2.3 parser bug. Same pixel output (the token is
                // defined as `0 0 30px hsl(var(--primary) / 0.15)`).
                plan.popular && "ring-2 ring-primary shadow-glow-primary",
                plan.scarcity &&
                  "ring-1 ring-[rgba(212,162,74,0.4)]"
              )}
            >
              {/* Scarcity banner — warm-gold stripe with live-style count.
               * Replaces the old subtle Badge that rendered the same info
               * at the same weight as "24-hour free trial". Gives Founder
               * urgency its own visual lane without drowning out "Most
               * Popular" on Pro. Only renders for plans that actually
               * have a slot cap (Founder today). */}
              {plan.scarcity && (
                <div className="flex items-center justify-between gap-2 bg-[rgba(212,162,74,0.12)] border-b border-[rgba(212,162,74,0.35)] px-4 py-2 text-[11px] font-semibold text-warm">
                  <span className="inline-flex items-center gap-1.5">
                    <Flame className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    Only {plan.scarcity.remaining} of {plan.scarcity.total} spots left
                  </span>
                  <span className="text-[10px] font-normal text-warm/80 tracking-wide uppercase">
                    Price locked forever
                  </span>
                </div>
              )}
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-xl">{plan.name}</CardTitle>
                  {plan.popular && (
                    <Badge variant="default">Most Popular</Badge>
                  )}
                </div>
                {/* Secondary badge — retained for the "Beta" tag on
                 * Founder (without the count, which now lives in the
                 * banner above). Keeps the badge slot available for
                 * other plans in the future (e.g. "Reservation only"). */}
                {plan.badge && (
                  <Badge variant="warning" className="w-fit text-xs">
                    {plan.badge}
                  </Badge>
                )}
                <CardDescription>{plan.description}</CardDescription>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-4xl font-extrabold text-foreground">
                    {plan.price}
                  </span>
                  <span className="text-sm text-muted-foreground">{plan.period}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">24-hour free trial</p>
              </CardHeader>

              <CardContent className="flex-1">
                <ul className="space-y-3">
                  {plan.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-center gap-3 text-sm"
                    >
                      <Check className="h-4 w-4 shrink-0 text-primary" />
                      <span className="text-foreground">{feature}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>

              <CardFooter>
                <Button
                  variant={plan.ctaVariant ?? "primary"}
                  className="w-full"
                  asChild
                >
                  <Link href={plan.ctaHref}>{plan.cta}</Link>
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
