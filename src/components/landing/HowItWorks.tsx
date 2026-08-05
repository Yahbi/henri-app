"use client";

import { Search, Brain, Trophy } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";


// 2026-04-30 truthfulness pass: replaced "continuously refreshes" with
// the truthful daily cadence and "Get notified instantly. You're first
// to the door." with a description that doesn't claim real-time push
// notifications or "first" status (permits are public records — anyone
// can read them, the value is the scoring + enrichment + outreach
// templates we layer on top).
//
// 2026-05-07: stat numbers ("1.4M+", "30+") removed from the static
// step description — they now flow in via the `permitsLabel` /
// `activeStatesLabel` props from `getLandingStats()` so the copy
// auto-adjusts when the database grows past a threshold.

interface HowItWorksProps {
  permitsLabel: string;
  activeStatesLabel: string;
}

export function HowItWorks({ permitsLabel, activeStatesLabel }: HowItWorksProps) {
  const steps = [
    {
      number: 1,
      title: "We Surface Permits",
      description: `Henri's permit catalog refreshes daily (${permitsLabel} permits, ${activeStatesLabel} states).`,
      icon: Search,
    },
    {
      number: 2,
      title: "AI Scores Leads",
      description:
        "Each permit is scored 0–100 across six signals: freshness, project value, contact quality, ZIP demand, homeowner engagement, and historical conversion. The breakdown renders on every lead.",
      icon: Brain,
    },
    {
      number: 3,
      title: "You Work the List",
      // 2026-08-04 truthfulness pass: was "50-template". Live query
      //   select count(*) from outreach_templates where is_default = true
      // returns 42 (7 trades × 3 stages × 2 channels, migration 00047).
      description:
        "Hot leads sort to the top. Outreach via the 42-template per-trade library (or your own saved templates).",
      icon: Trophy,
    },
  ] as const;
  return (
    <section
      id="how-it-works"
      className="scroll-mt-20 bg-background py-24 lg:py-32"
    >
      <div className="mx-auto max-w-7xl px-6">
        {/* Section header */}
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-heading text-3xl font-normal tracking-tight text-foreground sm:text-4xl">
            How It Works
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            From permit filing to closed deal in three simple steps.
          </p>
        </div>

        {/* Steps grid */}
        <div className="relative mt-16 grid grid-cols-1 gap-8 md:grid-cols-3">
          {/* Connecting lines (desktop only) */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-[16.67%] right-[16.67%] hidden h-px -translate-y-1/2 md:block"
          >
            <div className="h-full w-full border-t-2 border-dashed border-border" />
          </div>

          {steps.map((step) => {
            const Icon = step.icon;
            return (
              <Card
                key={step.number}
                variant="translucent"
                className="relative z-10 text-center"
              >
                <CardContent className="flex flex-col items-center gap-4 p-8">
                  {/* Number badge */}
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-cta text-sm font-bold text-cta-foreground">
                    {step.number}
                  </div>

                  {/* Icon */}
                  <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10">
                    <Icon className="h-7 w-7 text-primary" />
                  </div>

                  {/* Title */}
                  <h3 className="text-xl font-semibold text-foreground">
                    {step.title}
                  </h3>

                  {/* Description */}
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {step.description}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}
