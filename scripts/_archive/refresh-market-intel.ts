/**
 * Ad-hoc: invoke refresh_market_intel_zip() SQL function to populate
 * the market_intel_zip table. Reports what happened + samples a few
 * rows so we know the aggregate is sensible.
 */
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
  const t0 = Date.now();
  const { data, error } = await s.rpc("refresh_market_intel_zip");
  const elapsed = Date.now() - t0;
  console.log("RPC result:", { data, error: error?.message, elapsed_ms: elapsed });

  if (error) {
    console.error("\nFunction missing? Try reading pg_proc:");
    const { data: fns } = await s
      .from("pg_proc" as never)
      .select("proname" as never)
      .limit(5);
    console.log("  (pg_proc direct read:", fns, ")");
    process.exit(1);
  }

  // Count + sample
  const { count } = await s
    .from("market_intel_zip")
    .select("zip", { count: "estimated", head: true });
  console.log("market_intel_zip row count:", count);

  const { data: samples } = await s
    .from("market_intel_zip")
    .select("zip, state, permit_count_90d, total_value_90d, top_trades, top_applicants")
    .order("permit_count_90d", { ascending: false })
    .limit(5);
  console.log("\nTop 5 ZIPs by permit count:");
  for (const r of samples ?? []) {
    console.log(
      `  ${r.zip} (${r.state ?? "—"}) ${r.permit_count_90d} permits · $${(r.total_value_90d as number)?.toLocaleString() ?? 0}`,
    );
  }
})();
