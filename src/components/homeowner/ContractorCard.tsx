"use client";

import { useState } from "react";
import { CheckCircle, Shield, Clock, Star, Loader2 } from "lucide-react";
import { useContractorSearch, type ContractorSearchResult } from "@/hooks/useContractorSearch";
import { useQuotes } from "@/hooks/useQuotes";

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
  licensedState: string | null;
  licenseVerified: boolean;
  lastVerified: string | null;
  insured: boolean | null;
  backgroundChecked: boolean | null;
  yearsInBusiness: number | null;
  specialties: string[];
}

/* ─── Star Rating ─── */
function StarDisplay({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Star className="h-3.5 w-3.5 fill-[#D4A24A] text-[#D4A24A]" />
      <span className="text-sm font-medium text-foreground">{rating.toFixed(1)}</span>
    </span>
  );
}

/* ─── Verification Badge ─── */
function VerifiedBadge({ label, verified }: { label: string; verified: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
      verified ? "bg-green-500/10 text-green-400" : "bg-zinc-500/10 text-muted-foreground"
    }`}>
      {verified ? <CheckCircle className="h-2.5 w-2.5" /> : <Clock className="h-2.5 w-2.5" />}
      {label}
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

  async function handleSubmit() {
    if (!description.trim() || !contactName.trim() || !zip.trim()) return;
    setSending(true);
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
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-heading font-normal text-foreground">Request a Quote</h2>
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
                <label className="text-xs font-medium text-foreground block mb-1">Your name</label>
                <input type="text" value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Jane Smith"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-foreground block mb-1">Email</label>
                  <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="jane@email.com"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary" />
                </div>
                <div>
                  <label className="text-xs font-medium text-foreground block mb-1">Phone</label>
                  <input type="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="(310) 555-1234"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-foreground block mb-1">ZIP code</label>
                <input type="text" value={zip} onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))} placeholder="90278" maxLength={5}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>
              <div>
                <label className="text-xs font-medium text-foreground block mb-1">Describe your project</label>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="I need a full roof replacement on a 2,000 sqft home..."
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none" />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={onClose} className="flex-1 rounded-lg border border-border px-4 py-2 text-sm hover:bg-bg-subtle transition-colors">
                Cancel
              </button>
              <button onClick={handleSubmit} disabled={!description.trim() || !contactName.trim() || !zip.trim() || sending}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-40">
                {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {sending ? "Sending..." : "Request Quote"}
              </button>
            </div>
          </>
        )}
      </div>
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
        <StarDisplay rating={contractor.rating} />
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

      {/* Verification badges — only render a claim if the API confirmed it.
       * Previously we showed Insured/Background Checked as unverified for
       * every contractor because the defaults were hardcoded false; now
       * we omit the row entirely when null. */}
      <div className="flex flex-wrap gap-1.5">
        <VerifiedBadge
          label={contractor.licensedState ? `Licensed (${contractor.licensedState})` : "Licensed"}
          verified={contractor.licenseVerified}
        />
        {contractor.insured !== null && (
          <VerifiedBadge label="Insured" verified={contractor.insured} />
        )}
        {contractor.backgroundChecked !== null && (
          <VerifiedBadge label="Background Checked" verified={contractor.backgroundChecked} />
        )}
        {contractor.licenseVerified && contractor.lastVerified && (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
            <Shield className="h-2.5 w-2.5" />
            Verified {contractor.lastVerified}
          </span>
        )}
      </div>

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
        className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 transition-opacity"
      >
        Request a Quote
      </button>
    </div>
  );
}

/* ─── Map API response to component shape ─── */
function mapApiContractor(c: ContractorSearchResult): ContractorProfile {
  // Only stamp fields that come from the API. Previously we hardcoded
  // responseTime: "< 24 hrs", licensedState: "CA", insured: false,
  // backgroundChecked: false, yearsInBusiness: 0, specialties: [] —
  // these rendered identically on every contractor and were a
  // truthfulness bug on /homeowner → Find Contractors. The card
  // component already handles nullable fields (omits rows when missing).
  return {
    id: c.id,
    name: c.company_name ?? c.full_name ?? "Contractor",
    trade: c.trade ?? "General",
    rating: c.avg_rating ?? 0,
    reviewCount: c.total_reviews ?? 0,
    responseTime:
      typeof (c as unknown as { response_time_h?: number }).response_time_h === "number"
        ? `~${Math.round((c as unknown as { response_time_h: number }).response_time_h)}h`
        : null,
    completedProjects: c.total_jobs_won ?? 0,
    licensedState:
      (c as unknown as { license_state?: string | null }).license_state ?? null,
    licenseVerified: c.verified ?? false,
    lastVerified: c.verified ? "Verified" : null,
    insured: (c as unknown as { insured?: boolean }).insured ?? null,
    backgroundChecked:
      (c as unknown as { background_checked?: boolean }).background_checked ?? null,
    yearsInBusiness:
      (c as unknown as { years_experience?: number }).years_experience ?? null,
    specialties:
      (c as unknown as { specialties?: string[] }).specialties ?? [],
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
          {trade ? `${trade} Contractors` : "Verified Contractors"} Near You
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          Every contractor on Henri is verified daily — licensed, insured, and background-checked
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
          <p className="mt-1 text-xs text-muted-foreground">
            {zip
              ? "Try a different trade, widen your area, or check back — we add new verified contractors every week."
              : "Add your ZIP in account settings so we can show licensed, insured contractors near you."}
          </p>
          {!zip && (
            <a
              href="/settings/account"
              className="mt-4 inline-block rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90"
            >
              Add your ZIP →
            </a>
          )}
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
