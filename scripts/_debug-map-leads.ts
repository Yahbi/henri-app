/**
 * Quick diagnostic — why are leads not showing on the map?
 *
 * The dashboard fetches `useLeads({ filters: { geocoded_only: true } })`
 * which filters `latitude IS NOT NULL AND longitude IS NOT NULL`. If
 * the geocoded count is low, the map will be empty even when 133k
 * leads exist.
 *
 * Run: npx tsx scripts/_debug-map-leads.ts
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
  console.log("=== Map-leads diagnostic ===\n");

  const { count: total } = await s
    .from("leads")
    .select("id", { count: "exact", head: true });

  // Geocoded only
  const { count: geocoded } = await s
    .from("leads")
    .select("id", { count: "exact", head: true })
    .not("latitude", "is", null)
    .not("longitude", "is", null);

  // Geocoded + scored (the panel sees leads >= score threshold)
  const { count: geocodedScored } = await s
    .from("leads")
    .select("id", { count: "exact", head: true })
    .not("latitude", "is", null)
    .not("longitude", "is", null)
    .gte("score", 25);

  // Score histogram
  const buckets = [
    [0, 24], [25, 49], [50, 74], [75, 100],
  ] as const;
  const dist: Array<{ range: string; total: number; geocoded: number }> = [];
  for (const [lo, hi] of buckets) {
    const totQ = await s
      .from("leads")
      .select("id", { count: "exact", head: true })
      .gte("score", lo)
      .lte("score", hi);
    const geoQ = await s
      .from("leads")
      .select("id", { count: "exact", head: true })
      .gte("score", lo)
      .lte("score", hi)
      .not("latitude", "is", null)
      .not("longitude", "is", null);
    dist.push({
      range: `${lo}-${hi}`,
      total: totQ.count ?? 0,
      geocoded: geoQ.count ?? 0,
    });
  }

  // Permits join — when leads.latitude is null, permits.latitude may have it
  const { count: permitGeocoded } = await s
    .from("leads")
    .select("id, permits!inner(latitude)", { count: "exact", head: true })
    .is("latitude", null)
    .not("permits.latitude", "is", null);

  // Top 5 stale leads (no coords) so we can spot-check
  const { data: sample } = await s
    .from("leads")
    .select(
      "id, score, status, latitude, longitude, address:permits(latitude,longitude,address)",
    )
    .is("latitude", null)
    .order("score", { ascending: false })
    .limit(5);

  console.log(`Total leads               : ${total?.toLocaleString() ?? "?"}`);
  console.log(`  with lat & lng (geocoded): ${geocoded?.toLocaleString() ?? "?"}`);
  console.log(`  geocoded AND score >= 25 : ${geocodedScored?.toLocaleString() ?? "?"}`);
  console.log(
    `  ungeocoded leads where joined permit HAS coords: ${permitGeocoded?.toLocaleString() ?? "?"}`,
  );
  console.log(`\nScore-bucket geocoding rates:`);
  for (const d of dist) {
    const pct = d.total > 0 ? Math.round((d.geocoded / d.total) * 100) : 0;
    console.log(
      `  ${d.range.padEnd(7)} total=${d.total.toString().padStart(7)}  geocoded=${d.geocoded.toString().padStart(6)}  (${pct}%)`,
    );
  }

  console.log(`\nSample top-score leads with NO leads.latitude (top 5):`);
  for (const r of sample ?? []) {
    const p = (r as unknown as { address: { latitude: number | null; longitude: number | null; address: string | null } }).address;
    console.log(
      `  id=${(r as { id: string }).id}  score=${(r as { score: number }).score}  permit_lat=${p?.latitude ?? "—"}  permit_lng=${p?.longitude ?? "—"}  addr=${p?.address?.slice(0, 50) ?? "—"}`,
    );
  }

  // Per-contractor breakdown — if all leads have contractor_id and the
  // user isn't on the right contractor, the map sees nothing.
  console.log(`\nLeads by contractor_id (top 10):`);
  const { data: byContractor } = await s
    .from("leads")
    .select("contractor_id")
    .not("contractor_id", "is", null)
    .limit(2000);
  const counts = new Map<string, number>();
  for (const r of byContractor ?? []) {
    const k = (r as { contractor_id: string }).contractor_id;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const top10 = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  for (const [c, n] of top10) {
    console.log(`  ${c}  ${n}`);
  }
  const { count: orphanCount } = await s
    .from("leads")
    .select("id", { count: "exact", head: true })
    .is("contractor_id", null);
  console.log(`  contractor_id IS NULL: ${orphanCount?.toLocaleString() ?? "?"}`);

  // Profiles that exist
  const { data: profiles } = await s
    .from("profiles")
    .select("id, email, role, onboarding_completed")
    .limit(10);
  console.log(`\nProfiles (top 10):`);
  for (const p of profiles ?? []) {
    const pp = p as { id: string; email: string; role: string | null; onboarding_completed: boolean | null };
    console.log(
      `  id=${pp.id.slice(0, 8)}…  email=${pp.email}  role=${pp.role}  onboarded=${pp.onboarding_completed}`,
    );
  }
})();
