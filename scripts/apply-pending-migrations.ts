/**
 * Apply every pending migration in `supabase/migrations/` (00039 → 00044) in
 * one shot.
 *
 * Why this exists:
 *   The canonical paths are `pnpm migrate` (Supabase CLI + access token) or
 *   pasting into the web SQL editor. Neither is automation-friendly:
 *     - SUPABASE_ACCESS_TOKEN isn't in `.env.local` (CLI uses the user's
 *       personal token, not project secrets).
 *     - The web editor is a human-mouse workflow.
 *
 *   This script bridges the gap: it probes each migration's expected
 *   columns/tables via PostgREST with the service-role key, prints a
 *   per-migration "applied / pending" matrix, and either:
 *     a) lands every PENDING migration via the `exec_sql(text)` RPC if
 *        the project happens to expose one, OR
 *     b) emits a single combined SQL bundle to copy-paste into the web
 *        SQL editor.
 *
 *   Idempotent. Safe to re-run. Migrations are additive-only
 *   (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`,
 *   `CREATE INDEX IF NOT EXISTS`) so re-applying a partial set is a
 *   no-op for any already-landed pieces.
 *
 * Run:
 *   npx tsx scripts/apply-pending-migrations.ts
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as path from "path";
import * as fs from "fs";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error("missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const s = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

/* ── Schema probes ──────────────────────────────────────────────────── */

async function columnExists(table: string, column: string): Promise<boolean> {
  const { error } = await s.from(table).select(column).limit(1);
  if (!error) return true;
  return !/does not exist|Could not find the column/i.test(error.message);
}

async function tableExists(table: string): Promise<boolean> {
  // Probing a missing table returns "does not exist" / "Could not find the table".
  const { error } = await s.from(table).select("*").limit(1);
  if (!error) return true;
  return !/does not exist|Could not find the table|relation .* does not exist/i.test(error.message);
}

/* ── Migration manifest ─────────────────────────────────────────────── */

interface MigrationCheck {
  file: string;
  description: string;
  /** Returns true when the migration's effects are visible in the schema. */
  isApplied: () => Promise<boolean>;
}

const MIGRATIONS: MigrationCheck[] = [
  // 00031 was supposed to land long ago, but the live DB is missing
  // exclusivity_locks. Include it here so the bundle pulls it back in.
  {
    file: "00031_wedge_trust.sql",
    description: "exclusivity_locks + watchers + permit_events tables (wedge bullets #1, #6)",
    isApplied: async () => {
      const [a, b] = await Promise.all([
        tableExists("exclusivity_locks"),
        tableExists("permit_events"),
      ]);
      return a && b;
    },
  },
  {
    file: "00039_contact_provenance.sql",
    description: "contact_source / contact_confidence / contact_extracted_at on permits + leads",
    isApplied: async () => {
      const [a, b] = await Promise.all([
        columnExists("permits", "contact_source"),
        columnExists("leads", "contact_source"),
      ]);
      return a && b;
    },
  },
  {
    file: "00041_voter_files.sql",
    description: "voter_fl / voter_nc / voter_oh tables",
    isApplied: async () => {
      const [a, b, c] = await Promise.all([
        tableExists("voter_fl"),
        tableExists("voter_nc"),
        tableExists("voter_oh"),
      ]);
      return a && b && c;
    },
  },
  {
    file: "00042_ppp_loans.sql",
    description: "ppp_loans table",
    isApplied: async () => tableExists("ppp_loans"),
  },
  {
    file: "00043_enrich_indexes.sql",
    description: "Partial indexes for burst enrichment (year_built / owner / phone NULL paths)",
    isApplied: async () => {
      // Indexes aren't directly observable via PostgREST. Treat as
      // always-pending; the SQL is idempotent (CREATE INDEX IF NOT
      // EXISTS) so re-running is a no-op.
      return false;
    },
  },
  {
    file: "00044_leads_enrichment_columns.sql",
    description: "employer / occupation / business_* / license_* / naics_code on leads",
    isApplied: async () => {
      const [a, b] = await Promise.all([
        columnExists("leads", "employer"),
        columnExists("leads", "license_number"),
      ]);
      return a && b;
    },
  },
  // ── Phase 1.2+ additions (post-2026-04-26 baseline) ──
  {
    file: "00045_cross_trade_suggestions.sql",
    description: "Phase 1.2: leads.cross_trade_suggestions jsonb column",
    isApplied: async () => columnExists("leads", "cross_trade_suggestions"),
  },
  {
    file: "00046_referral_credits.sql",
    description: "Phase 1.4: referral_credits idempotency log table",
    isApplied: async () => tableExists("referral_credits"),
  },
  {
    file: "00047_seed_outreach_templates.sql",
    description: "Phase 1.5: seed of 42 trade-stage-channel outreach templates",
    isApplied: async () => {
      // Probe: count outreach_templates rows. Migration 00047 seeds 42.
      // If we see < 30, treat as pending (data seed, not just schema).
      const { count, error } = await s
        .from("outreach_templates")
        .select("*", { count: "exact", head: true });
      if (error) return false;
      return (count ?? 0) >= 30;
    },
  },
  {
    file: "00050_storm_events.sql",
    description: "Phase 2.3: NOAA Storm Events ingest table + spatial indexes",
    isApplied: async () => tableExists("storm_events"),
  },
  {
    file: "00051_last_enriched_at.sql",
    description: "Phase 2.6: leads.last_enriched_at + index for re-enrichment cron",
    isApplied: async () => columnExists("leads", "last_enriched_at"),
  },
  {
    file: "00052_permit_source_provenance.sql",
    description: "permit_sources: discovered_via, field_mapping_status, priority, imported_at, notes",
    isApplied: async () => {
      const [a, b] = await Promise.all([
        columnExists("permit_sources", "discovered_via"),
        columnExists("permit_sources", "field_mapping_status"),
      ]);
      return a && b;
    },
  },
  {
    file: "00053_permit_source_zip_coverage.sql",
    description: "permit_source_zips: many-to-many ZIP coverage table for US_COMPREHENSIVE_MASTER.json import",
    isApplied: async () => tableExists("permit_source_zips"),
  },
  {
    file: "00054_webhook_idempotency.sql",
    description: "webhook_idempotency: per-provider event-id dedup for Twilio/Resend webhooks (audit priority #7)",
    isApplied: async () => tableExists("webhook_idempotency"),
  },
];

/* ── Apply path: try exec_sql RPC, fall back to copy-paste bundle ───── */

function readMigration(file: string): string {
  return fs.readFileSync(
    path.resolve(process.cwd(), "supabase", "migrations", file),
    "utf-8",
  );
}

async function tryRpcApply(client: SupabaseClient, sql: string): Promise<{ ok: boolean; err?: string }> {
  const { error } = await client.rpc("exec_sql", { sql });
  if (!error) return { ok: true };
  return { ok: false, err: error.message };
}

function bundleUrl(): string {
  // Map e.g. https://ivfxylgoxgrxttknewsf.supabase.co
  //      ->  https://app.supabase.com/project/ivfxylgoxgrxttknewsf/sql/new
  // (Naive double-replace mangles the substituted "supabase.com" — extract
  // the project ref first, then template.)
  const ref = SUPABASE_URL!
    .replace(/^https?:\/\//, "")
    .split(".")[0];
  return `https://app.supabase.com/project/${ref}/sql/new`;
}

async function main() {
  console.log("── Henri migration audit ─────────────────────────────────");
  console.log(`Project: ${SUPABASE_URL}\n`);

  const status = await Promise.all(
    MIGRATIONS.map(async (m) => ({ ...m, applied: await m.isApplied() })),
  );

  for (const m of status) {
    const tag = m.applied ? "  applied" : "  PENDING";
    console.log(`${tag}  ${m.file}  — ${m.description}`);
  }

  const pending = status.filter((m) => !m.applied);
  if (pending.length === 0) {
    console.log("\nAll migrations applied. Nothing to do.");
    return;
  }

  console.log(`\n${pending.length} migration(s) pending. Attempting RPC path...`);

  /* ── Path A: exec_sql RPC ────────────────────────────────────────── */
  let rpcWorked = true;
  for (const m of pending) {
    const sql = readMigration(m.file);
    const { ok, err } = await tryRpcApply(s, sql);
    if (!ok) {
      console.log(`  RPC unavailable (${err}). Switching to copy-paste path.`);
      rpcWorked = false;
      break;
    }
    console.log(`  applied ${m.file} via RPC.`);
  }

  if (rpcWorked) {
    console.log("\nRe-checking schema...");
    const recheck = await Promise.all(MIGRATIONS.map((m) => m.isApplied()));
    const stillMissing = MIGRATIONS.filter((_, i) => !recheck[i] && !MIGRATIONS[i].file.includes("00043"));
    if (stillMissing.length === 0) {
      console.log("All migrations confirmed applied (00043 indexes skip schema probe — trust the apply).");
      return;
    }
    console.warn(`\n${stillMissing.length} migration(s) still report missing — fall through to copy-paste.`);
  }

  /* ── Path B: combined SQL bundle ─────────────────────────────────── */
  // Prepend a one-time `exec_sql` RPC bootstrap so the next run of this
  // script can take Path A and auto-apply. Idempotent — CREATE OR REPLACE
  // means re-running is harmless. SECURITY DEFINER so the service-role
  // can call it; restricted to the `service_role` role to prevent abuse.
  const execSqlBootstrap = `-- ───── _bootstrap_exec_sql (one-time) ─────
-- Lets future \`pnpm migrate\` runs apply DDL via Path A (RPC) instead
-- of bundle-paste. Restricted to service_role; never exposed to the
-- anon or authenticated roles.
CREATE OR REPLACE FUNCTION exec_sql(sql text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  EXECUTE sql;
END;
$$;
REVOKE ALL ON FUNCTION exec_sql(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION exec_sql(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION exec_sql(text) TO service_role;
`;

  const bundle =
    execSqlBootstrap +
    "\n" +
    pending
      .map((m) => `-- ───── ${m.file} ─────\n-- ${m.description}\n${readMigration(m.file)}\n`)
      .join("\n");

  const bundlePath = path.resolve(process.cwd(), "supabase", "_pending-bundle.sql");
  fs.writeFileSync(bundlePath, bundle, "utf-8");

  console.log(`\nBundle written to ${bundlePath}`);
  console.log(`Open ${bundleUrl()}, paste the file, click "Run".`);
  console.log("\nAfter applying, re-run this script to verify all green.");
  process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
