/**
 * GET /api/cron/gdelt-triggers
 *
 * Daily cron — pulls GDELT 2.0 Doc API for construction-trigger news
 * events ("broke ground", "groundbreaking ceremony", "ribbon cutting",
 * "new construction", "construction permit") in the last 7 days,
 * source-country US.
 *
 * Why: an earlier-stage lead trigger that fires BEFORE permits are
 * filed. A "broke ground at $X site" article means a permit follows
 * within days. Henri uses these to surface jobs the permit feeds
 * haven't caught up to yet.
 *
 * Source: https://api.gdeltproject.org/api/v2/doc/doc
 * Free, no auth, public-domain.
 *
 * Cron auth: `CRON_SECRET` Bearer per CLAUDE.md.
 *
 * Wave 2.B Phase 1 of ~/.claude/plans/whats-the-14-days-purring-papert.md.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 280;

const API = "https://api.gdeltproject.org/api/v2/doc/doc";

const QUERIES = [
  '"broke ground" sourcecountry:US',
  '"groundbreaking ceremony" sourcecountry:US',
  '"ribbon cutting" sourcecountry:US',
  '"new construction" sourcecountry:US',
  '"construction permit" sourcecountry:US',
] as const;

interface GdeltArticle {
  url?: string;
  url_mobile?: string;
  title?: string;
  seendate?: string;
  domain?: string;
  language?: string;
  sourcecountry?: string;
  [k: string]: unknown;
}

interface GdeltResponse {
  articles?: GdeltArticle[];
}

function asString(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

/**
 * GDELT `seendate` is `YYYYMMDDHHMMSS` (UTC). Parse to ISO.
 */
function parseSeenDate(s: string | null): string | null {
  if (!s || s.length < 14) return null;
  const yyyy = s.slice(0, 4);
  const mm = s.slice(4, 6);
  const dd = s.slice(6, 8);
  const hh = s.slice(8, 10);
  const mi = s.slice(10, 12);
  const ss = s.slice(12, 14);
  const iso = `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function fetchQuery(q: string, days: number): Promise<GdeltArticle[]> {
  const params = new URLSearchParams({
    query: q,
    mode: "ArtList",
    format: "json",
    maxrecords: "250",
    timespan: `${days}d`,
  });
  const url = `${API}?${params}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Henri-Bot/1.0 (cron@meethenri.com)",
    },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    logger.warn("gdelt.fetch_failed", { status: res.status, query: q });
    return [];
  }
  // GDELT occasionally returns text/html with an HTML error wrapper
  // even with format=json. Defensively parse.
  const text = await res.text();
  if (!text.trim() || text.trim().startsWith("<")) {
    logger.warn("gdelt.bad_body", { query: q });
    return [];
  }
  try {
    const json = JSON.parse(text) as GdeltResponse;
    return json.articles ?? [];
  } catch (err) {
    logger.warn("gdelt.parse_failed", { query: q, error: String(err) });
    return [];
  }
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const supabase = createAdminClient();

  // Default to 7-day timespan; allow back-fills via ?days=30
  const reqDays = Number(new URL(request.url).searchParams.get("days"));
  const days = Number.isFinite(reqDays) && reqDays > 0 ? Math.min(365, reqDays) : 7;

  let pulled = 0;
  let inserted = 0;
  const perQuery: Record<string, { pulled: number; inserted: number }> = {};

  try {
    for (const q of QUERIES) {
      const articles = await fetchQuery(q, days);
      perQuery[q] = { pulled: articles.length, inserted: 0 };
      pulled += articles.length;
      if (articles.length === 0) continue;

      const rows = articles
        .map((a) => {
          const url = asString(a.url);
          if (!url) return null;
          // Trim insanely long URLs to keep the unique index size sane.
          const trimmedUrl = url.length > 1024 ? url.slice(0, 1024) : url;
          return {
            url: trimmedUrl,
            title: asString(a.title),
            seen_date: parseSeenDate(asString(a.seendate)),
            domain: asString(a.domain),
            language: asString(a.language),
            source_country: asString(a.sourcecountry),
            query_match: q,
            raw_json: a,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      if (rows.length === 0) continue;

      const { error, count } = await supabase
        .from("triggers_news_gdelt")
        .upsert(rows, {
          onConflict: "url",
          ignoreDuplicates: true,
          count: "exact",
        });
      if (error) {
        logger.warn("gdelt.insert_error", { query: q, error: error.message });
      } else {
        perQuery[q].inserted = count ?? 0;
        inserted += count ?? 0;
      }
    }

    logger.info("gdelt.done", {
      duration_ms: Date.now() - startedAt,
      days,
      pulled,
      inserted,
      perQuery,
    });
    return NextResponse.json({
      ok: true,
      duration_ms: Date.now() - startedAt,
      days,
      pulled,
      inserted,
      perQuery,
    });
  } catch (err) {
    logger.error("gdelt.error", { error: String(err) });
    return NextResponse.json(
      { error: "gdelt-triggers failed", detail: String(err) },
      { status: 500 },
    );
  }
}
