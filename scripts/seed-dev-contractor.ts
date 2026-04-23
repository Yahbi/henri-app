#!/usr/bin/env npx tsx
/* Dev-only: seed a test contractor, claim top ZIPs as territories, reset
 * permit scored_at in those ZIPs, so the scoring cron creates leads that
 * show up on the dashboard map.
 *
 * DO NOT run this against production.
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "..", ".env.local") });
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (SUPABASE_URL.includes("supabase.co") && !SUPABASE_URL.includes("localhost")) {
  // allow remote dev Supabase; warn
  console.log("[warn] Targeting remote Supabase:", SUPABASE_URL);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DEV_EMAIL = "dev-contractor@henri.local";
const DEV_PASSWORD = "DevContractor!2026";
const DEV_NAME = "Dev Contractor";
// Top ZIPs by permit count from `npx tsx scripts/top-zips.ts`
const DEV_ZIPS = ["33629", "33606", "33616", "33647", "33607", "33611", "33604", "33609", "33602"];

async function main() {
  console.log("==".repeat(30));
  console.log("  Henri dev contractor seed");
  console.log("==".repeat(30));

  /* 1. Ensure auth user exists */
  console.log("\n[1] Auth user");
  let userId: string;
  const { data: existing } = await supabase.auth.admin.listUsers();
  const existingUser = existing?.users?.find((u) => u.email === DEV_EMAIL);
  if (existingUser) {
    userId = existingUser.id;
    console.log(`  existing user: ${userId}`);
  } else {
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email: DEV_EMAIL,
      password: DEV_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: DEV_NAME, role: "contractor" },
    });
    if (createErr) {
      console.error("  create user failed:", createErr);
      process.exit(1);
    }
    userId = created.user!.id;
    console.log(`  created user: ${userId}`);
  }

  /* 2. Upsert profile */
  console.log("\n[2] Profile");
  const { error: profileErr } = await supabase
    .from("profiles")
    .upsert({
      id: userId,
      email: DEV_EMAIL,
      full_name: DEV_NAME,
      role: "contractor",
      plan: "pro",
      onboarding_completed: true,
    });
  if (profileErr) {
    console.error("  profile upsert failed:", profileErr);
    process.exit(1);
  }
  console.log("  profile upserted");

  /* 3. Claim territories via claim_territory RPC (enforces slot exclusivity) */
  console.log("\n[3] Territories");
  for (const zip of DEV_ZIPS) {
    const { data: slot, error } = await supabase.rpc("claim_territory", {
      p_zip: zip,
      p_contractor_id: userId,
    });
    if (error) {
      if (String(error.message).includes("already holds")) {
        console.log(`  ${zip}: already claimed`);
      } else {
        console.log(`  ${zip}: ${error.message}`);
      }
    } else {
      console.log(`  ${zip}: claimed (slot ${slot})`);
    }
  }

  /* 4. Reset scored_at on permits in those ZIPs so they re-score */
  console.log("\n[4] Reset scored_at on permits in these ZIPs");
  const { error: resetErr, count } = await supabase
    .from("permits")
    .update({ scored_at: null }, { count: "exact" })
    .in("zip", DEV_ZIPS)
    .not("scored_at", "is", null);
  if (resetErr) {
    console.error("  reset failed:", resetErr);
    process.exit(1);
  }
  console.log(`  reset ${count} permits`);

  /* 5. Summary */
  console.log("\n[5] Next steps");
  console.log(`  1) Make sure dev server is running (localhost:3000)`);
  console.log(`  2) Run: npm run score   (converts reset permits → leads)`);
  console.log(`  3) Sign in at http://localhost:3000/login`);
  console.log(`       email: ${DEV_EMAIL}`);
  console.log(`       pass:  ${DEV_PASSWORD}`);
  console.log(`  4) Open http://localhost:3000/dashboard/map — leads show up`);
  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
