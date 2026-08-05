import { Footer } from "@/components/marketing/Footer";
import { MarketingNav } from "@/components/marketing/MarketingNav";

/**
 * Marketing layout — wraps `/`, `/portal`, `/contractors`, `/pricing`,
 * `/terms`, `/privacy`, `/acceptable-use`.
 *
 * Mounts the shared `<MarketingNav />` (consistent nav with Sign in + CTA
 * + mobile hamburger across every pre-auth page — gap-audit items G1 + G7)
 * and `<Footer />` (Stripe + Google OAuth review require Terms / Privacy /
 * Acceptable Use reachable from every pre-auth page).
 */
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <MarketingNav />
      {/* Skip-link target — see the note in (dashboard)/layout.tsx. */}
      <main id="main-content" tabIndex={-1} className="flex-1 pt-14">
        {children}
      </main>
      <Footer />
    </div>
  );
}
