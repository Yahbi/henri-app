#!/usr/bin/env npx tsx
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "..", ".env.local") });
import { createClient } from "@supabase/supabase-js";
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  // Use estimated count since exact is slow on large tables
  const { count, error } = await s.from("permits").select("id", { count: "estimated", head: true });
  if (error) console.error(error);
  console.log("permits total (estimated):", count?.toLocaleString() ?? "?");

  // Per-source-city exact counts
  const cities = ["New York", "Chicago", "Washington", "Seattle", "San Francisco", "Louisville",
    "Raleigh", "Hartford", "Sioux Falls", "Tempe", "Dallas", "Austin", "Cincinnati", "Baton Rouge",
    "Tampa", "Miami", "San Diego", "Phoenix", "Atlanta"];
  console.log("\npermits by source_city:");
  for (const c of cities) {
    const { count: n } = await s.from("permits").select("id", { count: "exact", head: true }).eq("source_city", c);
    console.log(`  ${c.padEnd(16)} ${(n ?? 0).toLocaleString()}`);
  }

  // Status mix
  const { data: statusSample } = await s.from("permits").select("status").limit(5000);
  const byStatus: Record<string, number> = {};
  for (const r of statusSample ?? []) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  console.log("\nstatus mix (5k sample):");
  Object.entries(byStatus).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  ${k.padEnd(12)} ${n}`));

  // Type mix
  const { data: typeSample } = await s.from("permits").select("permit_type").limit(5000);
  const byType: Record<string, number> = {};
  for (const r of typeSample ?? []) byType[r.permit_type] = (byType[r.permit_type] ?? 0) + 1;
  console.log("\npermit_type mix (5k sample):");
  Object.entries(byType).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  ${k.padEnd(18)} ${n}`));
}

main();
