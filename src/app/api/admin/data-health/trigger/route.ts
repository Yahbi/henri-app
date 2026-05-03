/**
 * POST /api/admin/data-health/trigger
 *
 * God-mode-only. Fires a sidecar-data cron route server-to-server using
 * the CRON_SECRET held in env, so the founder can trigger any cron
 * from the data-health admin UI without copying the secret to their
 * phone / browser.
 *
 * Body: { "cron_path": "swdi-events" }   ← the slug under /api/cron/
 *
 * Hardening:
 *   - Allow-list of cron slugs (no arbitrary URL invocation)
 *   - 290s timeout passed through to the upstream cron
 *   - Returns the upstream JSON unchanged so the UI can render the
 *     same `pulled` / `inserted` counts the natural cron would log.
 *
 * Why server-to-server: CRON_SECRET stays in Vercel env. The browser
 * never sees it. God-mode auth (email allowlist) replaces the
 * Bearer-token check at the trigger boundary.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isGodModeEmail } from "@/lib/auth/god-mode";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 300;

/* Allow-list of cron slugs that the admin UI can trigger. Mirrors the
 * sidecar list in /api/admin/data-health. Adding a new sidecar cron
 * means adding it here too — defends against arbitrary-URL injection
 * if the UI is ever compromised. */
/*
 * 2026-05-02 retrospective audit: pruned 6 dead/pending crons whose
 * data wasn't reaching contractors. Removed:
 *   cdc-svi          → CDC SVI dataset deprecated (route still exists, just unscheduled)
 *   census-acs       → demo_acs_zcta unused in src/ (drawer + scoring don't read it)
 *   hmda-rotate      → 2 rows after weeks of rotation; defer to Hetzner sidecar
 *   hud-zipxw        → HUD requires authenticated download
 *   code-violations  → no drawer panel or scoring booster wired yet
 *   nifc-wildfires   → no drawer panel or scoring booster wired yet
 * Route files are kept on disk; they're just not in the trigger
 * allow-list anymore. Re-add when the consumer side is ready.
 */
const ALLOWED: ReadonlySet<string> = new Set([
  "swdi-events",
  "courtlistener-liens",
  "usgs-quakes",
  "hud-reo",
  "census-geocode",
  "fema-nri",
  "openfema-declarations",
  "gdelt-triggers",
  "openfema-nfip",
  "openfema-ia",
  "state-licenses-rotate",
  "activate-arcgis-sources",
  // The legacy main scoring cron — wrapped with logCronRun in commit
  // (post-audit 2026-05-02) and added here so the data-health Run-now
  // button can fire it manually when Vercel's auto-cron drops it.
  "score",
]);

interface TriggerBody {
  cron_path?: string;
  /** Pass-through query string appended to the upstream cron URL.
   *  E.g. `state=CA` for the HMDA rotator, `year=2024` for NFIP. */
  query?: string;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isGodModeEmail(user?.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: TriggerBody;
  try {
    body = (await request.json()) as TriggerBody;
  } catch {
    return NextResponse.json(
      { error: "invalid JSON body" },
      { status: 400 },
    );
  }

  const cronPath = (body.cron_path ?? "").trim();
  if (!cronPath || !ALLOWED.has(cronPath)) {
    return NextResponse.json(
      { error: "cron_path missing or not in allow-list", allowed: [...ALLOWED] },
      { status: 400 },
    );
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET env var not set on server" },
      { status: 500 },
    );
  }

  // Build the absolute URL to the cron route. We resolve via the
  // request's host so this works in dev (localhost), preview, and
  // production without a hard-coded base URL.
  const reqUrl = new URL(request.url);
  const upstream =
    `${reqUrl.protocol}//${reqUrl.host}/api/cron/${cronPath}` +
    (body.query ? `?${body.query.replace(/^[?&]/, "")}` : "");

  const startedAt = Date.now();
  try {
    logger.info("admin-trigger.start", {
      user_email: user?.email,
      cron_path: cronPath,
      query: body.query ?? null,
    });
    const res = await fetch(upstream, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${cronSecret}`,
        // Lets the upstream cron route stamp `trigger='manual'` in
        // its cron_runs audit row instead of the default 'cron'.
        "x-cron-trigger": "manual",
      },
      signal: AbortSignal.timeout(290_000),
    });
    const status = res.status;
    // Read the body once as text — calling res.json() consumes the
    // stream, and on parse failure res.text() then throws "Body is
    // unusable". Always go via .text() and then try-parse.
    const text = await res.text();
    let upstreamBody: unknown;
    try {
      upstreamBody = JSON.parse(text);
    } catch {
      upstreamBody = text.slice(0, 2000);
    }
    logger.info("admin-trigger.done", {
      user_email: user?.email,
      cron_path: cronPath,
      status,
      duration_ms: Date.now() - startedAt,
    });
    return NextResponse.json(
      {
        ok: status >= 200 && status < 300,
        cron_path: cronPath,
        status,
        duration_ms: Date.now() - startedAt,
        upstream: upstreamBody,
      },
      { status: status >= 200 && status < 300 ? 200 : 502 },
    );
  } catch (err) {
    logger.error("admin-trigger.error", {
      user_email: user?.email,
      cron_path: cronPath,
      error: String(err),
    });
    return NextResponse.json(
      {
        ok: false,
        cron_path: cronPath,
        error: String(err),
        duration_ms: Date.now() - startedAt,
      },
      { status: 500 },
    );
  }
}
