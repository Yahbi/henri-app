#!/usr/bin/env npx tsx
/* ── Pipeline Health Check ───────────────────────────────────────────────────
 * Diagnoses why data might not be showing on the map.
 * Checks every step of the pipeline and reports what's missing.
 *
 * Usage:
 *   npx tsx scripts/check-pipeline.ts
 * ────────────────────────────────────────────────────────────────────────── */

import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "..", ".env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

type Status = "pass" | "fail" | "warn";

function check(status: Status, label: string, detail?: string) {
  const icon = status === "pass" ? "[OK]" : status === "fail" ? "[!!]" : "[??]";
  console.log(`  ${icon} ${label}`);
  if (detail) console.log(`      ${detail}`);
}

async function main() {
  console.log("=".repeat(60));
  console.log("  Henri — Pipeline Health Check");
  console.log("=".repeat(60));

  /* ── 1. Environment ─────────────────────────────────────────────────── */
  console.log("\n--- Environment ---");

  if (SUPABASE_URL && SUPABASE_URL.startsWith("https://")) {
    check("pass", "NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
  } else {
    check("fail", "NEXT_PUBLIC_SUPABASE_URL", "Missing or empty. Get it from app.supabase.com > Project Settings > API");
    console.log("\n  Cannot continue without Supabase credentials.");
    process.exit(1);
  }

  if (SUPABASE_KEY && SUPABASE_KEY.length > 20) {
    check("pass", "SUPABASE_SERVICE_ROLE_KEY", `${SUPABASE_KEY.slice(0, 10)}...`);
  } else {
    check("fail", "SUPABASE_SERVICE_ROLE_KEY", "Missing or empty.");
    console.log("\n  Cannot continue without Supabase credentials.");
    process.exit(1);
  }

  if (CRON_SECRET && CRON_SECRET !== "dev_cron_secret_change_in_production") {
    check("pass", "CRON_SECRET", "Set and not default");
  } else if (CRON_SECRET === "dev_cron_secret_change_in_production") {
    check("warn", "CRON_SECRET", "Using dev default — OK for local testing");
  } else {
    check("fail", "CRON_SECRET", "Missing — needed for scoring trigger");
  }

  const headers = {
    apikey: SUPABASE_KEY!,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
  };

  /* ── 2. Permits table ───────────────────────────────────────────────── */
  console.log("\n--- Permits Table ---");

  try {
    // Total permits via the count endpoint (HEAD with Prefer: count=exact
    // returns the total via the content-range header without rows). Note:
    // an earlier version of this script also fetched a separate `?limit=1`
    // probe — dropped because countResp serves the same diagnostic and
    // the dead probe was a CI lint warning (no-unused-vars).
    const countResp = await fetch(
      `${SUPABASE_URL}/rest/v1/permits?select=id`,
      { headers: { ...headers, Prefer: "count=exact" }, method: "HEAD" },
    );
    const totalPermits = countResp.headers.get("content-range")?.split("/")[1] ?? "?";

    if (totalPermits === "0" || totalPermits === "?") {
      check("fail", `Permits in database: ${totalPermits}`, "Run: npm run ingest");
    } else {
      check("pass", `Permits in database: ${totalPermits}`);
    }

    // Permits with coordinates
    const geoResp = await fetch(
      `${SUPABASE_URL}/rest/v1/permits?latitude=not.is.null&select=id`,
      { headers: { ...headers, Prefer: "count=exact" }, method: "HEAD" },
    );
    const withCoords = geoResp.headers.get("content-range")?.split("/")[1] ?? "0";
    if (withCoords === "0") {
      check("fail", `Permits with coordinates: ${withCoords}`, "Run: npm run ingest (without --skip-geocode) or npm run backfill-geocode");
    } else {
      check("pass", `Permits with coordinates: ${withCoords}`);
    }

    // Unscored permits
    const unscoredResp = await fetch(
      `${SUPABASE_URL}/rest/v1/permits?scored_at=is.null&select=id`,
      { headers: { ...headers, Prefer: "count=exact" }, method: "HEAD" },
    );
    const unscored = unscoredResp.headers.get("content-range")?.split("/")[1] ?? "0";
    if (unscored !== "0") {
      check("warn", `Unscored permits: ${unscored}`, "Run: npm run score");
    } else {
      check("pass", "All permits scored");
    }

    // ZIP distribution
    const zipResp = await fetch(
      `${SUPABASE_URL}/rest/v1/permits?select=zip&latitude=not.is.null&limit=5000`,
      { headers },
    );
    if (zipResp.ok) {
      const zipRows: Array<{ zip: string }> = await zipResp.json();
      const zipCounts = new Map<string, number>();
      for (const row of zipRows) {
        if (row.zip) zipCounts.set(row.zip, (zipCounts.get(row.zip) ?? 0) + 1);
      }
      const topZips = [...zipCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
      if (topZips.length > 0) {
        console.log("  Top ZIPs with geocoded permits:");
        for (const [zip, count] of topZips) {
          console.log(`    ${zip}: ${count} permits`);
        }
      }
    }
  } catch (err) {
    check("fail", "Cannot query permits table", String(err));
  }

  /* ── 3. Leads table ─────────────────────────────────────────────────── */
  console.log("\n--- Leads Table ---");

  try {
    const leadsResp = await fetch(
      `${SUPABASE_URL}/rest/v1/leads?select=id`,
      { headers: { ...headers, Prefer: "count=exact" }, method: "HEAD" },
    );
    const totalLeads = leadsResp.headers.get("content-range")?.split("/")[1] ?? "0";

    if (totalLeads === "0") {
      check("fail", `Leads created: ${totalLeads}`, "Run: npm run score (with dev server running)");
    } else {
      check("pass", `Leads created: ${totalLeads}`);
    }

    // Leads with coordinates
    const geoLeadsResp = await fetch(
      `${SUPABASE_URL}/rest/v1/leads?latitude=not.is.null&select=id`,
      { headers: { ...headers, Prefer: "count=exact" }, method: "HEAD" },
    );
    const leadsWithCoords = geoLeadsResp.headers.get("content-range")?.split("/")[1] ?? "0";
    if (totalLeads !== "0" && leadsWithCoords === "0") {
      check("fail", `Leads with coordinates: ${leadsWithCoords}`, "Permits were likely uploaded without geocoding. Run: npm run backfill-geocode && npm run score");
    } else if (totalLeads !== "0") {
      check("pass", `Leads with coordinates: ${leadsWithCoords}`);
    }
  } catch (err) {
    check("fail", "Cannot query leads table", String(err));
  }

  /* ── 4. Territories ─────────────────────────────────────────────────── */
  console.log("\n--- Territories ---");

  try {
    const terrResp = await fetch(
      `${SUPABASE_URL}/rest/v1/territories?status=eq.active&select=zip,contractor_id`,
      { headers },
    );

    if (terrResp.ok) {
      const territories: Array<{ zip: string; contractor_id: string }> = await terrResp.json();
      if (territories.length === 0) {
        check("fail", "No active territories", "A contractor must claim ZIP territories during onboarding to see leads on the map");
      } else {
        const uniqueContractors = new Set(territories.map((t) => t.contractor_id));
        const uniqueZips = [...new Set(territories.map((t) => t.zip))];
        check("pass", `${territories.length} active territories across ${uniqueContractors.size} contractor(s)`);
        console.log(`    ZIPs claimed: ${uniqueZips.slice(0, 15).join(", ")}${uniqueZips.length > 15 ? "..." : ""}`);

        // Check overlap with permit ZIPs
        const permitZipResp = await fetch(
          `${SUPABASE_URL}/rest/v1/permits?latitude=not.is.null&select=zip&limit=5000`,
          { headers },
        );
        if (permitZipResp.ok) {
          const permitZips = new Set(
            (await permitZipResp.json() as Array<{ zip: string }>)
              .map((r) => r.zip)
              .filter(Boolean),
          );
          const overlap = uniqueZips.filter((z) => permitZips.has(z));
          if (overlap.length === 0) {
            check("fail", "No ZIP overlap between territories and geocoded permits",
              `Territory ZIPs: ${uniqueZips.slice(0, 5).join(", ")} | Permit ZIPs: ${[...permitZips].slice(0, 5).join(", ")}`);
            console.log("    The contractor needs to claim ZIPs where permits exist, or ingest permits for claimed ZIPs.");
          } else {
            check("pass", `${overlap.length} ZIPs overlap: ${overlap.slice(0, 10).join(", ")}`);
          }
        }
      }
    }
  } catch (err) {
    check("fail", "Cannot query territories", String(err));
  }

  /* ── Summary ────────────────────────────────────────────────────────── */
  console.log("\n" + "=".repeat(60));
  console.log("  Recommended next steps:");
  console.log("  1. Fill in .env.local with Supabase credentials");
  console.log("  2. npm run ingest          (upload permits with coordinates)");
  console.log("  3. npm run dev             (start Next.js)");
  console.log("  4. npm run score           (create leads from permits)");
  console.log("  5. Claim territories for the ZIPs shown above");
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("Health check failed:", err);
  process.exit(1);
});
