/**
 * Ad-hoc: how many distinct US states do we have enabled permit sources
 * in? Drives the honest "N states covered" landing-page stat.
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
  const states = new Set<string>();
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await s
      .from("permit_sources")
      .select("state")
      .eq("enabled", true)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const row of data) {
      if (row.state) states.add(row.state.toUpperCase());
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  const sorted = [...states].sort();
  console.log(`Distinct states with enabled sources: ${sorted.length}`);
  console.log(sorted.join(", "));
})();
