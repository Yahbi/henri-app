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
