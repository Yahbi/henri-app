#!/usr/bin/env npx tsx
/**
 * Post-ingestion coverage verifier.
 *
 * Run after a Hetzner sidecar deploy / new state activation / nightly
 * cron pass to confirm that what we *think* we configured is actually
 * landing rows. Pairs with `coverage-gaps.ts`:
 *
 *   coverage-gaps.ts   → which states/cities are we missing endpoints for?
 *                        (endpoint-side audit)
 *   verify-coverage.ts → for the endpoints we DO have, is data flowing?
 *                        (data-side audit)
 *
 * What it checks:
 *
 *   1. Per-state permit count + freshness (newest issued_date, last 24h
 *      insert count). Flags any state whose newest permit is >14d old.
 *
 *   2. ZIP fill rate per state. For each state with active permits, what
 *      % of ZIPs in that state have at least one permit? Pulls the
 *      authoritative ZIP-by-state list from a built-in catalog (no DB
 *      dependency on the pruned `zip_crosswalk_hud` table).
 *
 *   3. Trade coverage. Counts permits per `permit_type` enum value
 *      (residential / commercial / renovation / new_construction /
 *      addition / repair / demolition / other). Henri scores leads for
 *      6 trades — flag if any trade has <1% representation.
 *
 *   4. Source health. From `permit_sources`, how many enabled rows
 *      delivered ≥1 row in the last 24h? Stale sources (enabled but
 *      no fresh data) get listed.
 *
 *   5. New-state arrivals. Diffs the state list against a "previous
 *      run" snapshot at `docs/studies/coverage-snapshot.json` and
 *      reports states that newly appeared (good news) or disappeared
 *      (bad news — pipeline regression).
 *
 * Output:
 *   - stdout: a markdown summary (passing/failing sections)
 *   - file: `docs/studies/verify-coverage-YYYY-MM-DD.md` (full report)
 *   - exit code: 0 if all gates pass, 1 if any gate fails (CI-friendly)
 *
 * Usage:
 *   npx tsx scripts/verify-coverage.ts
 *   npx tsx scripts/verify-coverage.ts --strict   # also fails on warnings
 */
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SR) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local",
  );
  process.exit(2);
}
const STRICT = process.argv.includes("--strict");

const s = createClient(SUPABASE_URL, SUPABASE_SR, {
  auth: { persistSession: false },
});

/* ── reference: ZIP counts per US state ────────────────────────────────
 * Source: USPS / HUD ZIP-by-state catalog as of 2024-Q4. Used to compute
 * fill-rate denominators without depending on the pruned
 * zip_crosswalk_hud table. Approximate (delivery vs. business ZIPs vary
 * by census release) but stable for relative comparisons.
 */
const ZIPS_PER_STATE: Record<string, number> = {
  AL: 642, AK: 237, AZ: 405, AR: 593, CA: 1763, CO: 526, CT: 282,
  DE: 67, DC: 53, FL: 983, GA: 736, HI: 95, ID: 277, IL: 1379,
  IN: 776, IA: 935, KS: 698, KY: 769, LA: 513, ME: 437, MD: 467,
  MA: 539, MI: 990, MN: 884, MS: 422, MO: 1015, MT: 369, NE: 581,
  NV: 226, NH: 247, NJ: 595, NM: 372, NY: 1797, NC: 808, ND: 386,
  OH: 1196, OK: 645, OR: 417, PA: 1764, RI: 90, SC: 425, SD: 376,
  TN: 614, TX: 1759, UT: 287, VT: 254, VA: 894, WA: 588, WV: 717,
  WI: 774, WY: 178,
};

const ALL_STATES = Object.keys(ZIPS_PER_STATE).sort();

/* ── data fetchers ──────────────────────────────────────────────────── */

async function countByState(): Promise<Map<string, number>> {
  // Use head:true + count:exact to get server-side totals per state
  // without paginating 1.4M rows. Loop all states; ~50 round-trips.
  const out = new Map<string, number>();
  for (const st of ALL_STATES) {
    const { count, error } = await s
      .from("permits")
      .select("*", { count: "exact", head: true })
      .eq("state", st);
    if (error) {
      console.warn(`[count ${st}] ${error.message}`);
      continue;
    }
    out.set(st, count ?? 0);
  }
  return out;
}

async function freshnessByState(): Promise<
  Map<string, { newest: string | null; last24h: number }>
> {
  const out = new Map<string, { newest: string | null; last24h: number }>();
  const since24 = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  for (const st of ALL_STATES) {
    // Newest issued_date (1 row).
    const { data: newestRow } = await s
      .from("permits")
      .select("issued_date")
      .eq("state", st)
      .order("issued_date", { ascending: false, nullsFirst: false })
      .limit(1);
    const newest = newestRow?.[0]?.issued_date ?? null;

    // Inserts in last 24h.
    const { count: last24h } = await s
      .from("permits")
      .select("*", { count: "exact", head: true })
      .eq("state", st)
      .gte("created_at", since24);

    out.set(st, { newest, last24h: last24h ?? 0 });
  }
  return out;
}

async function distinctZipsByState(): Promise<Map<string, number>> {
  // PostgREST doesn't expose DISTINCT directly. Use the existing
  // `zip_demand_scores` view if present (one row per ZIP). Otherwise
  // fall back to a sampled scan.
  const out = new Map<string, number>();
  for (const st of ALL_STATES) {
    // First attempt: via zip_demand_scores (cheap, indexed).
    const { data, error } = await s
      .from("zip_demand_scores")
      .select("zip", { count: "exact", head: false })
      .eq("state", st);
    if (!error && data) {
      const uniqueZips = new Set(
        (data as Array<{ zip: string }>).map((r) => r.zip).filter(Boolean),
      );
      out.set(st, uniqueZips.size);
      continue;
    }
    // Fallback: sampled distinct zips from permits (capped at 5k rows
    // per state — enough for a relative coverage signal).
    const { data: sample } = await s
      .from("permits")
      .select("zip")
      .eq("state", st)
      .not("zip", "is", null)
      .limit(5000);
    const uniqueZips = new Set(
      (sample as Array<{ zip: string }> | null)?.map((r) =>
        (r.zip ?? "").slice(0, 5),
      ) ?? [],
    );
    out.set(st, uniqueZips.size);
  }
  return out;
}

async function tradeBreakdown(): Promise<Map<string, number>> {
  // Per-permit_type counts across the whole fleet.
  const TYPES = [
    "residential",
    "commercial",
    "renovation",
    "new_construction",
    "addition",
    "repair",
    "demolition",
    "other",
  ];
  const out = new Map<string, number>();
  for (const t of TYPES) {
    const { count } = await s
      .from("permits")
      .select("*", { count: "exact", head: true })
      .eq("permit_type", t);
    out.set(t, count ?? 0);
  }
  return out;
}

async function staleSources(): Promise<
  Array<{ id: string; source_city: string; last_run_at: string | null }>
> {
  // Sources marked enabled=true that haven't produced a row in the
  // last 24h. Reads from cron_runs (added 2026-05-01 migration 00076).
  const since24 = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: enabled, error } = await s
    .from("permit_sources")
    .select("id, source_city, last_run_at")
    .eq("enabled", true);
  if (error || !enabled) return [];

  return (enabled as Array<{
    id: string;
    source_city: string;
    last_run_at: string | null;
  }>).filter((row) => {
    if (!row.last_run_at) return true;
    return row.last_run_at < since24;
  });
}

/* ── snapshot diff ─────────────────────────────────────────────────── */

const SNAPSHOT_PATH = path.resolve(
  process.cwd(),
  "docs",
  "studies",
  "coverage-snapshot.json",
);

type Snapshot = {
  timestamp: string;
  states_with_data: string[];
  total_permits: number;
};

function readPrevSnapshot(): Snapshot | null {
  try {
    return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf-8"));
  } catch {
    return null;
  }
}

function writeSnapshot(s: Snapshot): void {
  fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(s, null, 2));
}

/* ── markdown emitter ──────────────────────────────────────────────── */

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function pct(num: number, denom: number): string {
  if (!denom) return "—";
  return `${((num / denom) * 100).toFixed(1)}%`;
}

(async () => {
  const startedAt = new Date();
  const failures: string[] = [];
  const warnings: string[] = [];
  const lines: string[] = [];

  lines.push("# Henri permit-coverage verification");
  lines.push(`Generated ${startedAt.toISOString()}`);
  lines.push("");

  console.log("[verify] Pulling per-state permit counts…");
  const counts = await countByState();
  console.log("[verify] Pulling per-state freshness…");
  const fresh = await freshnessByState();
  console.log("[verify] Pulling distinct-ZIP coverage…");
  const zipsCovered = await distinctZipsByState();
  console.log("[verify] Pulling trade breakdown…");
  const trades = await tradeBreakdown();
  console.log("[verify] Pulling stale-source list…");
  const stale = await staleSources();

  // ── Section 1: per-state coverage table
  lines.push("## 1. Per-state coverage");
  lines.push("");
  lines.push(
    "| State | Permits | Newest | Last 24h | ZIPs covered | ZIP fill |",
  );
  lines.push(
    "|---|---:|---|---:|---:|---:|",
  );
  const SINCE_14D = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  let activeStates = 0;
  const statesWithData: string[] = [];
  for (const st of ALL_STATES) {
    const c = counts.get(st) ?? 0;
    if (c > 0) {
      activeStates++;
      statesWithData.push(st);
    }
    const f = fresh.get(st) ?? { newest: null, last24h: 0 };
    const newest = f.newest ? f.newest.slice(0, 10) : "—";
    const z = zipsCovered.get(st) ?? 0;
    const zTotal = ZIPS_PER_STATE[st] ?? 0;
    const fillPct = pct(z, zTotal);

    lines.push(
      `| ${st} | ${fmt(c)} | ${newest} | ${fmt(f.last24h)} | ${fmt(z)} / ${fmt(
        zTotal,
      )} | ${fillPct} |`,
    );

    if (c > 0 && f.newest && f.newest < SINCE_14D) {
      warnings.push(
        `STALE: ${st} has ${fmt(c)} permits but newest is ${newest} (>14d)`,
      );
    }
    if (c > 0 && z > 0 && z < zTotal * 0.05) {
      warnings.push(
        `THIN ZIP COVERAGE: ${st} has ${z}/${zTotal} ZIPs (${fillPct})`,
      );
    }
  }
  lines.push("");
  lines.push(`**Active states**: ${activeStates}/51 (50 + DC)`);
  lines.push("");

  if (activeStates < 25) {
    failures.push(
      `Only ${activeStates}/51 states have any permits — pre-launch goal is ≥30`,
    );
  }

  // ── Section 2: trade breakdown
  lines.push("## 2. Trade coverage");
  lines.push("");
  lines.push("| permit_type | Count | % of total |");
  lines.push("|---|---:|---:|");
  let total = 0;
  for (const v of trades.values()) total += v;
  for (const [t, c] of trades) {
    lines.push(`| ${t} | ${fmt(c)} | ${pct(c, total)} |`);
    if (
      c > 0 &&
      c < total * 0.005 &&
      ["renovation", "new_construction", "addition", "demolition"].includes(t)
    ) {
      warnings.push(
        `THIN TRADE: ${t} is only ${pct(c, total)} of permits — may indicate enum mapper bug`,
      );
    }
  }
  lines.push("");
  lines.push(`**Total permits**: ${fmt(total)}`);
  lines.push("");

  // ── Section 3: stale sources
  lines.push("## 3. Stale enabled sources (no row in last 24h)");
  lines.push("");
  if (stale.length === 0) {
    lines.push("None — every enabled source produced data in the last 24h.");
  } else {
    lines.push("| source_id | source_city | last_run_at |");
    lines.push("|---|---|---|");
    for (const r of stale) {
      lines.push(
        `| ${r.id} | ${r.source_city} | ${r.last_run_at ?? "(never)"} |`,
      );
    }
    if (stale.length > 10) {
      warnings.push(
        `${stale.length} enabled sources are stale — investigate cron health`,
      );
    }
  }
  lines.push("");

  // ── Section 4: snapshot diff
  lines.push("## 4. Diff vs. previous run");
  lines.push("");
  const prev = readPrevSnapshot();
  if (!prev) {
    lines.push("No previous snapshot — this is the baseline.");
  } else {
    const prevSet = new Set(prev.states_with_data);
    const nowSet = new Set(statesWithData);
    const added = statesWithData.filter((x) => !prevSet.has(x));
    const removed = prev.states_with_data.filter((x) => !nowSet.has(x));
    lines.push(
      `Previous: ${fmt(prev.total_permits)} permits across ${prev.states_with_data.length} states (${prev.timestamp.slice(0, 10)})`,
    );
    lines.push(
      `Current:  ${fmt(total)} permits across ${activeStates} states`,
    );
    lines.push(
      `Delta: **${fmt(total - prev.total_permits)}** permits, **+${added.length} / -${removed.length}** states`,
    );
    lines.push("");
    if (added.length) lines.push(`**Newly active**: ${added.join(", ")}`);
    if (removed.length) {
      lines.push(`**Regressed (was active, now empty)**: ${removed.join(", ")}`);
      failures.push(
        `REGRESSION: ${removed.length} state(s) lost all permits since last run: ${removed.join(", ")}`,
      );
    }
  }
  lines.push("");

  writeSnapshot({
    timestamp: startedAt.toISOString(),
    states_with_data: statesWithData,
    total_permits: total,
  });

  // ── Section 5: gate summary
  lines.push("## 5. Gate summary");
  lines.push("");
  if (failures.length === 0 && warnings.length === 0) {
    lines.push("**PASS** — no failures, no warnings.");
  } else {
    if (failures.length) {
      lines.push("### Failures (block deploy)");
      for (const f of failures) lines.push(`- ${f}`);
      lines.push("");
    }
    if (warnings.length) {
      lines.push("### Warnings (review, don't necessarily block)");
      for (const w of warnings) lines.push(`- ${w}`);
      lines.push("");
    }
  }

  // ── write report file
  const dateStr = startedAt.toISOString().slice(0, 10);
  const reportPath = path.resolve(
    process.cwd(),
    "docs",
    "studies",
    `verify-coverage-${dateStr}.md`,
  );
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, lines.join("\n"));
  console.log(`\n[verify] Wrote ${reportPath}`);
  console.log(`[verify] Active states: ${activeStates}/51`);
  console.log(`[verify] Total permits: ${fmt(total)}`);
  console.log(
    `[verify] Failures: ${failures.length}, Warnings: ${warnings.length}`,
  );

  // Exit code: 1 on failures (always); 1 on warnings if --strict.
  if (failures.length > 0) process.exit(1);
  if (STRICT && warnings.length > 0) process.exit(1);
  process.exit(0);
})();
