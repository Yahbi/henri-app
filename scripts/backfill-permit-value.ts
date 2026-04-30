/**
 * Tier A+ Sprint 2 — F2.2 backfill script.
 *
 * One-shot run to fill missing `permit_value` on the leads corpus using
 * the statistical regression in src/lib/predictive/value-forecast.ts.
 *
 * Approach:
 *   1. Build the value model from leads that DO have permit_value (the
 *     ~30% that have actuals). Bucket on (permit_type × ZIP3 × year_built).
 *   2. For each lead with a NULL permit_value, look up its bucket and
 *      compute a predicted value using the bucket median + IQR confidence.
 *   3. UPDATE the lead with the predicted value, only when:
 *        - sample_size >= MIN_APPLY_SAMPLE
 *        - confidence != "low" (or the operator passed --include-low)
 *   4. Set a marker column or just write the value and let downstream
 *      consumers treat all values uniformly. Sprint 2's plan stores the
 *      predicted value directly in `permit_value` (downstream code
 *      doesn't need to know whether it was actual or predicted).
 *
 * Safety: only updates rows where permit_value IS NULL. Never overwrites
 * an existing actual value. Idempotent — re-run safe.
 *
 * Tier A+ compliance: predicts about THE PROPERTY (public asset), not
 * about any consumer. No FHA/credit/employment decision.
 *
 * Run:
 *   pnpm tsx scripts/backfill-permit-value.ts [--dry-run] [--limit N] [--include-low]
 *
 * Env required:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from "@supabase/supabase-js";
import * as path from "path";
import * as dotenv from "dotenv";
import {
  buildValueModel,
  forecastValue,
  type ValueModel,
} from "../src/lib/predictive/value-forecast";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SR) {
  console.error(
    "Missing env. Need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.",
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const INCLUDE_LOW = args.includes("--include-low");
const limitArg = args.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? parseInt(limitArg.split("=")[1], 10) : Infinity;

/** Don't apply predictions when the bucket has fewer than this many samples.
 * The forecaster's internal floor is 5; we hold ourselves to a stricter bar
 * here because we're writing to production rows. */
const MIN_APPLY_SAMPLE = 20;
const PAGE_SIZE = 1000;
const TRAINING_LIMIT = 100_000; // Cap on the model-build query

const s = createClient(SUPABASE_URL, SUPABASE_SR, {
  auth: { persistSession: false },
});

async function buildModel(): Promise<ValueModel> {
  console.log("[model] pulling training samples (leads with non-null permit_value)...");
  const { data, error } = await s
    .from("leads")
    .select("permit_type, zip, year_built, permit_value")
    .not("permit_value", "is", null)
    .gt("permit_value", 0)
    .limit(TRAINING_LIMIT);
  if (error) throw new Error(`model build: ${error.message}`);
  console.log(`[model] training rows: ${(data ?? []).length}`);

  const samples = (data ?? []).map((r) => ({
    permit_type: (r.permit_type as string | null) ?? null,
    zip: (r.zip as string | null) ?? null,
    year_built: (r.year_built as number | null) ?? null,
    estimated_value: r.permit_value as number,
  }));
  return buildValueModel(samples);
}

interface LeadRow {
  id: string;
  permit_type: string | null;
  zip: string | null;
  year_built: number | null;
}

async function* iterateValuelessLeads(): AsyncGenerator<LeadRow[]> {
  let offset = 0;
  while (offset < LIMIT) {
    const pageSize = Math.min(PAGE_SIZE, LIMIT - offset);
    const { data, error } = await s
      .from("leads")
      .select("id, permit_type, zip, year_built")
      .is("permit_value", null)
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(`leads fetch: ${error.message}`);
    if (!data || data.length === 0) return;
    yield data as LeadRow[];
    if (data.length < pageSize) return;
    offset += pageSize;
  }
}

interface RunStats {
  scanned: number;
  applied: number;
  skipped_no_forecast: number;
  skipped_low_confidence: number;
  skipped_small_sample: number;
  errors: number;
  by_confidence: Record<string, number>;
}

async function main() {
  console.log(
    `Permit-value backfill — ${DRY_RUN ? "DRY-RUN" : "WRITE"} mode${
      LIMIT < Infinity ? `, limit=${LIMIT}` : ""
    }${INCLUDE_LOW ? ", include-low=true" : ""}`,
  );

  const model = await buildModel();
  console.log(`[model] buckets built: ${model.buckets.size}`);

  const stats: RunStats = {
    scanned: 0,
    applied: 0,
    skipped_no_forecast: 0,
    skipped_low_confidence: 0,
    skipped_small_sample: 0,
    errors: 0,
    by_confidence: {},
  };

  for await (const page of iterateValuelessLeads()) {
    for (const lead of page) {
      stats.scanned++;
      const forecast = forecastValue(
        {
          permit_type: lead.permit_type,
          zip: lead.zip,
          year_built: lead.year_built,
        },
        model,
      );
      if (!forecast) {
        stats.skipped_no_forecast++;
        continue;
      }
      if (forecast.sample_size < MIN_APPLY_SAMPLE) {
        stats.skipped_small_sample++;
        continue;
      }
      if (!INCLUDE_LOW && forecast.confidence === "low") {
        stats.skipped_low_confidence++;
        continue;
      }

      stats.by_confidence[forecast.confidence] =
        (stats.by_confidence[forecast.confidence] ?? 0) + 1;
      stats.applied++;

      if (!DRY_RUN) {
        const { error } = await s
          .from("leads")
          .update({ permit_value: forecast.predicted_value })
          .eq("id", lead.id);
        if (error) {
          stats.errors++;
          console.error(`[err] lead ${lead.id}: ${error.message}`);
        }
      }
    }

    console.log(
      `[progress] scanned=${stats.scanned} applied=${stats.applied} no-forecast=${stats.skipped_no_forecast} small=${stats.skipped_small_sample} low=${stats.skipped_low_confidence} err=${stats.errors}`,
    );
  }

  console.log("\n=== Backfill complete ===");
  console.log(JSON.stringify(stats, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
