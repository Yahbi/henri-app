"use client";

import { useState, useEffect } from "react";
import { Loader2, Check } from "lucide-react";
import { useCapacityPrefs } from "@/hooks/useCapacityPrefs";
import { EMPTY_CAPACITY_PREFS, type CapacityPrefs } from "@/lib/capacity/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";

/**
 * Phase 0a wedge #7 — capacity preferences.
 *
 *   "Too many leads is a liability." Contractors with 2-crew shops get
 *   buried if the scorer hands them every $3M commercial permit in the
 *   territory. This form lets them say "I can only actually take on
 *   jobs within 25 miles, $20k-$150k, starting in the next 60 days,
 *   max 6 active at a time." The Leads tab then hides everything out
 *   of bounds (with a clear "N filtered out, widen to see" footer).
 */

const DAYS = [
  { num: 1, label: "Mon" },
  { num: 2, label: "Tue" },
  { num: 3, label: "Wed" },
  { num: 4, label: "Thu" },
  { num: 5, label: "Fri" },
  { num: 6, label: "Sat" },
  { num: 7, label: "Sun" },
];

export default function CapacitySettingsPage() {
  const { prefs, isLoading, migrationPending, save, clear } = useCapacityPrefs();

  const [draft, setDraft] = useState<CapacityPrefs>(prefs);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(prefs);
  }, [prefs]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    const result = await save(draft);
    setSaving(false);
    if (result.ok) {
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1800);
    } else {
      setError(result.error ?? "Could not save.");
    }
  }

  async function handleClear() {
    setSaving(true);
    setError(null);
    setDraft(EMPTY_CAPACITY_PREFS);
    const result = await clear();
    setSaving(false);
    if (!result.ok) setError(result.error ?? "Could not clear.");
  }

  function toggleDay(n: number) {
    setDraft((d) => {
      const has = d.preferred_days_of_week.includes(n);
      return {
        ...d,
        preferred_days_of_week: has
          ? d.preferred_days_of_week.filter((x) => x !== n)
          : [...d.preferred_days_of_week, n].sort((a, b) => a - b),
      };
    });
  }

  return (
    <div className="max-w-2xl px-6 py-8">
      <h1 className="font-heading text-2xl font-normal text-foreground mb-1">
        Capacity
      </h1>
      <p className="text-sm text-muted-foreground mb-6">
        Tell Henri what you can actually take on. Leads outside your capacity
        are hidden from the Leads tab so your pipeline stays right-sized for
        your crew, not packed with jobs you&apos;d decline anyway.
      </p>

      {migrationPending && (
        <div className="mb-6 rounded-lg border border-warm/30 bg-warm/8 px-4 py-3 text-[12px] text-warm">
          <p className="font-semibold">Feature pending</p>
          <p className="mt-0.5 text-muted-foreground">
            Capacity preferences activate once migration{" "}
            <code className="font-mono">00031_wedge_trust.sql</code> is applied
            to Supabase. Form saves will return a 503 until then.
          </p>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading your preferences…
        </div>
      ) : (
        <div className="space-y-6">
          <Section title="Travel radius" badge={<NotYetActiveBadge />}>
            <NumberField
              label="Max miles from your primary ZIP"
              placeholder="e.g. 25"
              value={draft.max_radius_miles}
              onChange={(v) => setDraft((d) => ({ ...d, max_radius_miles: v }))}
              suffix="mi"
              hint="Leave blank for no cap."
            />
          </Section>

          <Section title="Project value">
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Min value"
                placeholder="20000"
                value={draft.value_min}
                onChange={(v) => setDraft((d) => ({ ...d, value_min: v }))}
                prefix="$"
              />
              <NumberField
                label="Max value"
                placeholder="150000"
                value={draft.value_max}
                onChange={(v) => setDraft((d) => ({ ...d, value_max: v }))}
                prefix="$"
              />
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Both optional. Leave blank for no floor/ceiling.
            </p>
          </Section>

          <Section title="Start window" badge={<NotYetActiveBadge />}>
            <div className="grid grid-cols-2 gap-3">
              <DateField
                label="Earliest"
                value={draft.start_window_start}
                onChange={(v) => setDraft((d) => ({ ...d, start_window_start: v }))}
              />
              <DateField
                label="Latest"
                value={draft.start_window_end}
                onChange={(v) => setDraft((d) => ({ ...d, start_window_end: v }))}
              />
            </div>
          </Section>

          <Section title="Active jobs cap" badge={<NotYetActiveBadge />}>
            <NumberField
              label="Max concurrent active jobs"
              placeholder="e.g. 6"
              value={draft.max_active_jobs}
              onChange={(v) => setDraft((d) => ({ ...d, max_active_jobs: v }))}
              hint="Will stop surfacing new leads once you&apos;re at this count (coming soon)."
            />
          </Section>

          <Section title="Work days">
            <div className="flex flex-wrap gap-2">
              {DAYS.map((day) => {
                const on = draft.preferred_days_of_week.includes(day.num);
                return (
                  <button
                    key={day.num}
                    type="button"
                    onClick={() => toggleDay(day.num)}
                    aria-pressed={on}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs border transition-colors",
                      on
                        ? "bg-primary text-white border-primary"
                        : "bg-background text-foreground border-border hover:bg-accent",
                    )}
                  >
                    {day.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Leave all off to mean &quot;any day.&quot;
            </p>
          </Section>

          {error && (
            <p className="text-xs text-red-500" role="alert">
              {error}
            </p>
          )}

          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-primary text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {justSaved && <Check className="h-3.5 w-3.5" />}
              {justSaved ? "Saved" : "Save preferences"}
            </button>
            <button
              type="button"
              onClick={handleClear}
              disabled={saving}
              className="px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              Clear all
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  badge,
  children,
}: {
  title: string;
  /** Optional inline badge rendered next to the section title (e.g. the
   *  "Not yet active" pill on dimensions Phase 0a doesn't enforce yet).
   *  Lives OUTSIDE the h2 so the heading's `uppercase` transform doesn't
   *  cascade into the badge copy. */
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
        {badge}
      </div>
      {children}
    </div>
  );
}

/* Phase 0a honesty note — only the value band (min/max) is enforced
 * client-side today (`src/lib/capacity/types.ts`). Radius, start window,
 * and max-active-jobs land in Phase A when the scorer applies them
 * server-side. Inputs stay editable so saved values take effect the day
 * enforcement ships — but the contractor must not believe they're
 * filtering anything yet. */
function NotYetActiveBadge() {
  return (
    <Badge
      variant="outline"
      className="text-[10px] font-medium text-muted-foreground"
    >
      Not yet active &mdash; coming in a future update
    </Badge>
  );
}

function NumberField({
  label,
  value,
  onChange,
  placeholder,
  prefix,
  suffix,
  hint,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
  prefix?: string;
  suffix?: string;
  hint?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-foreground mb-1">
        {label}
      </label>
      <div className="flex items-center gap-1 rounded-lg border border-border bg-background focus-within:ring-2 focus-within:ring-primary">
        {prefix && <span className="pl-3 text-sm text-muted-foreground">{prefix}</span>}
        <input
          type="number"
          min={0}
          placeholder={placeholder}
          value={value ?? ""}
          onChange={(e) => {
            const raw = e.target.value.trim();
            if (raw === "") {
              onChange(null);
            } else {
              const n = Number(raw);
              onChange(Number.isFinite(n) ? Math.round(n) : null);
            }
          }}
          className="flex-1 bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        {suffix && <span className="pr-3 text-sm text-muted-foreground">{suffix}</span>}
      </div>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-foreground mb-1">
        {label}
      </label>
      <input
        type="date"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
      />
    </div>
  );
}
