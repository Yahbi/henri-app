"use client";

import { Search, Brain, Trophy } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";


const steps = [
  {
    number: 1,
    title: "We Surface Permits",
    description:
      "Henri continuously refreshes verified permit activity across major metro markets.",
    icon: Search,
  },
  {
    number: 2,
    title: "AI Scores Leads",
    description:
      "Each permit is scored 0-100 based on value, timing, and your trade match.",
    icon: Brain,
  },
  {
    number: 3,
    title: "You Close Deals",
    description:
      "Get notified instantly. You're first to the door.",
    icon: Trophy,
  },
] as const;

export function HowItWorks() {
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
                variant="glass"
                className="relative z-10 text-center"
              >
                <CardContent className="flex flex-col items-center gap-4 p-8">
                  {/* Number badge */}
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
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
