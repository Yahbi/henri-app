/* ── Permit Ingestion Cron ───────────────────────────────────────────────────
 * GET /api/cron/permits
 *
 * Called on a schedule to fetch recent building permits from public data
 * sources, deduplicate against existing records, and insert new permits
 * into the `permits` table for downstream scoring and lead assignment.
 * ────────────────────────────────────────────────────────────────────────── */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PERMIT_SOURCES } from "@/lib/permits/sources";
import { fetchPermits, type NormalizedPermit } from "@/lib/permits/fetcher";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 min — enough for 25 sources

/* Valid permit_type enum values in the database */
const PERMIT_TYPE_MAP: Record<string, string> = {
  residential: "residential",
  commercial: "commercial",
  demolition: "demolition",
  renovation: "renovation",
  new_construction: "new_construction",
  addition: "addition",
  repair: "repair",
};

/** Map free-text permit type to the database enum value. */
function mapPermitType(text: string | null): string {
  if (!text) return "other";
  const lower = text.toLowerCase();
  for (const [keyword, enumValue] of Object.entries(PERMIT_TYPE_MAP)) {
    if (lower.includes(keyword)) return enumValue;
  }
  if (lower.includes("remodel") || lower.includes("alteration")) return "renovation";
  if (lower.includes("new ") || lower.includes("construct")) return "new_construction";
  if (lower.includes("demo")) return "demolition";
  if (lower.includes("add")) return "addition";
  return "other";
}

interface SourceResult {
  id: string;
  city: string;
  fetched: number;
  inserted: number;
  skipped: number;
  errors: string[];
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Build a dedup key from permit number + city (lowercased, trimmed). */
function dedupKey(permitNumber: string, city: string): string {
  return `${permitNumber.toLowerCase().trim()}::${city.toLowerCase().trim()}`;
}

/* ── Route handler ───────────────────────────────────────────────────────── */

export async function GET(request: NextRequest) {
  /* Auth */
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const results: SourceResult[] = [];
  let totalInserted = 0;

  for (const source of PERMIT_SOURCES) {
    const result: SourceResult = {
      id: source.id,
      city: source.city,
      fetched: 0,
      inserted: 0,
      skipped: 0,
      errors: [],
    };

    try {
      /* 1. Fetch recent permits */
      let permits: NormalizedPermit[];
      try {
        permits = await fetchPermits(source, { limit: 200, daysBack: 7 });
      } catch (fetchErr) {
        const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
        result.errors.push(`Fetch failed: ${msg}`);
        results.push(result);
        await sleep(500);
        continue;
      }

      result.fetched = permits.length;

      if (permits.length === 0) {
        results.push(result);
        await sleep(500);
        continue;
      }

      /* 2. Deduplicate — check which permit_numbers already exist for this city */
      const permitNumbers = permits
        .map((p) => p.permit_number)
        .filter((n): n is string => n != null && n.length > 0);

      const existingKeys = new Set<string>();

      if (permitNumbers.length > 0) {
        // Batch lookup in chunks of 100 to avoid query-string limits
        const sourceCity = `socrata_${source.id}`;
        for (let i = 0; i < permitNumbers.length; i += 100) {
          const chunk = permitNumbers.slice(i, i + 100);
          const { data: existing } = await supabase
            .from("permits")
            .select("source_id, source_city")
            .eq("source_city", sourceCity)
            .in("source_id", chunk.map((n) => `${sourceCity}_${n}`));

          if (existing) {
            for (const row of existing) {
              existingKeys.add(
                dedupKey(
                  (row.source_id as string).replace(`${sourceCity}_`, ""),
                  source.city,
                ),
              );
            }
          }
        }
      }

      /* 3. Filter to new permits only */
      const newPermits = permits.filter((p) => {
        if (!p.permit_number) return true; // No number → can't dedup, insert anyway
        return !existingKeys.has(dedupKey(p.permit_number, source.city));
      });

      result.skipped = permits.length - newPermits.length;

      if (newPermits.length === 0) {
        results.push(result);
        await sleep(500);
        continue;
      }

      /* 4. Insert into permits table in batches of 50 */
      const sourceCity = `socrata_${source.id}`;
      for (let i = 0; i < newPermits.length; i += 50) {
        const batch = newPermits.slice(i, i + 50);
        const rows = batch.map((p) => {
          const ownerName = [p.owner_first, p.owner_last].filter(Boolean).join(" ") || null;
          return {
            source_city: sourceCity,
            source_id: p.permit_number
              ? `${sourceCity}_${p.permit_number}`
              : `${sourceCity}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            permit_number: p.permit_number,
            city: p.city,
            state: p.state,
            address: p.address,
            zip: p.zip,
            latitude: p.latitude,
            longitude: p.longitude,
            permit_type: mapPermitType(p.permit_type),
            status: "issued" as const,
            description: p.description,
            estimated_value: p.estimated_value,
            applicant_name: ownerName,
            issued_date: p.applied_date,
            source_type: "socrata",
            raw_json: p.raw_data,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
        });

        const { error: insertError, data: insertedRows } = await supabase
          .from("permits")
          .upsert(rows, { onConflict: "source_city,source_id", ignoreDuplicates: true })
          .select("id");

        if (insertError) {
          result.errors.push(`Insert batch ${i} failed: ${insertError.message}`);
        } else {
          result.inserted += insertedRows?.length ?? batch.length;
        }
      }

      totalInserted += result.inserted;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Unexpected error: ${msg}`);
    }

    results.push(result);

    // Rate-limit: 500 ms delay between sources
    await sleep(500);
  }

  return NextResponse.json({
    success: true,
    processed_at: new Date().toISOString(),
    sources: results,
    total_inserted: totalInserted,
    total_fetched: results.reduce((sum, r) => sum + r.fetched, 0),
    total_skipped: results.reduce((sum, r) => sum + r.skipped, 0),
  });
}
