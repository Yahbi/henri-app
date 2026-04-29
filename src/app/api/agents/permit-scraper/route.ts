import { NextRequest, NextResponse } from "next/server";
import { PERMIT_SOURCES } from "@/lib/permits/sources";
import { fetchPermits, type NormalizedPermit } from "@/lib/permits/fetcher";
import { PermitScraperBodySchema, parseBody } from "@/lib/schemas/api";
import { logger } from "@/lib/logger";

/**
 * Permit Scraper Agent
 *
 * POST /api/agents/permit-scraper
 * Body: { source_ids?: string[], days_back?: number, limit?: number }
 *
 * Fetches permits from Socrata sources and returns normalized results.
 * If no source_ids provided, scrapes all configured sources.
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const raw = await request.json().catch(() => ({}));
    const parsed = parseBody(PermitScraperBodySchema, raw);
    if (parsed.response) return parsed.response;
    const sourceIds = parsed.data.source_ids;
    const daysBack: number = parsed.data.days_back ?? 30;
    const limit: number = parsed.data.limit ?? 100;

    // Select sources
    let sources = PERMIT_SOURCES;
    if (sourceIds?.length) {
      const idSet = new Set(sourceIds);
      sources = sources.filter((s) => idSet.has(s.id));
    }

    if (sources.length === 0) {
      return NextResponse.json(
        { status: "error", message: "No matching sources found" },
        { status: 400 },
      );
    }

    // Fetch all sources in parallel
    const results = await Promise.allSettled(
      sources.map((source) =>
        fetchPermits(source, { limit, daysBack }).then((permits) => ({
          source_id: source.id,
          city: source.city,
          state: source.state,
          count: permits.length,
          permits,
        })),
      ),
    );

    const successful: {
      source_id: string;
      city: string;
      state: string;
      count: number;
      permits: NormalizedPermit[];
    }[] = [];
    const failed: { source_id: string; error: string }[] = [];

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === "fulfilled") {
        successful.push(result.value);
      } else {
        failed.push({
          source_id: sources[i].id,
          error: String(result.reason),
        });
      }
    }

    const totalPermits = successful.reduce((sum, s) => sum + s.count, 0);

    return NextResponse.json({
      status: "ok",
      sources_queried: sources.length,
      sources_succeeded: successful.length,
      sources_failed: failed.length,
      total_permits: totalPermits,
      results: successful.map((s) => ({
        source_id: s.source_id,
        city: s.city,
        state: s.state,
        count: s.count,
      })),
      failures: failed,
      params: { days_back: daysBack, limit },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error("[permit-scraper] Error", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      { status: "error", message: "Scraping failed" },
      { status: 500 },
    );
  }
}
