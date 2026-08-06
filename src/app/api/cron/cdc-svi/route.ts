/**
 * GET /api/cron/cdc-svi
 *
 * DISABLED 2026-05-01 — original Socrata dataset (`ypqf-r5qs`) on
 * data.cdc.gov is mislabeled "Social Vulnerability Index" but is
 * actually CDC's COVID-19 vaccine hesitancy dataset (verified via
 * the metadata endpoint — `description` mentions Household Pulse
 * Survey + COVID vaccine hesitancy). The real ATSDR SVI hosted on
 * services3.arcgis.com returns 403 to anonymous requests.
 *
 * Until a working public endpoint is identified, this route is a
 * deliberate no-op so the daily cron doesn't fail-loud on the
 * data-health page. Re-enable path:
 *   1. Find a working CDC/ATSDR SVI endpoint (paid product, ArcGIS
 *      with token, or scraper fallback).
 *   2. Restore the Socrata-style fetch loop modeled on
 *      /api/cron/openfema-declarations or /api/cron/fema-nri.
 *   3. Update `contractor_license_sources`-like notes here so the
 *      data-health UI shows green again.
 *
 * Cron auth: `CRON_SECRET` Bearer per CLAUDE.md.
 *
 * Wave 2.A of ~/.claude/plans/whats-the-14-days-purring-papert.md.
 */

import { NextRequest, NextResponse } from "next/server";
import { logCronRun, detectTrigger } from "@/lib/admin/cron-log";

export const runtime = "nodejs";
export const maxDuration = 60;

const NOTE =
  "CDC SVI Socrata dataset deprecated; ATSDR ArcGIS endpoint requires auth. Cron is a no-op until a public source is identified.";

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  // logCronRun was only reachable on the success return. This route is a
  // no-op today so nothing between here and there can realistically throw,
  // but "the only audit row is written on the happy path" is the shape that
  // makes a failure indistinguishable from a cron that never fired, and it
  // stops being harmless the moment the fetch loop is restored. Same
  // try/catch as territory-backfill and scrape.
  try {
    const result = {
      ok: true,
      duration_ms: Date.now() - startedAt,
      pages: 0,
      pulled: 0,
      inserted: 0,
      note: NOTE,
    };
    await logCronRun("cdc-svi", startedAt, {
      pulled: 0,
      inserted: 0,
      summary: result,
      trigger: detectTrigger(request),
      status: "partial",
    });
    return NextResponse.json(result);
  } catch (err) {
    await logCronRun("cdc-svi", startedAt, {
      status: "error",
      error: err instanceof Error ? err.message : String(err),
      trigger: detectTrigger(request),
    });
    throw err;
  }
}
