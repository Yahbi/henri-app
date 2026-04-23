import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { TerritoryMapPreview } from "@/components/landing/TerritoryMapPreview";
import { TrustSignals } from "@/components/landing/TrustSignals";
import { PricingSection } from "@/components/landing/PricingSection";
import { FAQ } from "@/components/landing/FAQ";

/**
 * Landing page composition. Prior version rendered a bespoke Footer
 * component that linked only to /pricing, #faq, mailto:support and
 * OMITTED /terms, /privacy, and /acceptable-use — breaking the
 * Stripe/Google OAuth review requirement that all three legal pages
 * be reachable from every public page. The shared Footer is now
 * mounted by `src/app/(marketing)/layout.tsx` so this page just
 * returns the marketing sections.
 */
export default function MarketingPage() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <TerritoryMapPreview />
      <TrustSignals />
      <PricingSection />
      <FAQ />
    </>
  );
}
