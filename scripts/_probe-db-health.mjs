/**
 * Quick DB health probe — sends 3 tiny queries and times each.
 * Used to decide whether the populate retry is worthwhile.
 */
import path from "node:path";
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: path.resolve(process.cwd(), ".env.local") });

const PROJECT_REF = "ivfxylgoxgrxttknewsf";
const API_URL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

async function probe(label, q) {
  const t0 = Date.now();
  try {
    const r = await fetch(API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: q }),
      signal: AbortSignal.timeout(15000),
    });
    const text = await r.text();
    const elapsed = Date.now() - t0;
    if (text.startsWith("<")) {
      console.log(`${label}: HTML ${r.status} in ${elapsed}ms`);
      return { ok: false };
    }
    const body = JSON.parse(text);
    if (body?.message && /ERROR/.test(body.message)) {
      console.log(`${label}: ERROR in ${elapsed}ms — ${body.message.slice(0, 80)}`);
      return { ok: false };
    }
    console.log(`${label}: ok in ${elapsed}ms — ${JSON.stringify(body).slice(0, 80)}`);
    return { ok: true, body };
  } catch (e) {
    const elapsed = Date.now() - t0;
    console.log(`${label}: timeout/abort in ${elapsed}ms — ${e.message}`);
    return { ok: false };
  }
}

await probe("noop", `SELECT 1 AS n`);
await probe("count_perms", `SELECT COUNT(*)::int AS n FROM public.permits`);
await probe("count_leads", `SELECT COUNT(*)::int AS n FROM public.leads`);
await probe("count_aggs", `SELECT COUNT(*)::int AS n FROM public.zip_pre_intent_aggregates`);
await probe("source_check", `SELECT 1 FROM public.leads WHERE source = 'permit' LIMIT 1`);
