/**
 * GET /api/cron/courtlistener-liens
 *
 * Daily cron — surfaces mechanic-lien / lis-pendens / construction-defect
 * dockets from CourtListener (Free Law Project, CC-licensed) into
 * `liens_courtlistener` (migration 00069). These are payment-distress
 * signals and pre-listing-prep triggers — perfect for outreach
 * targeting in roofing / general-contractor trades.
 *
 * Source: https://www.courtlistener.com/api/rest/v3/search/
 * Auth: optional `CL_TOKEN` env var raises rate limit; falls back to
 * anonymous if unset.
 *
 * Window: last 30 days, mechanic-lien-related dockets only. The unique
 * constraint on (court, docket_number, date_filed) handles de-dup
 * across daily re-runs.
 *
 * Cron auth: `CRON_SECRET` Bearer per CLAUDE.md.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 280;

const CL_API = "https://www.courtlistener.com/api/rest/v3/search/";
const QUERY =
  '("mechanic\'s lien" OR "construction lien" OR "lis pendens" OR "notice of commencement")';

interface ClResult {
  caseName?: string;
  dateFiled?: string;
  court?: string;
  docketNumber?: string;
  absolute_url?: string;
  snippet?: string;
  [k: string]: unknown;
}

interface ClPage {
  results?: ClResult[];
  next?: string | null;
}

function parseDate(s: string | undefined): string | null {
  if (!s) return null;
  // CourtListener returns YYYY-MM-DD. Trim time portion if present.
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const supabase = createAdminClient();

  // Fetch headers — token boosts rate limit when set.
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "Henri-Bot/1.0 (cron@meethenri.com)",
  };
  if (process.env.CL_TOKEN) headers["Authorization"] = `Token ${process.env.CL_TOKEN}`;

  // Last 30 days window — captures most fresh distress filings without
  // re-paginating the entire historical archive every night.
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 30);
  const cutoffYmd = cutoff.toISOString().slice(0, 10);

  let url: string | null =
    `${CL_API}?type=r&q=${encodeURIComponent(QUERY)}` +
    `&filed_after=${cutoffYmd}&order_by=dateFiled+desc`;

  let pulled = 0;
  let inserted = 0;
  let pages = 0;
  let lastStatus = 0;
  const MAX_PAGES = 20; // soft cap — beyond this we're scanning history, not fresh
  const hasToken = !!process.env.CL_TOKEN;

  try {
    while (url && pages < MAX_PAGES) {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(60_000) });
      lastStatus = res.status;
      if (!res.ok) {
        logger.warn("courtlistener.fetch_failed", {
          status: res.status,
          page: pages,
          has_token: hasToken,
        });
        break;
      }
      const json = (await res.json()) as ClPage;
      const results = json.results ?? [];
      if (results.length === 0) break;

      const rows = results
        .map((r) => ({
          case_name: r.caseName ?? null,
          date_filed: parseDate(r.dateFiled),
          court: r.court ?? "unknown",
          docket_number: r.docketNumber ?? "unknown",
          absolute_url: r.absolute_url ?? null,
          snippet: r.snippet ?? null,
          raw_json: r,
        }))
        .filter((r) => r.date_filed); // drop any that didn't parse

      if (rows.length > 0) {
        const { error, count } = await supabase
          .from("liens_courtlistener")
          .upsert(rows, {
            onConflict: "court,docket_number,date_filed",
            ignoreDuplicates: true,
            count: "exact",
          });
        if (error) {
          logger.warn("courtlistener.insert_error", { error: error.message, page: pages });
        } else {
          inserted += count ?? 0;
        }
      }

      pulled += results.length;
      pages += 1;
      url = json.next ?? null;
      // Light pacing to be a good API citizen.
      if (url) await new Promise((r) => setTimeout(r, 300));
    }

    // Surface the auth gap so a 403 (anonymous) doesn't silently look
    // like a healthy zero-result run. CourtListener requires a free
    // CL_TOKEN env var (sign up at courtlistener.com → Account → API).
    const authNote =
      !hasToken && (lastStatus === 403 || lastStatus === 401)
        ? "CourtListener anonymous access denied — set CL_TOKEN in Vercel env"
        : undefined;

    logger.info("courtlistener.done", {
      duration_ms: Date.now() - startedAt,
      pages,
      pulled,
      inserted,
      last_status: lastStatus,
      has_token: hasToken,
    });
    return NextResponse.json({
      ok: true,
      duration_ms: Date.now() - startedAt,
      pages,
      pulled,
      inserted,
      last_status: lastStatus,
      has_token: hasToken,
      ...(authNote ? { note: authNote } : {}),
    });
  } catch (err) {
    logger.error("courtlistener.error", { error: String(err) });
    return NextResponse.json(
      { error: "courtlistener-liens failed", detail: String(err) },
      { status: 500 },
    );
  }
}
