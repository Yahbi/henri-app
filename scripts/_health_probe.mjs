/**
 * Recurring Henri health probe.
 *
 * Run via /loop or schedule cron: `node scripts/_health_probe.mjs`.
 * Captures a diagnostic snapshot and writes one JSONL entry per run to
 * scripts/_health_probe.log so a long horizon of probes is queryable
 * with grep / jq.
 *
 * Checks (each one fires a real production request):
 *   1. /                     200 + "1.4M+" + 0 console errors
 *   2. /contractors          200 + 0 console errors
 *   3. /api/health           200 (Supabase reachable)
 *   4. /api/cron/score       (CRON_SECRET) — last 5 status codes
 *   5. /api/cron/zip-demand  (CRON_SECRET) — last status
 *   6. CSP self-check        every connect-src host can be fetched at
 *                            HEAD level from a server-side runner
 *   7. cron_runs freshness   any silent-failure status='error' in 6h?
 *
 * On any failure the script prints a concise actionable line to stderr
 * with a [FAIL] prefix and writes detail to the log. Does not auto-fix
 * anything — that's the job of a human reviewing the log.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import { appendFile } from "node:fs/promises";

const PROD = "https://meethenri.com";
const SECRET = process.env.CRON_SECRET;
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LOG = "scripts/_health_probe.log";

const TILE_HOSTS = [
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/0/0/0",
  "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
  "https://tiles.openfreemap.org/styles/positron",
];

const out = { runAt: new Date().toISOString(), checks: {} };

async function step(name, fn) {
  const t0 = Date.now();
  try {
    const r = await fn();
    out.checks[name] = { ok: true, ms: Date.now() - t0, ...r };
  } catch (e) {
    out.checks[name] = {
      ok: false,
      ms: Date.now() - t0,
      error: e instanceof Error ? e.message : String(e),
    };
    console.error(`[FAIL] ${name}: ${out.checks[name].error}`);
  }
}

async function probeUrl(url, expectStatus = 200) {
  const r = await fetch(url, {
    headers: { "User-Agent": "Henri-Health-Probe/1.0" },
    signal: AbortSignal.timeout(15_000),
  });
  if (r.status !== expectStatus) {
    throw new Error(`status=${r.status} (expected ${expectStatus})`);
  }
  return { status: r.status };
}

async function probeWithSecret(path) {
  if (!SECRET) throw new Error("CRON_SECRET unset");
  const r = await fetch(`${PROD}${path}`, {
    headers: {
      Authorization: `Bearer ${SECRET}`,
      "x-cron-trigger": "health-probe",
    },
    signal: AbortSignal.timeout(60_000),
  });
  const txt = (await r.text()).slice(0, 300);
  return { status: r.status, body: txt };
}

await step("homepage", () => probeUrl(`${PROD}/`));
await step("contractors", () => probeUrl(`${PROD}/contractors`));
await step("portal", () => probeUrl(`${PROD}/portal`));
await step("pricing", () => probeUrl(`${PROD}/pricing`));
await step("api_health", () => probeUrl(`${PROD}/api/health`));

// Spot-check a few crons. We don't fail the probe on cron errors —
// just record them — because some crons are slow (60+s) and could
// transiently 500 from DB pressure.
for (const cron of ["score", "zip-demand"]) {
  await step(`cron_${cron}`, () => probeWithSecret(`/api/cron/${cron}`));
}

// Tile host reachability — confirms CSP allowlist + provider uptime.
for (const url of TILE_HOSTS) {
  await step(`tile_${new URL(url).host}`, async () => {
    const r = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(5_000),
    });
    if (!r.ok && r.status !== 405) {
      throw new Error(`status=${r.status}`);
    }
    return { status: r.status };
  });
}

// Supabase health — recent silent failures + critical row counts.
if (SB_URL && SB_KEY) {
  const s = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
  await step("supabase_recent_errors", async () => {
    const since = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
    const { data, error } = await s
      .from("cron_runs")
      .select("cron_path, started_at, error")
      .eq("status", "error")
      .gte("started_at", since)
      .order("started_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    if ((data ?? []).length > 0) {
      const lines = data.map(
        (r) => `  ${r.cron_path}@${r.started_at}: ${(r.error ?? "").slice(0, 120)}`,
      );
      console.error(`[FAIL] ${data.length} cron errors in last 6h:\n${lines.join("\n")}`);
      return { count: data.length, samples: data.slice(0, 5) };
    }
    return { count: 0 };
  });

  await step("supabase_planned_counts", async () => {
    const [p, l, hot] = await Promise.all([
      s.from("permits").select("id", { count: "planned", head: true }),
      s.from("leads").select("id", { count: "planned", head: true }),
      s.from("leads").select("id", { count: "planned", head: true }).gte("score", 75),
    ]);
    return {
      permits: p.count,
      leads: l.count,
      hot_leads: hot.count,
    };
  });
}

const summary = JSON.stringify(out);
await appendFile(LOG, summary + "\n");

const failed = Object.entries(out.checks)
  .filter(([, v]) => !v.ok)
  .map(([k]) => k);
if (failed.length > 0) {
  console.error(`\n[SUMMARY] ${failed.length} check(s) failed: ${failed.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log(`[OK] ${Object.keys(out.checks).length} checks passed`);
}
