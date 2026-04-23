/**
 * DEV / GOD-MODE: Claim every ZIP that has permits for the owner contractor.
 *
 * Rationale: the scoring cron only generates a lead when a permit's ZIP has
 * at least one active territory. To unlock "all leads nationwide" for the
 * god-mode user, we grant them a slot in every ZIP present in the permits
 * table. Subsequent scoring runs will then create owner-assigned leads for
 * every scorable permit.
 *
 * Idempotent: skips ZIPs the owner already owns, skips ZIPs where all 3
 * slots are taken, batches inserts with ON CONFLICT DO NOTHING.
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

(async () => {
  const { data: owner } = await s
    .from("profiles")
    .select("id, email")
    .eq("email", "y.abismuth@gmail.com")
    .single();
  if (!owner) {
    console.error("Owner not found");
    process.exit(1);
  }

  // 1. Collect every ZIP that appears in permits (paginated keyset scan).
  console.log("Collecting unique ZIPs from permits…");
  const zips = new Set<string>();
  let lastId: string | null = null;
  let scanned = 0;
  while (true) {
    let q = s.from("permits").select("id, zip").order("id").limit(1000);
    if (lastId) q = q.gt("id", lastId);
    const { data, error } = await q;
    if (error || !data || data.length === 0) break;
    for (const p of data) {
      if (p.zip && /^\d{5}$/.test(p.zip)) zips.add(p.zip);
    }
    lastId = data[data.length - 1].id as string;
    scanned += data.length;
    if (scanned % 20000 < 1000) console.log(`  scanned ${scanned.toLocaleString()}, unique ZIPs: ${zips.size}`);
    if (data.length < 1000) break;
  }
  console.log(`Total: ${scanned.toLocaleString()} permits, ${zips.size.toLocaleString()} unique ZIPs`);

  // 2. ZIPs the owner already has active territory for → skip.
  const { data: existing } = await s
    .from("territories")
    .select("zip")
    .eq("contractor_id", owner.id)
    .eq("status", "active");
  const alreadyOwned = new Set((existing ?? []).map((t) => t.zip));
  const toClaim = [...zips].filter((z) => !alreadyOwned.has(z));
  console.log(`Owner already holds ${alreadyOwned.size} ZIPs, need to claim ${toClaim.length}`);

  // 3. Bulk insert with slot_number=1. If slot 1 is taken, fall back to 2 or 3.
  const now = new Date().toISOString();
  const BATCH = 500;
  let inserted = 0;
  let skipped = 0;
  for (let i = 0; i < toClaim.length; i += BATCH) {
    const chunk = toClaim.slice(i, i + BATCH).map((zip) => ({
      zip,
      contractor_id: owner.id,
      status: "active" as const,
      slot_number: 1,
      claimed_at: now,
    }));
    // Try bulk insert; on conflict (zip,slot_number) UNIQUE WHERE status=active,
    // fall back to per-row with slot 2/3.
    const { error, data } = await s
      .from("territories")
      .insert(chunk)
      .select("zip");
    if (!error) {
      inserted += data?.length ?? 0;
    } else {
      // Conflict on at least one row — do row-by-row with slot fallback.
      for (const row of chunk) {
        let placed = false;
        for (const slot of [1, 2, 3]) {
          const { error: e2 } = await s.from("territories").insert({
            ...row,
            slot_number: slot,
          });
          if (!e2) {
            inserted++;
            placed = true;
            break;
          }
        }
        if (!placed) skipped++;
      }
    }
    if ((i / BATCH) % 10 === 0) console.log(`  claimed ${inserted.toLocaleString()}, skipped ${skipped}`);
  }

  console.log(`\nDone. Inserted ${inserted.toLocaleString()} new territories, skipped ${skipped} (all slots taken).`);

  const { count: final } = await s
    .from("territories")
    .select("*", { count: "exact", head: true })
    .eq("contractor_id", owner.id)
    .eq("status", "active");
  console.log(`Owner now holds ${final?.toLocaleString()} active territories.`);
})();
