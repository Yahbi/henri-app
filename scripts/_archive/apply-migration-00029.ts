/**
 * Apply migration 00029 — address-prefix index on permits —
 * directly via Supabase's Postgres REST. Done this way (vs waiting
 * for the next deploy) so /api/permits/history stops hitting statement
 * timeouts in dev.
 */
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

(async () => {
  const sql = fs.readFileSync(
    path.resolve(process.cwd(), "supabase/migrations/00029_permits_address_prefix_idx.sql"),
    "utf-8",
  );
  console.log("Running migration 00029...");
  // Supabase doesn't expose arbitrary SQL over REST by default; we'll
  // use the `pg_meta` RPC if defined, else print a hint. For this
  // project there's typically an `exec` or `execute_sql` RPC exposed
  // for the service role — try common names.
  const candidates = ["exec", "execute_sql", "run_sql", "sql"];
  for (const fn of candidates) {
    const { error } = await s.rpc(fn as never, { sql } as never);
    if (!error) {
      console.log(`Migration applied via rpc('${fn}')`);
      return;
    }
    if (!/Could not find the function/i.test(error.message)) {
      console.error(`rpc('${fn}') failed:`, error.message);
      return;
    }
  }
  console.error(
    "No RPC endpoint available for arbitrary SQL. Apply migration via:",
    "\n  supabase db push",
    "\nor paste the SQL into the Supabase SQL editor.",
  );
  process.exit(1);
})();
