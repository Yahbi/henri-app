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
import { extractContactWithProvenance } from "@/lib/ingest/extract-contact";
import { normalizeStatus } from "@/lib/scrapers/normalizer";
import { logCronRun, detectTrigger } from "@/lib/admin/cron-log";

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
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Audit priority #8 (2026-04-28): inline 280s deadline. The per-source
  // loop runs ~25 sources sequentially and each can take 5-15s on slow
  // jurisdictions. Without this check Vercel kills at 300s mid-source
  // and we lose the ones that were halfway through. Now we exit cleanly
  // and the response includes the partial results.
  //
  // t0 is captured AFTER the auth check on purpose: an unauthorized request
  // is not a run, and logging it would reset catchup's staleness clock for
  // this cron without any work having happened.
  const t0 = Date.now();
  try {
    return await run(request, t0);
  } catch (err) {
    // The route has never caught here — rethrow so Next's own error handling
    // (and the resulting 500) is unchanged. The catch exists purely so the
    // run leaves an audit row behind instead of looking "never ran".
    await logCronRun("permits", t0, {
      status: "error",
      error: String(err),
      trigger: detectTrigger(request),
    });
    throw err;
  }
}

async function run(request: NextRequest, t0: number): Promise<NextResponse> {
  const supabase = createAdminClient();
  const results: SourceResult[] = [];
  let totalInserted = 0;
  const deadlineMs = t0 + 280_000;

  for (const source of PERMIT_SOURCES) {
    if (Date.now() > deadlineMs) {
      results.push({
        id: source.id,
        city: source.city,
        fetched: 0,
        inserted: 0,
        skipped: 0,
        errors: ["skipped — cron deadline reached"],
      });
      continue;
    }
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
          // First pass: combined name from the structured first/last the
          // upstream Socrata parser set on the record itself.
          const combined = [p.owner_first, p.owner_last].filter(Boolean).join(" ").trim();
          // Fallback: pull applicant/owner/contractor from raw_data with
          // the multi-city extractor. Many Socrata feeds ship the owner
          // as `ownername` / `applicant_name` / `owner_s_business_name`
          // — none of which the upstream parser maps. Backfill-from-raw
          // audit (2026-04-22) showed ~37% of permits have a non-null
          // owner field in raw_json that was never being persisted.
          //
          // We still call extractContactWithProvenance here (rather than
          // relying solely on fetcher's p.contact_source) because we need
          // the full ExtractedContact to resolve applicant_name + contractor_name,
          // not just the provenance tags. The fetcher's provenance fields
          // are used as the canonical stamp because they reflect the
          // raw-blob read that actually populated owner_first/owner_last.
          //
          // Provenance columns (migration 00039):
          //   contact_source       — which upstream shape the blob came from
          //   contact_confidence   — 0-1 heuristic quality score
          //   contact_extracted_at — when we pulled it
          const fromRaw = extractContactWithProvenance(p.raw_data);
          const applicantName = combined || fromRaw.applicant_name || fromRaw.owner_name || null;
          // Only stamp provenance when we actually pulled a contact
          // field — blank rows shouldn't get a "confidence" badge.
          const wroteContact = !!(applicantName || fromRaw.contractor_name);
          const nowIso = new Date().toISOString();
          return {
            source_city: sourceCity,
            source_id: p.permit_number
              ? `${sourceCity}_${p.permit_number}`
              : `${sourceCity}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            permit_number: p.permit_number,
            city: p.city,
            state: p.state,
            address: p.address,
            // permits.zip is varchar(5); upstream sources sometimes
            // ship ZIP+4 strings ("60601-1234") which overflow.
            // Extract the first 5 digits, drop anything that isn't a
            // valid 5-digit ZIP.
            zip: ((): string | null => {
              const raw = (p.zip ?? "").trim();
              if (!raw) return null;
              const m = raw.match(/^(\d{5})/);
              return m ? m[1] : null;
            })(),
            latitude: p.latitude,
            longitude: p.longitude,
            permit_type: mapPermitType(p.permit_type),
            // Map upstream status string to the DB enum. Was hardcoded
            // `"issued"` until 2026-04-27 audit B1 — that lied about
            // every permit's actual lifecycle (submitted/approved/
            // expired/revoked all collapsed to "issued"). Read from the
            // raw blob in priority order; fall back to "submitted" so
            // we never write an invalid enum.
            status: normalizeStatus(
              String(
                (p.raw_data as Record<string, unknown> | null)?.status ??
                  (p.raw_data as Record<string, unknown> | null)?.permit_status ??
                  (p.raw_data as Record<string, unknown> | null)?.workflow_status ??
                  (p.raw_data as Record<string, unknown> | null)?.current_status ??
                  ""
              )
            ),
            description: p.description,
            estimated_value: p.estimated_value,
            applicant_name: applicantName,
            contractor_name: fromRaw.contractor_name,
            // Prefer the fetcher's provenance (reflects the raw-blob read
            // inside fetchPermits) and fall back to our re-extraction.
            contact_source: wroteContact ? (p.contact_source ?? fromRaw.source) : null,
            contact_confidence: wroteContact
              ? (p.contact_confidence ?? fromRaw.confidence)
              : null,
            contact_extracted_at: wroteContact ? nowIso : null,
            issued_date: p.applied_date,
            source_type: "socrata",
            raw_json: p.raw_data,
            created_at: nowIso,
            updated_at: nowIso,
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

  const result = {
    success: true,
    processed_at: new Date().toISOString(),
    sources: results,
    total_inserted: totalInserted,
    total_fetched: results.reduce((sum, r) => sum + r.fetched, 0),
    total_skipped: results.reduce((sum, r) => sum + r.skipped, 0),
  };
  await logCronRun("permits", t0, {
    // pulled = permit records fetched from upstream across all sources.
    // inserted = new permit rows written (dedup + upsert applied).
    pulled: result.total_fetched,
    inserted: result.total_inserted,
    summary: result,
    trigger: detectTrigger(request),
  });
  return NextResponse.json(result);
}
