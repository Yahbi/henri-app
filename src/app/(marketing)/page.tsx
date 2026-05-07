import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { TerritoryMapPreview } from "@/components/landing/TerritoryMapPreview";
import { TrustSignals } from "@/components/landing/TrustSignals";
import { PricingSection } from "@/components/landing/PricingSection";
import { FAQ } from "@/components/landing/FAQ";
import { getLandingStats } from "@/lib/stats/landing";

/**
 * Landing page composition.
 *
 * Stats (permit count, active-state count) are fetched server-side via
 * `getLandingStats()` and passed down to every section that previously
 * hardcoded numbers. The page is revalidated every hour so the data
 * stays fresh without putting the home page on the request-time
 * Supabase critical path.
 *
 * Prior version rendered a bespoke Footer that linked only to
 * /pricing, #faq, mailto:support and OMITTED /terms, /privacy, and
 * /acceptable-use — breaking the Stripe/Google OAuth review
 * requirement that all three legal pages be reachable from every
 * public page. The shared Footer is now mounted by
 * `src/app/(marketing)/layout.tsx` so this page just returns the
 * marketing sections.
 */

// Cache the rendered HTML for 1h. Stats fetched once per cache miss.
export const revalidate = 3600;

export default async function MarketingPage() {
  const stats = await getLandingStats();

  return (
    <>
      <Hero
        permitsLabel={stats.permitsLabel}
        activeStatesLabel={stats.activeStatesLabel}
        activeStates={stats.activeStates}
      />
      <HowItWorks
        permitsLabel={stats.permitsLabel}
        activeStatesLabel={stats.activeStatesLabel}
      />
      <TerritoryMapPreview
        permitsLabel={stats.permitsLabel}
        activeStatesLabel={stats.activeStatesLabel}
      />
      <TrustSignals />
      <PricingSection />
      <FAQ
        permitsLabel={stats.permitsLabel}
        activeStatesLabel={stats.activeStatesLabel}
        activeStatesCount={stats.activeStates.length}
      />
    </>
  );
}
