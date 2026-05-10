/**
 * Apply migrations 00095 (CHECK constraints) + 00096 (stage_history
 * backfill) statement-by-statement so each ALTER / VALIDATE / INSERT
 * fits inside the Mgmt API 8s statement-timeout window. Idempotent.
 */
import path from "node:path";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: path.resolve(process.cwd(), ".env.local") });

const sql = async (q, attempt = 0) => {
  const r = await fetch(
    `https://api.supabase.com/v1/projects/ivfxylgoxgrxttknewsf/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: q }),
    },
  );
  const text = await r.text();
  if (text.startsWith("<")) {
    if (attempt < 3) {
      const wait = 3000 * Math.pow(1.6, attempt);
      console.log(`[retry] HTML, attempt ${attempt + 1}/3, wait ${Math.round(wait)}ms…`);
      await new Promise((r) => setTimeout(r, wait));
      return sql(q, attempt + 1);
    }
    throw new Error(`HTML after 3 retries`);
  }
  return JSON.parse(text);
};

const statements = [
  // ─── 00095: CHECK constraints ───
  {
    name: "00095.1 leads_source_check (NOT VALID)",
    q: `DO $$ BEGIN
      ALTER TABLE public.leads
        ADD CONSTRAINT leads_source_check
        CHECK (source IN ('permit', 'parcel_synthesis', 'event_trigger', 'manual'))
        NOT VALID;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  },
  {
    name: "00095.2 leads_source_check (VALIDATE)",
    q: `ALTER TABLE public.leads VALIDATE CONSTRAINT leads_source_check;`,
  },
  {
    name: "00095.3 alert_rules_kind_check (NOT VALID)",
    q: `DO $$ BEGIN
      ALTER TABLE public.alert_rules
        ADD CONSTRAINT alert_rules_kind_check
        CHECK (kind IN ('high_score', 'permit_no_contractor', 'homeowner_match', 'stage_change'))
        NOT VALID;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  },
  {
    name: "00095.4 alert_rules_kind_check (VALIDATE)",
    q: `ALTER TABLE public.alert_rules VALIDATE CONSTRAINT alert_rules_kind_check;`,
  },
  {
    name: "00095.5 stage_history_changed_by_kind_check (NOT VALID)",
    q: `DO $$ BEGIN
      ALTER TABLE public.stage_history
        ADD CONSTRAINT stage_history_changed_by_kind_check
        CHECK (changed_by_kind IN ('score_cron', 'backfill', 'manual', 'intake', 'system', 'henri-scoring-v3'))
        NOT VALID;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  },
  {
    name: "00095.6 stage_history_changed_by_kind_check (VALIDATE)",
    q: `ALTER TABLE public.stage_history VALIDATE CONSTRAINT stage_history_changed_by_kind_check;`,
  },

  // ─── 00096: stage_history backfill ───
  {
    name: "00096 stage_history one-shot backfill",
    q: `INSERT INTO public.stage_history (lead_id, from_stage, to_stage, changed_at, changed_by_kind)
        SELECT
          l.id,
          NULL,
          l.opportunity_stage,
          COALESCE(l.updated_at, l.created_at, NOW()),
          'backfill'
        FROM public.leads l
        WHERE l.opportunity_stage IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM public.stage_history sh WHERE sh.lead_id = l.id
          );`,
  },
];

let pass = 0;
for (const s of statements) {
  console.log(`\n=== ${s.name} ===`);
  const t0 = Date.now();
  const result = await sql(s.q);
  const ms = Date.now() - t0;
  if (result?.message && /ERROR/.test(result.message)) {
    console.error(`FAIL in ${ms}ms: ${result.message.slice(0, 200)}`);
    if (s.name.includes("backfill")) {
      // backfill is best-effort — keep going
      console.log("(backfill failure is non-fatal; will succeed on next run when DB recovers)");
      continue;
    }
    process.exit(1);
  }
  console.log(`ok in ${ms}ms`);
  pass += 1;
}

console.log("\n=== verify constraints exist ===");
const c = await sql(`
  SELECT conname, contype, convalidated
  FROM pg_constraint
  WHERE conname IN (
    'leads_source_check',
    'alert_rules_kind_check',
    'stage_history_changed_by_kind_check'
  )
  ORDER BY conname;
`);
console.log(JSON.stringify(c, null, 2));

console.log("\n=== verify stage_history population (small probe) ===");
const cnt = await sql(`SELECT COUNT(*)::int AS history_rows FROM public.stage_history`);
console.log(JSON.stringify(cnt, null, 2));

console.log(`\n=== summary === ${pass}/${statements.length} statements applied`);
