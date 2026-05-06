/**
 * End-to-end pipeline verification — sources → permits → score → leads →
 * territory ↔ god-mode visibility.
 *
 * Why this exists: after the FINAL no-auth catalog import + Move 1+2 ship,
 * we need ground truth on:
 *   1. permits — coverage by ZIP, geocoding rate, scoring backlog
 *   2. leads — contractor assignment, geocoding, ZIP match
 *   3. territory ↔ ZIP overlap — are claimed territories meaningful?
 *   4. god-mode visibility — what does the founder actually see?
 *
 * Read-only. No mutations. Safe to re-run any time.
 *
 * Usage: npx tsx scripts/_verify-pipeline.ts
 */
import { createClient } from "@supabase/supabase-js";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const FOUNDER_EMAIL = "y.abismuth@gmail.com";

// All counts use estimated (instant via pg_class.reltuples) — exact would
// hit the 8s statement timeout on the 1.45M-row permits table.
async function count(
  table: string,
  filter?: (q: ReturnType<typeof s.from>) => unknown,
  mode: "estimated" | "exact" = "estimated",
): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = s.from(table).select("*", { count: mode, head: true });
  if (filter) q = filter(q);
  const { count, error } = await q;
  if (error) {
    console.warn(`  [warn] ${table}.count(${mode}) failed: ${error.message}`);
    return -1;
  }
  return count ?? 0;
}

function pct(num: number, denom: number): string {
  if (denom <= 0) return "n/a";
  return `${((num / denom) * 100).toFixed(1)}%`;
}

function fmt(n: number): string {
  return n < 0 ? "ERR" : n.toLocaleString();
}

async function section(title: string): Promise<void> {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 70 - title.length))}`);
}

async function main() {
  console.log("══ Henri pipeline verification ══════════════════════════════════════");

  /* 1. PERMITS — the source of truth */
  await section("1. PERMITS");
  const permitsTotal = await count("permits");
  const permitsZipNull = await count("permits", (q) => q.is("zip", null));
  const permitsLatNull = await count("permits", (q) => q.is("latitude", null));
  const permitsLngNull = await count("permits", (q) => q.is("longitude", null));
  const permitsScored = await count("permits", (q) => q.not("scored_at", "is", null));
  const permitsUnscored = await count("permits", (q) => q.is("scored_at", null));
  console.log(`  total                   : ${fmt(permitsTotal)}`);
  console.log(`  ZIP populated           : ${fmt(permitsTotal - permitsZipNull)} (${pct(permitsTotal - permitsZipNull, permitsTotal)})`);
  console.log(`  ZIP null                : ${fmt(permitsZipNull)} (${pct(permitsZipNull, permitsTotal)})`);
  console.log(`  geocoded (lat+lng)      : ${fmt(permitsTotal - Math.max(permitsLatNull, permitsLngNull))} (${pct(permitsTotal - Math.max(permitsLatNull, permitsLngNull), permitsTotal)})`);
  console.log(`  scored                  : ${fmt(permitsScored)} (${pct(permitsScored, permitsTotal)})`);
  console.log(`  unscored                : ${fmt(permitsUnscored)} (${pct(permitsUnscored, permitsTotal)})`);

  /* 2. LEADS — what surfaces to contractors */
  await section("2. LEADS");
  const leadsTotal = await count("leads");
  const leadsContractorNull = await count("leads", (q) => q.is("contractor_id", null));
  const leadsZipNull = await count("leads", (q) => q.is("zip", null));
  const leadsAddrNull = await count("leads", (q) => q.is("address", null));
  const leadsLatNull = await count("leads", (q) => q.is("latitude", null));
  const leadsLngNull = await count("leads", (q) => q.is("longitude", null));
  const leadsGeocoded = await count("leads", (q) =>
    q.not("latitude", "is", null).not("longitude", "is", null),
  );
  console.log(`  total                   : ${fmt(leadsTotal)}`);
  console.log(`  contractor_id null      : ${fmt(leadsContractorNull)} (${pct(leadsContractorNull, leadsTotal)})`);
  console.log(`  ZIP populated           : ${fmt(leadsTotal - leadsZipNull)} (${pct(leadsTotal - leadsZipNull, leadsTotal)})`);
  console.log(`  address populated       : ${fmt(leadsTotal - leadsAddrNull)} (${pct(leadsTotal - leadsAddrNull, leadsTotal)})`);
  console.log(`  geocoded (lat+lng)      : ${fmt(leadsGeocoded)} (${pct(leadsGeocoded, leadsTotal)})`);
  console.log(`  lat null                : ${fmt(leadsLatNull)} (${pct(leadsLatNull, leadsTotal)})`);
  console.log(`  lng null                : ${fmt(leadsLngNull)} (${pct(leadsLngNull, leadsTotal)})`);
  console.log(`  geocoding gap           : ${fmt(leadsTotal - leadsGeocoded)} leads need backfill`);

  /* 3. SOURCES — ingest catalog */
  await section("3. PERMIT_SOURCES");
  const sourcesTotal = await count("permit_sources");
  const sourcesEnabled = await count("permit_sources", (q) => q.eq("enabled", true));
  // Recently-touched (last hour) = the FINAL importer's footprint.
  const oneHrAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const sourcesRecent = await count("permit_sources", (q) => q.gte("updated_at", oneHrAgo));
  console.log(`  total                   : ${fmt(sourcesTotal)}`);
  console.log(`  enabled=true            : ${fmt(sourcesEnabled)} (${pct(sourcesEnabled, sourcesTotal)})`);
  console.log(`  touched in last hr      : ${fmt(sourcesRecent)} (FINAL importer footprint)`);

  /* 4. TERRITORIES + ZIP overlap */
  await section("4. TERRITORIES + ZIP OVERLAP");
  const { data: founderProfile } = await s
    .from("profiles")
    .select("id, full_name")
    .eq("email", FOUNDER_EMAIL)
    .maybeSingle();
  if (!founderProfile) {
    console.log(`  [warn] no profile for ${FOUNDER_EMAIL}`);
  } else {
    const founderId = (founderProfile as { id: string }).id;
    const territoriesTotal = await count("territories", (q) =>
      q.eq("contractor_id", founderId),
    );
    const territoriesActive = await count("territories", (q) =>
      q.eq("contractor_id", founderId).eq("status", "active"),
    );
    console.log(`  founder profile         : ${(founderProfile as { full_name: string | null }).full_name ?? FOUNDER_EMAIL}`);
    console.log(`  founder territories     : ${fmt(territoriesTotal)} total, ${fmt(territoriesActive)} active`);

    // Sample ZIP overlap — collect leads ZIPs (limit 5k) and territories ZIPs
    // (limit 12k), check intersection.
    const { data: leadZipRows } = await s
      .from("leads")
      .select("zip")
      .eq("contractor_id", founderId)
      .not("zip", "is", null)
      .limit(5000);
    const leadZipSet = new Set<string>(
      (leadZipRows ?? []).map((r) => (r as { zip: string }).zip).filter(Boolean),
    );
    console.log(`  unique ZIPs in founder leads (sample 5k) : ${leadZipSet.size.toLocaleString()}`);

    // Pull all territory ZIPs in chunks (PostgREST 1000-row cap).
    const territoryZipSet = new Set<string>();
    for (let off = 0; off < 12000; off += 1000) {
      const { data } = await s
        .from("territories")
        .select("zip")
        .eq("contractor_id", founderId)
        .range(off, off + 999);
      if (!data || data.length === 0) break;
      for (const r of data) territoryZipSet.add((r as { zip: string }).zip);
      if (data.length < 1000) break;
    }
    console.log(`  unique ZIPs in founder territories       : ${territoryZipSet.size.toLocaleString()}`);

    // Intersection check
    let inBoth = 0;
    for (const z of leadZipSet) if (territoryZipSet.has(z)) inBoth++;
    console.log(`  lead ZIPs ALSO in territories            : ${inBoth.toLocaleString()} (${pct(inBoth, leadZipSet.size)})`);
    console.log(`  lead ZIPs NOT in territories             : ${(leadZipSet.size - inBoth).toLocaleString()} (legacy leads from prior territory claims)`);
  }

  /* 5. GOD-MODE VISIBILITY — what the dashboard's useLeads({skip_permits_join:true,limit:25k,filters:{geocoded_only:true}}) sees */
  await section("5. GOD-MODE DASHBOARD VISIBILITY");
  const godVisibleTotal = await count("leads", (q) =>
    q.not("latitude", "is", null).not("longitude", "is", null),
  );
  console.log(`  geocoded leads (god-mode pool)   : ${fmt(godVisibleTotal)}`);
  console.log(`  dashboard cap (limit 25,000)     : ${fmt(Math.min(25_000, godVisibleTotal))}`);
  console.log(`  visible vs total leads           : ${pct(godVisibleTotal, leadsTotal)} of all leads`);
  console.log(`  visible vs total permits         : ${pct(godVisibleTotal, permitsTotal)} of all permits`);

  /* 6. ORPHANS / WEIRD STATES */
  await section("6. ORPHANS + INTEGRITY");
  // Permits scored but no lead row created (territory gate skipped them)
  const { data: scoredSample } = await s
    .from("permits")
    .select("id")
    .not("scored_at", "is", null)
    .limit(5000);
  const scoredIds = new Set<string>(
    (scoredSample ?? []).map((p) => (p as { id: string }).id),
  );
  let orphans = 0;
  // Sample 200 of those — quick existence check on leads.permit_id
  const sample = [...scoredIds].slice(0, 200);
  for (const pid of sample) {
    const { count: c } = await s
      .from("leads")
      .select("*", { count: "exact", head: true })
      .eq("permit_id", pid);
    if ((c ?? 0) === 0) orphans++;
  }
  console.log(`  scored permits with NO lead row : ${orphans} / 200 sampled (${((orphans / 200) * 100).toFixed(1)}%)`);
  console.log(`    → these were scored but their ZIP had no contractor → no lead row created.`);
  console.log(`    → Move 3 (bulk-claim every permit ZIP) plus future runs of`);
  console.log(`      _bulk-claim-and-score.ts will close this gap.`);

  console.log(`\n══ Verification done ══`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
