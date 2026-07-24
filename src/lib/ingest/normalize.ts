/* ── Permit Data Normalization ──────────────────────────────────────────────
 * Vendor-specific normalization for raw permit data from permits.db.
 *
 * The scraper writes into a single SQLite table, but the columns have
 * different semantics per vendor:
 *
 *   Accela:  address=description, status=real address, description="addr : owner"
 *   Tyler:   address=real address (doubled suffixes), status=real status, description=scope
 *   Etrakit: address=real address, status=empty, description=contractor name
 *
 * This module fixes the misalignment and produces a clean, uniform record.
 * ────────────────────────────────────────────────────────────────────────── */

/* ── Raw row from SQLite ──────────────────────────────────────────────── */

export interface RawPermitRow {
  id: number;
  permit_number: string;
  permit_type: string;
  address: string;
  status: string;
  description: string;
  city: string;
  state: string;
  county: string;
  vendor: "accela" | "tyler" | "etrakit";
  source_url: string;
  scraped_date: string;
  created_at: string;
}

/* ── Normalized output ────────────────────────────────────────────────── */

export interface NormalizedPermit {
  permitNumber: string;
  permitTypeRaw: string;
  permitTypeEnum: PermitTypeEnum;
  trade: string;
  statusEnum: PermitStatusEnum;
  description: string | null;
  address: string | null;
  city: string;
  state: string;
  zip: string | null;
  county: string;
  ownerName: string | null;
  ownerFirst: string | null;
  ownerLast: string | null;
  contractorName: string | null;
  vendor: string;
  sourceUrl: string;
  scrapedDate: string;
  sourceCity: string;
  sourceId: string;
  rawJson: Record<string, unknown>;
}

export type PermitTypeEnum =
  | "residential"
  | "commercial"
  | "demolition"
  | "renovation"
  | "new_construction"
  | "addition"
  | "repair"
  | "other";

export type PermitStatusEnum =
  | "submitted"
  | "approved"
  | "issued"
  | "final"
  | "expired"
  | "revoked";

/* ── Main entry point ─────────────────────────────────────────────────── */

export function normalizeRow(raw: RawPermitRow): NormalizedPermit | null {
  if (isGarbagePermit(raw)) return null;

  const vendor = raw.vendor.toLowerCase() as RawPermitRow["vendor"];

  let realAddress: string | null = null;
  let realDescription: string | null = null;
  let realStatus: string = "";
  let ownerName: string | null = null;
  let ownerFirst: string | null = null;
  let ownerLast: string | null = null;
  let contractorName: string | null = null;

  switch (vendor) {
    case "accela": {
      // Accela: status column = real address, address column = description
      realAddress = raw.status || null;
      realDescription = raw.address || null;

      // description column may contain "address : owner_name"
      const ownerData = extractOwnerName(raw.description);
      if (ownerData) {
        ownerName = ownerData.fullName;
        ownerFirst = ownerData.firstName;
        ownerLast = ownerData.lastName;
        // If we didn't get an address from status, try the description
        if (!realAddress && ownerData.address) {
          realAddress = ownerData.address;
        }
      }

      // Accela status column has addresses; real permit status comes from other signals
      // Try to detect if the raw.status is actually a status word vs address
      if (realAddress && isLikelyStatus(realAddress)) {
        realStatus = realAddress;
        realAddress = null;
      } else {
        realStatus = "submitted"; // default for accela
      }
      break;
    }

    case "tyler": {
      // Tyler: columns are correct but address has doubled suffixes
      realAddress = cleanTylerAddress(raw.address);
      realDescription = raw.description || null;
      realStatus = raw.status || "submitted";
      break;
    }

    case "etrakit": {
      // Etrakit: address is correct, description is contractor name
      realAddress = raw.address || null;
      contractorName = raw.description || null;
      realDescription = null;
      realStatus = "submitted"; // status is always empty
      break;
    }
  }

  // Parse address to extract ZIP
  const parsed = realAddress ? parseAddress(realAddress, raw.city, raw.state) : null;
  const cleanedAddress = parsed?.street ?? realAddress;
  const zip = parsed?.zip ?? null;

  return {
    permitNumber: raw.permit_number,
    permitTypeRaw: raw.permit_type,
    permitTypeEnum: mapPermitTypeToEnum(raw.permit_type),
    trade: mapPermitTypeToTrade(raw.permit_type),
    statusEnum: mapStatusToEnum(vendor, realStatus),
    description: realDescription,
    address: cleanedAddress,
    city: raw.city,
    state: raw.state,
    zip,
    county: raw.county,
    ownerName,
    ownerFirst,
    ownerLast,
    contractorName,
    vendor: raw.vendor,
    sourceUrl: raw.source_url,
    scrapedDate: raw.scraped_date,
    sourceCity: raw.city.toLowerCase().replace(/\s+/g, "_"),
    sourceId: raw.permit_number,
    rawJson: { ...raw },
  };
}

/* ── Garbage filter ───────────────────────────────────────────────────── */

const GARBAGE_PERMIT_PATTERNS = [
  /INVALID/i,
  /test\s/i,
  /^\d{1,3}$/,       // bare 1-3 digit numbers
  /^\d{2}-\d{2}-\d{4}\s\d{2}-\d{2}-[AP]M/i, // date strings
];

const ADMIN_PERMIT_TYPES = new Set([
  "add contractor license to a record",
  "add contact to a building record",
  "add/change licensed professional",
  "change of contact information",
  "change of scope",
  "fee appeal case",
  "research-zoning history",
  "contractor-general-agent",
  "contractor-plumbing-agent",
  "contractor-heating & cooling-agent",
  "contractor-general-llc",
]);

export function isGarbagePermit(raw: RawPermitRow): boolean {
  // Garbage permit numbers
  for (const pattern of GARBAGE_PERMIT_PATTERNS) {
    if (pattern.test(raw.permit_number)) return true;
  }

  // Admin/non-construction permit types
  if (ADMIN_PERMIT_TYPES.has(raw.permit_type.toLowerCase())) return true;

  return false;
}

/* ── Owner name extraction ────────────────────────────────────────────── */

export function extractOwnerName(
  description: string | null | undefined,
): { fullName: string; firstName: string | null; lastName: string | null; address: string | null } | null {
  if (!description || !description.includes(" : ")) return null;

  const parts = description.split(" : ");
  if (parts.length < 2) return null;

  const address = parts[0].trim();
  const name = parts[1].trim();

  if (!name || name.length < 2) return null;

  // Split name into first/last
  const nameParts = name.split(/\s+/);
  let firstName: string | null = null;
  let lastName: string | null = null;

  if (nameParts.length >= 2) {
    firstName = titleCase(nameParts[0]);
    lastName = titleCase(nameParts.slice(1).join(" "));
  } else {
    lastName = titleCase(name);
  }

  return {
    fullName: titleCase(name),
    firstName,
    lastName,
    address: address || null,
  };
}

/* ── Tyler address cleaning ───────────────────────────────────────────── */

const DOUBLED_SUFFIXES = [
  "ST ST", "AVE AVE", "BLVD BLVD", "DR DR", "CIR CIR",
  "PL PL", "CT CT", "LN LN", "WAY WAY", "RD RD",
  "TER TER", "PKWY PKWY",
];

export function cleanTylerAddress(address: string): string {
  if (!address) return address;

  let cleaned = address;

  // Fix doubled street suffixes: "FIGUEROA ST ST" → "FIGUEROA ST"
  for (const doubled of DOUBLED_SUFFIXES) {
    const single = doubled.split(" ")[0];
    cleaned = cleaned.replace(new RegExp(`\\b${doubled}\\b`, "gi"), single);
  }

  // Fix doubled city/state: "CARSON, CA CA 90745" → "CARSON, CA 90745"
  cleaned = cleaned.replace(
    /,\s*([A-Z]{2})\s+\1\s+(\d{5})/i,
    ", $1 $2",
  );

  // Fix "Unit:" format: normalize to "Unit"
  cleaned = cleaned.replace(/\bUnit:\s*/gi, "Unit ");

  return cleaned.trim();
}

/* ── Address parsing ──────────────────────────────────────────────────── */

export function parseAddress(
  raw: string,
  knownCity: string,
  knownState: string,
): { street: string; zip: string | null } {
  if (!raw) return { street: raw, zip: null };

  // Extract 5-digit ZIP code (last occurrence)
  const zipMatch = raw.match(/\b(\d{5})\b/g);
  const zip = zipMatch ? zipMatch[zipMatch.length - 1] : null;

  // Remove city, state, zip from the address to get just the street
  let street = raw;

  // Remove ZIP
  if (zip) {
    street = street.replace(new RegExp(`\\b${zip}\\b`), "");
  }

  // Remove known city name (case-insensitive)
  if (knownCity) {
    street = street.replace(
      new RegExp(`\\b${escapeRegex(knownCity)}\\b,?`, "gi"),
      "",
    );
  }

  // Remove state abbreviation at end-ish
  if (knownState) {
    street = street.replace(
      new RegExp(`\\b${escapeRegex(knownState)}\\b,?`, "gi"),
      "",
    );
  }

  // Clean up trailing commas, extra spaces
  street = street.replace(/,\s*,/g, ",").replace(/,\s*$/, "").replace(/\s{2,}/g, " ").trim();

  return { street, zip };
}

/* ── Permit type → enum ───────────────────────────────────────────────── */

export function mapPermitTypeToEnum(type: string): PermitTypeEnum {
  const lower = type.toLowerCase();

  if (/demol|wreck/i.test(lower)) return "demolition";
  if (/new\s*(construction|building)|single family home/i.test(lower)) return "new_construction";
  // `commercial` MUST be checked before the project-type buckets below:
  // "Building Permit (Commercial) - Tenant Improvement" should classify as
  // commercial, not renovation. (Fixed 2026-07 — the old ordering matched
  // `renovation` first and mislabelled every commercial tenant-improvement.)
  if (/commercial|non-residential/i.test(lower)) return "commercial";
  if (/renovation|alteration|remodel|tenant improvement|interior/i.test(lower))
    return "renovation";
  if (/addition|add[\s-]on/i.test(lower)) return "addition";
  if (/repair|foundation repair/i.test(lower)) return "repair";
  if (/residential|1-2 family|one or two family/i.test(lower)) return "residential";

  return "other";
}

/* ── Permit type → trade ──────────────────────────────────────────────── */

export function mapPermitTypeToTrade(type: string): string {
  const lower = type.toLowerCase();

  if (/roof|re-roof|re-side/i.test(lower)) return "roofing";
  if (/plumbing|water heater|wastewater/i.test(lower)) return "plumbing";
  if (/electric/i.test(lower)) return "electrical";
  if (/hvac|heat|cool|mechanical|air conditioning|air distribution/i.test(lower))
    return "hvac";
  if (/solar|pv/i.test(lower)) return "solar";
  if (/fire\s*sprinkler|fire\s*prevention/i.test(lower)) return "fire_protection";
  if (/pool|spa/i.test(lower)) return "pool";
  if (/fence/i.test(lower)) return "fencing";
  if (/sign|banner|pz sign/i.test(lower)) return "signage";
  if (/demol|wreck/i.test(lower)) return "demolition";
  if (/foundation/i.test(lower)) return "foundation";
  if (/driveway|sidewalk|drain/i.test(lower)) return "concrete";
  if (/tree|lawn|irrigation/i.test(lower)) return "landscaping";
  if (/window|door/i.test(lower)) return "windows_doors";
  if (/deck/i.test(lower)) return "decking";
  if (/bath/i.test(lower)) return "bathroom";

  return "general";
}

/* ── Status mapping ───────────────────────────────────────────────────── */

const TYLER_STATUS_MAP: Record<string, PermitStatusEnum> = {
  complete: "final",
  finaled: "final",
  "closed/no further action": "final",
  issued: "issued",
  expired: "expired",
  void: "revoked",
  cancelled: "revoked",
  apply: "submitted",
  "in review": "submitted",
  "additional documents required": "submitted",
};

const ACCELA_STATUS_MAP: Record<string, PermitStatusEnum> = {
  open: "submitted",
  issued: "issued",
  review: "submitted",
  approved: "approved",
  closed: "final",
};

export function mapStatusToEnum(
  vendor: string,
  status: string,
): PermitStatusEnum {
  const lower = status.toLowerCase().trim();
  if (!lower) return "submitted";

  switch (vendor) {
    case "tyler":
      return TYLER_STATUS_MAP[lower] ?? "submitted";
    case "accela":
      return ACCELA_STATUS_MAP[lower] ?? "submitted";
    default:
      return "submitted";
  }
}

/* ── Deduplication ────────────────────────────────────────────────────── */

export function deduplicatePermits(
  rows: RawPermitRow[],
): RawPermitRow[] {
  const seen = new Map<string, RawPermitRow>();

  for (const row of rows) {
    // Key: permit_number + city (source-level dedup)
    const key = `${row.permit_number}::${row.city}::${row.vendor}`;
    if (!seen.has(key)) {
      seen.set(key, row);
    }
  }

  return Array.from(seen.values());
}

/* ── Utility ──────────────────────────────────────────────────────────── */

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isLikelyStatus(value: string): boolean {
  const lower = value.toLowerCase().trim();
  const statusWords = ["open", "closed", "issued", "approved", "review", "pending", "expired", "revoked"];
  return statusWords.includes(lower);
}
