#!/usr/bin/env npx tsx
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "..", ".env.local") });
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  const { count: total } = await supabase
    .from("permits")
    .select("*", { count: "exact", head: true });
  const { count: withLat } = await supabase
    .from("permits")
    .select("*", { count: "exact", head: true })
    .not("latitude", "is", null);
  const { count: withZip } = await supabase
    .from("permits")
    .select("*", { count: "exact", head: true })
    .not("zip", "is", null);
  const { count: scored } = await supabase
    .from("permits")
    .select("*", { count: "exact", head: true })
    .not("score", "is", null);
  console.log(`total permits: ${total}`);
  console.log(`with lat/lng:  ${withLat}`);
  console.log(`with zip:      ${withZip}`);
  console.log(`with score:    ${scored}`);

  const { count: leads } = await supabase
    .from("leads")
    .select("*", { count: "exact", head: true });
  const { count: territories } = await supabase
    .from("territories")
    .select("*", { count: "exact", head: true })
    .eq("status", "active");
  console.log(`leads:         ${leads}`);
  console.log(`territories:   ${territories}`);
}
main();
