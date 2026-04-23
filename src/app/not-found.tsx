import Link from "next/link";
import { Compass, Home, MessageCircle, Search } from "lucide-react";

/**
 * Branded 404 page. Shown for any unmatched route — both marketing and
 * app routes. Gives people a helpful set of next-actions grouped by who
 * they are (homeowner, contractor, or just browsing), rather than the
 * generic Next.js 404.
 */
export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4 py-12 text-center">
      <Link
        href="/"
        className="font-heading text-4xl text-primary font-medium tracking-tight"
        aria-label="Henri. home"
      >
        Henri.
      </Link>

      <div className="mt-8 flex items-center gap-4">
        <div
          className="hidden sm:flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary"
          aria-hidden="true"
        >
          <Compass className="h-7 w-7" />
        </div>
        <h1 className="font-heading text-5xl sm:text-6xl font-normal text-foreground">404</h1>
      </div>

      <p className="mt-6 text-lg font-medium text-foreground">
        We can&apos;t find that page
      </p>
      <p className="mt-2 text-sm text-muted-foreground max-w-md">
        The URL you followed may be broken, or the page may have moved. Here are a few places you can go instead.
      </p>

      <div className="mt-8 grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-3">
        <Link
          href="/"
          className="group flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-5 text-center transition-colors hover:border-primary hover:bg-primary/5"
        >
          <Home className="h-5 w-5 text-primary" aria-hidden="true" />
          <span className="text-sm font-semibold text-foreground">Home</span>
          <span className="text-xs text-muted-foreground">Start from the top</span>
        </Link>
        <Link
          href="/portal"
          className="group flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-5 text-center transition-colors hover:border-primary hover:bg-primary/5"
        >
          <Search className="h-5 w-5 text-primary" aria-hidden="true" />
          <span className="text-sm font-semibold text-foreground">Find a contractor</span>
          <span className="text-xs text-muted-foreground">Free for homeowners</span>
        </Link>
        <Link
          href="/contractors"
          className="group flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-5 text-center transition-colors hover:border-primary hover:bg-primary/5"
        >
          <MessageCircle className="h-5 w-5 text-primary" aria-hidden="true" />
          <span className="text-sm font-semibold text-foreground">For contractors</span>
          <span className="text-xs text-muted-foreground">Plans &amp; territories</span>
        </Link>
      </div>

      <p className="mt-8 text-xs text-muted-foreground">
        Still can&apos;t find what you need?{" "}
        <a
          href="mailto:support@henri.app"
          className="underline hover:text-foreground"
        >
          Email support
        </a>
        .
      </p>
    </div>
  );
}
