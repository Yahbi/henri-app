"use client";

import { useEffect, useState } from "react";
import { CheckCircle, Shield, Star, Loader2 } from "lucide-react";
import { useContractorSearch, type ContractorSearchResult } from "@/hooks/useContractorSearch";
import { useQuotes } from "@/hooks/useQuotes";
import { FocusTrap } from "@/components/ui/focus-trap";

/* ─── Types ─── */
interface ContractorProfile {
  id: string;
  name: string;
  trade: string;
  rating: number;
  reviewCount: number;
  // All of the following allow null so the card can OMIT the row when
  // we don't have real data rather than rendering a hardcoded default
  // that's identical on every contractor.
  responseTime: string | null;
  completedProjects: number;
  // Licence fields mirror the API's trust block. There is no `insured` or
  // `backgroundChecked` here on purpose: Henri collects neither signal, so
  // any value the card could show would be an assertion it can't back.
  licensedState: string | null;
  licenseVerified: boolean;
  lastVerified: string | null;
  yearsInBusiness: number | null;
  specialties: string[];
}

/* ─── Star Rating ─── */
function StarDisplay({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Star className="h-3.5 w-3.5 fill-warm text-warm" />
      <span className="text-sm font-medium text-foreground">{rating.toFixed(1)}</span>
    </span>
  );
}

/* ─── Licence Badge ───
 * Rendered only when the state-roster cross-check actually matched. There is
 * deliberately no "pending" variant: a greyed-out badge sitting under a
 * contractor's name still reads as a Henri-issued credential, and for a
 * contractor whose licence never matched a roster there is nothing to
 * credential. Absence is the honest state. */
function LicensedBadge({ state }: { state: string | null }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-400">
      <CheckCircle className="h-2.5 w-2.5" />
      {state ? `Licensed (${state})` : "Licensed"}
    </span>
  );
}

/* ─── Quote Request Modal ─── */
function QuoteRequestModal({ contractor, onClose }: { contractor: ContractorProfile; onClose: () => void }) {
  const { requestQuote } = useQuotes();
  const [description, setDescription] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [zip, setZip] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  // requestQuote returning success:false used to do nothing at all — the
  // button simply re-enabled and the homeowner had no idea the request
  // never left.
  const [sendError, setSendError] = useState<string | null>(null);

  // Escape closes the dialog (WCAG 2.1 / expected dialog behaviour).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function handleSubmit() {
    if (!description.trim() || !contactName.trim() || !zip.trim()) return;
    setSending(true);
    setSendError(null);
    const result = await requestQuote({
      contractor_id: contractor.id,
      trade: contractor.trade,
      zip,
      description,
      contact_name: contactName,
      contact_email: contactEmail,
      contact_phone: contactPhone,
    });
    setSending(false);
    if (result.success) {
      setSent(true);
      setTimeout(onClose, 2000);
      return;
    }
    setSendError(
      result.error ?? "We couldn't send your quote request. Please try again.",
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quote-modal-title"
    >
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <FocusTrap active>
      <div className="relative z-10 w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 id="quote-modal-title" className="text-lg font-heading font-normal text-foreground">
              Request a Quote
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">from {contractor.name}</p>
          </div>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-bg-subtle" aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 2l12 12M14 2L2 14" /></svg>
          </button>
        </div>

        {sent ? (
          <div className="rounded-lg bg-green-500/10 p-4 text-center">
            <p className="text-sm font-medium text-green-400">Quote request sent</p>
            <p className="text-xs text-muted-foreground mt-1">
              {contractor.name} will respond soon{contractor.responseTime ? ` (${contractor.responseTime})` : ""}
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <div>
                <label htmlFor="quote-name" className="text-xs font-medium text-foreground block mb-1">Your name</label>
                <input id="quote-name" type="text" value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Jane Smith"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="quote-email" className="text-xs font-medium text-foreground block mb-1">Email</label>
                  <input id="quote-email" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="jane@email.com"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary" />
                </div>
                <div>
                  <label htmlFor="quote-phone" className="text-xs font-medium text-foreground block mb-1">Phone</label>
                  <input id="quote-phone" type="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="(310) 555-1234"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary" />
                </div>
              </div>
              <div>
                <label htmlFor="quote-zip" className="text-xs font-medium text-foreground block mb-1">ZIP code</label>
                <input id="quote-zip" type="text" inputMode="numeric" value={zip} onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))} placeholder="90278" maxLength={5}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>
              <div>
                <label htmlFor="quote-description" className="text-xs font-medium text-foreground block mb-1">Describe your project</label>
                <textarea id="quote-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="I need a full roof replacement on a 2,000 sqft home..."
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none" />
              </div>
            </div>
            {sendError && (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                {sendError}
              </p>
            )}
            <div className="flex gap-2">
              <button onClick={onClose} className="flex-1 rounded-lg border border-border px-4 py-2 text-sm hover:bg-bg-subtle transition-colors">
                Cancel
              </button>
              <button onClick={handleSubmit} disabled={!description.trim() || !contactName.trim() || !zip.trim() || sending}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-cta px-4 py-2 text-sm text-cta-foreground font-medium hover:opacity-90 transition-opacity disabled:opacity-40">
                {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {sending ? "Sending..." : "Request Quote"}
              </button>
            </div>
          </>
        )}
      </div>
      </FocusTrap>
    </div>
  );
}

/* ─── Single Contractor Card ─── */
function ContractorProfileCard({ contractor, onRequestQuote }: {
  contractor: ContractorProfile;
  onRequestQuote: (contractor: ContractorProfile) => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4 hover:border-primary/30 transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-heading font-normal text-foreground">{contractor.name}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {contractor.trade}
            {contractor.yearsInBusiness && contractor.yearsInBusiness > 0
              ? ` · ${contractor.yearsInBusiness} years in business`
              : ""}
          </p>
        </div>
        {/* A contractor with no reviews rendered "0.0" next to a star,
            which reads as a terrible rating rather than "no reviews yet". */}
        {contractor.reviewCount > 0 && contractor.rating > 0 ? (
          <StarDisplay rating={contractor.rating} />
        ) : (
          <span className="text-xs text-muted-foreground">No reviews yet</span>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="text-center rounded-lg bg-bg-subtle p-2">
          <p className="text-lg font-heading font-normal text-foreground">{contractor.reviewCount}</p>
          <p className="text-[10px] text-muted-foreground">Reviews</p>
        </div>
        <div className="text-center rounded-lg bg-bg-subtle p-2">
          <p className="text-lg font-heading font-normal text-foreground">{contractor.completedProjects}</p>
          <p className="text-[10px] text-muted-foreground">Henri Jobs</p>
        </div>
        <div className="text-center rounded-lg bg-bg-subtle p-2">
          <p className="text-lg font-heading font-normal text-foreground">{contractor.responseTime ?? "—"}</p>
          <p className="text-[10px] text-muted-foreground">Response</p>
        </div>
      </div>

      {/* Trust row — one claim, and only when the roster match is real.
       * The Insured / Background Checked badges that used to sit here were
       * driven by `profiles.badge_insured` / `badge_background`, columns no
       * code path has ever written (migration 00117 locked them for exactly
       * that reason). Henri runs neither check, so the badges are gone
       * rather than wired up. */}
      {contractor.licenseVerified && (
        <div className="flex flex-wrap gap-1.5">
          <LicensedBadge state={contractor.licensedState} />
          {contractor.lastVerified && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
              <Shield className="h-2.5 w-2.5" />
              Roster-checked {contractor.lastVerified}
            </span>
          )}
        </div>
      )}

      {/* Specialties */}
      {contractor.specialties.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {contractor.specialties.map((s) => (
            <span key={s} className="rounded-md bg-bg-subtle px-2 py-0.5 text-[10px] text-muted-foreground">
              {s}
            </span>
          ))}
        </div>
      )}

      {/* CTA */}
      <button
        onClick={() => onRequestQuote(contractor)}
        className="w-full rounded-lg bg-cta px-4 py-2.5 text-sm font-medium text-cta-foreground hover:opacity-90 transition-opacity"
      >
        Request a Quote
      </button>
    </div>
  );
}

/* ─── Map API response to component shape ─── */

/** "Mar 2026", or null when the timestamp is absent or unparseable. */
function formatVerifiedMonth(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

/**
 * `ContractorSearchResult` is now imported from the route that produces it
 * (via the hook's re-export), so the field names here are checked against the
 * real payload at compile time. The previous version of this function read
 * every field twice — once under the hook's stale name, once under the
 * route's actual name — because the two had drifted and nothing caught it.
 *
 * Fields the API can't supply stay null; the card omits those rows rather
 * than rendering a hardcoded default identical on every contractor.
 */
function mapApiContractor(c: ContractorSearchResult): ContractorProfile {
  return {
    id: c.id,
    name: c.company_name ?? c.full_name ?? "Contractor",
    trade: c.trade ?? "General",
    rating: c.avg_rating ?? 0,
    reviewCount: c.review_count ?? 0,
    responseTime:
      typeof c.response_time_h === "number"
        ? `~${Math.round(c.response_time_h)}h`
        : null,
    completedProjects: c.jobs_completed ?? 0,
    licensedState: c.license_state,
    licenseVerified: c.license_verified,
    lastVerified: formatVerifiedMonth(c.license_verified_at),
    yearsInBusiness: c.years_experience,
    specialties: c.specialties ?? [],
  };
}

/* ─── Exported Component ─── */
interface ContractorListProps {
  trade?: string;
  zip?: string;
}

export function ContractorList({ trade, zip }: ContractorListProps) {
  const { contractors: apiContractors, isLoading } = useContractorSearch(zip ?? "", trade);
  const [quoteTarget, setQuoteTarget] = useState<ContractorProfile | null>(null);

  /* Map API data to component shape */
  const contractors: ContractorProfile[] = apiContractors.map(mapApiContractor);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-heading font-normal text-foreground">
          {trade ? `${trade} Contractors` : "Contractors"} Near You
        </h2>
        {/* TRUTHFULNESS FIX 2026-08-04 — this read "Every contractor on
         * Henri is verified daily — licensed, insured, and
         * background-checked". All three claims were unbacked, and this
         * one is homeowner-safety-facing:
         *   - "verified daily": src/lib/license/verify.ts never contacts
         *     a licensing board; every path returns "pending".
         *   - "insured": `badge_insured` exists as a column defaulting to
         *     false and is never written by onboarding or any other path.
         *   - "background-checked": no such check exists anywhere.
         * The card body already omits per-contractor badges it can't
         * substantiate; the header contradicted it. Replaced with the one
         * thing we actually do. */}
        <p className="text-xs text-muted-foreground mt-1">
          Contractors give us a license number at signup, which we cross-check
          against the public state license roster where one is available. Badges
          below show only what we&apos;ve confirmed — always ask to see current
          license and insurance before hiring.
        </p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-5 space-y-4 animate-pulse">
              <div className="h-5 w-32 bg-bg-subtle rounded" />
              <div className="h-3 w-24 bg-bg-subtle rounded" />
              <div className="grid grid-cols-3 gap-3">
                {[...Array(3)].map((_, j) => (
                  <div key={j} className="h-14 bg-bg-subtle rounded-lg" />
                ))}
              </div>
              <div className="h-10 bg-bg-subtle rounded-lg" />
            </div>
          ))}
        </div>
      ) : contractors.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <p className="text-sm font-medium text-foreground">
            {zip ? "No contractors found in this area" : "Set your ZIP to see local contractors"}
          </p>
          {/* "we add new verified contractors every week" was an invented
              cadence, and "licensed, insured" repeated the unbacked
              insurance claim. Both removed 2026-08-04. */}
          <p className="mt-1 text-xs text-muted-foreground">
            {zip
              ? "Try a different trade, widen your area, or check back later — coverage grows as contractors join."
              : "Add your ZIP so we can show contractors serving your area."}
          </p>
          {/* The "Add your ZIP" CTA pointed at /settings/account, which is
              the contractor settings surface — a homeowner following it
              lands on a page built for a different role. Removed until a
              homeowner profile editor exists; flagged in the audit. */}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {contractors.map((c) => (
            <ContractorProfileCard key={c.id} contractor={c} onRequestQuote={setQuoteTarget} />
          ))}
        </div>
      )}

      {/* Quote Request Modal */}
      {quoteTarget && <QuoteRequestModal contractor={quoteTarget} onClose={() => setQuoteTarget(null)} />}
    </div>
  );
}
