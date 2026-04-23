"use client";

import Link from "next/link";
import { Check } from "lucide-react";
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
}

const plans: Plan[] = [
  {
    name: "Founder",
    price: "$149",
    period: "/mo",
    description: "Beta pricing. Locked forever for early supporters.",
    badge: "Beta \u00b7 87 of 100 left",
    features: [
      "3 ZIP territories",
      "AI-scored permit leads",
      "Full owner contact data",
      "Email & SMS outreach",
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
      "Full contact enrichment",
      "Email & SMS outreach",
      "Storm Center alerts",
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
      // Pro tier — kept to features that are LIVE today (Phase 3.3). The
      // stub surfaces (Canvass / Neighborhood Blast / Reputation) are
      // moving to a separate "Coming to Pro" sub-list once we decide
      // their actual ship date; don't sell what doesn't work yet.
      "12 ZIP territories",
      "Everything in Starter",
      "Compliance monitoring",
      "Storm alerts & permit surge",
      "Priority support",
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
      "Priority lead routing",
      "Dedicated account manager",
      "Team seats (up to 10)",
    ],
    cta: "Start free trial",
    ctaHref: "/signup?role=contractor&plan=enterprise",
    ctaVariant: "outline",
  },
];

export function PricingSection() {
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
          {plans.map((plan) => (
            <Card
              key={plan.name}
              variant="default"
              className={cn(
                "flex flex-col",
                plan.popular &&
                  "ring-2 ring-primary shadow-[0_0_30px_hsl(var(--primary)/0.15)]"
              )}
            >
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-xl">{plan.name}</CardTitle>
                  {plan.popular && (
                    <Badge variant="default">Most Popular</Badge>
                  )}
                </div>
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
