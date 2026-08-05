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
import { PLAN_TIERS, planFeatures, type PlanSlug } from "@/lib/plans/tiers";

/* The tier facts — price, ZIP allowance, feature bullets — live in
 * src/lib/plans/tiers.ts. They used to be declared here AND in
 * src/app/(dashboard)/settings/billing/page.tsx, and the two copies had
 * drifted, so the page a contractor bought from and the page they manage
 * billing on advertised different products. Only the marketing chrome
 * (CTA wording, button treatment, the Founder seat-cap banner) is local. */
interface PlanChrome {
  cta: string;
  ctaHref: string;
  ctaVariant: "primary" | "glow" | "outline";
  badge?: string;
  /** Scarcity banner — when present, renders as a warm-gold stripe
   *  across the top of the card. Reserved for the Founder plan where
   *  the 100-slot cap is a load-bearing part of the offer. */
  scarcity?: { remaining: number; total: number };
}

const PLAN_CHROME: Record<PlanSlug, PlanChrome> = {
  founder: {
    cta: "Claim founder spot",
    ctaHref: "/signup?role=contractor&plan=founder",
    ctaVariant: "outline",
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
  },
  starter: {
    cta: "Start free trial",
    ctaHref: "/signup?role=contractor&plan=starter",
    ctaVariant: "primary",
  },
  pro: {
    cta: "Start free trial",
    ctaHref: "/signup?role=contractor&plan=pro",
    ctaVariant: "glow",
  },
  enterprise: {
    cta: "Start free trial",
    ctaHref: "/signup?role=contractor&plan=enterprise",
    ctaVariant: "outline",
  },
};

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
          {PLAN_TIERS.map((plan) => {
            const chrome = PLAN_CHROME[plan.slug];
            // Live seat count overrides the conservative placeholder once
            // /api/founder-seats resolves.
            const scarcity = chrome.scarcity
              ? founderSeats ?? chrome.scarcity
              : undefined;
            return (
            <Card
              key={plan.slug}
              variant="default"
              className={cn(
                "flex flex-col overflow-hidden",
                // Named shadow-glow-primary token replaces the inline
                // arbitrary-value form to dodge a Tailwind v4 + Turbopack
                // 16.2.3 parser bug. Same pixel output (the token is
                // defined as `0 0 30px hsl(var(--primary) / 0.15)`).
                plan.popular && "ring-2 ring-primary shadow-glow-primary",
                scarcity && "ring-1 ring-warm/40"
              )}
            >
              {/* Scarcity banner — warm-gold stripe with live-style count.
               * Replaces the old subtle Badge that rendered the same info
               * at the same weight as "24-hour free trial". Gives Founder
               * urgency its own visual lane without drowning out "Most
               * Popular" on Pro. Only renders for plans that actually
               * have a slot cap (Founder today). */}
              {scarcity && (
                <div className="flex items-center justify-between gap-2 bg-warm/10 border-b border-warm/35 px-4 py-2 text-[11px] font-semibold text-warm">
                  {/* 2026-08-04: before /api/founder-seats resolves, the
                    * placeholder rendered the literal "Only 100 of 100 spots
                    * left" — a scarcity claim asserting no scarcity, and a
                    * count we hadn't actually measured yet. Until the live
                    * count arrives we state the cap only. */}
                  <span className="inline-flex items-center gap-1.5">
                    <Flame className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    {founderSeats
                      ? `Only ${scarcity.remaining} of ${scarcity.total} spots left`
                      : `Limited to ${scarcity.total} Founder seats`}
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
                {chrome.badge && (
                  <Badge variant="warning" className="w-fit text-xs">
                    {chrome.badge}
                  </Badge>
                )}
                <CardDescription>{plan.description}</CardDescription>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-4xl font-extrabold text-foreground">
                    {plan.price}
                  </span>
                  <span className="text-sm text-muted-foreground">{plan.interval}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">24-hour free trial</p>
              </CardHeader>

              <CardContent className="flex-1">
                <ul className="space-y-3">
                  {planFeatures(plan).map((feature) => (
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
                <Button variant={chrome.ctaVariant} className="w-full" asChild>
                  <Link href={chrome.ctaHref}>{chrome.cta}</Link>
                </Button>
              </CardFooter>
            </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}
