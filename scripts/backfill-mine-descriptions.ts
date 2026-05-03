/**
 * Bulk description-miner backfill.
 *
 * Why: extract-contact.ts (used by backfill-contact-from-raw.ts) reads
 * STRUCTURED raw_json fields like owner_email, contact_phone, etc. It
 * does not parse free-text description fields. As a result:
 *   - leads.phone is at 1.2% (mostly from structured fields)
 *   - leads.email is at 0.0% (no jurisdiction ships structured email)
 *
 * The description-miner module (src/lib/enrichment/description-miner.ts)
 * runs phone + email regex against free-text and tolerates US phone
 * formatting variants. It already lives inside the enrich orchestrator,
 * but that path only runs on leads with year_built IS NULL — so leads
 * already enriched for property data never get a re-scan for inline
 * contact text.
 *
 * This script bypasses the orchestrator entirely:
 *   1. SELECT leads where (phone IS NULL OR email IS NULL) AND
 *      permits.description IS NOT NULL
 *   2. Run mineMultiple() on the description text
 *   3. UPDATE leads.phone / leads.email when found
 *   4. Stamp contact_source='permit_description' + contact_extracted_at
 *
 * Idempotent. Pure regex, zero API cost. Safe to re-run; the WHERE
 * clause naturally re-narrows to rows still missing data.
 *
 * Run: npx tsx scripts/backfill-mine-descriptions.ts
 *      MAX=50000 npx tsx scripts/backfill-mine-descriptions.ts
 */
import { createClient } from "@supabase/supabase-js";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
import { mineMultiple } from "../src/lib/enrichment/description-miner";

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const PAGE = 1_000;
const MAX = Number(process.env.MAX ?? 200_000);

interface LeadRow {
  id: string;
  phone: string | null;
  email: string | null;
  permits: { description: string | null } | { description: string | null }[] | null;
}

async function main() {
  let scanned = 0;
  let mined = 0;
  let phonePatched = 0;
  let emailPatched = 0;
  const startedAt = Date.now();

  // Cursor-based pagination using id (uuid). We iterate ascending and
  // never re-touch a row twice.
  let cursorId: string | null = null;

  while (scanned < MAX) {
    /*
     * 2026-05-02 fix: the .or("phone.is.null,email.is.null") forced a
     * sequential scan against 226k leads + permits join, hitting the
     * 60s Supabase statement timeout. Drop the OR; filter in JS
     * instead. Cost: we scan rows that already have both phone and
     * email, but JS filter is cheap and the per-page query is now
     * index-sargable on (id ASC).
     */
    let q = s
      .from("leads")
      .select("id, phone, email, permits(description)")
      .order("id", { ascending: true })
      .limit(PAGE);
    if (cursorId !== null) q = q.gt("id", cursorId);

    const { data, error } = await q;
    if (error) {
      console.error("query error", error.message);
      break;
    }
    if (!data || data.length === 0) {
      console.log("no more rows.");
      break;
    }

    for (const row of data as LeadRow[]) {
      scanned++;
      cursorId = row.id;

      // JS-side filter that replaces the dropped .or() clause.
      if (row.phone && row.email) continue;

      const permitsField = row.permits;
      const permitRow = Array.isArray(permitsField)
        ? permitsField[0]
        : permitsField;
      const desc = permitRow?.description;
      if (!desc) continue;

      const m = mineMultiple([desc]);
      if (m.phones.length === 0 && m.emails.length === 0) continue;

      mined++;
      const patch: Record<string, unknown> = {};
      if (!row.phone && m.phones.length > 0) {
        patch.phone = m.phones[0];
        phonePatched++;
      }
      if (!row.email && m.emails.length > 0) {
        patch.email = m.emails[0];
        emailPatched++;
      }
      if (Object.keys(patch).length === 0) continue;

      patch.contact_source = "permit_description";
      patch.contact_extracted_at = new Date().toISOString();

      const { error: updErr } = await s
        .from("leads")
        .update(patch)
        .eq("id", row.id);
      if (updErr) {
        // Some columns might not exist (contact_source/contact_extracted_at);
        // retry without them.
        if (/column.*contact_(source|extracted_at)/i.test(updErr.message)) {
          delete patch.contact_source;
          delete patch.contact_extracted_at;
          await s.from("leads").update(patch).eq("id", row.id);
        } else {
          console.error(`update fail ${row.id}: ${updErr.message}`);
        }
      }
    }

    if (scanned % 10_000 < PAGE) {
      console.log(
        `scanned=${scanned.toLocaleString()}  mined=${mined.toLocaleString()}  phone+=${phonePatched.toLocaleString()}  email+=${emailPatched.toLocaleString()}  (${Math.round((Date.now() - startedAt) / 1000)}s)`,
      );
    }
  }

  console.log(
    `\nDone. scanned=${scanned}  mined=${mined}  phone+=${phonePatched}  email+=${emailPatched}  in ${Math.round((Date.now() - startedAt) / 1000)}s`,
  );
}

main().catch((err) => {
  console.error("fatal", err);
  process.exit(1);
});
