/**
 * Phase 0 — Pre-flight diagnostics for the Data Henri 3 ingest plan.
 *
 * Read-only. Gathers:
 *   1. Current Supabase DB size + row counts on relevant tables
 *   2. permits.db row count + distinct-address count + schema confirmation
 *   3. Owner profile presence (y.abismuth@gmail.com)
 *   4. Projected final DB size
 *
 * Output is a single JSON blob + a human summary. No writes.
 *
 * Run:  npx tsx scripts/phase0-preflight.ts
 */

import { createClient } from "@supabase/supabase-js";
import Database from "better-sqlite3";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PERMITS_DB_PATH = "C:/Users/yabis/Desktop/Data Henri 3/permits.db";
const OWNER_EMAIL = "y.abismuth@gmail.com";

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

async function tableCount(table: string): Promise<number | string> {
  const { count, error } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true });
  if (error) return `err: ${error.message}`;
  return count ?? 0;
}

async function main() {
  const result: Record<string, unknown> = {};

  // ── Supabase side ──────────────────────────────────────────
  console.log("→ Querying Supabase…");
  const supabaseCounts: Record<string, number | string> = {};
  for (const t of [
    "permits",
    "permit_sources",
    "territories",
    "leads",
    "profiles",
  ]) {
    supabaseCounts[t] = await tableCount(t);
  }
  result.supabaseCounts = supabaseCounts;

  // Owner profile
  const { data: ownerProfile, error: ownerErr } = await supabase
    .from("profiles")
    .select("id, email, role, plan, onboarding_completed")
    .eq("email", OWNER_EMAIL)
    .maybeSingle();
  result.owner = ownerErr ? { error: ownerErr.message } : ownerProfile;

  // Active territories already held by owner
  if (ownerProfile?.id) {
    const { data: ownerTerritories, error: tErr } = await supabase
      .from("territories")
      .select("zip, status, slot_number")
      .eq("contractor_id", ownerProfile.id);
    result.ownerTerritories = tErr ? { error: tErr.message } : ownerTerritories;
  }

  // DB size via RPC (if rpc exists); else skip
  try {
    const { data: sizeData, error: sizeErr } = await supabase.rpc(
      "pg_database_size_mb" as never,
    );
    result.dbSize = sizeErr ? `rpc missing: ${sizeErr.message}` : sizeData;
  } catch {
    result.dbSize = "rpc_unavailable";
  }

  // ── permits.db side ───────────────────────────────────────
  console.log("→ Opening permits.db read-only…");
  let sqliteErr: string | null = null;
  try {
    const db = new Database(PERMITS_DB_PATH, {
      readonly: true,
      fileMustExist: true,
    });
    // immutable mode via URI — better-sqlite3 supports `fileMustExist` but not
    // the immutable flag directly. Read-only + no WAL checkpoint triggered
    // because better-sqlite3 won't attempt writes.
    db.pragma("journal_mode = WAL", { simple: true }); // harmless read query
    result.sqliteSchemaVersion = db.pragma("schema_version", { simple: true });
    result.sqliteTables = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as Array<Record<string, unknown>>
    ).map((r) => r.name);

    // Schema of permits
    const cols = db
      .prepare("PRAGMA table_info(permits)")
      .all() as Array<{ name: string; type: string; notnull: number; pk: number }>;
    result.permitsColumns = cols.map((c) => ({
      name: c.name,
      type: c.type,
      notnull: !!c.notnull,
      pk: !!c.pk,
    }));

    // Row counts
    const permitsCount = (
      db.prepare("SELECT count(*) AS n FROM permits").get() as { n: number }
    ).n;
    result.sqlitePermitsCount = permitsCount;

    // Sample 3 rows
    const sampleRows = db
      .prepare("SELECT * FROM permits LIMIT 3")
      .all() as Array<Record<string, unknown>>;
    result.sqliteSampleRows = sampleRows.map((r) => {
      // Trim raw_data / raw_json if present so the output is readable
      const trimmed: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r)) {
        if (typeof v === "string" && v.length > 200) {
          trimmed[k] = v.slice(0, 200) + "…";
        } else {
          trimmed[k] = v;
        }
      }
      return trimmed;
    });

    // Distinct addresses (estimate for address_permit_history size)
    // This query is heavy on 24M rows; run it only if permitsCount > 0.
    if (permitsCount > 0) {
      console.log("→ Counting distinct addresses (may take 30s on 24M rows)…");
      const distinctAddr = (
        db
          .prepare(
            "SELECT count(DISTINCT lower(coalesce(trim(address),'')) || '|' || coalesce(zip,'')) AS n FROM permits WHERE address IS NOT NULL AND trim(address) != ''",
          )
          .get() as { n: number }
      ).n;
      result.sqliteDistinctAddresses = distinctAddr;

      // Date range
      const dateInfo = db
        .prepare(
          "SELECT min(issue_date) AS min_issue, max(issue_date) AS max_issue, min(applied_date) AS min_applied, max(applied_date) AS max_applied FROM permits",
        )
        .get();
      result.sqliteDateRange = dateInfo;

      // Recent count (last 30 days)
      const recent = db
        .prepare(
          "SELECT count(*) AS n FROM permits WHERE issue_date >= date('now','-30 days') OR applied_date >= date('now','-30 days')",
        )
        .get() as { n: number };
      result.sqliteRecent30d = recent.n;

      // Top permit_type values (for enum mapping coverage check)
      const topTypes = db
        .prepare(
          "SELECT permit_type, count(*) AS n FROM permits GROUP BY permit_type ORDER BY n DESC LIMIT 20",
        )
        .all();
      result.sqliteTopPermitTypes = topTypes;

      // Top states
      const topStates = db
        .prepare(
          "SELECT state, count(*) AS n FROM permits GROUP BY state ORDER BY n DESC LIMIT 15",
        )
        .all();
      result.sqliteTopStates = topStates;
    }

    db.close();
  } catch (e) {
    sqliteErr = e instanceof Error ? e.message : String(e);
    result.sqliteError = sqliteErr;
  }

  // ── Projections ────────────────────────────────────────────
  const permitsCount = (result.sqlitePermitsCount as number) ?? 0;
  const distinctAddresses = (result.sqliteDistinctAddresses as number) ?? 0;
  const projectedPermitsBytes = permitsCount * 500;
  const projectedHistoryBytes = distinctAddresses * 1024;
  const projectedTotalGB =
    (projectedPermitsBytes + projectedHistoryBytes) / 1024 / 1024 / 1024;
  result.projection = {
    permitsRows: permitsCount,
    distinctAddresses,
    estimatedPermitsMB: (projectedPermitsBytes / 1024 / 1024).toFixed(1),
    estimatedHistoryMB: (projectedHistoryBytes / 1024 / 1024).toFixed(1),
    estimatedTotalGB: projectedTotalGB.toFixed(2),
  };

  console.log("\n========== PHASE 0 PRE-FLIGHT ==========");
  console.log(JSON.stringify(result, null, 2));
  console.log("========================================\n");

  console.log("Summary:");
  console.log(`  Supabase permits: ${supabaseCounts.permits}`);
  console.log(`  Supabase permit_sources: ${supabaseCounts.permit_sources}`);
  console.log(`  Supabase territories: ${supabaseCounts.territories}`);
  console.log(`  Supabase leads: ${supabaseCounts.leads}`);
  console.log(
    `  Owner y.abismuth@gmail.com: ${ownerProfile ? `present (role=${ownerProfile.role}, plan=${ownerProfile.plan})` : "NOT FOUND"}`,
  );
  if (sqliteErr) {
    console.log(`  permits.db: FAILED — ${sqliteErr}`);
  } else {
    console.log(`  permits.db rows: ${permitsCount.toLocaleString()}`);
    console.log(
      `  permits.db distinct addresses: ${distinctAddresses.toLocaleString()}`,
    );
    console.log(`  Projected Supabase size: ~${projectedTotalGB.toFixed(1)} GB`);
  }
}

main().catch((err) => {
  console.error("Phase 0 failed:", err);
  process.exit(1);
});
