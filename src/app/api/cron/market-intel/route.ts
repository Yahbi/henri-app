import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

/**
 * /api/cron/market-intel — nightly refresh of `market_intel_zip`.
 *
 * Preferred path: call the `refresh_market_intel_zip()` SQL function
 * which aggregates server-side in a single statement. Sub-second at
 * our current data volumes.
 *
 * Fallback path (when the function didn't land in migration 00034):
 * run the aggregation in TypeScript via the service-role client. A
 * bit slower (~5-15s per sweep) but lets the cron hydrate the table
 * without requiring the user to manually re-apply SQL.
 *
 * Scheduled in vercel.json at `0 4 * * *` (4am UTC = midnight ET).
 */

export const runtime = "nodejs";
export const maxDuration = 60;

async function handler(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  const supabase = createAdminClient();

  try {
    // 1) Preferred — server-side SQL function.
    const rpc = await supabase.rpc("refresh_market_intel_zip");
    if (!rpc.error) {
      const zipsRefreshed = Array.isArray(rpc.data) && rpc.data[0]?.zips_refreshed != null
        ? Number(rpc.data[0].zips_refreshed)
        : 0;
      return NextResponse.json({
        ok: true,
        zips_refreshed: zipsRefreshed,
        via: "sql_function",
        elapsed_ms: Date.now() - started,
      });
    }

    // 2) Fallback — aggregate in JS when the function is missing OR
    //    when it timed out on Supabase's default statement_timeout
    //    (8s — too short for a 925k-row aggregate). JS path pages in
    //    sub-timeout chunks and does the rollup client-side.
    if (
      /function.*does not exist|Could not find the function|canceling statement due to statement timeout/i
        .test(rpc.error.message)
    ) {
      logger.warn("market-intel: refresh_market_intel_zip() missing, falling back to JS aggregation");
      try {
        const zipsRefreshed = await refreshInJS(supabase);
        return NextResponse.json({
          ok: true,
          zips_refreshed: zipsRefreshed,
          via: "js_fallback",
          elapsed_ms: Date.now() - started,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown";
        // Table missing too — full migration 00034 is pending.
        if (/Could not find the table.*market_intel_zip/i.test(msg)) {
          return NextResponse.json(
            {
              ok: false,
              migrationPending: true,
              message:
                "Apply migration 00034_market_intel_zip.sql (both the table + refresh_market_intel_zip function need to land).",
            },
            { status: 503 },
          );
        }
        throw err;
      }
    }

    // Anything else (including schema cache miss on the table itself)
    // — surface migrationPending so the UI can render its clear
    // "apply 00034" banner rather than a generic 500.
    if (/Could not find the table.*market_intel_zip/i.test(rpc.error.message)) {
      return NextResponse.json(
        { ok: false, migrationPending: true, message: "Apply migration 00034 (table missing)" },
        { status: 503 },
      );
    }
    throw new Error(rpc.error.message);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    logger.error("market-intel cron failed", { message: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * Pure-JS equivalent of refresh_market_intel_zip(). Pulls every
 * recent permit, groups by ZIP in memory, writes the rollup.
 */
async function refreshInJS(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<number> {
  const sinceIso = new Date(Date.now() - 90 * 86_400_000).toISOString();

  // Page through permits in the trailing 90 days using ONLY
  // issued_date (index-backed). The prior version used an `.or()`
  // across issued/applied/created_at which ended up as a disjunction
  // that couldn't use any single index and timed out on the 925k-row
  // table. We lose a small tail of permits that have an applied_date
  // but no issued_date — acceptable trade; most markets care about
  // issued permits anyway.
  const rows: Array<{
    zip: string | null;
    state: string | null;
    permit_type: string | null;
    applicant_name: string | null;
    contractor_name: string | null;
    estimated_value: number | null;
    issued_date: string | null;
  }> = [];
  const PAGE = 1000;
  for (let off = 0; off < 50_000; off += PAGE) {
    const { data, error } = await supabase
      .from("permits")
      .select("zip, state, permit_type, applicant_name, contractor_name, estimated_value, issued_date")
      .gte("issued_date", sinceIso)
      .not("zip", "is", null)
      .neq("zip", "")
      .range(off, off + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...(data as typeof rows));
    if (data.length < PAGE) break;
  }

  // Aggregate by ZIP.
  interface PerZip {
    zip: string;
    state: string | null;
    permit_count_90d: number;
    total_value_90d: number;
    cur_30d: number;
    prior_30d: number;
    trades: Map<string, { count: number; total_value: number }>;
    applicants: Map<string, { count: number; total_value: number }>;
  }
  const byZip = new Map<string, PerZip>();
  const dayMs = 86_400_000;
  const now = Date.now();

  for (const r of rows) {
    const zip = (r.zip ?? "").slice(0, 5);
    if (!zip) continue;
    const eventIso = r.issued_date;
    const eventTs = eventIso ? new Date(eventIso).getTime() : now;
    const v = Number(r.estimated_value ?? 0);
    const in30 = now - eventTs <= 30 * dayMs;
    const inPrior30 = !in30 && now - eventTs <= 60 * dayMs;

    let bucket = byZip.get(zip);
    if (!bucket) {
      bucket = {
        zip,
        state: r.state,
        permit_count_90d: 0,
        total_value_90d: 0,
        cur_30d: 0,
        prior_30d: 0,
        trades: new Map(),
        applicants: new Map(),
      };
      byZip.set(zip, bucket);
    }
    bucket.permit_count_90d += 1;
    bucket.total_value_90d += v;
    if (in30) bucket.cur_30d += 1;
    if (inPrior30) bucket.prior_30d += 1;
    if (r.permit_type) {
      const t = bucket.trades.get(r.permit_type) ?? { count: 0, total_value: 0 };
      t.count += 1;
      t.total_value += v;
      bucket.trades.set(r.permit_type, t);
    }
    const party = (r.contractor_name ?? r.applicant_name ?? "").trim();
    if (party) {
      const a = bucket.applicants.get(party) ?? { count: 0, total_value: 0 };
      a.count += 1;
      a.total_value += v;
      bucket.applicants.set(party, a);
    }
  }

  const toTopN = (m: Map<string, { count: number; total_value: number }>, nameKey: string) =>
    [...m.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5)
      .map(([k, v]) => ({ [nameKey]: k, count: v.count, total_value: v.total_value }));

  const upsertRows = [...byZip.values()].map((b) => ({
    zip: b.zip,
    state: b.state,
    as_of: new Date().toISOString(),
    permit_count_90d: b.permit_count_90d,
    total_value_90d: b.total_value_90d,
    avg_value_90d:
      b.permit_count_90d > 0
        ? Math.round(b.total_value_90d / b.permit_count_90d)
        : 0,
    permit_count_mom_delta_pct:
      b.prior_30d === 0
        ? b.cur_30d > 0 ? 100 : null
        : Math.round(((b.cur_30d - b.prior_30d) / b.prior_30d) * 10000) / 100,
    top_trades: toTopN(b.trades, "trade"),
    top_applicants: toTopN(b.applicants, "name"),
    trending_up: [],
    trending_down: [],
  }));

  // Use upsert on primary key (zip) instead of delete+insert. PostgREST
  // schema-cache races sometimes make the DELETE fail with "table not
  // found" even when the table exists; upsert has the same result
  // (latest snapshot wins) without the clear step.
  for (let i = 0; i < upsertRows.length; i += 500) {
    const chunk = upsertRows.slice(i, i + 500);
    const { error } = await supabase
      .from("market_intel_zip")
      .upsert(chunk, { onConflict: "zip" });
    if (error) throw new Error(error.message);
  }
  return upsertRows.length;
}

export const GET = handler;
export const POST = handler;
