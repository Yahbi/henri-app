"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Bell, Plus, Trash2, RefreshCw } from "lucide-react";
import { STAGE_LABEL_MAP } from "@/lib/intent/stage-colors";

/**
 * /dashboard/settings/alerts
 *
 * Module 14 — per-contractor alert rules. Lists existing rules with
 * enable/disable toggle, channel + criteria editor, and a "+ New rule"
 * form at the top. Mirrors the visual language of /dashboard/settings/
 * data-health and /dashboard/settings/news-triggers (CLAUDE.md "do not
 * add new top-level tabs" — deepen existing tabs).
 *
 * Path note: was originally `/dashboard/settings/notifications` but
 * Next.js 16 Turbopack collapsed it with the pre-existing
 * `(dashboard)/settings/notifications` (per-channel toggles) inside
 * the same route group. Renamed to `/alerts` so both routes coexist.
 *
 * The evaluator that fires these rules lives in src/lib/alerts/. The
 * score cron + intake handler call into it on lead create / match.
 */

interface AlertRule {
  id: string;
  kind: "high_score" | "permit_no_contractor" | "homeowner_match" | "stage_change";
  criteria: Record<string, unknown>;
  enabled: boolean;
  channel: "email" | "sms" | "none";
  last_fired_at: string | null;
  fire_count: number;
  created_at: string;
}

const KIND_LABELS: Record<AlertRule["kind"], string> = {
  high_score: "High-score lead",
  permit_no_contractor: "Permit filed, no contractor",
  homeowner_match: "Homeowner-submitted match",
  stage_change: "Stage transition",
};

const KIND_DESCRIPTIONS: Record<AlertRule["kind"], string> = {
  high_score: "Fires when a new lead in your territory crosses a score threshold.",
  permit_no_contractor: "Fires when a new permit is filed in your territory with no contractor listed.",
  homeowner_match: "Fires when a homeowner submits an intake matching your trade.",
  stage_change: "Fires when a lead transitions into a target opportunity stage.",
};

function fmtRelative(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return iso.slice(0, 10);
  const min = Math.round(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

export default function NotificationsPage() {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creatingKind, setCreatingKind] = useState<AlertRule["kind"]>("high_score");
  const [creatingBusy, setCreatingBusy] = useState(false);
  const [draftCriteria, setDraftCriteria] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/alerts/rules");
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? `HTTP ${res.status}`);
        setRules([]);
        return;
      }
      const body = (await res.json()) as { rules: AlertRule[] };
      setRules(body.rules ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load rules");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Shared non-2xx handler so no mutation can fail silently. */
  async function reportFailure(res: Response, fallback: string) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    setError(body?.error ?? `${fallback} (HTTP ${res.status})`);
  }

  // A stage_change rule with no target stage matches nothing useful —
  // the form labelled "To stage (required)" but never enforced it, so
  // "Create rule" happily produced a dead `any → any` rule.
  const createDisabled =
    creatingBusy || (creatingKind === "stage_change" && !draftCriteria.to);

  async function createRule() {
    if (creatingKind === "stage_change" && !draftCriteria.to) {
      setError("Pick a target stage before creating a stage-transition rule.");
      return;
    }
    setCreatingBusy(true);
    setError(null);
    try {
      const criteria = buildCriteria(creatingKind, draftCriteria);
      const res = await fetch("/api/alerts/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: creatingKind, criteria, enabled: true, channel: "email" }),
      });
      if (!res.ok) {
        await reportFailure(res, "Couldn't create the rule");
        return;
      }
      setDraftCriteria({});
      await refresh();
    } catch (err) {
      // The try had no catch — a network throw here escaped as an
      // unhandled rejection and the UI showed nothing at all.
      setError(err instanceof Error ? err.message : "Couldn't create the rule.");
    } finally {
      setCreatingBusy(false);
    }
  }

  async function toggleEnabled(rule: AlertRule, next: boolean) {
    try {
      const res = await fetch(`/api/alerts/rules?id=${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) {
        await reportFailure(res, "Couldn't update the rule");
        return;
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update the rule.");
    }
  }

  async function changeChannel(rule: AlertRule, channel: AlertRule["channel"]) {
    try {
      const res = await fetch(`/api/alerts/rules?id=${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel }),
      });
      // Previously `if (!res.ok) return;` — the select snapped back to
      // its old value on the next refresh with no explanation.
      if (!res.ok) {
        await reportFailure(res, "Couldn't change the channel");
        return;
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't change the channel.");
    }
  }

  async function deleteRule(rule: AlertRule) {
    if (!window.confirm("Delete this alert rule? This can't be undone.")) return;
    try {
      const res = await fetch(`/api/alerts/rules?id=${rule.id}`, { method: "DELETE" });
      if (!res.ok) {
        await reportFailure(res, "Couldn't delete the rule");
        return;
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete the rule.");
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <Link
        href="/dashboard/settings"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to settings
      </Link>

      <header className="mt-6 flex items-end justify-between">
        <div>
          <h1 className="font-heading text-2xl font-normal tracking-tight text-foreground">
            <Bell className="inline-block h-5 w-5 mr-2 -mt-1 text-primary" />
            Alerts
          </h1>
          {/* Honest timing. Homeowner-match rules genuinely fire on
           * submit (the /api/intake handler evaluates inline). The
           * permit-derived kinds are evaluated by the scoring run, and
           * `dispatchAlertHits` suppresses a repeat fire of the same
           * rule within 24h. The previous copy ("the moment", "real
           * time") promised neither of those constraints. */}
          <p className="mt-1 text-sm text-muted-foreground">
            Email or SMS when a lead matches your criteria. Homeowner-match
            rules fire as soon as the homeowner submits; permit-based rules
            fire when the daily scoring run picks up new permits. Each rule
            sends at most once every 24 hours.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm text-muted-foreground hover:bg-accent transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </header>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {/* New rule form */}
      <section className="mt-8 rounded-xl border border-border bg-card p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Add a new rule
        </h2>
        <div className="mt-4 space-y-4">
          <div>
            <label className="text-xs text-muted-foreground" htmlFor="kind-select">
              When should I be notified?
            </label>
            <select
              id="kind-select"
              value={creatingKind}
              onChange={(e) => {
                setCreatingKind(e.target.value as AlertRule["kind"]);
                setDraftCriteria({});
              }}
              className="mt-1 w-full text-sm rounded-lg border border-border bg-card px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              {(Object.keys(KIND_LABELS) as AlertRule["kind"][]).map((k) => (
                <option key={k} value={k}>{KIND_LABELS[k]}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              {KIND_DESCRIPTIONS[creatingKind]}
            </p>
          </div>

          <CriteriaEditor
            kind={creatingKind}
            draft={draftCriteria}
            onChange={setDraftCriteria}
          />

          <button
            type="button"
            onClick={createRule}
            disabled={createDisabled}
            className="inline-flex items-center gap-1.5 rounded-lg bg-cta px-4 py-2 text-sm font-medium text-cta-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            <Plus className="h-3.5 w-3.5" />
            {creatingBusy ? "Creating…" : "Create rule"}
          </button>
          <p className="text-xs text-muted-foreground">
            New rules start on the Email channel. Switch a rule to SMS below —
            SMS needs a mobile number on your profile.
          </p>
        </div>
      </section>

      {/* Existing rules */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          My rules ({rules.length})
        </h2>
        {loading ? (
          <div className="mt-4 h-24 animate-pulse rounded-lg bg-muted" />
        ) : rules.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
            No alert rules yet. Add one above to get notified.
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {rules.map((rule) => (
              <div
                key={rule.id}
                className="rounded-xl border border-border bg-card p-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {KIND_LABELS[rule.kind]}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {summariseCriteria(rule.kind, rule.criteria)}
                  </p>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Fired {rule.fire_count}× · last {fmtRelative(rule.last_fired_at)}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <select
                    value={rule.channel}
                    onChange={(e) => changeChannel(rule, e.target.value as AlertRule["channel"])}
                    className="text-xs rounded-md border border-border bg-card px-2 py-1.5 text-foreground"
                    aria-label="Channel"
                  >
                    <option value="email">Email</option>
                    <option value="sms">SMS</option>
                    <option value="none">Off</option>
                  </select>
                  <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={(e) => toggleEnabled(rule, e.target.checked)}
                    />
                    {rule.enabled ? "Enabled" : "Disabled"}
                  </label>
                  <button
                    type="button"
                    onClick={() => deleteRule(rule)}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-colors"
                    aria-label="Delete rule"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Criteria editor (per-kind form fields)                                    */
/* -------------------------------------------------------------------------- */

function CriteriaEditor({
  kind,
  draft,
  onChange,
}: {
  kind: AlertRule["kind"];
  draft: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  const set = (k: string, v: string) => onChange({ ...draft, [k]: v });
  if (kind === "high_score") {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field htmlFor="alert-min-score" label="Minimum score (0-100)">
          <input
            id="alert-min-score"
            type="number"
            min={0}
            max={100}
            placeholder="75"
            value={draft.min_score ?? ""}
            onChange={(e) => set("min_score", e.target.value)}
            className="w-full text-sm rounded-lg border border-border bg-card px-3 py-2"
          />
        </Field>
        <Field htmlFor="alert-trades" label="Trades (comma-separated; blank = any)">
          <input
            id="alert-trades"
            type="text"
            placeholder="roofing, hvac"
            value={draft.trades ?? ""}
            onChange={(e) => set("trades", e.target.value)}
            className="w-full text-sm rounded-lg border border-border bg-card px-3 py-2"
          />
        </Field>
      </div>
    );
  }
  if (kind === "permit_no_contractor") {
    return (
      <Field htmlFor="alert-zip" label="ZIP (blank = any in your territory)">
        <input
          id="alert-zip"
          type="text"
          placeholder="06106"
          value={draft.zip ?? ""}
          onChange={(e) => set("zip", e.target.value)}
          className="w-full text-sm rounded-lg border border-border bg-card px-3 py-2"
        />
      </Field>
    );
  }
  if (kind === "homeowner_match") {
    return (
      <Field htmlFor="alert-ho-trades" label="Trades (comma-separated; blank = any)">
        <input
          id="alert-ho-trades"
          type="text"
          placeholder="adu, roofing"
          value={draft.trades ?? ""}
          onChange={(e) => set("trades", e.target.value)}
          className="w-full text-sm rounded-lg border border-border bg-card px-3 py-2"
        />
      </Field>
    );
  }
  // stage_change
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Field htmlFor="alert-stage-from" label="From stage (optional)">
        <select
          id="alert-stage-from"
          value={draft.from ?? ""}
          onChange={(e) => set("from", e.target.value)}
          className="w-full text-sm rounded-lg border border-border bg-card px-3 py-2"
        >
          <option value="">Any source stage</option>
          {Object.entries(STAGE_LABEL_MAP).map(([slug, label]) => (
            <option key={slug} value={slug}>{label}</option>
          ))}
        </select>
      </Field>
      <Field htmlFor="alert-stage-to" label="To stage (required)">
        <select
          id="alert-stage-to"
          required
          aria-required="true"
          value={draft.to ?? ""}
          onChange={(e) => set("to", e.target.value)}
          className="w-full text-sm rounded-lg border border-border bg-card px-3 py-2"
        >
          <option value="">Pick a stage…</option>
          {Object.entries(STAGE_LABEL_MAP).map(([slug, label]) => (
            <option key={slug} value={slug}>{label}</option>
          ))}
        </select>
      </Field>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-xs text-muted-foreground mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}

function buildCriteria(
  kind: AlertRule["kind"],
  draft: Record<string, string>,
): Record<string, unknown> {
  if (kind === "high_score") {
    const min = draft.min_score ? parseInt(draft.min_score, 10) : 75;
    const trades = parseTrades(draft.trades);
    return { min_score: min, trades };
  }
  if (kind === "permit_no_contractor") {
    return { zip: draft.zip?.trim() || null };
  }
  if (kind === "homeowner_match") {
    return { trades: parseTrades(draft.trades) };
  }
  return {
    from: draft.from?.trim() || null,
    to: draft.to?.trim() || null,
  };
}

function parseTrades(raw: string | undefined): string[] | null {
  if (!raw) return null;
  const out = raw
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  return out.length > 0 ? out : null;
}

function summariseCriteria(
  kind: AlertRule["kind"],
  criteria: Record<string, unknown>,
): string {
  if (kind === "high_score") {
    const min = (criteria.min_score as number | undefined) ?? 75;
    const trades = criteria.trades as string[] | null | undefined;
    const tradePart = trades && trades.length > 0 ? ` · ${trades.join(", ")}` : "";
    return `Score ≥ ${min}${tradePart}`;
  }
  if (kind === "permit_no_contractor") {
    const zip = criteria.zip as string | null | undefined;
    return zip ? `ZIP ${zip}` : "Any ZIP in my territories";
  }
  if (kind === "homeowner_match") {
    const trades = criteria.trades as string[] | null | undefined;
    return trades && trades.length > 0 ? `Trades: ${trades.join(", ")}` : "Any trade";
  }
  // stage_change
  const from = criteria.from as string | null | undefined;
  const to = criteria.to as string | null | undefined;
  return `${from ?? "any"} → ${to ?? "any"}`;
}
