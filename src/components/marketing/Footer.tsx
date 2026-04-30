import Link from "next/link";
import { NewsletterSignup } from "./NewsletterSignup";

/**
 * Footer mounted on every marketing + auth page.
 *
 * Required for Stripe subscription approval and Google OAuth consent
 * screen review: both require that Terms, Privacy, and Acceptable Use
 * policies be reachable from every page served to users before auth.
 *
 * 2026-04-30 audit upgrade — added:
 *   - Newsletter signup row (CAN-SPAM-compliant funnel; posts to
 *     /api/newsletter with graceful-degrade across DB → JSONL → Resend).
 *   - Physical mailing address — required by CAN-SPAM § 7704(a)(5)
 *     for any sender that does commercial email. Driven by env so the
 *     founder fills it in via Vercel without code changes; the line
 *     is hidden when the env var is unset (graceful degrade — same
 *     pattern as feature flags).
 */
export function Footer() {
  const year = new Date().getFullYear();
  // Set NEXT_PUBLIC_BUSINESS_ADDRESS in Vercel + .env.local. Format:
  //   "Henri Inc, 123 Main St, Suite 400, City, ST 90210"
  // Stays hidden in dev until set so the page doesn't ship a fake
  // address. CAN-SPAM compliance is on the deploying entity.
  const businessAddress = process.env.NEXT_PUBLIC_BUSINESS_ADDRESS?.trim();

  return (
    <footer className="border-t border-border bg-card">
      <div className="mx-auto max-w-7xl px-6 py-10">
        {/* Top: brand + email-capture funnel */}
        <div className="grid gap-8 sm:grid-cols-2 sm:items-start">
          <div>
            <Link
              href="/"
              className="font-heading text-base font-normal tracking-tight text-primary"
            >
              Henri.
            </Link>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
              Get the occasional product update and a heads-up when
              Founder-tier seats open. No spam, unsubscribe in one click.
            </p>
          </div>
          <div className="sm:max-w-md sm:justify-self-end">
            <NewsletterSignup source="footer" />
          </div>
        </div>

        {/* Mid: legal + product nav */}
        <nav
          className="mt-8 flex flex-wrap gap-x-6 gap-y-2 border-t border-border pt-6 text-sm text-muted-foreground"
          aria-label="Footer"
        >
          <Link href="/login" className="hover:text-foreground">
            Sign in
          </Link>
          <Link href="/signup?role=contractor" className="hover:text-foreground">
            Start free trial
          </Link>
          <Link href="/pricing" className="hover:text-foreground">
            Pricing
          </Link>
          <Link href="/contractors" className="hover:text-foreground">
            For contractors
          </Link>
          <Link href="/portal" className="hover:text-foreground">
            For homeowners
          </Link>
          <Link href="/terms" className="hover:text-foreground">
            Terms
          </Link>
          <Link href="/privacy" className="hover:text-foreground">
            Privacy
          </Link>
          <Link href="/acceptable-use" className="hover:text-foreground">
            Acceptable use
          </Link>
        </nav>

        {/* Bottom: copyright + physical address (CAN-SPAM) */}
        <div className="mt-6 flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>&copy; {year} Henri.</span>
          {businessAddress && (
            <address className="not-italic" aria-label="Mailing address">
              {businessAddress}
            </address>
          )}
        </div>
      </div>
    </footer>
  );
}
