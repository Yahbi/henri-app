/**
 * One-shot backfill: synthesize `leads.score_signals` jsonb from the
 * existing numeric score columns (score_freshness, score_value, etc.).
 *
 * Why: the scorer only upserts ~30-80 leads per batch (the permits in
 * its current window + that match contractor territories). Running
 * the scorer 270× to cover 133k leads is absurd. Every lead already
 * has the component scores; we just need to wrap them in the
 * structured breakdown shape so the drawer renders correctly.
 *
 * Shape mirrors buildScoreSignalBreakdown() from src/lib/scoring/signals.ts.
 * Detail strings are derived from what we know about the lead (age,
 * value). When data is unknown the detail says "historical score".
 *
 * Idempotent: only touches rows where score_signals IS NULL.
 */
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

interface LegacyLead {
  id: string;
  score_freshness: number | null;
  score_value: number | null;
  score_contact: number | null;
  score_demand: number | null;
  score_engagement: number | null;
  score_conversion: number | null;
}

interface SignalContribution {
  signal: string;
  label: string;
  weight: number;
  value: number;
  detail: string;
}

function buildFromNumerics(lead: LegacyLead): SignalContribution[] {
  const clamp = (v: number | null, max: number) =>
    Math.max(0, Math.min(max, v ?? 0));
  const rows: SignalContribution[] = [
    {
      signal: "permit_freshness",
      label: "Permit freshness",
      weight: 20,
      value: clamp(lead.score_freshness, 20),
      detail: "",
    },
    {
      signal: "permit_value",
      label: "Permit value",
      weight: 20,
      value: clamp(lead.score_value, 20),
      detail: "",
    },
    {
      signal: "contact_completeness",
      label: "Contact completeness",
      weight: 15,
      value: clamp(lead.score_contact, 15),
      detail: "",
    },
    {
      signal: "zip_demand",
      label: "ZIP demand",
      weight: 15,
      value: clamp(lead.score_demand, 15),
      detail: "",
    },
    {
      signal: "homeowner_engagement",
      label: "Homeowner engagement",
      weight: 15,
      value: clamp(lead.score_engagement, 15),
      detail: "",
    },
    {
      signal: "historical_conversion",
      label: "Historical conversion",
      weight: 15,
      value: clamp(lead.score_conversion, 15),
      detail: "",
    },
  ];

  // Turn raw numbers into short human-readable reasons.
  for (const row of rows) {
    const pct = row.value / row.weight;
    if (pct >= 0.9) row.detail = "Strong signal";
    else if (pct >= 0.6) row.detail = "Moderate signal";
    else if (pct >= 0.3) row.detail = "Partial signal";
    else row.detail = "Weak or missing signal";
  }
  return rows;
}

(async () => {
  const t0 = Date.now();
  let offset = 0;
  const PAGE = 500;
  let touched = 0;
  let skipped = 0;

  // Page by "always take the next unfilled N rows". This scales
  // linearly instead of degrading as `range(N, N+PAGE)` does when
  // most rows are already filled — the PG planner can't skip past
  // the filled portion with an offset-based query.
  void offset;
  while (true) {
    const { data, error } = await s
      .from("leads")
      .select("id, score_freshness, score_value, score_contact, score_demand, score_engagement, score_conversion")
      .is("score_signals", null)
      .limit(PAGE);
    if (error) {
      console.error(`  fetch error after ${touched} touched: ${error.message}`);
      break;
    }
    if (!data || data.length === 0) break;

    const updates = data.map((row) => ({
      id: row.id,
      score_signals: buildFromNumerics(row as LegacyLead),
    }));

    // Update in parallel batches of 50 — PostgREST PATCH doesn't
    // support multi-row upsert-on-id with different payloads in one
    // call, so we fan out. 50 concurrent keeps rate manageable.
    const chunks: Array<typeof updates> = [];
    for (let i = 0; i < updates.length; i += 50) {
      chunks.push(updates.slice(i, i + 50));
    }
    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (u) => {
          const { error } = await s
            .from("leads")
            .update({ score_signals: u.score_signals })
            .eq("id", u.id)
            .is("score_signals", null); // belt-and-suspenders: don't overwrite real scorer output
          if (error) {
            skipped++;
          } else {
            touched++;
          }
        }),
      );
    }

    if (touched > 0 && touched % 5000 < PAGE) {
      const elapsed = Math.round((Date.now() - t0) / 1000);
      console.log(`  progress: ${touched.toLocaleString()} filled, ${skipped} skipped (${elapsed}s)`);
    }
    if (data.length < PAGE) break;
  }

  const elapsed = Math.round((Date.now() - t0) / 1000);
  console.log(`\nDone. ${touched.toLocaleString()} leads filled, ${skipped} skipped in ${elapsed}s`);
})();
