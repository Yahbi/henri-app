/**
 * NJ statewide construction-permit ingest.
 *
 * WHY THIS EXISTS
 * ---------------
 * New Jersey is the only state in the country with a legally-mandated
 * statewide permit feed: N.J.A.C. 5:23-4.5(d) requires every municipality to
 * report construction permits monthly to the Dept. of Community Affairs. The
 * result is one Socrata dataset covering all 564 municipalities:
 *
 *     https://data.nj.gov/resource/w9se-dmra.json     (~2.7M rows)
 *
 * Henri had THREE NJ permits before this route existed.
 *
 * THE PROBLEM THE JOIN SOLVES
 * ---------------------------
 * The DCA feed has 42 columns and NOT ONE of them is a street address — it
 * identifies a property only by (comu, block, lot). A lead you cannot mail or
 * knock on is worthless, so the raw feed alone is unusable for Henri.
 *
 * NJ's statewide parcel composite closes that gap:
 *
 *     services2.arcgis.com/.../Parcels_Composite_NJ_WM/FeatureServer/0
 *
 * Its PAMS_PIN is exactly `{comu}_{block}_{lot}` — the DCA feed's own key.
 * Verified live 2026-08-04: DCA row (comu 0101, block 189, lot 3) joins to
 * PAMS_PIN "0101_189_3" -> PROP_LOC "647 WHITE HORSE PIKE", ABSECON CITY.
 *
 * Measured coverage of the parcel layer: 3,478,727 parcels, 3,073,143 (88%)
 * carry PROP_LOC. So ~88% of NJ permits become addressable.
 *
 * HONEST LIMITATION: OWNER_NAME on the parcel layer is 100% empty (0 of
 * 3.48M) — New Jersey redacts it under Daniel's Law. This route therefore
 * delivers ADDRESSES, not owner names. Owner/contact enrichment for NJ still
 * has to come from the normal enrichment stack.
 *
 * Idempotent: upserts on (source_city, source_id), so re-runs update rather
 * than duplicate. Paged + deadline-guarded like every other ingest cron.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { logCronRun } from "@/lib/admin/cron-log";

export const runtime = "nodejs";
export const maxDuration = 300;

const DCA_URL = "https://data.nj.gov/resource/w9se-dmra.json";
const PARCELS_URL =
  "https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/ArcGIS/rest/services/Parcels_Composite_NJ_WM/FeatureServer/0/query";

/** Socrata page size. 1000 keeps each response ~1MB. */
const PAGE_SIZE = 1000;
/**
 * Socrata pages per invocation.
 *
 * Sized so a run RELIABLY finishes and reaches logCronRun. That matters more
 * than raw throughput here: the cursor lives in cron_runs.summary.nextOffset,
 * so a run that blows its budget and gets aborted logs nothing and the cursor
 * never advances — the next run would redo the same window forever. Observed:
 * 12 pages overran the admin trigger's 290s cap and left no row behind.
 */
const MAX_PAGES = 8;
/**
 * PAMS_PINs per ArcGIS lookup. Was 120 when the lookup was a GET and the IN()
 * list had to fit in a URL; POST has no such limit, so a bigger chunk means
 * ~4x fewer round trips per page.
 */
const PARCEL_CHUNK = 500;
/** Leave headroom so we always finish the upsert + log before the wall. */
const DEADLINE_MS = 200_000;

interface DcaRow {
  comu?: string;
  muniname?: string;
  county?: string;
  block?: string;
  lot?: string;
  permitno?: string;
  permitdate?: string;
  certdate?: string;
  permittypedesc?: string;
  permitstatusdesc?: string;
  usegroup?: string;
  usegroupdesc?: string;
  constcost?: string;
  squarefeet?: string;
  buildfee?: string;
  plumbfee?: string;
  electfee?: string;
  firefee?: string;
  elevfee?: string;
  pk?: string;
}

/** `{comu}_{block}_{lot}` — the parcel layer's PAMS_PIN. */
function pamsPin(r: DcaRow): string | null {
  const c = (r.comu ?? "").trim();
  const b = (r.block ?? "").trim();
  const l = (r.lot ?? "").trim();
  if (!c || !b || !l) return null;
  return `${c}_${b}_${l}`;
}

/**
 * NJ use groups follow the IBC/IRC letter scheme. R-x and U are the
 * residential + accessory groups; everything else is commercial-ish. We only
 * use this to pick the permit_type enum, and fall back to the project-type
 * description when the use group is missing.
 */
function mapPermitType(r: DcaRow): string {
  const use = (r.usegroup ?? "").trim().toUpperCase();
  const desc = `${r.permittypedesc ?? ""} ${r.usegroupdesc ?? ""}`.toLowerCase();

  if (/demoli/.test(desc)) return "demolition";
  if (/new construction|new building/.test(desc)) return "new_construction";
  if (/addition/.test(desc)) return "addition";
  if (/repair/.test(desc)) return "repair";
  if (/alteration|renovat|remodel/.test(desc)) return "renovation";

  if (use.startsWith("R") || use === "U") return "residential";
  if (use) return "commercial";
  return "other";
}

function mapStatus(r: DcaRow): string {
  const s = (r.permitstatusdesc ?? "").toLowerCase();
  if (/certificate|approval|final|closed/.test(s)) return "final";
  if (/issued|active|open/.test(s)) return "issued";
  if (/expire/.test(s)) return "expired";
  if (/revoke|void|cancel/.test(s)) return "revoked";
  if (/approved/.test(s)) return "approved";
  return "submitted";
}

/**
 * Socrata floating timestamps -> YYYY-MM-DD, or null.
 *
 * The DCA feed contains genuine data-entry typos in permitdate — measured
 * extremes are 1113-11-11 and 2925-08-15. An unclamped far-future date would
 * poison freshness scoring (it reads as "filed in the future"), and a
 * year-1113 date is equally meaningless. Anything outside a sane window is
 * treated as no-date rather than stored, so the scorer sees NULL and falls
 * back honestly instead of inventing urgency.
 */
const MIN_PERMIT_YEAR = 1900;
function isoDate(v?: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  if (!Number.isFinite(d.getTime())) return null;
  const year = d.getUTCFullYear();
  // Allow a small forward window — some jurisdictions post-date an issue by
  // days — but reject anything beyond next year.
  if (year < MIN_PERMIT_YEAR || year > new Date().getUTCFullYear() + 1) return null;
  return d.toISOString().slice(0, 10);
}

function toInt(v?: string): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.slice(0, 120)}`);
  return res.json();
}

/**
 * ArcGIS query via POST.
 *
 * MUST be POST, not GET: a `PAMS_PIN IN (...)` list of ~120 quoted keys blows
 * past the server's URL-length limit and ArcGIS answers 404 — which silently
 * cost us every address on the first live run (match rate 5% instead of ~50%).
 * POST puts the WHERE clause in the body, so chunk size is bounded only by
 * what we choose.
 */
async function arcgisQueryPost(
  params: Record<string, string>,
  timeoutMs: number,
): Promise<unknown> {
  const res = await fetch(PARCELS_URL, {
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) throw new Error(`ArcGIS HTTP ${res.status}`);
  return res.json();
}

/** Resolve PAMS_PIN -> { address, city } via the statewide parcel layer. */
async function lookupAddresses(
  pins: string[],
): Promise<Map<string, { address: string; city: string | null }>> {
  const out = new Map<string, { address: string; city: string | null }>();
  for (let i = 0; i < pins.length; i += PARCEL_CHUNK) {
    const chunk = pins.slice(i, i + PARCEL_CHUNK);
    // PAMS_PIN is text; quote each value. Values are digits/underscores only
    // (built by pamsPin), so there is nothing to escape.
    const inList = chunk.map((p) => `'${p}'`).join(",");
    try {
      const j = (await arcgisQueryPost(
        {
          where: `PAMS_PIN IN (${inList})`,
          outFields: "PAMS_PIN,PROP_LOC,MUN_NAME",
          returnGeometry: "false",
          resultRecordCount: String(PARCEL_CHUNK * 4),
          f: "json",
        },
        25_000,
      )) as {
        features?: Array<{ attributes?: Record<string, unknown> }>;
      };
      for (const f of j.features ?? []) {
        const a = f.attributes ?? {};
        const pin = String(a.PAMS_PIN ?? "").trim();
        const loc = String(a.PROP_LOC ?? "").trim();
        if (!pin || !loc) continue;
        if (!out.has(pin)) {
          const mun = String(a.MUN_NAME ?? "").trim();
          out.set(pin, { address: loc, city: mun || null });
        }
      }
    } catch (err) {
      // A failed parcel chunk only costs us addresses for those rows — the
      // permits still ingest with a null address and can be back-filled on a
      // later run. Never abort the whole ingest for one lookup.
      logger.warn("nj-permits.parcel-lookup-failed", {
        error: err instanceof Error ? err.message : String(err),
        chunkSize: chunk.length,
      });
    }
  }
  return out;
}

async function handler(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  const supabase = createAdminClient();
  const url = new URL(request.url);
  // Resume cursor.
  //
  // An explicit ?offset=N always wins (used for manual/targeted backfill).
  // Otherwise we RESUME from where the previous successful run stopped, read
  // out of cron_runs. Without this the scheduled cron would restart at 0 every
  // two hours, re-upsert the same newest ~12k rows forever, and never walk the
  // 2.7M-row history. The feed is ordered permitdate DESC, so offset 0 is the
  // newest and increasing offsets march back through time.
  //
  // When a run finds no rows we've reached the end of the feed and reset to 0,
  // which re-sweeps from the top to pick up newly-filed permits. Re-sweeping is
  // free of side effects because every write is an upsert on
  // (source_city, source_id).
  const explicitOffset = url.searchParams.get("offset");
  let offset = 0;
  if (explicitOffset != null) {
    const n = Number(explicitOffset);
    offset = Number.isFinite(n) && n >= 0 ? n : 0;
  } else {
    const { data: lastRun } = await supabase
      .from("cron_runs")
      .select("summary")
      .eq("cron_path", "nj-statewide-permits")
      .eq("status", "ok")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const prev = (lastRun?.summary as { nextOffset?: unknown } | null)?.nextOffset;
    const n = Number(prev);
    if (Number.isFinite(n) && n > 0) offset = n;
  }

  let pulled = 0;
  let inserted = 0;
  let withAddress = 0;
  let pages = 0;
  let reachedEnd = false;

  try {
    for (let p = 0; p < MAX_PAGES; p++) {
      if (Date.now() - started > DEADLINE_MS) break;

      const pageUrl =
        `${DCA_URL}?$limit=${PAGE_SIZE}&$offset=${offset}` +
        `&$order=${encodeURIComponent("permitdate DESC")}`;
      const rows = (await fetchJson(pageUrl, 30_000)) as DcaRow[];
      if (!Array.isArray(rows) || rows.length === 0) {
        // End of the feed — wrap the cursor so the next scheduled run starts
        // again at the newest permits instead of parking past the tail.
        offset = 0;
        reachedEnd = true;
        break;
      }

      pages++;
      pulled += rows.length;
      offset += rows.length;

      const pinByRow = rows.map(pamsPin);
      const uniquePins = [...new Set(pinByRow.filter((x): x is string => !!x))];
      const addrByPin = await lookupAddresses(uniquePins);

      const upserts = rows
        .map((r, i) => {
          const pin = pinByRow[i];
          const hit = pin ? addrByPin.get(pin) : undefined;
          if (hit) withAddress++;
          const sourceId = r.pk || `${pin ?? "nopin"}-${r.permitno ?? i}`;
          return {
            source_city: "NJ-DCA-STATEWIDE",
            source_id: String(sourceId),
            permit_number: r.permitno ?? null,
            permit_type: mapPermitType(r),
            status: mapStatus(r),
            description:
              [r.permittypedesc, r.usegroupdesc].filter(Boolean).join(" — ") || null,
            address: hit?.address ?? null,
            city: hit?.city ?? r.muniname ?? null,
            state: "NJ",
            estimated_value: toInt(r.constcost),
            applied_date: isoDate(r.permitdate),
            issued_date: isoDate(r.permitdate),
            raw_json: r as unknown as Record<string, unknown>,
          };
        })
        // A permit with no address is not actionable for a contractor, and
        // Henri's enrichment keys off address. Skip rather than store noise.
        .filter((row) => !!row.address);

      if (upserts.length > 0) {
        const { error } = await supabase
          .from("permits")
          .upsert(upserts, { onConflict: "source_city,source_id" });
        if (error) throw new Error(error.message);
        inserted += upserts.length;
      }
    }

    const durationMs = Date.now() - started;
    await logCronRun("nj-statewide-permits", started, {
      status: "ok",
      pulled,
      inserted,
      summary: { pages, withAddress, nextOffset: offset, reachedEnd },
    });

    return NextResponse.json({
      success: true,
      pages,
      pulled,
      inserted,
      withAddress,
      addressMatchRate: pulled > 0 ? Math.round((withAddress / pulled) * 100) : 0,
      nextOffset: offset,
      reachedEnd,
      durationMs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("nj-permits.failed", { error: message, offset, pulled });
    await logCronRun("nj-statewide-permits", started, {
      status: "error",
      pulled,
      inserted,
      error: message,
    });
    return NextResponse.json({ error: message, pulled, inserted }, { status: 500 });
  }
}

export const GET = handler;
export const POST = handler;
