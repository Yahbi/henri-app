import { ShieldCheck, FileCheck, Ban, Lock, Database } from "lucide-react";

/**
 * Honest trust section for the landing page.
 *
 * IMPORTANT: Per CLAUDE.md, we do not fabricate testimonials, ROI figures,
 * "X contractors won Y" claims, or fake ratings. Everything here describes
 * real product promises + operational facts that can be traced back to
 * code, the live DB, or operational config.
 *
 * 2026-04-30 truthfulness pass — removed three pillars that overclaimed:
 *   - "Exclusive leads, not shared" (14-day window) — no UI path acquires
 *     the lock + no forfeit cron, so the claim was unbacked. See plan
 *     ~/.claude/plans/whats-the-14-days-purring-papert.md.
 *   - "Use-it-or-lose-it" (72h auto-release) — no cron flips locks to
 *     'forfeit'; the column exists but nothing reads it.
 *   - "Minutes, not days" (instant scoring) — cron is daily on Hobby
 *     plan ('0 2 * * *'), not minute-level. Replaced with a daily-cadence
 *     pillar that maps directly to vercel.json.
 *
 * When we have real customer testimonials cleared by legal, we can add a
 * separate <Testimonials> section. Until then, we lead with proof points
 * that ARE true today.
 */

const PILLARS = [
  {
    icon: ShieldCheck,
    title: "License verified daily",
    body: "We re-verify your license every 24 hours against the state board. If it lapses, we pause your leads until it's current.",
  },
  {
    icon: FileCheck,
    title: "Transparent scoring",
    body: "Every lead shows the six signals behind its score — freshness, value, contact quality, demand, engagement, conversion. No black box.",
  },
  {
    icon: Database,
    title: "Sourced from public permits",
    body: "Every lead starts from a real building permit filed with a city or county — not a homeowner form fill resold to multiple contractors. We refresh the catalog daily.",
  },
  {
    icon: Ban,
    title: "Cancel anytime",
    body: "No contracts, no lock-in, no per-lead fees. Cancel at end of cycle and keep every piece of data you've built.",
  },
];

export function TrustSignals() {
  return (
    <section
      className="border-t border-border bg-background py-24 lg:py-32"
      aria-labelledby="trust-heading"
    >
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-primary">
            Built on proof, not promises
          </p>
          <h2
            id="trust-heading"
            className="mt-4 font-heading text-4xl font-normal tracking-tight text-foreground sm:text-5xl"
          >
            Why contractors trust Henri with their pipeline
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Every promise below is enforced in code, not in a pitch deck. The
            guarantees are the product.
          </p>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {PILLARS.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="group rounded-2xl border border-border bg-card p-6 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
            >
              <div
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary"
                aria-hidden="true"
              >
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 font-heading text-xl font-normal text-foreground">
                {title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {body}
              </p>
            </div>
          ))}
        </div>

        {/* Security + compliance strip */}
        <div className="mt-16 flex flex-wrap items-center justify-center gap-x-8 gap-y-4 rounded-2xl border border-border bg-card/60 px-6 py-6 text-xs sm:text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-primary" aria-hidden="true" />
            <span>
              <span className="font-semibold text-foreground">TLS + AES-256</span>{" "}
              at rest and in transit
            </span>
          </div>
          <span aria-hidden="true" className="hidden h-4 w-px bg-border sm:block" />
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
            <span>
              <span className="font-semibold text-foreground">Passwordless</span>{" "}
              sign-in — no passwords to leak
            </span>
          </div>
          <span aria-hidden="true" className="hidden h-4 w-px bg-border sm:block" />
          <div className="flex items-center gap-2">
            <FileCheck className="h-4 w-4 text-primary" aria-hidden="true" />
            <span>
              <span className="font-semibold text-foreground">24-hour</span> free
              trial, cancel anytime
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
