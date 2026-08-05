"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";
import { CoverageMap } from "@/components/landing/CoverageMap";
import type { UsState } from "@/lib/stats/us-states";

/**
 * Hero block on the marketing landing page.
 *
 * Stats are NOT hardcoded any more — they're passed in from the page
 * (which fetches via `getLandingStats()` in a 1h-revalidated server
 * component). When permits cross 1.5M or active states cross 35,
 * the labels update on the next page revalidation without any code
 * change.
 *
 * Right column shows a live coverage tile map (CoverageMap) instead
 * of the previous empty gradient circle. Tiles light up for states
 * with new permits in the last 30 days.
 */

interface HeroProps {
  permitsLabel: string;
  activeStatesLabel: string;
  activeStates: readonly UsState[];
  /** Live per-state permit counts — shades the coverage map by volume. */
  statePermits?: Readonly<Partial<Record<UsState, number>>>;
  /** "18,000+" — omitted when the coverage cache hasn't been computed. */
  zipsCoveredLabel?: string;
}

export function Hero({
  permitsLabel,
  activeStatesLabel,
  activeStates,
  statePermits,
  zipsCoveredLabel,
}: HeroProps) {
  // The third badge only earns its place when it carries a real number.
  // With no ZIP count available it falls back to the refresh cadence
  // rather than rendering an empty or invented stat.
  const stats = [
    { label: `${permitsLabel} Permits Tracked`, top: "8%", left: "2%", delay: "0s" },
    { label: `${activeStatesLabel} States Covered`, top: "44%", left: "-2%", delay: "0.2s" },
    {
      label: zipsCoveredLabel
        ? `${zipsCoveredLabel} ZIP Codes`
        : "Refreshed daily",
      top: "78%",
      left: "4%",
      delay: "0.4s",
    },
  ] as const;

  return (
    <section className="relative min-h-screen flex items-center overflow-hidden bg-background">
      {/* Blueprint plate — roof-framing plans + parcel boundaries, the actual
          source material Henri works from. Anchored right so the headline
          column on the left stays on flat background; masked to nothing by
          ~55% width so text contrast is never affected. Sits UNDER the
          gradient mesh below. Decorative only. */}
      {/* z-0, NOT a negative z-index. The section paints an opaque
          `bg-background`, and in CSS painting order a negative-z descendant is
          drawn BEFORE the parent's block background — so at -z-20 this layer
          was painted and then covered, i.e. invisible. Verified in-browser:
          the element was 1430x900 with the image loaded and simply never
          visible. z-0 puts it above the section background while the copy
          column (relative z-10) and the map column (positioned, later in DOM)
          both still paint above it. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0 hidden lg:block"
        style={{
          backgroundImage: "url(/brand/hero-blueprint.webp)",
          backgroundSize: "cover",
          backgroundPosition: "right center",
          // 0.35, tuned by eye against the coverage-map card that sits on top
          // of it — at 0.5 the framing lines competed with the map tiles.
          opacity: 0.35,
          maskImage:
            "linear-gradient(to right, transparent 0%, transparent 45%, rgba(0,0,0,0.85) 75%, rgba(0,0,0,1) 100%)",
          WebkitMaskImage:
            "linear-gradient(to right, transparent 0%, transparent 45%, rgba(0,0,0,0.85) 75%, rgba(0,0,0,1) 100%)",
        }}
      />

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
              Track public building permits, score every lead 0&ndash;100 with
              AI, and reach homeowners with permit-specific outreach &mdash;
              no per-lead fees, no shared marketplace queue.
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

          {/* Right: coverage map + floating stat badges */}
          <div className="relative flex items-center justify-center">
            {/* Floating stat badges, animated. Hidden on mobile to keep
                the right column from collapsing into noise — the map
                is the meaningful element on small screens. */}
            {stats.map((stat) => (
              <Badge
                key={stat.label}
                variant="secondary"
                className={cn(
                  "absolute z-20 hidden select-none whitespace-nowrap px-4 py-2 text-sm font-medium shadow-lg backdrop-blur-sm lg:inline-flex",
                  "animate-[float_3s_ease-in-out_infinite]",
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

            <CoverageMap
              activeStates={activeStates}
              statePermits={statePermits}
              caption={
                zipsCoveredLabel
                  ? `${permitsLabel} permits across ${zipsCoveredLabel} ZIP codes. Hover a state for its exact count.`
                  : undefined
              }
            />
          </div>
        </div>
      </div>
    </section>
  );
}
