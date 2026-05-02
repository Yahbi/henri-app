/**
 * GET /api/cron/activate-arcgis-sources
 *
 * Daily cron — flips up to 50 of the 2,364 newly-imported ArcGIS
 * permit endpoints from `enabled=false` to `enabled=true`. Each
 * activation makes the endpoint visible to Henri's existing
 * `/api/cron/scrape` (the historical permit ingest job).
 *
 * Why incremental: a one-shot enable-all would suddenly add 2,364
 * new sources to the daily scrape pool, blowing through API
 * quotas / Vercel function-time. 50/day = ~47 days to reach full
 * coverage, but each day adds another ~10-50k permits to the
 * `permits` table from the activated endpoints.
 *
 * Order: prioritize wedge cities first (NC/SC/TN/VA), then
 * everything else by jurisdiction-name alphabetical for
 * determinism. The first ~5 days of activation should cover the
 * Durham / Greensboro / Hartford gap surfaced by the local
 * ArcGIS pulls on 2026-05-01.
 *
 * Cron auth: `CRON_SECRET` Bearer per CLAUDE.md.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { logCronRun, detectTrigger } from "@/lib/admin/cron-log";

export const runtime = "nodejs";
export const maxDuration = 60;

const BATCH_PER_RUN = 50;

/** Wedge-city state codes prioritized first. The wedge bullet says
 *  these are the markets where Henri needs to crush. */
const WEDGE_STATES = ["NC", "SC", "TN", "VA"] as const;

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const supabase = createAdminClient();

  try {
    // Step 1 — pick wedge-state candidates first.
    const wedgeIds: string[] = [];
    {
      const { data } = await supabase
        .from("permit_sources")
        .select("id")
        .eq("enabled", false)
        .eq("source_type", "arcgis")
        .in("state", WEDGE_STATES as unknown as string[])
        .order("jurisdiction", { ascending: true })
        .limit(BATCH_PER_RUN);
      for (const r of data ?? []) {
        if (typeof r.id === "string") wedgeIds.push(r.id);
      }
    }

    // Step 2 — fill remainder from any other state.
    const remaining = BATCH_PER_RUN - wedgeIds.length;
    const otherIds: string[] = [];
    if (remaining > 0) {
      const { data } = await supabase
        .from("permit_sources")
        .select("id")
        .eq("enabled", false)
        .eq("source_type", "arcgis")
        .not("state", "in", `(${WEDGE_STATES.map((s) => `"${s}"`).join(",")})`)
        .order("jurisdiction", { ascending: true })
        .limit(remaining);
      for (const r of data ?? []) {
        if (typeof r.id === "string") otherIds.push(r.id);
      }
    }

    const ids = [...wedgeIds, ...otherIds];
    if (ids.length === 0) {
      const result = {
        ok: true,
        duration_ms: Date.now() - startedAt,
        activated: 0,
        note: "All ArcGIS sources already enabled — nothing to do.",
      };
      await logCronRun("activate-arcgis-sources", startedAt, {
        pulled: 0, inserted: 0, summary: result, trigger: detectTrigger(request),
      });
      return NextResponse.json(result);
    }

    // Step 3 — flip enabled=true.
    const { error } = await supabase
      .from("permit_sources")
      .update({ enabled: true })
      .in("id", ids);

    if (error) {
      logger.error("activate-arcgis.update_failed", { error: error.message });
      await logCronRun("activate-arcgis-sources", startedAt, {
        error: error.message, trigger: detectTrigger(request),
      });
      return NextResponse.json(
        { error: "update failed", detail: error.message },
        { status: 500 },
      );
    }

    logger.info("activate-arcgis.done", {
      duration_ms: Date.now() - startedAt,
      activated: ids.length,
      wedge: wedgeIds.length,
      other: otherIds.length,
    });

    const result = {
      ok: true,
      duration_ms: Date.now() - startedAt,
      activated: ids.length,
      wedge: wedgeIds.length,
      other: otherIds.length,
    };
    await logCronRun("activate-arcgis-sources", startedAt, {
      pulled: ids.length, inserted: ids.length,
      summary: result, trigger: detectTrigger(request),
    });
    return NextResponse.json(result);
  } catch (err) {
    logger.error("activate-arcgis.error", { error: String(err) });
    await logCronRun("activate-arcgis-sources", startedAt, {
      error: String(err), trigger: detectTrigger(request),
    });
    return NextResponse.json(
      { error: "activate-arcgis-sources failed", detail: String(err) },
      { status: 500 },
    );
  }
}
