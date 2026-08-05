/**
 * Activation probe for /api/cron/activate-arcgis-sources.
 *
 * WHY
 * ---
 * The activation cron used to flip 50 discovery stubs from `enabled=false` to
 * `enabled=true` per day WITHOUT ever looking at what the endpoint serves.
 * Roughly 2,642 enabled rows turned out to be business-licence registries,
 * sewer-wye inventories, wetland layers and building footprints. They scrape
 * cleanly, land in `public.permits`, and inflate the permit count the
 * marketing site reports — a truthfulness problem, not just noise.
 *
 * So: fetch one sample row before enabling, and let the SAME heuristic the
 * scrapers already use decide. There is exactly one non-permit heuristic in
 * this codebase (`looksLikeNonPermitDataset`) and this module deliberately
 * does not add a second — a divergent second opinion would be worse than no
 * gate at all, because the two would disagree about the same source.
 *
 * WHAT `permit` MEANS HERE
 * -----------------------
 * "The payload carries no non-permit marker." That is a PASSED SCREEN, not a
 * positive confirmation. The screen is a negative one by construction, so a
 * layer named for something else but with unremarkable column names (building
 * footprints: OBJECTID / HEIGHT / SHAPE_Area) still passes. Widening the
 * screen belongs in `NON_PERMIT_MARKERS` in src/lib/scrapers/types.ts, where
 * every scraper picks it up at once.
 */

import { BROWSER_UA } from "@/lib/scrapers/normalizer";
import { collectObservedKeys, looksLikeNonPermitDataset } from "@/lib/scrapers/types";

export type ProbeVerdict =
  /** Passed the non-permit screen — safe to enable. */
  | "permit"
  /** Positive evidence of a non-permit dataset — must stay disabled. */
  | "non_permit"
  /** We could not tell: transport error, error envelope, or no schema at all. */
  | "unreachable";

export interface DatasetProbe {
  verdict: ProbeVerdict;
  /** Columns the endpoint actually ships. Persisted so ops can see the evidence. */
  observedKeys: string[];
  /** Operator-facing reason. Non-null for every verdict except `permit`. */
  reason: string | null;
}

/** Same cap + sort as `collectObservedKeys`, applied to a field-schema list. */
const MAX_SCHEMA_KEYS = 40;

interface ArcGISProbeResponse {
  features?: Array<{ attributes?: Record<string, unknown> } | null> | null;
  fields?: Array<{ name?: unknown } | null> | null;
  error?: { message?: unknown } | null;
}

/**
 * Build the one-row probe URL for an ArcGIS layer.
 *
 * Mirrors the scraper's own query shape so the probe sees exactly what a real
 * run would see. Any query string already on the stored endpoint is dropped —
 * we supply every parameter ourselves, and appending `/query` after an
 * existing `?...` would produce a URL no server can answer.
 *
 * Pure + exported for unit tests.
 */
export function buildProbeUrl(endpoint: string): string {
  const path = endpoint.trim().split("?")[0].replace(/\/+$/, "");
  const base = /\/query$/i.test(path) ? path : `${path}/query`;
  return `${base}?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=1&f=json`;
}

/**
 * Decide a verdict from a parsed ArcGIS query response.
 *
 * Key source order matters: a sample row is the strongest evidence, but a
 * layer that is currently empty still advertises its `fields`, and an empty
 * layer is a perfectly normal state for a low-volume jurisdiction. Falling
 * back to the field schema means "no rows today" is not mistaken for "no
 * evidence" — the old behaviour would have enabled it blind either way.
 *
 * Pure + exported for unit tests.
 */
export function classifyProbePayload(payload: unknown): DatasetProbe {
  if (!payload || typeof payload !== "object") {
    return {
      verdict: "unreachable",
      observedKeys: [],
      reason: "probe response was not a JSON object",
    };
  }

  const body = payload as ArcGISProbeResponse;

  if (body.error) {
    const message =
      typeof body.error.message === "string" && body.error.message.trim()
        ? body.error.message.trim()
        : "unknown ArcGIS error";
    return {
      verdict: "unreachable",
      observedKeys: [],
      reason: `endpoint returned an ArcGIS error envelope: ${message}`,
    };
  }

  const sample = (body.features ?? []).find((f) => f && f.attributes)?.attributes;
  let observedKeys = collectObservedKeys(sample);

  if (observedKeys.length === 0) {
    observedKeys = (body.fields ?? [])
      .map((f) => (f && typeof f.name === "string" ? f.name : null))
      .filter((n): n is string => Boolean(n))
      .sort()
      .slice(0, MAX_SCHEMA_KEYS);
  }

  if (observedKeys.length === 0) {
    return {
      verdict: "unreachable",
      observedKeys: [],
      reason: "endpoint returned neither a sample row nor a field schema",
    };
  }

  const nonPermit = looksLikeNonPermitDataset(observedKeys);
  if (nonPermit) {
    return { verdict: "non_permit", observedKeys, reason: nonPermit };
  }

  return { verdict: "permit", observedKeys, reason: null };
}

/**
 * Fetch one row from an ArcGIS layer and classify it.
 *
 * Single attempt, short timeout, no retries: this is a gate on a daily batch
 * of 50 candidates, not an ingest. A transient failure costs the candidate one
 * strike and it is re-probed on a later run (bounded by MAX_CONSECUTIVE_ERRORS
 * so a permanently dead stub cannot be retried forever).
 *
 * Never throws.
 */
export async function probeArcGISDataset(
  endpoint: string,
  timeoutMs = 8_000,
): Promise<DatasetProbe> {
  if (!endpoint || !endpoint.trim()) {
    return { verdict: "unreachable", observedKeys: [], reason: "source has no endpoint" };
  }

  try {
    const res = await fetch(buildProbeUrl(endpoint), {
      headers: { "User-Agent": BROWSER_UA },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      return {
        verdict: "unreachable",
        observedKeys: [],
        reason: `probe HTTP ${res.status}`,
      };
    }
    return classifyProbePayload(await res.json());
  } catch (err) {
    return {
      verdict: "unreachable",
      observedKeys: [],
      reason: `probe failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
