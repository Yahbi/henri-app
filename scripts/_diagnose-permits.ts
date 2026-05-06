/**
 * Diagnose why geocoding is finding 0 hits — count permits where
 * latitude is null but address+state are populated (= geocodable).
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

async function count(filter: (q: ReturnType<typeof s.from>) => unknown): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = s.from("permits").select("*", { count: "estimated", head: true });
  q = filter(q);
  const { count } = await q;
  return count ?? 0;
}

async function main() {
  const total = await count((q) => q);
  const nullLat = await count((q) => q.is("latitude", null));
  const nullLatHasAddr = await count((q) => q.is("latitude", null).not("address", "is", null));
  const nullLatHasState = await count((q) => q.is("latitude", null).not("state", "is", null));
  const nullLatHasZip = await count((q) => q.is("latitude", null).not("zip", "is", null));
  const nullLatHasAddrState = await count((q) =>
    q.is("latitude", null).not("address", "is", null).not("state", "is", null),
  );
  const nullLatHasAddrStateZip = await count((q) =>
    q.is("latitude", null).not("address", "is", null).not("state", "is", null).not("zip", "is", null),
  );

  console.log(`permits total                                     : ${total.toLocaleString()}`);
  console.log(`permits with NULL latitude                        : ${nullLat.toLocaleString()}`);
  console.log(`  + has address                                   : ${nullLatHasAddr.toLocaleString()}`);
  console.log(`  + has state                                     : ${nullLatHasState.toLocaleString()}`);
  console.log(`  + has zip                                       : ${nullLatHasZip.toLocaleString()}`);
  console.log(`  + has address + state                           : ${nullLatHasAddrState.toLocaleString()}`);
  console.log(`  + has address + state + zip (best for Nominatim): ${nullLatHasAddrStateZip.toLocaleString()}`);

  // Sample the state-null permits (these are the ones the cron picks up but can't geocode well)
  const { data: noState } = await s
    .from("permits")
    .select("id, address, city, state, zip")
    .is("latitude", null)
    .is("state", null)
    .limit(3);
  console.log(`\nSample of state-NULL permits (cron picks these but Nominatim returns nothing):`);
  console.log(JSON.stringify(noState, null, 2));

  // Sample state-populated permits
  const { data: withState } = await s
    .from("permits")
    .select("id, address, city, state, zip")
    .is("latitude", null)
    .not("state", "is", null)
    .limit(3);
  console.log(`\nSample of state-populated permits (geocodable):`);
  console.log(JSON.stringify(withState, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
