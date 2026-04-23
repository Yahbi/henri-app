import { createClient } from "@supabase/supabase-js";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  const [total, withAppl, withContr] = await Promise.all([
    s.from("permits").select("id", { count: "exact", head: true }),
    s.from("permits").select("id", { count: "exact", head: true }).not("applicant_name", "is", null),
    s.from("permits").select("id", { count: "exact", head: true }).not("contractor_name", "is", null),
  ]);
  const { data: sample } = await s.from("permits").select("id, applicant_name, contractor_name, address, state").not("applicant_name", "is", null).limit(3);
  console.log(JSON.stringify({ total: total.count, withApplicant: withAppl.count, withContractor: withContr.count, sample }, null, 2));
})();
