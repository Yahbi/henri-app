import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasStripe, hasTwilio, hasResend, hasOpenAI, hasSupabase } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * GET /api/health
 *
 * Liveness + readiness check for uptime monitoring (BetterStack, Pingdom,
 * Vercel Monitoring, etc.) and DR runbook validation. Returns:
 *   - 200 + JSON when all critical services are reachable
 *   - 503 + JSON when DB or auth is unreachable
 *   - Auxiliary services (Stripe / Twilio / Resend / OpenAI) report their
 *     gate status but don't fail the response — they're optional integrations
 *     and may be intentionally unset in dev / preview environments.
 *
 * No auth required (intentionally public). Returns no PII or secrets — just
 * service-level reachability + the deployed git commit SHA so on-call can
 * confirm what version is live.
 *
 * Cache: `no-store` so monitors always get a fresh signal.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface HealthCheck {
  status: "ok" | "fail" | "unconfigured";
  latency_ms?: number;
  error?: string;
}

interface HealthResponse {
  status: "ok" | "degraded" | "fail";
  version: string | null;
  uptime_seconds: number;
  timestamp: string;
  services: {
    database: HealthCheck;
    stripe: HealthCheck;
    twilio: HealthCheck;
    resend: HealthCheck;
    openai: HealthCheck;
  };
}

const startedAt = Date.now();

async function checkDatabase(): Promise<HealthCheck> {
  if (!hasSupabase()) {
    return { status: "unconfigured", error: "Supabase env missing" };
  }
  const t0 = Date.now();
  try {
    const supabase = createAdminClient();
    // Cheap probe — count permits in head-only mode. Estimated count
    // returns instantly via pg_class.reltuples rather than a sequential
    // scan, so the health check stays under 100ms even on 1.5M-row tables.
    const { error } = await supabase
      .from("permits")
      .select("*", { count: "estimated", head: true });
    const latency_ms = Date.now() - t0;
    if (error) {
      // Log the real error server-side; the public response gets a
      // generic string so DB internals (schema names, connection
      // details) never leak through an unauthenticated endpoint.
      logger.error("health: database probe failed", { error: error.message });
      return { status: "fail", latency_ms, error: "database unreachable" };
    }
    return { status: "ok", latency_ms };
  } catch (e) {
    logger.error("health: database probe threw", {
      error: e instanceof Error ? e.message : String(e),
    });
    return {
      status: "fail",
      latency_ms: Date.now() - t0,
      error: "database unreachable",
    };
  }
}

export async function GET() {
  // DB is the only critical service — everything else is auxiliary.
  // If DB fails, the overall status is "fail" (503).
  const database = await checkDatabase();

  const services: HealthResponse["services"] = {
    database,
    // For non-critical services, just check whether their env vars are
    // configured. A real network probe per service per health-check
    // would burn rate-limit budget on Stripe/Twilio/etc.
    stripe: hasStripe()
      ? { status: "ok" }
      : { status: "unconfigured", error: "STRIPE_SECRET_KEY unset" },
    twilio: hasTwilio()
      ? { status: "ok" }
      : { status: "unconfigured", error: "TWILIO_* env unset" },
    resend: hasResend()
      ? { status: "ok" }
      : { status: "unconfigured", error: "RESEND_API_KEY unset" },
    openai: hasOpenAI()
      ? { status: "ok" }
      : { status: "unconfigured", error: "OPENAI_API_KEY unset" },
  };

  const overall: HealthResponse["status"] =
    database.status === "fail"
      ? "fail"
      : Object.values(services).some((s) => s.status === "fail")
        ? "degraded"
        : "ok";

  const body: HealthResponse = {
    status: overall,
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
    services,
  };

  // 503 only when the critical DB path is down — this is the signal
  // upstream load balancers / monitors use to remove the instance from
  // rotation. Auxiliary failures still return 200 with status:"degraded"
  // so monitors can page on it without dropping traffic.
  const httpStatus = overall === "fail" ? 503 : 200;

  return NextResponse.json(body, {
    status: httpStatus,
    headers: { "Cache-Control": "no-store, must-revalidate" },
  });
}
