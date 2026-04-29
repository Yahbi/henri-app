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

  // Get unique ZIPs from permits (estimated count first for speed)
  const { count: permitsTotal } = await s
    .from("permits")
    .select("id", { count: "estimated", head: true });

  // Paginate through permits to collect unique ZIPs
  const zips = new Set<string>();
  let lastId: string | null = null;
  let pages = 0;
  while (true) {
    let q = s.from("permits").select("id, zip").order("id").limit(1000);
    if (lastId) q = q.gt("id", lastId);
    const { data, error } = await q;
    if (error || !data || data.length === 0) break;
    for (const p of data) if (p.zip) zips.add(p.zip);
    lastId = data[data.length - 1].id as string;
    pages++;
    if (pages % 20 === 0) console.log(`  ${pages * 1000} permits scanned, ${zips.size} unique ZIPs`);
    if (pages > 1000) break; // safety
  }

  const { count: ownerTerritories } = await s
    .from("territories")
    .select("id", { count: "exact", head: true })
    .eq("contractor_id", owner!.id)
    .eq("status", "active");

  console.log({
    permits_total_est: permitsTotal,
    unique_zips_with_permits: zips.size,
    owner_territories_current: ownerTerritories,
    new_territories_needed: zips.size - (ownerTerritories ?? 0),
    firstFew: [...zips].slice(0, 5),
  });
})();
