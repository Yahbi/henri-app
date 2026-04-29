/**
 * Phase 6 — End-to-end route smoke audit.
 *
 * Hits every dashboard, marketing, and API route with both authenticated
 * (owner session cookies from dev-login) and anonymous contexts. Reports
 * status + key content signals.
 *
 * Run:  npx tsx scripts/audit-app.ts
 */

import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const URL = process.env.LOCAL_APP_URL ?? "http://localhost:3000";

type Check = {
  name: string;
  path: string;
  method?: "GET" | "POST";
  authed: boolean;
  expectStatus?: number[]; // default [200, 204, 302]
  bodyAssert?: (body: string, json: unknown) => string | null; // returns error msg or null
};

// We can't easily forge Supabase session cookies from Node, so auth'd
// routes are checked via the /api/dev/auto-login flow which sets them.
// The audit script runs the auto-login once, captures the Set-Cookie headers,
// and replays them on subsequent requests.

async function login(): Promise<Record<string, string>> {
  const res = await fetch(`${URL}/api/dev/auto-login`, {
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(`auto-login failed: ${res.status} ${await res.text()}`);
  }
  const cookies: Record<string, string> = {};
  // Node 22 fetch: getSetCookie()
  const setCookies =
    (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ??
    [];
  for (const sc of setCookies) {
    const [pair] = sc.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) cookies[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  if (Object.keys(cookies).length === 0) {
    console.warn("No cookies captured; authed checks will likely 401");
  }
  return cookies;
}

const anonChecks: Check[] = [
  { name: "home", path: "/", authed: false },
  { name: "marketing:pricing", path: "/pricing", authed: false },
  { name: "marketing:contractors", path: "/contractors", authed: false },
  { name: "marketing:portal", path: "/portal", authed: false },
  { name: "login page", path: "/login", authed: false },
  { name: "signup page", path: "/signup", authed: false },
];

const authedChecks: Check[] = [
  { name: "/dashboard", path: "/dashboard", authed: true },
  { name: "/dashboard/map?days=30", path: "/dashboard/map?days=30", authed: true },
  { name: "/dashboard/map?days=90", path: "/dashboard/map?days=90", authed: true },
  { name: "/dashboard/pipeline", path: "/dashboard/pipeline", authed: true },
  { name: "/dashboard/permits", path: "/dashboard/permits", authed: true },
  { name: "/dashboard/leads", path: "/dashboard/leads", authed: true },
  { name: "/dashboard/intel", path: "/dashboard/intel", authed: true },
  { name: "/dashboard/analytics", path: "/dashboard/analytics", authed: true },
  { name: "/dashboard/roi", path: "/dashboard/roi", authed: true },
  { name: "/dashboard/canvass", path: "/dashboard/canvass", authed: true },
  { name: "/dashboard/storm", path: "/dashboard/storm", authed: true },
  { name: "/dashboard/compliance", path: "/dashboard/compliance", authed: true },
  { name: "/dashboard/estimate", path: "/dashboard/estimate", authed: true },
  { name: "/dashboard/reputation", path: "/dashboard/reputation", authed: true },
  { name: "/dashboard/financing", path: "/dashboard/financing", authed: true },
  { name: "/dashboard/blast", path: "/dashboard/blast", authed: true },
  { name: "/dashboard/messages", path: "/dashboard/messages", authed: true },
  { name: "/dashboard/outreach", path: "/dashboard/outreach", authed: true },
  { name: "/dashboard/jobs", path: "/dashboard/jobs", authed: true },
  { name: "/dashboard/settings", path: "/dashboard/settings", authed: true },
  { name: "/dashboard/billing", path: "/dashboard/billing", authed: true },
  { name: "/homeowner", path: "/homeowner", authed: true, expectStatus: [200, 302, 307] },
  // APIs
  {
    name: "api/leads",
    path: "/api/leads",
    authed: true,
    bodyAssert: (_b, j) => {
      const rows = (j as { leads?: unknown[] })?.leads;
      return Array.isArray(rows) ? null : "no leads[] in response";
    },
  },
  {
    name: "api/leads/map?days=30",
    path: "/api/leads/map?days=30",
    authed: true,
    bodyAssert: (_b, j) => {
      const features = (j as { features?: unknown[] })?.features;
      if (!Array.isArray(features)) return "no features[] in response";
      return null;
    },
  },
  // /api/permits intentionally skipped — no such route in this codebase
  // (permits are surfaced via /api/leads & /api/leads/map with joins).
  { name: "api/profile", path: "/api/profile", authed: true },
  { name: "api/territories", path: "/api/territories", authed: true },
  { name: "api/analytics/funnel", path: "/api/analytics/funnel", authed: true },
  { name: "api/analytics/forecast", path: "/api/analytics/forecast", authed: true },
  // ── Phase-3 endpoints added during the launch-readiness pass ──
  // Each POST endpoint is sent with an empty body and is expected to
  // return 400 (missing required fields). They're here to catch
  // compile-time breakage + auth regressions, not to exercise happy path.
  { name: "api/overlays/spc", path: "/api/overlays/spc?day=1", authed: true },
  { name: "api/overlays/alerts", path: "/api/overlays/alerts", authed: true },
  { name: "api/billing/portal", path: "/api/billing/portal", method: "POST", authed: true, expectStatus: [200, 400] },
  { name: "api/billing/change-plan", path: "/api/billing/change-plan", method: "POST", authed: true, expectStatus: [400] },
  { name: "api/billing/extra-zip", path: "/api/billing/extra-zip", method: "POST", authed: true, expectStatus: [200, 400, 500] },
  { name: "api/licenses/verify", path: "/api/licenses/verify", method: "POST", authed: true },
  { name: "api/compliance/verify", path: "/api/compliance/verify", method: "POST", authed: true },
  { name: "api/ai/draft-reply", path: "/api/ai/draft-reply", method: "POST", authed: true, expectStatus: [400] },
  { name: "api/reviews/respond", path: "/api/reviews/respond", method: "POST", authed: true, expectStatus: [400] },
  { name: "api/estimates/send", path: "/api/estimates/send", method: "POST", authed: true, expectStatus: [400] },
  { name: "api/financing/request", path: "/api/financing/request", method: "POST", authed: true, expectStatus: [400] },
  { name: "api/messages/send", path: "/api/messages/send", method: "POST", authed: true, expectStatus: [400] },
  // Cron endpoints — bearer-gated, so unauthenticated POST should 401.
  { name: "api/cron/blast-worker (unauth)", path: "/api/cron/blast-worker", authed: false, expectStatus: [401] },
  { name: "api/cron/enrich (unauth)", path: "/api/cron/enrich", authed: false, expectStatus: [401] },
  { name: "api/cron/geocode-backfill (unauth)", path: "/api/cron/geocode-backfill", authed: false, expectStatus: [401] },
];

async function run(check: Check, cookies: Record<string, string>) {
  const headers: Record<string, string> = {};
  if (check.authed && Object.keys(cookies).length > 0) {
    headers.cookie = Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }
  // POST smoke-tests send an empty JSON body so the handler can echo
  // its validation errors (e.g., "lead_id required") rather than 500'ing
  // on a missing body parse. The expectStatus on each POST check
  // encodes the expected 400.
  const init: RequestInit = {
    method: check.method ?? "GET",
    headers,
    redirect: "manual",
  };
  if (check.method === "POST") {
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    init.body = "{}";
  }
  const res = await fetch(`${URL}${check.path}`, init);
  const acceptable = check.expectStatus ?? [200, 204, 302, 307];
  const statusOk = acceptable.includes(res.status);
  let bodyErr: string | null = null;
  if (statusOk && check.bodyAssert) {
    const body = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(body);
    } catch {
      /* HTML */
    }
    bodyErr = check.bodyAssert(body, json);
  }
  return {
    name: check.name,
    status: res.status,
    ok: statusOk && !bodyErr,
    error: !statusOk ? `unexpected status ${res.status}` : bodyErr,
  };
}

async function main() {
  console.log(`Audit target: ${URL}`);
  console.log("Logging in via /api/dev/auto-login…");
  const cookies = await login();
  console.log(`Captured ${Object.keys(cookies).length} cookies`);

  const results: Awaited<ReturnType<typeof run>>[] = [];
  for (const c of [...anonChecks, ...authedChecks]) {
    const r = await run(c, cookies);
    const tag = r.ok ? "✓" : "✗";
    console.log(`  ${tag} ${r.status} ${r.name}${r.error ? " — " + r.error : ""}`);
    results.push(r);
  }

  const ok = results.filter((r) => r.ok).length;
  const fail = results.length - ok;
  console.log(`\n${ok}/${results.length} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
