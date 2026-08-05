/**
 * Source -> scraper routing.
 *
 * THE BUG THIS CLOSES
 * -------------------
 * /api/cron/scrape used to route with a single ternary:
 *
 *     source.source_type === "arcgis" ? arcgis : socrata
 *
 * i.e. EVERYTHING that was not ArcGIS went into the Socrata scraper. Live
 * counts of enabled rows at the time of the fix:
 *
 *     arcgis   208,944   -> correct
 *     socrata   20,038   -> correct
 *     ckan         593   -> WRONG, silently returned nothing (Boston ~658k permits)
 *     unknown   10,041   -> mostly wrong
 *     csv/html/tyler/etrakit/opengov/... ~300 -> wrong
 *
 * Wrong-scraper runs returned `{inserted:0, updated:0, errors:0}`, which the
 * cron recorded as a clean success. A permanently unscrapable stub therefore
 * looked exactly like a quiet city, forever.
 *
 * Routing is now: trust the declared type for the three types we have real
 * scrapers for, otherwise SNIFF THE ENDPOINT (many rows are typed `unknown`
 * but point at a perfectly good FeatureServer or Socrata resource), and if
 * neither identifies a supported API, return `unsupported` so the caller can
 * fail LOUDLY instead of mis-dispatching.
 */

export type ScraperKind = "arcgis" | "socrata" | "ckan" | "unsupported";

/** ArcGIS REST: .../FeatureServer/0, .../MapServer/3, or the service root. */
const ARCGIS_RE = /\/(FeatureServer|MapServer)(\/\d+)?(\/|\?|$)/i;
/** CKAN: action API, datastore dump, or a dataset/resource landing page. */
const CKAN_RE = /\/api\/3\/action\/|\/datastore\/dump\/|\/dataset\//i;
/** Socrata: /resource/<4>-<4>[.json] — the universal SODA dataset path. */
const SOCRATA_RE = /\/resource\/[a-z0-9]{4}-[a-z0-9]{4}(\.json)?/i;

/**
 * Identify the API family from the URL alone. Returns null when the URL
 * carries no recognisable signal (an HTML portal page, a PDF, a KML download,
 * a vendor SPA, ...).
 *
 * Pure + exported for unit tests.
 */
export function sniffEndpoint(endpoint: string | null | undefined): ScraperKind | null {
  if (!endpoint) return null;
  if (ARCGIS_RE.test(endpoint)) return "arcgis";
  // Socrata before CKAN: some Socrata hosts also expose /dataset/ landing
  // pages, and a concrete /resource/xxxx-xxxx id is the stronger signal.
  if (SOCRATA_RE.test(endpoint)) return "socrata";
  if (CKAN_RE.test(endpoint)) return "ckan";
  return null;
}

/**
 * Route one source to a scraper.
 *
 * Declared type wins for the three supported families so the 229k rows that
 * are already correctly typed keep their existing behaviour exactly. Only
 * rows with an unsupported/garbage `source_type` fall through to the sniffer.
 *
 * Pure + exported for unit tests.
 */
export function resolveScraperKind(
  sourceType: string | null | undefined,
  endpoint: string | null | undefined,
): ScraperKind {
  const declared = (sourceType ?? "").trim().toLowerCase();
  if (declared === "arcgis") return "arcgis";
  if (declared === "socrata") return "socrata";
  if (declared === "ckan") return "ckan";
  return sniffEndpoint(endpoint) ?? "unsupported";
}

/** Operator-facing reason string for an unsupported source. */
export function unsupportedDetail(
  sourceType: string | null | undefined,
  endpoint: string | null | undefined,
): string {
  return (
    `no scraper for source_type='${sourceType ?? "null"}' and the endpoint carries ` +
    `no ArcGIS / Socrata / CKAN signal (${(endpoint ?? "").slice(0, 160)})`
  );
}
