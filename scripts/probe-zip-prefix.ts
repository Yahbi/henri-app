import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

(async () => {
  console.log("Test 1: eq('zip', '06106') + ilike('address', '642 PARK ST%')");
  const { data: a, error: ae } = await s
    .from("permits")
    .select("id, address, zip")
    .eq("zip", "06106")
    .ilike("address", "642 PARK ST%")
    .limit(5);
  console.log("  error=", ae?.message, "  count=", a?.length, "  first=", a?.[0]);

  console.log("\nTest 2: just ilike('address', '642 PARK ST%')");
  const { data: b, error: be } = await s
    .from("permits")
    .select("id, address, zip")
    .ilike("address", "642 PARK ST%")
    .limit(5);
  console.log("  error=", be?.message, "  count=", b?.length, "  first=", b?.[0]);

  console.log("\nTest 3: ilike('address', '%642 PARK ST%') (leading wildcard)");
  const { data: c, error: ce } = await s
    .from("permits")
    .select("id, address, zip")
    .ilike("address", "%642 PARK ST%")
    .limit(5);
  console.log("  error=", ce?.message, "  count=", c?.length, "  first=", c?.[0]);
})();
