/**
 * GET /api/cron/nifc-wildfires
 *
 * Daily cron — pulls current US wildfire incidents from the NIFC
 * (National Interagency Fire Center) WFIGS ArcGIS service. Free,
 * no auth.
 *
 * Why: wildfire perimeters drive roofing / cleanup / tree-removal
 * lead surges in CA / CO / OR / AZ / NM and beyond. Henri uses the
 * incident location + acres-burned + status to identify recovery
 * windows for restoration trades.
 *
 * Source:
 *   https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/
 *     WFIGS_Incident_Locations_Current/FeatureServer/0/query
 *
 * Window: full current-year (NIFC's "Current" service is current-
 * year only). De-dup via IRWIN ID (`IrwinID`) which the upstream
 * guarantees stable per incident.
 *
 * Cron auth: `CRON_SECRET` Bearer per CLAUDE.md.
 *
 * Wave 2.C of ~/.claude/plans/whats-the-14-days-purring-papert.md.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { logCronRun, detectTrigger } from "@/lib/admin/cron-log";

export const runtime = "nodejs";
export const maxDuration = 280;

const FS_URL =
  "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/" +
  "WFIGS_Incident_Locations_Current/FeatureServer/0/query";
const PAGE_SIZE = 2000;
const MAX_PAGES = 30;

interface WfigsAttrs {
  IrwinID?: string;
  IncidentName?: string;
  IncidentTypeCategory?: string;
  POOState?: string;
  POOCounty?: string;
  FireCause?: string;
  IncidentSize?: number | string;
  PercentContained?: number | string;
  FireDiscoveryDateTime?: number | string;
  ModifiedOnDateTime?: number | string;
  IncidentStatus?: string;
  InitialLatitude?: number | string;
  InitialLongitude?: number | string;
  [k: string]: unknown;
}

interface ArcgisFeature {
  attributes?: WfigsAttrs;
  geometry?: { x?: number; y?: number };
}

interface ArcgisPage {
  features?: ArcgisFeature[];
}

function asString(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function asNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** ArcGIS ships dates as epoch milliseconds. Convert to ISO. */
function epochMsToIso(v: unknown): string | null {
  const n = asNumber(v);
  if (n == null) return null;
  const d = new Date(n);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function buildRow(f: ArcgisFeature) {
  const a = f.attributes ?? {};
  const irwin = asString(a.IrwinID);
  if (!irwin) return null;
  return {
    irwin_id: irwin,
    incident_name: asString(a.IncidentName),
    incident_type: asString(a.IncidentTypeCategory),
    state: asString(a.POOState),
    county: asString(a.POOCounty),
    fire_cause: asString(a.FireCause),
    acres_burned: asNumber(a.IncidentSize),
    containment_pct: asNumber(a.PercentContained),
    discovery_date: epochMsToIso(a.FireDiscoveryDateTime),
    modified_date: epochMsToIso(a.ModifiedOnDateTime),
    fire_status: asString(a.IncidentStatus),
    lat: asNumber(a.InitialLatitude) ?? asNumber(f.geometry?.y),
    lng: asNumber(a.InitialLongitude) ?? asNumber(f.geometry?.x),
    raw_json: a,
  };
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const supabase = createAdminClient();
  let offset = 0;
  let pulled = 0;
  let inserted = 0;
  let pages = 0;

  try {
    while (pages < MAX_PAGES) {
      const url =
        `${FS_URL}?where=1%3D1&outFields=*&f=json&returnGeometry=false` +
        `&resultOffset=${offset}&resultRecordCount=${PAGE_SIZE}`;
      const res = await fetch(url, {
        headers: { "User-Agent": "Henri-Bot/1.0 (cron@meethenri.com)" },
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) {
        logger.warn("nifc.fetch_failed", { status: res.status, offset });
        break;
      }
      const json = (await res.json()) as ArcgisPage;
      const feats = json.features ?? [];
      if (feats.length === 0) break;

      const rows = feats
        .map(buildRow)
        .filter((r): r is NonNullable<typeof r> => r !== null);

      if (rows.length > 0) {
        // 200-row chunks — wildfire raw_json is large (~50 attrs).
        const BATCH = 200;
        for (let i = 0; i < rows.length; i += BATCH) {
          const slice = rows.slice(i, i + BATCH);
          const { error, count } = await supabase
            .from("wildfires_nifc")
            .upsert(slice, { onConflict: "irwin_id", count: "exact" });
          if (error) {
            logger.warn("nifc.insert_error", { page: pages, batch_start: i, error: error.message });
            continue;
          }
          inserted += count ?? 0;
        }
      }

      pulled += feats.length;
      pages += 1;
      offset += feats.length;
      if (feats.length < PAGE_SIZE) break;
    }

    logger.info("nifc.done", {
      duration_ms: Date.now() - startedAt,
      pages, pulled, inserted,
    });
    const result = {
      ok: true,
      duration_ms: Date.now() - startedAt,
      pages, pulled, inserted,
    };
    await logCronRun("nifc-wildfires", startedAt, {
      pulled, inserted, summary: result, trigger: detectTrigger(request),
    });
    return NextResponse.json(result);
  } catch (err) {
    logger.error("nifc.error", { error: String(err) });
    await logCronRun("nifc-wildfires", startedAt, {
      pulled, inserted, error: String(err), trigger: detectTrigger(request),
    });
    return NextResponse.json(
      { error: "nifc-wildfires failed", detail: String(err) },
      { status: 500 },
    );
  }
}
