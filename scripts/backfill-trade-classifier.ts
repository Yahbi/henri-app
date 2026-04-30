/**
 * Tier A+ Sprint 2 — F2.3 backfill script.
 *
 * One-shot run to classify the corpus of "other"-tagged or null-trade
 * leads into Henri's 7 canonical trades using the deterministic
 * regex + cosine-similarity classifier in src/lib/predictive/trade-classifier.ts.
 *
 * Runs against the production Supabase using SUPABASE_SERVICE_ROLE_KEY
 * (bypasses RLS — service-role only). Read-only on permits, UPDATEs leads.
 *
 * Safety: only updates rows where trade IS NULL or trade='other'. Never
 * overwrites a positively-classified row. Idempotent — re-run safe; rows
 * that already have a canonical trade are skipped.
 *
 * Tier A+ compliance: classifies properties + permits, not people. No
 * protected-class proxy possible — the classifier only sees permit_type
 * + description text.
 *
 * Run:
 *   pnpm tsx scripts/backfill-trade-classifier.ts [--dry-run] [--limit N]
 *
 * Env required:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from "@supabase/supabase-js";
import * as path from "path";
import * as dotenv from "dotenv";
import { classifyTrade, isCanonicalTrade } from "../src/lib/predictive/trade-classifier";

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
const limitArg = args.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? parseInt(limitArg.split("=")[1], 10) : Infinity;

/** Confidence floor below which we DON'T overwrite an existing trade.
 * Above this we apply the classifier's prediction. */
const MIN_CONFIDENCE_TO_APPLY = 0.5;
const PAGE_SIZE = 1000;

const s = createClient(SUPABASE_URL, SUPABASE_SR, {
  auth: { persistSession: false },
});

interface LeadRow {
  id: string;
  trade: string | null;
  permit_type: string | null;
  permit_description: string | null;
}

async function* iterateUnclassifiedLeads(): AsyncGenerator<LeadRow[]> {
  let offset = 0;
  while (offset < LIMIT) {
    const pageSize = Math.min(PAGE_SIZE, LIMIT - offset);
    const { data, error } = await s
      .from("leads")
      .select("id, trade, permit_type, permit_description")
      .or("trade.is.null,trade.eq.other")
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
  applied_regex: number;
  applied_cosine: number;
  skipped_low_confidence: number;
  errors: number;
  by_trade: Record<string, number>;
}

async function main() {
  console.log(
    `Trade-classifier backfill — ${DRY_RUN ? "DRY-RUN" : "WRITE"} mode${
      LIMIT < Infinity ? `, limit=${LIMIT}` : ""
    }`,
  );

  const stats: RunStats = {
    scanned: 0,
    applied_regex: 0,
    applied_cosine: 0,
    skipped_low_confidence: 0,
    errors: 0,
    by_trade: {},
  };

  for await (const page of iterateUnclassifiedLeads()) {
    for (const lead of page) {
      stats.scanned++;
      const cls = classifyTrade(lead.permit_type, lead.permit_description);

      // Only apply when confidence is meaningful
      if (cls.method === "none" || cls.confidence < MIN_CONFIDENCE_TO_APPLY) {
        stats.skipped_low_confidence++;
        continue;
      }
      // Validate the predicted trade is one of the canonical 7
      if (!isCanonicalTrade(cls.trade)) {
        stats.errors++;
        continue;
      }

      stats.by_trade[cls.trade] = (stats.by_trade[cls.trade] ?? 0) + 1;
      if (cls.method === "regex") stats.applied_regex++;
      if (cls.method === "cosine") stats.applied_cosine++;

      if (!DRY_RUN) {
        const { error } = await s
          .from("leads")
          .update({ trade: cls.trade })
          .eq("id", lead.id);
        if (error) {
          stats.errors++;
          console.error(`[err] lead ${lead.id}: ${error.message}`);
        }
      }
    }

    console.log(
      `[progress] scanned=${stats.scanned} regex=${stats.applied_regex} cosine=${stats.applied_cosine} low=${stats.skipped_low_confidence} err=${stats.errors}`,
    );
  }

  console.log("\n=== Backfill complete ===");
  console.log(JSON.stringify(stats, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
