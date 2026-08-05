/**
 * GET /api/admin/news-triggers
 *
 * God-mode-only. Returns the most recent GDELT construction-trigger
 * articles (broke ground / ribbon cutting / new construction / etc.)
 * for the founder to scan as a pre-permit lead source. Pulls from
 * `triggers_news_gdelt` (Wave 2.B Phase 1).
 *
 * Optional query params:
 *   ?query=ribbon         — filter by which GDELT query matched
 *   ?days=30              — recency window in days (default 30)
 *   ?limit=100            — row cap (default 100, max 500)
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isGodModeEmail } from "@/lib/auth/god-mode";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ArticleRow {
  trigger_uid: string;
  url: string;
  title: string | null;
  seen_date: string | null;
  domain: string | null;
  language: string | null;
  source_country: string | null;
  query_match: string | null;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isGodModeEmail(user?.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const queryFilter = params.get("query");
  const reqDays = Number(params.get("days"));
  const days = Number.isFinite(reqDays) && reqDays > 0 ? Math.min(365, reqDays) : 30;
  const reqLimit = Number(params.get("limit"));
  const limit = Number.isFinite(reqLimit) ? Math.min(500, Math.max(1, reqLimit)) : 100;

  const admin = createAdminClient();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  let q = admin
    .from("triggers_news_gdelt")
    .select(
      "trigger_uid, url, title, seen_date, domain, language, source_country, query_match",
      { count: "estimated" },
    )
    .gte("seen_date", since)
    .order("seen_date", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (queryFilter) {
    q = q.ilike("query_match", `%${queryFilter}%`);
  }
  const { data, count, error } = await q;
  if (error) {
    logger.error("admin.news_triggers query failed", { message: error.message });
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  // Aggregate by domain + query_match for the histograms.
  const byDomain = new Map<string, number>();
  const byQuery = new Map<string, number>();
  const articles: ArticleRow[] = [];
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    const article: ArticleRow = {
      trigger_uid: String(r.trigger_uid),
      url: String(r.url ?? ""),
      title: typeof r.title === "string" ? r.title : null,
      seen_date: typeof r.seen_date === "string" ? r.seen_date : null,
      domain: typeof r.domain === "string" ? r.domain : null,
      language: typeof r.language === "string" ? r.language : null,
      source_country: typeof r.source_country === "string" ? r.source_country : null,
      query_match: typeof r.query_match === "string" ? r.query_match : null,
    };
    articles.push(article);
    if (article.domain) byDomain.set(article.domain, (byDomain.get(article.domain) ?? 0) + 1);
    if (article.query_match) byQuery.set(article.query_match, (byQuery.get(article.query_match) ?? 0) + 1);
  }

  return NextResponse.json(
    {
      ok: true,
      total_in_window: count ?? articles.length,
      window_days: days,
      articles,
      domain_histogram: Object.fromEntries(
        [...byDomain.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
      ),
      query_histogram: Object.fromEntries(
        [...byQuery.entries()].sort((a, b) => b[1] - a[1]),
      ),
    },
    { headers: { "Cache-Control": "private, max-age=60" } },
  );
}
