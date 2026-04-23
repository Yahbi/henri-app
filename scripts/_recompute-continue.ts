/* Resume the score recompute from where it timed out. Uses smaller
 * pages + longer delays between batches to avoid Supabase statement
 * timeouts on large UPDATE fan-outs. */
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
  const PAGE = 500;
  while (true) {
    let q = s.from("leads").select(`
      id, cascade_count, phone, email, owner_name, owner_first, owner_last,
      year_built, home_sqft, lot_sqft, assessed_value, property_value,
      owner_occupied, is_homeowner_intake,
      permits (estimated_value, issued_date, applied_date, description, permit_type, zip, created_at)
    `).eq("contractor_id", owner.id).order("id").limit(PAGE);
    if (lastId) q = q.gt("id", lastId);
    const { data, error } = await q;
    if (error) { console.error("scan:", error.message); break; }
    if (!data || data.length === 0) break;

    const updates: Array<{ id: string; score: number; urgency: string; f: number; v: number; c: number; d: number; e: number; cv: number }> = [];
    for (const l of data) {
      const p = l.permits as any;
      if (!p) continue;
      const sig = buildSignals({
        permit: { issue_date: p.issued_date ?? p.applied_date, estimated_value: p.estimated_value, description: p.description, permit_type: p.permit_type, zip: p.zip, created_at: p.created_at },
        lead: {
          owner_name: l.owner_name, owner_first: l.owner_first, owner_last: l.owner_last,
          phone: l.phone, email: l.email,
          owner_occupied: l.owner_occupied, property_value: l.property_value, assessed_value: l.assessed_value,
          is_homeowner_intake: l.is_homeowner_intake ?? false,
          cascadeCount: l.cascade_count ?? 1,
        },
      });
      const r = calculateScore(sig);
      updates.push({ id: l.id as string, score: r.total, urgency: r.urgency, f: r.freshness, v: r.value, c: r.contact, d: r.demand, e: r.engagement, cv: r.conversion });
      if (r.total >= 75) hotCount++;
    }
    // Serialize updates to avoid connection-pool saturation
    for (let i = 0; i < updates.length; i += 20) {
      const chunk = updates.slice(i, i + 20);
      try {
        await Promise.all(chunk.map(u => s.from("leads").update({
          score: u.score, urgency: u.urgency,
          score_freshness: u.f, score_value: u.v, score_contact: u.c,
          score_demand: u.d, score_engagement: u.e, score_conversion: u.cv,
        }).eq("id", u.id)));
      } catch (e) { console.warn("batch err, continuing"); }
      await new Promise(r => setTimeout(r, 100));
    }
    processed += data.length;
    lastId = data[data.length - 1].id as string;
    if (processed % 5000 < PAGE) console.log(`  processed ${processed.toLocaleString()}, hot: ${hotCount}`);
    if (data.length < PAGE) break;
  }
  console.log(`\nDone. Processed ${processed.toLocaleString()}. Hot: ${hotCount}`);
})();
