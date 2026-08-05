"use client";

/**
 * Post-intake project page — where a homeowner lands after completing the
 * chat intake flow. Replaces the previous "Done button closes the modal
 * into the void" UX. Shows:
 *
 *  - Intake summary (trade, address, description, score, budget, timeline)
 *  - Matched contractor card with real fields from /api/intake/[id]/matches
 *  - Expected contact window
 *  - Status timeline (submitted → matched → call scheduled → in progress)
 *
 * This page is also linkable from the homeowner dashboard's "My Projects"
 * list so intakes are discoverable forever.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Clock,
  CheckCircle,
  MessageSquare,
  Phone,
  Mail,
  Star,
  Briefcase,
  XCircle,
} from "lucide-react";
import { useUser } from "@/hooks/useUser";

type IntakeDetail = {
  id: string;
  zip: string;
  trade: string;
  timeline: string | null;
  budget_range: string | null;
  description: string | null;
  refinement_answers: Array<{ q: string; a: string }> | null;
  henri_score: number | null;
  status: string;
  created_at: string;
  matched_contractor_id: string | null;
  matched_lead_id: string | null;
  contact: {
    name: string | null;
    phone: string | null;
    email: string | null;
  };
};

type Match = {
  contractor_id: string;
  rank: number;
  is_primary: boolean;
  company_name: string;
  rating: number;
  review_count: number;
  response_time: string;
  jobs_completed: number;
  /* `badges` (licensed / insured / background_checked) is gone from
   * /api/intake/[id]/matches: it was read off profiles.badge_* columns
   * that nothing writes — and one of which isn't a column at all — so it
   * advertised three checks Henri never ran. Henri collects no insurance
   * or background data, so nothing honest replaces it here. */
  has_portfolio: boolean;
};

type MatchesResponse = {
  intake_id: string;
  trade: string;
  zip: string;
  status: string;
  match_count: number;
  matches: Match[];
};

const STATUS_STEPS = [
  { key: "pending", label: "Submitted" },
  { key: "matched", label: "Contractor matched" },
  { key: "in_progress", label: "Call scheduled" },
  { key: "completed", label: "Project complete" },
] as const;

export default function HomeownerIntakePage() {
  const { id } = useParams() as { id: string };
  const { user, loading: userLoading } = useUser();
  const [intake, setIntake] = useState<IntakeDetail | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [withdrawBusy, setWithdrawBusy] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  useEffect(() => {
    if (userLoading) return;
    if (!user) {
      // Auth resolved with no user. Previously this returned early and
      // `loading` never cleared, pinning the page on skeleton bars
      // forever with no message and no way out.
      setLoading(false);
      setError("Sign in with the email you used for this project to view it.");
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        const [detailRes, matchesRes] = await Promise.all([
          fetch(`/api/intake/${id}`),
          fetch(`/api/intake/${id}/matches`),
        ]);

        if (detailRes.status === 403) {
          if (!cancelled) setError("You don't have access to this project.");
          return;
        }
        if (detailRes.status === 404 || !detailRes.ok) {
          if (!cancelled) setError("Project not found.");
          return;
        }

        const detail = (await detailRes.json()) as IntakeDetail;
        const matchesBody = matchesRes.ok
          ? ((await matchesRes.json()) as MatchesResponse)
          : null;

        if (!cancelled) {
          setIntake(detail);
          setMatches(matchesBody?.matches ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load project.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, user, userLoading]);

  if (loading || userLoading) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-12">
        <div className="h-6 w-32 animate-pulse rounded bg-muted" />
        <div className="mt-6 h-40 animate-pulse rounded-lg bg-muted" />
        <div className="mt-4 h-40 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  if (error || !intake) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-12">
        <Link
          href="/homeowner"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to dashboard
        </Link>
        <div className="mt-8 rounded-lg border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive">
          {error ?? "Project not found."}
        </div>
      </div>
    );
  }

  async function handleWithdraw() {
    if (!intake) return;
    const confirmed = window.confirm(
      "Withdraw this project? Your matched contractor will no longer be able to reach out, and any pending outreach will be cancelled. You can submit a new project anytime.",
    );
    if (!confirmed) return;

    setWithdrawBusy(true);
    setWithdrawError(null);
    try {
      const res = await fetch(`/api/intake/${intake.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "withdraw" }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setWithdrawError(body?.error ?? "Failed to withdraw project.");
        return;
      }
      setIntake({ ...intake, status: "withdrawn" });
    } catch (err) {
      setWithdrawError(err instanceof Error ? err.message : "Failed to withdraw project.");
    } finally {
      setWithdrawBusy(false);
    }
  }

  const primary = matches.find((m) => m.is_primary) ?? matches[0] ?? null;
  const isWithdrawn = intake.status === "withdrawn";
  const statusIndex = Math.max(
    0,
    STATUS_STEPS.findIndex((s) => s.key === intake.status),
  );
  const createdLocal = new Date(intake.created_at).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  // Expected-contact window: submission + 1h if matched, +24h otherwise.
  // Only meaningful while it's still in the future — an intake submitted
  // three weeks ago used to render "Expected contact by Tue 3:00 PM"
  // pointing at a moment three weeks in the past.
  const expected = new Date(intake.created_at);
  expected.setHours(expected.getHours() + (intake.status === "matched" ? 1 : 24));
  const expectedIsFuture = expected.getTime() > Date.now();
  const expectedLabel = expected.toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <Link
        href="/homeowner"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to dashboard
      </Link>

      <header className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-normal tracking-tight text-foreground">
            Your {intake.trade} project
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Submitted {createdLocal} · ZIP {intake.zip}
          </p>
        </div>
        {intake.henri_score != null && (
          <div className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            Henri score {intake.henri_score}/100
          </div>
        )}
      </header>

      {isWithdrawn && (
        <div
          role="status"
          className="mt-6 rounded-lg border border-border bg-bg-subtle px-4 py-3 text-sm text-muted-foreground"
        >
          <p>
            <strong className="text-foreground">Project withdrawn.</strong>{" "}
            Your matched contractor can no longer reach out, and any pending
            outreach has been cancelled. You can{" "}
            <Link href="/portal" className="text-primary hover:underline">
              start a new project
            </Link>{" "}
            anytime.
          </p>
        </div>
      )}

      {/* Status timeline */}
      <ol className="mt-8 flex flex-wrap items-center gap-2" aria-label="Project status">
        {STATUS_STEPS.map((step, idx) => {
          const active = !isWithdrawn && idx <= statusIndex;
          return (
            <li
              key={step.key}
              className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${
                active
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground"
              }`}
            >
              {active ? (
                <CheckCircle className="h-3.5 w-3.5" />
              ) : (
                <Clock className="h-3.5 w-3.5" />
              )}
              {step.label}
            </li>
          );
        })}
      </ol>

      {/* Primary match card */}
      {primary ? (
        <section className="mt-8 rounded-xl border border-border bg-card p-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Matched contractor
          </h2>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-heading text-xl text-foreground">
                {primary.company_name}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                {primary.rating > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <Star className="h-3.5 w-3.5 fill-current text-primary" />
                    {primary.rating.toFixed(1)} ({primary.review_count})
                  </span>
                )}
                {primary.jobs_completed > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <Briefcase className="h-3.5 w-3.5" />
                    {primary.jobs_completed} jobs
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Response time {primary.response_time}
              </p>
            </div>
            <div className="flex gap-2">
              <Link
                href={`/contractors/${primary.contractor_id}`}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
              >
                View profile
              </Link>
              {intake.matched_lead_id && (
                <Link
                  href={`/homeowner/messages?thread=${intake.matched_lead_id}`}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-cta px-4 py-2 text-sm font-semibold text-cta-foreground transition-opacity hover:opacity-90"
                >
                  <MessageSquare className="h-4 w-4" /> Message
                </Link>
              )}
            </div>
          </div>
          {/* Copy fix 2026-08-04: promised "an email and SMS when they
              reach out". There is no such notification — nothing watches
              for contractor outreach, and SMS depends on Twilio, which
              isn't provisioned. Say what the homeowner can actually rely
              on: the contractor has their details, and the message thread
              lives here. Also stop rendering a past-dated "expected by". */}
          <p className="mt-4 rounded-md bg-bg-subtle p-3 text-xs text-muted-foreground">
            {expectedIsFuture ? (
              <>
                They usually reach out by <strong>{expectedLabel}</strong>.{" "}
              </>
            ) : (
              <>Haven&apos;t heard from them yet? </>
            )}
            {intake.matched_lead_id ? (
              <>
                You can message them directly from this page &mdash; replies show
                up in{" "}
                <Link href="/homeowner/messages" className="text-primary hover:underline">
                  Messages
                </Link>
                .
              </>
            ) : (
              <>They have your contact details and will call or email you.</>
            )}
          </p>
        </section>
      ) : (
        <section className="mt-8 rounded-xl border border-dashed border-border bg-card p-6 text-center">
          {/* "You'll get an email within 24 hours" was an SLA nothing
              enforces — no job or cron chases unmatched intakes. */}
          <p className="text-sm text-muted-foreground">
            We&apos;re still matching your project with a local contractor.
            Check back here &mdash; this page updates as soon as one is assigned.
          </p>
        </section>
      )}

      {/* Project details */}
      <section className="mt-8 rounded-xl border border-border bg-card p-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Project details
        </h2>
        <dl className="grid grid-cols-1 gap-y-3 sm:grid-cols-2 sm:gap-x-6">
          {intake.budget_range && (
            <Row label="Budget" value={intake.budget_range} />
          )}
          {intake.timeline && (
            <Row label="Timeline" value={intake.timeline} />
          )}
          <Row label="Trade" value={intake.trade} />
          <Row label="Location" value={`ZIP ${intake.zip}`} />
        </dl>
        {intake.description && (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Description
            </p>
            <p className="mt-1 text-sm text-foreground">{intake.description}</p>
          </div>
        )}
        {intake.refinement_answers && intake.refinement_answers.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Follow-up answers
            </p>
            {intake.refinement_answers.map((r, i) => (
              <div key={i} className="rounded-md bg-bg-subtle p-3">
                <p className="text-xs text-muted-foreground">{r.q}</p>
                <p className="mt-1 text-sm text-foreground">{r.a}</p>
              </div>
            ))}
          </div>
        )}
        {/* Photos section removed 2026-06-10 — the intake flow never
            persisted photo files (names were collected then dropped), so
            this section could never populate. The photo step itself was
            removed from ChatIntakeModal in the same change. */}
      </section>

      {/* Withdraw / opt-out — appears unless already withdrawn or completed.
          Withdrawal sets status='withdrawn' and clears consent_given_at, which
          the outreach hygiene gate (`src/lib/outreach/hygiene.ts`) reads to
          refuse any further SMS / email targeting this intake. */}
      {!isWithdrawn && intake.status !== "completed" && (
        <section className="mt-8 rounded-xl border border-border bg-card p-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Privacy controls
          </h2>
          <p className="text-sm text-muted-foreground">
            You authorized Henri to share your contact info with one matched
            contractor in your territory. You can withdraw that authorization
            at any time — your matched contractor will stop receiving outreach
            on this project.
          </p>
          {withdrawError && (
            <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {withdrawError}
            </p>
          )}
          <button
            type="button"
            onClick={handleWithdraw}
            disabled={withdrawBusy}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-destructive/50 hover:bg-destructive/5 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-60"
          >
            <XCircle className="h-4 w-4" />
            {withdrawBusy ? "Withdrawing…" : "Withdraw this project"}
          </button>
        </section>
      )}

      {/* Contact block */}
      {intake.contact.email && (
        <section className="mt-8 rounded-xl border border-border bg-card p-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Your contact details
          </h2>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-foreground">
            {intake.contact.name && (
              <span>{intake.contact.name}</span>
            )}
            {intake.contact.phone && (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <Phone className="h-3.5 w-3.5" /> {intake.contact.phone}
              </span>
            )}
            {intake.contact.email && (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <Mail className="h-3.5 w-3.5" /> {intake.contact.email}
              </span>
            )}
          </div>
          {/* /settings/account is the CONTRACTOR settings surface; a
              homeowner sent there gets a contractor-shaped page. Point at
              the control that actually applies to them instead. */}
          <p className="mt-3 text-xs text-muted-foreground">
            Only your matched contractor can see this. To stop sharing it, use
            Withdraw this project above.
          </p>
        </section>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-foreground">{value}</dd>
    </div>
  );
}
