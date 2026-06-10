/**
 * GET/POST /api/cron/discover-sources
 *
 * The self-perpetuating nationwide source-discovery loop. Each run walks
 * one page of the Socrata Discovery catalog AND one page of the ArcGIS
 * Hub catalog, auto-detects field mappings for every permit dataset it
 * finds, and inserts the new ones into `permit_sources` (enabled when the
 * mapping is good enough to scrape). A cursor in `discovery_state`
 * (migration 00104) makes it resume across runs; when a catalog is fully
 * swept the cursor wraps back to the top, so newly-published municipal
 * datasets are picked up forever. The hourly `scrape` cron then ingests
 * whatever this loop enabled.
 *
 * This is the "doesn't stop until nationwide, then keeps watching" engine.
 *
 * Cron auth: `CRON_SECRET` Bearer per CLAUDE.md.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { logCronRun, detectTrigger } from "@/lib/admin/cron-log";
import {
  fetchSocrataPage,
  fetchArcgisPage,
  detectForCandidate,
  type Candidate,
} from "@/lib/discovery/catalog";

export const runtime = "nodejs";
export const maxDuration = 300;

const SOCRATA_PAGE = 25;
const ARCGIS_PAGE = 15;

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

function normalizeEndpoint(u: string): string {
  return u.toLowerCase().replace(/\/+$/, "");
}

interface IngestOutcome {
  examined: number;
  enabledInserted: number;
  partialInserted: number;
  skippedDuplicate: number;
  skippedUnmappable: number;
  states: Set<string>;
}

async function ingestCandidates(
  supabase: ReturnType<typeof createAdminClient>,
  candidates: Candidate[],
): Promise<IngestOutcome> {
  const out: IngestOutcome = {
    examined: candidates.length,
    enabledInserted: 0,
    partialInserted: 0,
    skippedDuplicate: 0,
    skippedUnmappable: 0,
    states: new Set(),
  };
  if (candidates.length === 0) return out;

  // Dedup against existing sources in one query.
  const endpoints = candidates.map((c) => c.endpoint);
  const { data: existing } = await supabase
    .from("permit_sources")
    .select("endpoint")
    .in("endpoint", endpoints);
  const have = new Set(
    (existing ?? []).map((r) => normalizeEndpoint(r.endpoint as string)),
  );

  const rows: Record<string, unknown>[] = [];
  for (const c of candidates) {
    if (have.has(normalizeEndpoint(c.endpoint))) {
      out.skippedDuplicate++;
      continue;
    }
    const f = detectForCandidate(c);
    // Need at least a usable id to collect anything.
    if (!f.idField || !f.looksLikePermits) {
      out.skippedUnmappable++;
      continue;
    }
    const state = c.stateGuess ?? "US";
    const slug = slugify(`${c.domain}-${c.name || c.endpoint}`).slice(0, 50);
    const sourceKey = `${c.sourceType}:${state}:auto-${slug}`;
    rows.push({
      source_key: sourceKey,
      name: (c.name || "Discovered permit dataset").slice(0, 200),
      state,
      endpoint: c.endpoint,
      source_type: c.sourceType,
      id_field: f.idField,
      type_field: f.typeField,
      status_field: f.statusField,
      desc_field: f.descField,
      address_field: f.addressField,
      date_field: f.dateField,
      value_field: f.valueField,
      lat_field: f.latField,
      lng_field: f.lngField,
      enabled: f.enable,
      // CHECK constraint allows verified|probed|unknown|failed|deprecated.
      // Auto-detected-and-usable → 'probed'; weak mapping → 'unknown'.
      field_mapping_status: f.enable ? "probed" : "unknown",
      discovered_via: "discover_cron_2026-06-10",
      notes: `auto-detected ${c.columns.length} cols; updated ${c.updatedAt ?? "?"}`,
    });
    if (f.enable) out.enabledInserted++;
    else out.partialInserted++;
    out.states.add(state);
  }

  if (rows.length > 0) {
    // upsert: re-discovery of the same dataset refreshes mapping, never dupes.
    const { error } = await supabase
      .from("permit_sources")
      .upsert(rows, { onConflict: "source_key", ignoreDuplicates: true });
    if (error) {
      logger.error("discover.insert_failed", { error: error.message, n: rows.length });
      out.enabledInserted = 0;
      out.partialInserted = 0;
    }
  }
  return out;
}

async function sweepCatalog(
  supabase: ReturnType<typeof createAdminClient>,
  catalog: "socrata" | "arcgis",
): Promise<Record<string, unknown>> {
  const { data: stateRow } = await supabase
    .from("discovery_state")
    .select("cursor_offset, sweeps_completed, candidates_seen, inserted_total")
    .eq("catalog", catalog)
    .single();

  const cursor = stateRow?.cursor_offset ?? 0;
  const pageSize = catalog === "socrata" ? SOCRATA_PAGE : ARCGIS_PAGE;
  // ArcGIS Hub startindex is 1-based; Socrata offset is 0-based.
  const start = catalog === "arcgis" ? Math.max(1, cursor) : cursor;

  const { candidates, total } =
    catalog === "socrata"
      ? await fetchSocrataPage(start, pageSize)
      : await fetchArcgisPage(start, pageSize);

  const outcome = await ingestCandidates(supabase, candidates);

  // Advance cursor; wrap to top when we've passed the end (re-sweep forever).
  let nextCursor = start + pageSize;
  let sweeps = stateRow?.sweeps_completed ?? 0;
  if (total > 0 && nextCursor >= total) {
    nextCursor = catalog === "arcgis" ? 1 : 0;
    sweeps += 1;
  }

  await supabase
    .from("discovery_state")
    .update({
      cursor_offset: nextCursor,
      result_set_size: total,
      sweeps_completed: sweeps,
      candidates_seen: (stateRow?.candidates_seen ?? 0) + outcome.examined,
      inserted_total:
        (stateRow?.inserted_total ?? 0) +
        outcome.enabledInserted +
        outcome.partialInserted,
      last_run_at: new Date().toISOString(),
      last_summary: {
        start,
        total,
        ...outcome,
        states: [...outcome.states],
      },
      updated_at: new Date().toISOString(),
    })
    .eq("catalog", catalog);

  return {
    catalog,
    start,
    total,
    examined: outcome.examined,
    enabledInserted: outcome.enabledInserted,
    partialInserted: outcome.partialInserted,
    skippedDuplicate: outcome.skippedDuplicate,
    skippedUnmappable: outcome.skippedUnmappable,
    states: [...outcome.states],
    nextCursor,
    sweeps,
  };
}

async function handler(request: NextRequest): Promise<NextResponse> {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const supabase = createAdminClient();

  try {
    // Both catalogs advance one page per run.
    const socrata = await sweepCatalog(supabase, "socrata");
    const arcgis = await sweepCatalog(supabase, "arcgis");

    const summary = { socrata, arcgis };
    const inserted =
      (socrata.enabledInserted as number) +
      (socrata.partialInserted as number) +
      (arcgis.enabledInserted as number) +
      (arcgis.partialInserted as number);
    const pulled =
      (socrata.examined as number) + (arcgis.examined as number);

    await logCronRun("discover-sources", startedAt, {
      pulled,
      inserted,
      summary,
      trigger: detectTrigger(request),
    });

    return NextResponse.json({ success: true, summary });
  } catch (err) {
    logger.error("discover.run_failed", { error: String(err) });
    await logCronRun("discover-sources", startedAt, {
      error: String(err),
      trigger: detectTrigger(request),
    });
    return NextResponse.json(
      { success: false, error: "discovery run failed" },
      { status: 500 },
    );
  }
}

export const GET = handler;
export const POST = handler;
