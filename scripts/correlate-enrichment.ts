/**
 * Free enrichment by in-DB correlation.
 *
 * Four passes, each pure SQL against our existing ingested data — no
 * external API calls, no rate limits, no paid integrations:
 *
 *   Pass 1 — Cross-permit owner propagation
 *     Same address, multiple permits → owner_name propagates across.
 *     If any permit at address X has owner_name, copy it to the rest
 *     of the permits at X where owner_name IS NULL. Homeowners rarely
 *     change mid-year so this is a high-confidence fill.
 *
 *   Pass 2 — Permits → leads owner sync
 *     Many leads have owner_name IS NULL even when their backing
 *     permit (via permit_id) now has it populated. Pure join-update.
 *
 *   Pass 3 — First/last split back-fill
 *     Wherever owner_name is set but owner_first/owner_last are null,
 *     use the business-name-parser to split.
 *
 *   Pass 4 — Contractor-name → applicant-name LLC correlation
 *     When permit.contractor_name is set but applicant_name is null,
 *     look for OTHER permits filed by that same contractor_name — the
 *     applicant_name on those is often the principal. Propagate.
 *
 * Idempotent. Safe to re-run. Run:
 *   npx tsx scripts/correlate-enrichment.ts
 *   DRY_RUN=1 npx tsx scripts/correlate-enrichment.ts
 *
 * Expected runtime: 10–30 min against a 930k-permit / 134k-lead DB.
 */
import { createClient } from "@supabase/supabase-js";
import * as path from "path";
import * as dotenv from "dotenv";
import { parseBusinessName } from "../src/lib/enrichment/business-name-parser";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const DRY_RUN = process.env.DRY_RUN === "1";
const PAGE = 1000;
const CONCURRENCY = 10;

/**
 * Address normalizer — collapses trivial differences so we can group
 * permits at "the same place" without false splits on casing /
 * whitespace / punctuation. Does NOT attempt USPS-grade standardization
 * (that needs an API); just enough to merge "123 Main St" / "123 MAIN ST"
 * / " 123 main st ".
 */
function normalizeAddress(addr: string | null | undefined, zip?: string | null): string | null {
  if (!addr) return null;
  const a = addr
    .toUpperCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.,]/g, "");
  return zip ? `${a}|${zip}` : a;
}

async function updateBatch<T extends { id: string }>(
  table: string,
  rows: T[],
  buildPatch: (r: T) => Record<string, unknown>,
): Promise<number> {
  if (DRY_RUN) return rows.length;
  let ok = 0;
  let i = 0;
  async function worker() {
    while (i < rows.length) {
      const r = rows[i++];
      if (!r) break;
      const patch = buildPatch(r);
      if (Object.keys(patch).length === 0) continue;
      const { error } = await s.from(table).update(patch).eq("id", r.id);
      if (!error) ok++;
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  return ok;
}

/* ── PASS 1: Cross-permit owner propagation ─────────────────────────── */
/*
 * Strategy: walk the permits table in pages. For each permit with
 * owner_name/applicant_name IS NULL, look up other permits at the
 * same (normalized address, zip) that DO have it. Copy the most
 * recently-filed value.
 *
 * We don't try to do this in one giant SELECT with a window function
 * — Supabase PostgREST doesn't support that directly, and a raw SQL
 * RPC path would need a SUPABASE_ACCESS_TOKEN. Instead we do it in
 * batches, which is slower but doesn't need migration access.
 */
async function pass1_crossPermitOwner(): Promise<{ scanned: number; patched: number }> {
  console.log("\n[1/4] Cross-permit owner propagation");
  let scanned = 0;
  let patched = 0;
  let iter = 0;

  while (iter < 200) {
    iter++;
    // Pull a page of permits missing owner + applicant, with an address + zip
    // we can group on.
    const { data: missing, error } = await s
      .from("permits")
      .select("id, address, zip")
      .is("applicant_name", null)
      .not("address", "is", null)
      .not("zip", "is", null)
      .neq("zip", "")
      .limit(PAGE);
    if (error) {
      console.warn(`  iter ${iter} scan error: ${error.message}`);
      break;
    }
    if (!missing || missing.length === 0) break;

    // Group by normalized (address, zip) so we look up each address once,
    // not once per permit with missing name.
    const grouped = new Map<string, string[]>(); // key → permit ids
    for (const p of missing) {
      const key = normalizeAddress(p.address as string, p.zip as string);
      if (!key) continue;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(p.id as string);
    }
    scanned += missing.length;

    // For each unique address, look up any permit at THIS same address
    // (any zip) that has an owner. Prefer the newest. Concurrency on
    // lookups so we don't serialize 1000 × address lookups.
    const entries = [...grouped.entries()];
    let ei = 0;
    const owners = new Map<string, string>(); // key → owner_name

    async function lookupWorker() {
      while (ei < entries.length) {
        const [key, _ids] = entries[ei++];
        if (!key) break;
        const [addr, zip] = key.split("|");
        if (!addr || !zip) continue;
        // Query: permits at this address+zip where owner is present.
        // Use UPPER-match trick so we match across case variants.
        const { data: donors } = await s
          .from("permits")
          .select("applicant_name, contractor_name, issued_date")
          .eq("zip", zip)
          .ilike("address", addr)
          .not("applicant_name", "is", null)
          .order("issued_date", { ascending: false })
          .limit(1);
        const donor = donors?.[0] as
          | { applicant_name: string | null }
          | undefined;
        if (donor?.applicant_name) owners.set(key, donor.applicant_name);
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, () => lookupWorker()));

    // Patch each permit with the owner from its address group.
    const toPatch: Array<{ id: string; applicant_name: string }> = [];
    for (const [key, ids] of grouped) {
      const owner = owners.get(key);
      if (!owner) continue;
      for (const id of ids) toPatch.push({ id, applicant_name: owner });
    }
    if (toPatch.length > 0) {
      const ok = await updateBatch("permits", toPatch, (r) => ({
        applicant_name: r.applicant_name,
      }));
      patched += ok;
    }

    console.log(
      `  iter ${iter}: scanned=${scanned.toLocaleString()} patched_total=${patched.toLocaleString()} (this iter +${toPatch.length})`,
    );

    // Progress bail: if no patches in this iteration AND we scanned a
    // full page, the next page is the same filter (because patched
    // rows drop out). But if no new patches happened, we're hitting
    // address-groups where no donor exists — genuine miss, move on.
    if (missing.length < PAGE) break;
  }

  return { scanned, patched };
}

/* ── PASS 2: Permits → leads owner sync ─────────────────────────────── */
/*
 * Many leads have owner_name/owner_first/owner_last IS NULL even when
 * their backing permit.applicant_name or permit.contractor_name is now
 * populated (thanks to Pass 1 and backfill-contact-from-raw). Walk
 * leads w/ owner_name IS NULL, look up the joined permit, populate
 * from applicant_name.
 */
async function pass2_leadsOwnerSync(): Promise<{ scanned: number; patched: number }> {
  console.log("\n[2/4] Permits → leads owner sync");
  let scanned = 0;
  let patched = 0;
  let iter = 0;

  while (iter < 200) {
    iter++;
    const { data: leads, error } = await s
      .from("leads")
      .select("id, permit_id, permits(applicant_name)")
      .is("owner_name", null)
      .not("permit_id", "is", null)
      .limit(PAGE);
    if (error) {
      console.warn(`  iter ${iter} scan error: ${error.message}`);
      break;
    }
    if (!leads || leads.length === 0) break;
    scanned += leads.length;

    const toPatch: Array<{ id: string; owner_name: string }> = [];
    for (const lead of leads) {
      const p = lead.permits as
        | { applicant_name: string | null }
        | Array<{ applicant_name: string | null }>
        | null;
      const permitRow = Array.isArray(p) ? p[0] : p;
      const name = permitRow?.applicant_name?.trim();
      if (name) toPatch.push({ id: lead.id as string, owner_name: name });
    }

    if (toPatch.length > 0) {
      const ok = await updateBatch("leads", toPatch, (r) => ({
        owner_name: r.owner_name,
      }));
      patched += ok;
    }
    console.log(
      `  iter ${iter}: scanned=${scanned.toLocaleString()} patched=${patched.toLocaleString()}`,
    );
    if (leads.length < PAGE || toPatch.length === 0) break;
  }
  return { scanned, patched };
}

/* ── PASS 3: First/last split back-fill ─────────────────────────────── */
async function pass3_firstLastSplit(): Promise<{ scanned: number; patched: number }> {
  console.log("\n[3/4] First/last split back-fill");
  let scanned = 0;
  let patched = 0;
  let iter = 0;

  while (iter < 200) {
    iter++;
    const { data: leads, error } = await s
      .from("leads")
      .select("id, owner_name")
      .not("owner_name", "is", null)
      .is("owner_last", null)
      .limit(PAGE);
    if (error) {
      console.warn(`  iter ${iter} scan error: ${error.message}`);
      break;
    }
    if (!leads || leads.length === 0) break;
    scanned += leads.length;

    const toPatch: Array<{
      id: string;
      owner_first: string | null;
      owner_last: string | null;
    }> = [];
    for (const lead of leads) {
      const ownerName = lead.owner_name as string;
      const parsed = parseBusinessName(ownerName);
      if (parsed.first || parsed.last) {
        toPatch.push({
          id: lead.id as string,
          owner_first: parsed.first,
          owner_last: parsed.last,
        });
      }
    }
    if (toPatch.length > 0) {
      const ok = await updateBatch("leads", toPatch, (r) => {
        const patch: Record<string, unknown> = {};
        if (r.owner_first) patch.owner_first = r.owner_first;
        if (r.owner_last) patch.owner_last = r.owner_last;
        return patch;
      });
      patched += ok;
    }
    console.log(
      `  iter ${iter}: scanned=${scanned.toLocaleString()} patched=${patched.toLocaleString()}`,
    );
    if (leads.length < PAGE || toPatch.length === 0) break;
  }
  return { scanned, patched };
}

/* ── PASS 4: Contractor-name → applicant-name propagation ───────────── */
/*
 * Business-name matching: when permit A has contractor_name =
 * "SMITH PLUMBING LLC" and permit B has contractor_name matching the
 * same normalized business name PLUS applicant_name = "John Smith",
 * that John is likely the principal of SMITH PLUMBING. Propagate
 * John's name as a candidate to all A-like permits where applicant
 * is null.
 *
 * Conservative: only propagate when we've seen a specific
 * (contractor_name → applicant_name) pair at least 3 times in other
 * permits. Avoids spraying a random employee's name as "owner".
 */
async function pass4_contractorPrincipalCorrelation(): Promise<{ scanned: number; patched: number }> {
  console.log("\n[4/4] Contractor-name → principal correlation");
  // Step 1: build the frequency map of (contractor_name → applicant_name)
  // across the whole permits table where BOTH are populated. This is
  // expensive; cap pages to 20 × 1000 = 20k samples for the initial
  // pass. It's a directional signal, not a full census — 20k pairs is
  // enough to surface the top few thousand LLCs that appear repeatedly.
  console.log("  building contractor → principal map...");
  const pairCounts = new Map<string, Map<string, number>>();
  let sampled = 0;
  for (let page = 0; page < 20; page++) {
    const { data } = await s
      .from("permits")
      .select("contractor_name, applicant_name")
      .not("contractor_name", "is", null)
      .not("applicant_name", "is", null)
      .range(page * PAGE, (page + 1) * PAGE - 1);
    if (!data || data.length === 0) break;
    sampled += data.length;
    for (const row of data) {
      const c = (row.contractor_name as string).toUpperCase().trim();
      const a = (row.applicant_name as string).trim();
      if (!c || !a) continue;
      if (!pairCounts.has(c)) pairCounts.set(c, new Map());
      const inner = pairCounts.get(c)!;
      inner.set(a, (inner.get(a) ?? 0) + 1);
    }
  }
  console.log(`  sampled ${sampled.toLocaleString()} pairs, ${pairCounts.size.toLocaleString()} unique contractors`);

  // Step 2: for each contractor with a "dominant" principal (≥3 appearances
  // AND ≥50% of that contractor's applicant occurrences), record the map.
  const contractorPrincipal = new Map<string, string>();
  for (const [c, inner] of pairCounts) {
    const total = [...inner.values()].reduce((a, b) => a + b, 0);
    for (const [a, count] of inner) {
      if (count >= 3 && count / total >= 0.5) {
        contractorPrincipal.set(c, a);
        break;
      }
    }
  }
  console.log(`  ${contractorPrincipal.size.toLocaleString()} contractors have a dominant principal`);

  // Step 3: scan permits where contractor_name is set but applicant_name
  // is NULL, fill with the mapped principal.
  let scanned = 0;
  let patched = 0;
  let iter = 0;
  while (iter < 100) {
    iter++;
    const { data: candidates, error } = await s
      .from("permits")
      .select("id, contractor_name")
      .not("contractor_name", "is", null)
      .is("applicant_name", null)
      .limit(PAGE);
    if (error) {
      console.warn(`  iter ${iter} scan error: ${error.message}`);
      break;
    }
    if (!candidates || candidates.length === 0) break;
    scanned += candidates.length;

    const toPatch: Array<{ id: string; applicant_name: string }> = [];
    for (const p of candidates) {
      const c = ((p.contractor_name as string) ?? "").toUpperCase().trim();
      const principal = contractorPrincipal.get(c);
      if (principal) toPatch.push({ id: p.id as string, applicant_name: principal });
    }

    if (toPatch.length > 0) {
      const ok = await updateBatch("permits", toPatch, (r) => ({
        applicant_name: r.applicant_name,
      }));
      patched += ok;
    }
    console.log(
      `  iter ${iter}: scanned=${scanned.toLocaleString()} patched=${patched.toLocaleString()}`,
    );
    if (candidates.length < PAGE || toPatch.length === 0) break;
  }
  return { scanned, patched };
}

(async () => {
  console.log(DRY_RUN ? "[DRY RUN]" : "[LIVE]", "correlate-enrichment");
  const t0 = Date.now();

  const p1 = await pass1_crossPermitOwner();
  const p2 = await pass2_leadsOwnerSync();
  const p3 = await pass3_firstLastSplit();
  const p4 = await pass4_contractorPrincipalCorrelation();

  const elapsed = Math.round((Date.now() - t0) / 1000);
  console.log("\n──────── summary ────────");
  console.log(`Pass 1 (cross-permit owner)    : scanned ${p1.scanned.toLocaleString()}, patched ${p1.patched.toLocaleString()}`);
  console.log(`Pass 2 (permits → leads sync)   : scanned ${p2.scanned.toLocaleString()}, patched ${p2.patched.toLocaleString()}`);
  console.log(`Pass 3 (first/last split)       : scanned ${p3.scanned.toLocaleString()}, patched ${p3.patched.toLocaleString()}`);
  console.log(`Pass 4 (contractor → principal) : scanned ${p4.scanned.toLocaleString()}, patched ${p4.patched.toLocaleString()}`);
  console.log(`\nTotal wall time: ${elapsed}s`);
})();
