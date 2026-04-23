/* One-shot: apply the current scoring model to every owner lead IN-PLACE,
 * using buildSignals + calculateScore against the existing enrichment
 * data. Avoids the round-trip of resetting scored_at and re-running the
 * full scorer (which would also re-insert duplicate leads). */
import { createClient } from "@supabase/supabase-js";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
import { buildSignals, calculateScore } from "../src/lib/scoring";

const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

(async () => {
  const { data: owner } = await s.from("profiles").select("id").eq("email","y.abismuth@gmail.com").single();
  if (!owner) process.exit(1);

  let processed = 0, hotCount = 0;
  let lastId: string | null = null;
  const PAGE = 1000;
  while (true) {
    let q = s.from("leads").select(`
      id, cascade_count, phone, email, owner_name, owner_first, owner_last,
      year_built, home_sqft, lot_sqft, assessed_value, property_value,
      owner_occupied, is_homeowner_intake,
      permits (id, estimated_value, issued_date, applied_date, description, permit_type, zip, created_at, applicant_name)
    `).eq("contractor_id", owner.id).order("id").limit(PAGE);
    if (lastId) q = q.gt("id", lastId);
    const { data, error } = await q;
    if (error) { console.error(error); break; }
    if (!data || data.length === 0) break;

    const updates: Array<{ id: string; score: number; urgency: string; score_freshness: number; score_value: number; score_contact: number; score_demand: number; score_engagement: number; score_conversion: number }> = [];
    for (const l of data) {
      const p = l.permits as any;
      if (!p) continue;
      const signals = buildSignals({
        permit: { issue_date: p.issued_date ?? p.applied_date, estimated_value: p.estimated_value, description: p.description, permit_type: p.permit_type, zip: p.zip, created_at: p.created_at },
        lead: {
          owner_name: l.owner_name, owner_first: l.owner_first, owner_last: l.owner_last,
          phone: l.phone, email: l.email,
          owner_occupied: l.owner_occupied, property_value: l.property_value, assessed_value: l.assessed_value,
          is_homeowner_intake: l.is_homeowner_intake ?? false,
          cascadeCount: l.cascade_count ?? 1,
        },
      });
      const r = calculateScore(signals);
      updates.push({ id: l.id as string, score: r.total, urgency: r.urgency,
        score_freshness: r.freshness, score_value: r.value, score_contact: r.contact,
        score_demand: r.demand, score_engagement: r.engagement, score_conversion: r.conversion });
      if (r.total >= 75) hotCount++;
    }
    // Batch-update 50 at a time in parallel.
    for (let i = 0; i < updates.length; i += 50) {
      await Promise.all(updates.slice(i, i + 50).map(u => s.from("leads").update({
        score: u.score, urgency: u.urgency,
        score_freshness: u.score_freshness, score_value: u.score_value, score_contact: u.score_contact,
        score_demand: u.score_demand, score_engagement: u.score_engagement, score_conversion: u.score_conversion,
      }).eq("id", u.id)));
    }
    processed += data.length;
    lastId = data[data.length - 1].id as string;
    if (processed % 10000 < PAGE) console.log(`  processed ${processed.toLocaleString()}, hot so far: ${hotCount}`);
    if (data.length < PAGE) break;
  }
  console.log(`\nDone. Processed ${processed.toLocaleString()}. Hot (>=75): ${hotCount}`);
})();
