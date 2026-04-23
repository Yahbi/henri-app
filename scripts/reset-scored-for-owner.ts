/**
 * After bulk-claiming territories, any permit that was previously scored but
 * whose ZIP wasn't in owner's territory has no owner-assigned lead. Reset
 * `scored_at = NULL` on those permits so the next scoring run creates leads
 * for them. Idempotent: permits that already have an owner lead are skipped.
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
    .select("id")
    .eq("email", "y.abismuth@gmail.com")
    .single();
  if (!owner) { console.error("no owner"); process.exit(1); }

  // Find all permits that have no lead for the owner yet.
  // Strategy: pull owner's lead permit_ids in batches (93k so it takes a moment),
  // then find permits.id NOT IN that set, and flip their scored_at to null.

  console.log("Collecting permit_ids already-leaded for owner…");
  const ownedPermitIds = new Set<string>();
  let lastId: string | null = null;
  while (true) {
    let q = s.from("leads").select("permit_id").eq("contractor_id", owner.id).order("permit_id").limit(1000);
    if (lastId) q = q.gt("permit_id", lastId);
    const { data, error } = await q;
    if (error || !data || data.length === 0) break;
    for (const l of data) if (l.permit_id) ownedPermitIds.add(l.permit_id as string);
    lastId = data[data.length - 1].permit_id as string;
    if (data.length < 1000) break;
  }
  console.log(`Owner has leads for ${ownedPermitIds.size.toLocaleString()} permits`);

  // Paginate permits and flip scored_at=null on ones missing from the owned set.
  console.log("Resetting scored_at on permits the owner has no lead for…");
  let resetCount = 0;
  let lastPermitId: string | null = null;
  let scanned = 0;
  while (true) {
    let q = s.from("permits").select("id").order("id").limit(1000);
    if (lastPermitId) q = q.gt("id", lastPermitId);
    const { data, error } = await q;
    if (error || !data || data.length === 0) break;

    const toReset = data.filter((p) => !ownedPermitIds.has(p.id as string)).map((p) => p.id as string);
    if (toReset.length > 0) {
      // Batch update in chunks of 200 (URL length cap on .in())
      for (let i = 0; i < toReset.length; i += 200) {
        const chunk = toReset.slice(i, i + 200);
        const { error: upErr } = await s
          .from("permits")
          .update({ scored_at: null })
          .in("id", chunk);
        if (upErr) console.warn("  update error:", upErr.message);
        else resetCount += chunk.length;
      }
    }
    lastPermitId = data[data.length - 1].id as string;
    scanned += data.length;
    if (scanned % 20000 < 1000) console.log(`  scanned ${scanned.toLocaleString()}, reset ${resetCount.toLocaleString()}`);
    if (data.length < 1000) break;
  }
  console.log(`\nDone. Reset scored_at=null on ${resetCount.toLocaleString()} permits.`);
})();
