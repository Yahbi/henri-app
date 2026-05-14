import path from "node:path";
import { config } from "dotenv";
config({ path: path.resolve(process.cwd(), ".env.local") });

const r = await fetch(
  `https://api.supabase.com/v1/projects/ivfxylgoxgrxttknewsf/database/query`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `SELECT COUNT(*)::int AS total,
                     COUNT(*) FILTER (WHERE opportunity_stage IS NOT NULL)::int AS stamped,
                     ROUND(100.0 * COUNT(*) FILTER (WHERE opportunity_stage IS NOT NULL) / NULLIF(COUNT(*),0), 1) AS pct,
                     MAX(id::text) AS max_id
              FROM leads`,
    }),
  },
);
const text = await r.text();
console.log(text);
