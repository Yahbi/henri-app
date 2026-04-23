import Link from "next/link";

/**
 * Footer mounted on every marketing + auth page.
 *
 * Required for Stripe subscription approval and Google OAuth consent
 * screen review: both require that Terms, Privacy, and Acceptable Use
 * policies be reachable from every page served to users before auth.
 *
 * Kept minimal — no mailing list signup, no social links — because the
 * app is not a consumer social product and those elements dilute the
 * B2B-SaaS positioning.
 */
export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-border bg-card">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-8 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Link
            href="/"
            className="font-heading text-base font-normal tracking-tight text-primary"
          >
            Henri.
          </Link>
          <span className="hidden sm:inline">·</span>
          <span className="hidden sm:inline">&copy; {year}</span>
        </div>

        <nav
          className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground"
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
      </div>
    </footer>
  );
}
