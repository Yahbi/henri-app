/**
 * One-shot backfill: re-extract owner fields from permits.raw_json into
 * existing leads that have null owner_name / owner_first / etc.
 *
 * Why this exists: early scorer runs only read lowercase `owner_first` /
 * `owner_last` from raw_json. Many jurisdictions ship OwnerFirst /
 * OWNER_NAME / APPLICANT_NAME / etc. This script re-runs the full
 * multi-casing extractor over every lead that still has a null owner_name
 * and patches the row. Idempotent: leads that already have an owner_name
 * are skipped.
 *
 * Usage: npx tsx scripts/backfill-owner-names.ts
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

function pick(raw: Record<string, unknown> | null, keys: string[]): string | null {
  if (!raw) return null;
  for (const k of keys) {
    const v = raw[k];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
}

function extractOwner(raw: Record<string, unknown> | null) {
  return {
    first: pick(raw, [
      "owner_first", "OwnerFirst", "OWNER_FIRST", "first_name", "FIRST_NAME",
      "applicant_first", "APPLICANT_FIRSTNAME", "ApplicantFirst",
    ]),
    last: pick(raw, [
      "owner_last", "OwnerLast", "OWNER_LAST", "last_name", "LAST_NAME",
      "applicant_last", "APPLICANT_LASTNAME", "ApplicantLast",
    ]),
    full: pick(raw, [
      "owner_name", "OwnerName", "OWNER_NAME", "owners_name", "OWNERS_NAME",
      "applicant_name", "APPLICANT_NAME", "ApplicantName", "Applicant",
    ]),
    phone: pick(raw, [
      "owner_phone", "OwnerPhone", "OWNER_PHONE", "phone", "PHONE", "Phone",
      "applicant_phone", "APPLICANT_PHONE",
    ]),
    email: pick(raw, [
      "owner_email", "OwnerEmail", "OWNER_EMAIL", "email", "EMAIL", "Email",
      "applicant_email", "APPLICANT_EMAIL",
    ]),
  };
}

(async () => {
  let updated = 0;
  let scanned = 0;
  let lastId: string | null = null;

  console.log("Scanning leads with null owner_name...");
  while (true) {
    let q = s
      .from("leads")
      .select("id, permit_id")
      .is("owner_name", null)
      .order("id")
      .limit(1000);
    if (lastId) q = q.gt("id", lastId);

    const { data, error } = await q;
    if (error) {
      console.error("scan error:", error.message);
      break;
    }
    if (!data || data.length === 0) break;

    const permitIds = data.map((l) => l.permit_id).filter(Boolean) as string[];
    const { data: permits } = await s
      .from("permits")
      .select("id, raw_json, applicant_name")
      .in("id", permitIds);
    const pmap = new Map(permits?.map((p) => [p.id as string, p]) ?? []);

    const updates: Array<{ id: string; patch: Record<string, string | null> }> = [];
    for (const l of data) {
      const p = pmap.get(l.permit_id as string);
      if (!p) continue;
      const raw = p.raw_json as Record<string, unknown> | null;
      const owner = extractOwner(raw);
      const fullFromRaw = owner.full ?? (p.applicant_name as string | null);
      if (!owner.first && !owner.last && !fullFromRaw && !owner.phone && !owner.email) continue;
      updates.push({
        id: l.id as string,
        patch: {
          owner_first: owner.first,
          owner_last: owner.last,
          owner_name: fullFromRaw,
          phone: owner.phone,
          email: owner.email,
        },
      });
    }

    // Batch updates per-row (Supabase doesn't support bulk per-row patches
    // without RLS bypass or rpc; service-role client will still rate-limit
    // politely). Chunk into parallel groups of 20 for throughput.
    for (let i = 0; i < updates.length; i += 20) {
      const chunk = updates.slice(i, i + 20);
      await Promise.all(
        chunk.map(async (u) => {
          const { error: upErr } = await s.from("leads").update(u.patch).eq("id", u.id);
          if (!upErr) updated++;
        }),
      );
    }

    scanned += data.length;
    lastId = data[data.length - 1].id as string;
    if (scanned % 10000 < 1000) {
      console.log(`  scanned ${scanned.toLocaleString()}, updated ${updated.toLocaleString()}`);
    }
    if (data.length < 1000) break;
  }

  console.log(`\nDone. Updated ${updated.toLocaleString()} of ${scanned.toLocaleString()} leads.`);
})();
