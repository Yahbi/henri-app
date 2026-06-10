/**
 * National open-data catalog readers for the discovery loop.
 *
 * Two catalogs cover essentially every machine-readable US permit dataset:
 *   - Socrata Discovery API  (api.us.socrata.com) — ~480 permit datasets
 *     across every Socrata gov domain, each with its full column list.
 *   - ArcGIS Hub search API  (hub.arcgis.com)     — thousands of permit
 *     feature/map services; we resolve layer 0 and read its fields.
 *
 * Each reader returns normalized Candidate objects. Field detection and
 * insertion happen in the cron route. All network calls are timeout-
 * guarded and fail soft (return [] / null) so one bad upstream never
 * breaks a discovery run.
 */

import { detectFields, type DetectResult } from "./field-detect";

export interface Candidate {
  sourceType: "socrata" | "arcgis";
  name: string;
  domain: string;
  /** Queryable endpoint: Socrata resource .json, or ArcGIS layer URL. */
  endpoint: string;
  columns: string[];
  updatedAt: string | null;
  /** Two-letter state guess from the domain/name, or null. */
  stateGuess: string | null;
}

// Browser-like UA — some catalog/feature servers WAF-block bot agents.
const UA = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
};

async function getJson(url: string, timeoutMs = 12000): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      headers: UA,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/* ── State guessing ─────────────────────────────────────────────────── */

const STATE_IN_NAME =
  /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/;
const DOMAIN_STATE: Record<string, string> = {
  cityofchicago: "IL", nyc: "NY", lacity: "CA", sfgov: "CA", seattle: "WA",
  austintexas: "TX", dallas: "TX", denver: "CO", honolulu: "HI",
  montgomerycountymd: "MD", baltimorecity: "MD", cincinnati: "OH",
};

function guessState(domain: string, name: string): string | null {
  for (const [frag, st] of Object.entries(DOMAIN_STATE)) {
    if (domain.includes(frag)) return st;
  }
  const m = name.match(STATE_IN_NAME);
  return m ? m[1].toUpperCase() : null;
}

/* ── Socrata Discovery API ──────────────────────────────────────────── */

interface SocrataResult {
  resource?: {
    id?: string;
    name?: string;
    type?: string;
    columns_field_name?: string[];
    updatedAt?: string;
  };
  metadata?: { domain?: string };
}

export async function fetchSocrataPage(
  offset: number,
  limit = 25,
  query = "building permits",
): Promise<{ candidates: Candidate[]; total: number }> {
  const url =
    `https://api.us.socrata.com/api/catalog/v1?q=${encodeURIComponent(query)}` +
    `&only=dataset&limit=${limit}&offset=${offset}`;
  const json = (await getJson(url)) as
    | { results?: SocrataResult[]; resultSetSize?: number }
    | null;
  if (!json?.results) return { candidates: [], total: 0 };

  const candidates: Candidate[] = [];
  for (const r of json.results) {
    const id = r.resource?.id;
    const domain = r.metadata?.domain;
    const name = r.resource?.name ?? "";
    const columns = r.resource?.columns_field_name ?? [];
    if (!id || !domain || columns.length === 0) continue;
    candidates.push({
      sourceType: "socrata",
      name,
      domain,
      endpoint: `https://${domain}/resource/${id}.json`,
      columns,
      updatedAt: r.resource?.updatedAt ?? null,
      stateGuess: guessState(domain, name),
    });
  }
  return { candidates, total: json.resultSetSize ?? 0 };
}

/* ── ArcGIS Hub search + layer resolution ───────────────────────────── */

interface HubItem {
  properties?: {
    title?: string;
    type?: string;
    url?: string;
    source?: string;
    modified?: number;
  };
}

interface ArcgisLayerMeta {
  name?: string;
  fields?: Array<{ name?: string }>;
  error?: unknown;
}

/**
 * Resolve a Hub service to a queryable layer-0 endpoint + its columns.
 * One extra HTTP call per item; returns null when layer 0 isn't a
 * permit-shaped feature layer.
 */
async function resolveArcgisLayer(
  serviceUrl: string,
): Promise<{ endpoint: string; columns: string[] } | null> {
  const base = serviceUrl.replace(/\/+$/, "");
  // Only Feature/Map servers expose /<layer>/query.
  if (!/\/(Feature|Map)Server$/i.test(base)) {
    // Some Hub urls already include a layer id.
    if (!/\/(Feature|Map)Server\/\d+$/i.test(base)) return null;
  }
  const layerUrl = /\/\d+$/.test(base) ? base : `${base}/0`;
  const meta = (await getJson(`${layerUrl}?f=json`)) as ArcgisLayerMeta | null;
  if (!meta || meta.error || !Array.isArray(meta.fields)) return null;
  const columns = meta.fields
    .map((f) => f.name)
    .filter((n): n is string => typeof n === "string");
  if (columns.length === 0) return null;
  return { endpoint: layerUrl, columns };
}

export async function fetchArcgisPage(
  startindex: number,
  limit = 15,
  query = "building permits",
): Promise<{ candidates: Candidate[]; total: number }> {
  const url =
    `https://hub.arcgis.com/api/search/v1/collections/dataset/items` +
    `?q=${encodeURIComponent(query)}&limit=${limit}&startindex=${startindex}`;
  const json = (await getJson(url)) as
    | { features?: HubItem[]; numberMatched?: number }
    | null;
  if (!json?.features) return { candidates: [], total: 0 };

  const candidates: Candidate[] = [];
  for (const item of json.features) {
    const p = item.properties ?? {};
    const type = p.type ?? "";
    const serviceUrl = p.url ?? "";
    const title = p.title ?? "";
    if (!serviceUrl) continue;
    if (!/Feature Service|Map Service/i.test(type)) continue;

    const resolved = await resolveArcgisLayer(serviceUrl);
    if (!resolved) continue;

    const domain = (() => {
      try {
        return new URL(resolved.endpoint).hostname;
      } catch {
        return "arcgis";
      }
    })();

    candidates.push({
      sourceType: "arcgis",
      name: title,
      domain,
      endpoint: resolved.endpoint,
      columns: resolved.columns,
      updatedAt: p.modified ? new Date(p.modified).toISOString() : null,
      stateGuess: guessState(domain + " " + (p.source ?? ""), title),
    });
  }
  return { candidates, total: json.numberMatched ?? 0 };
}

/* ── Candidate → detection ──────────────────────────────────────────── */

export function detectForCandidate(c: Candidate): DetectResult {
  return detectFields(c.columns, c.sourceType, c.name);
}
