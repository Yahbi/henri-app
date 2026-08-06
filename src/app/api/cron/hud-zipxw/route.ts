/**
 * GET /api/cron/hud-zipxw
 *
 * DISABLED 2026-05-01 — HUD's USPS ZIP crosswalk XLSX files at
 * www.huduser.gov/portal/datasets/usps/ZIP_*_<date>.xlsx return 404
 * for the documented date pattern (2024Q4 = `122024.xlsx`). The
 * actual download flow on the HUD User portal requires:
 *   1. Free HUD User account login (form auth, not API key)
 *   2. Form-based crosswalk-quarter selection
 *   3. POST that returns a one-time XLSX download URL
 *
 * That flow doesn't fit Vercel's stateless cron execution model
 * without an Auth0/Playwright session manager. Disabling for now;
 * the route returns a deliberate no-op so the data-health page
 * doesn't show a perpetual error.
 *
 * Re-enable paths:
 *   - User adds a session-cookie env var (HUD_AUTH_COOKIE) that we
 *     attach to the XLSX request — CSRF-friendly path.
 *   - Or move this loader to the Hetzner sidecar VM where Playwright
 *     can drive the form submission.
 *   - Or pay for the third-party "ZIP Code Database" feed that
 *     mirrors HUD's data with no auth wall.
 *
 * Cron auth: `CRON_SECRET` Bearer per CLAUDE.md.
 *
 * Wave 2.B Phase 2 of ~/.claude/plans/whats-the-14-days-purring-papert.md.
 */

import { NextRequest, NextResponse } from "next/server";
import { logCronRun, detectTrigger } from "@/lib/admin/cron-log";

export const runtime = "nodejs";
export const maxDuration = 60;

const NOTE =
  "HUD ZIP crosswalk requires authenticated download from huduser.gov; current XLSX URL pattern returns 404. Cron is a no-op until login flow is implemented (Hetzner sidecar or HUD_AUTH_COOKIE env var).";

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
  // stops being harmless the moment the XLSX download is restored. Same
  // try/catch as territory-backfill and scrape.
  try {
    const result = {
      ok: true,
      duration_ms: Date.now() - startedAt,
      quarter: null,
      pulled: 0,
      inserted: 0,
      summary: {},
      note: NOTE,
    };
    await logCronRun("hud-zipxw", startedAt, {
      pulled: 0,
      inserted: 0,
      summary: result,
      trigger: detectTrigger(request),
      status: "partial",
    });
    return NextResponse.json(result);
  } catch (err) {
    await logCronRun("hud-zipxw", startedAt, {
      status: "error",
      error: err instanceof Error ? err.message : String(err),
      trigger: detectTrigger(request),
    });
    throw err;
  }
}
