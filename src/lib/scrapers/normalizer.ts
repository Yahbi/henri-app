import type { PermitType } from "@/types/permits";

const PERMIT_TYPE_KEYWORDS: Record<PermitType, string[]> = {
  residential: ["residential", "single family", "dwelling", "house", "home", "duplex", "townhouse"],
  commercial: ["commercial", "office", "retail", "business", "store", "restaurant", "hotel"],
  demolition: ["demolition", "demolish", "demo", "tear down", "wreck"],
  renovation: ["renovation", "renovate", "remodel", "rehab", "alteration", "alter"],
  new_construction: ["new construction", "new build", "new building", "erect", "construct new"],
  addition: ["addition", "add on", "extension", "expand"],
  repair: ["repair", "fix", "maintenance", "replace", "patch", "restore"],
  other: [],
};

/**
 * Permit status values accepted by the DB enum (see migration 00004_permits.sql).
 * The `PermitStatus` TS type is wider — it includes UI-only states. Anything
 * we write to `permits.status` must come from this narrower set or Postgres
 * will reject the insert.
 */
type DbPermitStatus =
  | "submitted"
  | "approved"
  | "issued"
  | "final"
  | "expired"
  | "revoked";

const STATUS_KEYWORDS: Record<DbPermitStatus, string[]> = {
  // Pre-issuance states — everything still "in flight" rolls up to submitted
  // because the DB enum has no under_review / in_review column.
  submitted: [
    "submitted", "filed", "received", "pending", "application",
    "under review", "in review", "review", "plan check", "examining",
  ],
  approved: ["approved", "granted", "active"],
  issued: ["issued"],
  final: ["completed", "closed", "finalized", "done", "final"],
  expired: ["expired", "lapsed", "void"],
  // Terminal-negative states (denied/cancelled/etc.) collapse into revoked
  // since the DB enum doesn't carry a separate 'denied'.
  revoked: [
    "revoked", "cancelled", "canceled", "withdrawn", "suspended",
    "denied", "rejected", "refused", "disapproved",
  ],
};

export function classifyPermitType(raw: string): PermitType {
  const lower = raw.toLowerCase();

  for (const [type, keywords] of Object.entries(PERMIT_TYPE_KEYWORDS) as [PermitType, string[]][]) {
    if (type === "other") continue;
    if (keywords.some((kw) => lower.includes(kw))) {
      return type;
    }
  }

  return "other";
}

/** Map any raw status string to a value the `permit_status` enum accepts. */
export function normalizeStatus(raw: string): DbPermitStatus {
  const lower = raw.toLowerCase();

  for (const [status, keywords] of Object.entries(STATUS_KEYWORDS) as [DbPermitStatus, string[]][]) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return status;
    }
  }

  // Unknown / empty → use DB default so we never write an invalid enum.
  return "submitted";
}

export function parseDate(raw: string | null): string | null {
  if (!raw) return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  // ArcGIS feature services commonly return dates as epoch milliseconds
  // (e.g. "1393218000000"). Detect all-digit values with 10+ digits and
  // treat them as a UNIX timestamp.
  if (/^-?\d{10,}$/.test(trimmed)) {
    const ms = Number(trimmed);
    if (isFinite(ms)) {
      const d = new Date(ms);
      if (!isNaN(d.getTime())) return d.toISOString();
    }
  }

  // Try ISO 8601 first (e.g., "2024-01-15T00:00:00.000")
  const isoDate = new Date(trimmed);
  if (!isNaN(isoDate.getTime())) {
    return isoDate.toISOString();
  }

  // Try MM/DD/YYYY
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, month, day, year] = slashMatch;
    const d = new Date(Number(year), Number(month) - 1, Number(day));
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  // Try YYYY/MM/DD
  const ymdSlash = trimmed.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (ymdSlash) {
    const [, year, month, day] = ymdSlash;
    const d = new Date(Number(year), Number(month) - 1, Number(day));
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  // Try "Month DD, YYYY" (e.g., "January 15, 2024")
  const longMatch = trimmed.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (longMatch) {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  return null;
}

export function extractZip(address: string): string | null {
  const match = address.match(/\b(\d{5})(?:-\d{4})?\b/);
  return match ? match[1] : null;
}

const VALID_STATES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID",
  "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS",
  "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK",
  "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV",
  "WI", "WY", "DC",
]);

/** Map a US ZIP to its USPS state via the leading-3-digit prefix ranges.
 *  Authoritative and universal — used to correct `permit.state` when the
 *  source's declared state is missing or a junk value like 'US'. */
export function zipToState(zip: string | null): string | null {
  if (!zip) return null;
  const n = parseInt(zip.slice(0, 3), 10);
  if (isNaN(n)) return null;
  const r = (lo: number, hi: number) => n >= lo && n <= hi;
  if (r(10, 27)) return "MA";
  if (r(28, 29)) return "RI";
  if (r(30, 38)) return "NH";
  if (r(39, 49)) return "ME";
  if (r(50, 59)) return "VT";
  if (r(60, 69)) return "CT";
  if (r(70, 89)) return "NJ";
  if (n === 5) return "NY";
  if (r(100, 149)) return "NY";
  if (r(150, 196)) return "PA";
  if (r(197, 199)) return "DE";
  if (r(200, 205)) return "DC";
  if (r(206, 219)) return "MD";
  if (r(220, 246)) return "VA";
  if (r(247, 268)) return "WV";
  if (r(270, 289)) return "NC";
  if (r(290, 299)) return "SC";
  if (r(300, 319) || r(398, 399)) return "GA";
  if (r(320, 349)) return "FL";
  if (r(350, 369)) return "AL";
  if (r(370, 385)) return "TN";
  if (r(386, 397)) return "MS";
  if (r(400, 427)) return "KY";
  if (r(430, 459)) return "OH";
  if (r(460, 479)) return "IN";
  if (r(480, 499)) return "MI";
  if (r(500, 528)) return "IA";
  if (r(530, 549)) return "WI";
  if (r(550, 567)) return "MN";
  if (r(570, 577)) return "SD";
  if (r(580, 588)) return "ND";
  if (r(590, 599)) return "MT";
  if (r(600, 629)) return "IL";
  if (r(630, 658)) return "MO";
  if (r(660, 679)) return "KS";
  if (r(680, 693)) return "NE";
  if (r(700, 714)) return "LA";
  if (r(716, 729)) return "AR";
  if (r(730, 749)) return "OK";
  if (r(750, 799)) return "TX";
  if (r(800, 816)) return "CO";
  if (r(820, 831)) return "WY";
  if (r(832, 838)) return "ID";
  if (r(840, 847)) return "UT";
  if (r(850, 865)) return "AZ";
  if (r(870, 884)) return "NM";
  if (r(889, 898)) return "NV";
  if (r(900, 961)) return "CA";
  if (r(967, 968)) return "HI";
  if (r(970, 979)) return "OR";
  if (r(980, 994)) return "WA";
  if (r(995, 999)) return "AK";
  return null;
}

/** Derive the correct permit state. Prefers an explicit ", ST 12345"
 *  token in the address, then the ZIP-prefix mapping, then the source's
 *  declared state — but never trusts a junk 'US'/''/null source state
 *  when the address can tell us better. */
export function deriveState(
  address: string | null,
  zip: string | null,
  fallback: string | null,
): string | null {
  if (address) {
    const m = address.toUpperCase().match(/,?\s*([A-Z]{2})\s+\d{5}(?:-\d{4})?\s*$/);
    if (m && VALID_STATES.has(m[1])) return m[1];
  }
  const fromZip = zipToState(zip);
  if (fromZip) return fromZip;
  if (fallback && fallback !== "US" && VALID_STATES.has(fallback)) return fallback;
  return fallback ?? null;
}

export function parseCoord(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;

  const num = typeof val === "number" ? val : Number(val);

  if (isNaN(num) || !isFinite(num)) return null;
  return num;
}

export function parseMoney(val: string | null): number | null {
  if (!val) return null;

  const cleaned = val.replace(/[$,\s]/g, "");
  if (!cleaned) return null;

  const num = Number(cleaned);
  if (isNaN(num) || !isFinite(num)) return null;
  // estimated_value is `bigint` — round to integer dollars
  return Math.round(num);
}
