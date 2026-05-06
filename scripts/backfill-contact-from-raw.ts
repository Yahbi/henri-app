/**
 * Backfill owner / applicant / contractor / phone / email on permits +
 * the matching leads, extracted from `permits.raw_json` — data we
 * already ingested but never denormalized into queryable columns.
 *
 * Motivation (2026-04-22 audit):
 *   permits.applicant_name  NULL on 933,580 / 933,580 rows (100%)
 *   permits.contractor_name NULL on ~925k / 933k (99%)
 *   leads.owner_name        NULL on 133k / 138k (96%)
 *   leads.phone ∧ email     NULL on 133k / 138k (96%)
 *
 *   ...but sampling raw_json showed ~37% of permits DO carry an
 *   `ownername` / `owner_name` field and ~36% carry `applicant_name`.
 *   The ingester just never wrote the data into the denormalized
 *   columns. This script closes that gap — purely from data already
 *   in our DB, no external API calls, zero cost.
 *
 * Flow per page of permits (1,000 rows):
 *   1. SELECT permits with raw_json NOT null AND applicant_name IS NULL
 *   2. Run extractContact() on each raw_json
 *   3. For rows with any signal → UPSERT permits columns
 *   4. Look up matching leads by permit_id → update leads too
 *
 * Idempotent. Safe to re-run. Resumable via an offset state file so a
 * crash doesn't force starting over.
 *
 * Run: npx tsx scripts/backfill-contact-from-raw.ts
 *      MAX=50000 npx tsx scripts/backfill-contact-from-raw.ts
 */
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
import {
  extractContactWithProvenance,
  hasAnyContact,
  type ExtractedContactWithProvenance,
} from "../src/lib/ingest/extract-contact";

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const STATE_FILE = path.resolve(
  process.cwd(),
  "scripts",
  ".backfill-contact.state.json",
);
const PAGE = 1_000;
const UPDATE_BATCH = 50;
const MAX = Number(process.env.MAX ?? 200_000);

// Provenance columns (contact_source, contact_confidence, contact_extracted_at)
// only exist after migration 00039 lands. Until then, including them in an
// UPDATE makes PostgREST reject the whole row with "column does not exist".
// Set `WRITE_PROVENANCE=1` once the migration is applied to start stamping
// provenance; default off so re-runs on an unmigrated DB still patch the
// basic owner/applicant/contractor fields.
const WRITE_PROVENANCE = process.env.WRITE_PROVENANCE === "1";

function loadState(): { offset: number; permits_patched: number; leads_patched: number } {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    }
  } catch {}
  return { offset: 0, permits_patched: 0, leads_patched: 0 };
}
function saveState(st: { offset: number; permits_patched: number; leads_patched: number }): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(st, null, 2));
}

type PermitPatch = {
  id: string;
  applicant_name?: string | null;
  contractor_name?: string | null;
  contact_source?: string | null;
  contact_confidence?: number | null;
  contact_extracted_at?: string | null;
};
type LeadPatch = {
  id: string;
  owner_name?: string | null;
  owner_first?: string | null;
  owner_last?: string | null;
  phone?: string | null;
  email?: string | null;
  contact_source?: string | null;
  contact_confidence?: number | null;
  contact_extracted_at?: string | null;
};

/** Apply a batch of PATCH statements. PostgREST caps single-row updates
 *  so we issue one `.update().eq()` per row; batch concurrency keeps
 *  it reasonable without blowing past its URL-length limit. */
async function applyPermitPatches(patches: PermitPatch[]): Promise<number> {
  let ok = 0;
  const CONCURRENCY = 10;
  let i = 0;
  async function worker() {
    while (i < patches.length) {
      const p = patches[i++];
      if (!p) break;
      const { id, ...rest } = p;
      const { error } = await s.from("permits").update(rest).eq("id", id);
      if (!error) ok++;
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  return ok;
}

async function applyLeadPatches(patches: LeadPatch[]): Promise<number> {
  let ok = 0;
  const CONCURRENCY = 10;
  let i = 0;
  async function worker() {
    while (i < patches.length) {
      const p = patches[i++];
      if (!p) break;
      const { id, ...rest } = p;
      const { error } = await s.from("leads").update(rest).eq("id", id);
      if (!error) ok++;
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  return ok;
}

(async () => {
  const state = loadState();
  console.log(`resuming from offset ${state.offset.toLocaleString()}; patched so far: permits=${state.permits_patched.toLocaleString()} leads=${state.leads_patched.toLocaleString()}`);

  const t0 = Date.now();
  let scanned = 0;
  let extracted = 0;

  // Self-advancing filter pattern — since every patched row flips
  // `applicant_name` to non-null, subsequent `applicant_name IS NULL`
  // queries naturally skip the patched set. That means we can keep
  // `.range(0, PAGE-1)` on every query instead of climbing an offset —
  // avoiding the statement-timeout that killed the first run of this
  // script at offset 23k (ORDER BY id + deep OFFSET + 933k-row filter
  // blew past Supabase's 60s statement budget).
  //
  // We also drop the ORDER BY — for this backfill we don't care about
  // processing order; any 1000 unpatched rows are fine. Without the
  // sort, Postgres picks a sequential scan that stays under the budget.
  //
  // For progress tracking we just count processed rows; `state.offset`
  // is kept as a cumulative counter, not a query offset.
  let emptyStreak = 0;
  let lastFirstId: string | undefined;
  while (scanned < MAX) {
    const { data: permits, error } = await s
      .from("permits")
      .select("id, applicant_name, contractor_name, raw_json")
      .is("applicant_name", null)
      .not("raw_json", "is", null)
      .range(0, PAGE - 1);

    if (error) {
      console.error(`scan error: ${error.message}`);
      // Transient? back off briefly and try again once. If it fails
      // twice we bail so the state file still reflects real progress.
      if (emptyStreak >= 1) break;
      emptyStreak++;
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    if (!permits || permits.length === 0) {
      console.log("no more permits to scan — done");
      break;
    }
    emptyStreak = 0;

    // Stuck detection: if the same first row comes back twice in a row,
    // the filter isn't advancing (no patches applied to this batch).
    // That usually means the batch is 1000 rows where `raw_json` has
    // nothing the extractor recognises. Mark those rows with an empty
    // `applicant_name` sentinel so they drop out of the filter and the
    // scanner can move on.
    const firstId = permits[0]?.id as string | undefined;
    if (firstId && firstId === lastFirstId) {
      console.log(`  batch stuck at ${firstId} — flagging as no-op to unblock`);
      const ids = permits.map((p) => p.id as string);
      // Bulk update in URL-safe chunks
      for (let off = 0; off < ids.length; off += 50) {
        const chunk = ids.slice(off, off + 50);
        await s
          .from("permits")
          .update({ applicant_name: "" })
          .in("id", chunk);
      }
      lastFirstId = undefined;
      continue;
    }
    lastFirstId = firstId;

    const permitPatches: PermitPatch[] = [];
    const leadsToLookup: Map<string, ExtractedContactWithProvenance> = new Map();
    // One timestamp per batch is fine — these rows are all being
    // extracted in the same second anyway, and sharing one value lets
    // downstream analytics group patches by backfill run.
    const extractedAt = new Date().toISOString();

    for (const row of permits) {
      scanned++;
      const c = extractContactWithProvenance(row.raw_json);
      if (!hasAnyContact(c)) continue;

      // Only write applicant_name + contractor_name at the permit level.
      // owner_first/last go on the lead (permit is per-address, lead is
      // per-contractor-slot — owners belong with the lead surface).
      const pp: PermitPatch = { id: row.id as string };
      if (c.applicant_name) pp.applicant_name = c.applicant_name;
      else if (c.owner_name) pp.applicant_name = c.owner_name;
      if (c.contractor_name) pp.contractor_name = c.contractor_name;
      if (pp.applicant_name || pp.contractor_name) {
        // Provenance columns (migration 00039) — record which upstream
        // shape produced this contact + how confident we are. Gated on
        // WRITE_PROVENANCE because the columns may not exist yet.
        if (WRITE_PROVENANCE) {
          pp.contact_source = c.source;
          pp.contact_confidence = c.confidence;
          pp.contact_extracted_at = extractedAt;
        }
        permitPatches.push(pp);
      }
      extracted++;
      leadsToLookup.set(row.id as string, c);
    }

    if (permitPatches.length > 0) {
      let permitOk = 0;
      for (let off = 0; off < permitPatches.length; off += UPDATE_BATCH) {
        permitOk += await applyPermitPatches(permitPatches.slice(off, off + UPDATE_BATCH));
      }
      state.permits_patched += permitOk;
    }

    // Look up ANY leads matching these permit_ids, patch owner fields.
    if (leadsToLookup.size > 0) {
      const permitIds = [...leadsToLookup.keys()];
      // Split lookup into URL-safe chunks (50 ids per .in()).
      for (let off = 0; off < permitIds.length; off += 50) {
        const chunk = permitIds.slice(off, off + 50);
        const { data: leads, error: lErr } = await s
          .from("leads")
          .select("id, permit_id, owner_name, phone, email")
          .in("permit_id", chunk);
        if (lErr) {
          console.warn(`  leads lookup failed: ${lErr.message}`);
          continue;
        }
        if (!leads) continue;

        const leadPatches: LeadPatch[] = [];
        for (const lead of leads) {
          const c = leadsToLookup.get(lead.permit_id as string);
          if (!c) continue;
          const lp: LeadPatch = { id: lead.id as string };
          if (!lead.owner_name && c.owner_name) lp.owner_name = c.owner_name;
          if (c.owner_first) lp.owner_first = c.owner_first;
          if (c.owner_last)  lp.owner_last  = c.owner_last;
          if (!lead.phone && c.phone) lp.phone = c.phone;
          if (!lead.email && c.email) lp.email = c.email;
          if (Object.keys(lp).length > 1) {
            // Anything actually changing → stamp provenance too (gated).
            if (WRITE_PROVENANCE) {
              lp.contact_source = c.source;
              lp.contact_confidence = c.confidence;
              lp.contact_extracted_at = extractedAt;
            }
            leadPatches.push(lp);
          }
        }
        if (leadPatches.length > 0) {
          let leadOk = 0;
          for (let lb = 0; lb < leadPatches.length; lb += UPDATE_BATCH) {
            leadOk += await applyLeadPatches(leadPatches.slice(lb, lb + UPDATE_BATCH));
          }
          state.leads_patched += leadOk;
        }
      }
    }

    state.offset += permits.length;
    saveState(state);
    const elapsed = Math.round((Date.now() - t0) / 1000);
    console.log(
      `  offset=${state.offset.toLocaleString()}  scanned=${scanned.toLocaleString()}  extracted=${extracted.toLocaleString()}  permits_patched=${state.permits_patched.toLocaleString()}  leads_patched=${state.leads_patched.toLocaleString()}  (${elapsed}s)`,
    );

    if (permits.length < PAGE) {
      console.log("reached tail of scan — done");
      break;
    }
  }

  const elapsed = Math.round((Date.now() - t0) / 1000);
  console.log(
    `\nDone. scanned=${scanned.toLocaleString()}  extracted=${extracted.toLocaleString()}  permits_patched=${state.permits_patched.toLocaleString()}  leads_patched=${state.leads_patched.toLocaleString()}  in ${elapsed}s`,
  );
})();
