"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";

// Honest stats — sourced from live Supabase counts (audit 2026-04-30):
//   permits.total                  = 1,412,498  (rounded to "900k+" for
//                                                 headroom; bump when we
//                                                 grow, never inflate)
//   distinct US states with >=1 permit ingested = 35
//                                                 (claim "30+" to stay
//                                                 conservative against
//                                                 sample variance)
//   refresh cadence                = every 30 min (vercel.json
//                                                  /api/cron/scrape)
// Earlier "45+ States Covered" was off — only 35 states have actual
// permit data ingested (50+ are configured in permit_sources but not
// yet producing). Tightened to 30+.
const stats = [
  { label: "900k+ Permits Tracked", top: "12%", left: "8%", delay: "0s" },
  { label: "30+ States Covered", top: "38%", left: "2%", delay: "0.2s" },
  { label: "Refreshed every 30 min", top: "64%", left: "6%", delay: "0.4s" },
] as const;

export function Hero() {
  return (
    <section className="relative min-h-screen flex items-center overflow-hidden bg-background">
      {/* Gradient mesh background */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background: [
            "radial-gradient(ellipse 60% 50% at 20% 50%, hsl(var(--primary) / 0.08) 0%, transparent 70%)",
            "radial-gradient(ellipse 40% 60% at 80% 30%, hsl(var(--accent) / 0.06) 0%, transparent 70%)",
            "radial-gradient(ellipse 50% 40% at 60% 80%, hsl(var(--primary) / 0.05) 0%, transparent 70%)",
          ].join(", "),
        }}
      />

      <div className="mx-auto w-full max-w-7xl px-6 py-24 lg:py-32">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
          {/* Left: copy + CTAs */}
          <div className="relative z-10 flex flex-col gap-8">
            <h1 className="font-heading text-5xl font-normal tracking-tight text-foreground sm:text-6xl lg:text-7xl">
              <span className="text-primary">Permit</span> Intelligence
              <br />
              <span className="text-foreground">for Contractors</span>
            </h1>

            <p className="max-w-lg text-lg leading-relaxed text-muted-foreground sm:text-xl">
              Track construction permits, score leads with AI, and lock down ZIP
              territories before your competition.
            </p>

            <div className="flex flex-wrap gap-4">
              <Button variant="glow" size="lg" asChild>
                <Link href="/signup?role=contractor">Start Free Trial</Link>
              </Button>
              <Button variant="outline" size="lg" asChild>
                <Link href="#how-it-works">See How It Works</Link>
              </Button>
            </div>

            <p className="text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link href="/login" className="font-medium text-primary hover:underline">
                Sign in
              </Link>
            </p>
          </div>

          {/* Right: globe + floating badges */}
          <div className="relative flex items-center justify-center">
            {/* Floating stat badges */}
            {stats.map((stat) => (
              <Badge
                key={stat.label}
                variant="secondary"
                className={cn(
                  "absolute z-20 hidden select-none whitespace-nowrap px-4 py-2 text-sm font-medium shadow-lg backdrop-blur-sm lg:inline-flex",
                  "animate-[float_3s_ease-in-out_infinite]"
                )}
                style={{
                  top: stat.top,
                  left: stat.left,
                  animationDelay: stat.delay,
                }}
              >
                {stat.label}
              </Badge>
            ))}

            <div className="aspect-square w-full max-w-[400px] rounded-full bg-gradient-to-br from-primary/20 via-primary/5 to-transparent border border-primary/10" />
          </div>
        </div>
      </div>
    </section>
  );
}
