import Link from "next/link";
import { Rocket } from "lucide-react";

/**
 * Coming-soon placeholder used by Phase 3.2 — wraps the four stub tabs
 * (Canvass, Reputation, Financing, Blast) whose UI is scaffolded but
 * whose backend integration isn't ready yet. Shown when the tab is
 * hidden from the topbar via `NEXT_PUBLIC_ENABLE_STUB_TABS`; still
 * reachable by URL so demo links keep working.
 */
export function ComingSoon({
  feature,
  description,
}: {
  feature: string;
  description: string;
}) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center justify-center px-6 py-24 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
        <Rocket className="h-6 w-6 text-primary" />
      </div>
      <h1 className="font-heading text-3xl font-normal tracking-tight text-foreground">
        {feature} is coming soon
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">{description}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link
          href="/dashboard"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        >
          Back to leads
        </Link>
        <a
          href="mailto:founder@meethenri.com?subject=Early access request"
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary"
        >
          Request early access
        </a>
      </div>
    </div>
  );
}

export const STUBS_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_STUB_TABS === "1";
