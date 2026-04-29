"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Trash2, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Card } from "@/components/ui/card";

/**
 * Phase 0a validation-interview mini-CRM.
 *
 * Target: log 15-20 contractor calls before Phase 0b ships. Each call
 * logs the 10 pain points in order of emphasis + the last 3 leads the
 * contractor bought and what happened to them. That's the data that
 * tells us whether "exclusivity" or "pre-permit signal" or "outreach
 * automation" is the actual wedge.
 *
 * UI is intentionally cheap — a list of prior interviews + an inline
 * "New interview" form. Full-blown CRM UI is overkill for a 20-row
 * dataset.
 */

const PAIN_POINTS: Array<{ key: string; label: string }> = [
  { key: "shared_leads", label: "Shared / recycled leads" },
  { key: "fake_leads", label: "Fake / tire-kicker leads" },
  { key: "opaque_pricing", label: "Opaque / runaway pricing" },
  { key: "stale_permit", label: "Stale permit data" },
  { key: "no_intent", label: "No intent signal" },
  { key: "slow_followup", label: "Slow follow-up / speed-to-lead" },
  { key: "labor_mismatch", label: "Labor / scheduling mismatch" },
  { key: "cashflow", label: "Cash flow / lock-in anxiety" },
  { key: "no_market_intel", label: "No market / competitive intelligence" },
  { key: "homeowner_trust", label: "Homeowner trust poisoned" },
];

const OUTCOMES = [
  { key: "not_reached", label: "Never reached" },
  { key: "reached_declined", label: "Reached, declined" },
  { key: "reached_quoted", label: "Quoted" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
  { key: "unknown", label: "Unknown" },
] as const;

interface RankedComplaint {
  rank: number;
  pain: string;
  verbatim?: string;
}

interface LeadOutcome {
  source: string;
  cost?: number;
  outcome?: (typeof OUTCOMES)[number]["key"];
  note?: string;
}

interface Interview {
  id: string;
  contractor_name: string;
  contractor_company: string | null;
  trade: string | null;
  state: string | null;
  years_in_business: number | null;
  crew_size: number | null;
  ranked_complaints: RankedComplaint[] | null;
  last_3_leads: LeadOutcome[] | null;
  notes: string | null;
  interviewed_at: string;
}

export default function InterviewsPage() {
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [loading, setLoading] = useState(true);
  const [migrationPending, setMigrationPending] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/interviews", { credentials: "include" });
      if (!res.ok) return;
      const body = (await res.json()) as {
        interviews: Interview[];
        migrationPending?: boolean;
      };
      setInterviews(body.interviews ?? []);
      setMigrationPending(!!body.migrationPending);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function deleteInterview(id: string) {
    if (!confirm("Delete this interview?")) return;
    await fetch(`/api/interviews?id=${id}`, { method: "DELETE" });
    refresh();
  }

  return (
    <div className="max-w-4xl px-6 py-8">
      <div className="flex items-start justify-between gap-4 mb-2">
        <div>
          <h1 className="font-heading text-2xl font-normal text-foreground">
            Contractor Interviews
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Log 15-20 contractor calls to validate which Phase 0a wedge is the
            actual unlock. We read these before re-planning Phase 0b.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setFormOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:opacity-90 transition-opacity shrink-0"
        >
          <Plus className="h-4 w-4" />
          New interview
        </button>
      </div>

      {migrationPending && (
        <div className="mt-4 rounded-lg border border-warm/30 bg-[rgba(212,162,74,0.08)] px-4 py-3 text-[12px] text-warm">
          <p className="font-semibold">Feature pending</p>
          <p className="mt-0.5 text-muted-foreground">
            Apply migration{" "}
            <code className="font-mono">00033_contractor_interviews.sql</code> to
            enable saving. Existing interviews are hidden until the table
            exists.
          </p>
        </div>
      )}

      {formOpen && (
        <NewInterviewForm
          onSaved={() => {
            setFormOpen(false);
            refresh();
          }}
          onCancel={() => setFormOpen(false)}
        />
      )}

      <div className="mt-6">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-sm font-semibold text-foreground">
            Logged interviews{" "}
            <span className="text-muted-foreground font-normal">
              ({interviews.length})
            </span>
          </h2>
          {interviews.length > 0 && (
            <ProgressBar count={interviews.length} />
          )}
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : interviews.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-bg-subtle px-6 py-10 text-center text-sm text-muted-foreground">
            No interviews logged yet. Click &quot;New interview&quot; after your
            first call to start the log.
          </div>
        ) : (
          <div className="space-y-2">
            {interviews.map((iv) => (
              <InterviewRow key={iv.id} interview={iv} onDelete={() => deleteInterview(iv.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProgressBar({ count }: { count: number }) {
  const target = 20;
  const pct = Math.min(100, (count / target) * 100);
  return (
    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
      <span>{count} / {target}</span>
      <div className="w-24 h-1.5 rounded-full bg-bg-subtle overflow-hidden">
        <div
          className={cn(
            "h-full transition-all",
            count >= target ? "bg-success" : count >= 10 ? "bg-primary" : "bg-warm",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function InterviewRow({
  interview,
  onDelete,
}: {
  interview: Interview;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const when = new Date(interview.interviewed_at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const topComplaint = (interview.ranked_complaints ?? []).find((c) => c.rank === 1);

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-4 py-3 flex items-start gap-3 text-left hover:bg-bg-subtle transition-colors"
      >
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground shrink-0 mt-0.5 transition-transform",
            expanded && "rotate-180",
          )}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground">{interview.contractor_name}</span>
            {interview.contractor_company && (
              <span className="text-xs text-muted-foreground">{interview.contractor_company}</span>
            )}
            {interview.trade && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-primary-08 text-primary text-[10px] font-medium capitalize">
                {interview.trade}
              </span>
            )}
            {interview.state && (
              <span className="text-[10px] text-muted-foreground uppercase">{interview.state}</span>
            )}
            <span className="text-[11px] text-muted-foreground ml-auto">{when}</span>
          </div>
          {topComplaint && (
            <p className="text-[12px] text-muted-foreground mt-1">
              Top complaint:{" "}
              <span className="text-foreground">
                {PAIN_POINTS.find((p) => p.key === topComplaint.pain)?.label ?? topComplaint.pain}
              </span>
            </p>
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-0 border-t border-border bg-bg-subtle/50 space-y-3">
          {(interview.ranked_complaints?.length ?? 0) > 0 && (
            <Section label="Ranked complaints">
              <ol className="space-y-1 text-[12px]">
                {interview.ranked_complaints!.map((c, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-primary font-semibold shrink-0 w-4">{c.rank}.</span>
                    <div>
                      <span className="text-foreground">
                        {PAIN_POINTS.find((p) => p.key === c.pain)?.label ?? c.pain}
                      </span>
                      {c.verbatim && (
                        <p className="text-muted-foreground italic mt-0.5">&ldquo;{c.verbatim}&rdquo;</p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </Section>
          )}
          {(interview.last_3_leads?.length ?? 0) > 0 && (
            <Section label="Last 3 leads">
              <ul className="space-y-1 text-[12px]">
                {interview.last_3_leads!.map((l, i) => (
                  <li key={i} className="flex gap-2 text-muted-foreground">
                    <span className="text-foreground capitalize">{l.source}</span>
                    {l.cost != null && <span>${l.cost}</span>}
                    {l.outcome && (
                      <span>
                        → {OUTCOMES.find((o) => o.key === l.outcome)?.label ?? l.outcome}
                      </span>
                    )}
                    {l.note && <span className="italic">— {l.note}</span>}
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {interview.notes && (
            <Section label="Notes">
              <p className="text-[12px] text-foreground whitespace-pre-wrap">{interview.notes}</p>
            </Section>
          )}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors"
            >
              <Trash2 className="h-3 w-3" />
              Delete
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
        {label}
      </p>
      {children}
    </div>
  );
}

function NewInterviewForm({
  onSaved,
  onCancel,
}: {
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [contractorName, setContractorName] = useState("");
  const [contractorCompany, setContractorCompany] = useState("");
  const [trade, setTrade] = useState("");
  const [state, setState] = useState("");
  const [crewSize, setCrewSize] = useState<string>("");
  const [years, setYears] = useState<string>("");
  const [complaints, setComplaints] = useState<RankedComplaint[]>([
    { rank: 1, pain: "" },
  ]);
  const [leads, setLeads] = useState<LeadOutcome[]>([{ source: "" }]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!contractorName.trim()) {
      setError("Contractor name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/interviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contractor_name: contractorName.trim(),
          contractor_company: contractorCompany.trim() || null,
          trade: trade.trim() || null,
          state: state.trim().toUpperCase() || null,
          years_in_business: years ? parseInt(years, 10) : null,
          crew_size: crewSize ? parseInt(crewSize, 10) : null,
          ranked_complaints: complaints.filter((c) => c.pain),
          last_3_leads: leads.filter((l) => l.source),
          notes: notes.trim() || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? `HTTP ${res.status}`);
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-primary/30 bg-primary-04 p-5 space-y-4">
      <h2 className="text-sm font-semibold text-foreground">New interview</h2>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Contractor name *">
          <input
            type="text"
            value={contractorName}
            onChange={(e) => setContractorName(e.target.value)}
            placeholder="e.g. Mike Rodriguez"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </Field>
        <Field label="Company">
          <input
            type="text"
            value={contractorCompany}
            onChange={(e) => setContractorCompany(e.target.value)}
            placeholder="e.g. Rodriguez Plumbing"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </Field>
        <Field label="Trade">
          <input
            type="text"
            value={trade}
            onChange={(e) => setTrade(e.target.value.toLowerCase())}
            placeholder="roofing / plumbing / hvac / …"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </Field>
        <Field label="State (2-letter)">
          <input
            type="text"
            maxLength={2}
            value={state}
            onChange={(e) => setState(e.target.value)}
            placeholder="CT"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground uppercase focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </Field>
        <Field label="Years in business">
          <input
            type="number"
            min={0}
            value={years}
            onChange={(e) => setYears(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </Field>
        <Field label="Crew size">
          <input
            type="number"
            min={0}
            value={crewSize}
            onChange={(e) => setCrewSize(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </Field>
      </div>

      <Field label="Top complaints (rank highest-emphasis first)">
        <div className="space-y-1.5">
          {complaints.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground w-5 text-right">{c.rank}.</span>
              <select
                value={c.pain}
                onChange={(e) => {
                  const next = [...complaints];
                  next[i] = { ...next[i], pain: e.target.value };
                  setComplaints(next);
                }}
                className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-[12px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">— pick a pain point —</option>
                {PAIN_POINTS.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={c.verbatim ?? ""}
                onChange={(e) => {
                  const next = [...complaints];
                  next[i] = { ...next[i], verbatim: e.target.value };
                  setComplaints(next);
                }}
                placeholder='verbatim quote (optional)'
                className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-[12px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
              {complaints.length > 1 && (
                <button
                  type="button"
                  onClick={() =>
                    setComplaints((cs) =>
                      cs.filter((_, j) => j !== i).map((x, j) => ({ ...x, rank: j + 1 })),
                    )
                  }
                  className="text-[11px] text-muted-foreground hover:text-red-500 px-1"
                >
                  ×
                </button>
              )}
            </div>
          ))}
          {complaints.length < 5 && (
            <button
              type="button"
              onClick={() =>
                setComplaints((cs) => [...cs, { rank: cs.length + 1, pain: "" }])
              }
              className="text-[11px] text-primary hover:underline"
            >
              + add another rank
            </button>
          )}
        </div>
      </Field>

      <Field label="Last 3 leads (source / cost / outcome)">
        <div className="space-y-1.5">
          {leads.map((l, i) => (
            <div key={i} className="grid grid-cols-12 gap-2">
              <input
                type="text"
                value={l.source}
                onChange={(e) => {
                  const next = [...leads];
                  next[i] = { ...next[i], source: e.target.value };
                  setLeads(next);
                }}
                placeholder="angi / referral / permit …"
                className="col-span-4 rounded-lg border border-border bg-background px-3 py-1.5 text-[12px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <input
                type="number"
                min={0}
                value={l.cost ?? ""}
                onChange={(e) => {
                  const next = [...leads];
                  next[i] = { ...next[i], cost: e.target.value ? Number(e.target.value) : undefined };
                  setLeads(next);
                }}
                placeholder="cost"
                className="col-span-2 rounded-lg border border-border bg-background px-3 py-1.5 text-[12px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <select
                value={l.outcome ?? ""}
                onChange={(e) => {
                  const next = [...leads];
                  next[i] = { ...next[i], outcome: (e.target.value || undefined) as LeadOutcome["outcome"] };
                  setLeads(next);
                }}
                className="col-span-3 rounded-lg border border-border bg-background px-3 py-1.5 text-[12px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">outcome</option>
                {OUTCOMES.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={l.note ?? ""}
                onChange={(e) => {
                  const next = [...leads];
                  next[i] = { ...next[i], note: e.target.value };
                  setLeads(next);
                }}
                placeholder="note (optional)"
                className="col-span-2 rounded-lg border border-border bg-background px-3 py-1.5 text-[12px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
              {leads.length > 1 && (
                <button
                  type="button"
                  onClick={() => setLeads((ls) => ls.filter((_, j) => j !== i))}
                  className="col-span-1 text-[11px] text-muted-foreground hover:text-red-500"
                >
                  ×
                </button>
              )}
            </div>
          ))}
          {leads.length < 5 && (
            <button
              type="button"
              onClick={() => setLeads((ls) => [...ls, { source: "" }])}
              className="text-[11px] text-primary hover:underline"
            >
              + add another lead
            </button>
          )}
        </div>
      </Field>

      <Field label="Notes">
        <textarea
          rows={4}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder='Anything else they said that mattered. Direct quotes are gold.'
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
        />
      </Field>

      {error && (
        <p className="text-xs text-red-500" role="alert">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={saving || !contractorName.trim()}
          className="inline-flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold bg-primary text-white hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save interview
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}
