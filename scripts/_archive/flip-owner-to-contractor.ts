/**
 * One-shot: flip y.abismuth@gmail.com from homeowner to contractor so the
 * dashboard renders. Idempotent.
 */
import { createClient } from "@supabase/supabase-js";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

async function main() {
  const email = "y.abismuth@gmail.com";
  const { data: before, error: e1 } = await supabase
    .from("profiles")
    .select("id, email, role, plan, onboarding_completed")
    .eq("email", email)
    .single();
  if (e1 || !before) {
    console.error("Owner not found:", e1?.message);
    process.exit(1);
  }
  console.log("Before:", before);

  const { error: e2 } = await supabase
    .from("profiles")
    .update({ role: "contractor", onboarding_completed: true })
    .eq("id", before.id);
  if (e2) {
    console.error("Update failed:", e2.message);
    process.exit(1);
  }

  const { data: after } = await supabase
    .from("profiles")
    .select("id, email, role, plan, onboarding_completed")
    .eq("id", before.id)
    .single();
  console.log("After:", after);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
