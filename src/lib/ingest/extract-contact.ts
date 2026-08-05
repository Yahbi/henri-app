/**
 * Extract owner / applicant / contractor / phone / email from the
 * heterogeneous `raw_json` blobs we store on every permit row.
 *
 * Different municipal portals name the same concept differently:
 *   NYC DOB  → owner_s_first_name + owner_s_last_name + owner_s_phone__
 *   Baton Rouge → ownername + contractorname + contractoraddress
 *   Chicago  → contact_name + contractor_name (sparse)
 *   Generic Socrata → ownername / owner_name / applicant_name / applicant
 *   ArcGIS   → OWNER_NAME / APPLICANT / Contractor (all-caps)
 *
 * This module gives every caller one function — `extractContact(raw)` —
 * that tries every known naming variant in priority order and returns a
 * normalized record. Callers (permit ingesters + a one-shot backfill
 * script) use the output to populate the denormalized columns on
 * `permits` and `leads`.
 *
 * IMPORTANT: this ONLY reads `raw_json` we already have. It never calls
 * any external API, so it is safe to run on the full 933k-row catalog
 * without cost or rate-limit concerns.
 */

import { parseBusinessName } from "@/lib/enrichment/business-name-parser";

/** Confidence threshold for accepting a business-name-parser split as the
 *  owner first/last. Below this we leave both fields null rather than
 *  writing a fabricated name. Mirrors the Step 3 plan. */
const BUSINESS_PARSER_MIN_CONFIDENCE = 0.6;

export interface ExtractedContact {
  owner_name: string | null;
  owner_first: string | null;
  owner_last: string | null;
  applicant_name: string | null;
  contractor_name: string | null;
  phone: string | null;
  email: string | null;
}

/** Tag for the upstream parser / shape that produced this contact.
 *  Lets the dashboard show a transparent provenance badge ("NYC DOB",
 *  "Socrata generic", etc.) and the scoring engine weight
 *  `contact_completeness` by how trustworthy the origin is. */
export type ContactSource =
  | "raw_json_nyc"
  | "raw_json_socrata_generic"
  | "raw_json_arcgis"
  | "raw_json_baton_rouge"
  | "raw_json_kcmo"
  | "raw_json_generic";

/** ExtractedContact + where it came from + how much we trust it.
 *  Emitted by `extractContactWithProvenance` — the provenance-aware
 *  variant of `extractContact`. */
export interface ExtractedContactWithProvenance extends ExtractedContact {
  source: ContactSource;
  /** 0.00-1.00 heuristic quality score. See `inferConfidence` for the
   *  rubric. Persisted as `contact_confidence numeric(3,2)` in both
   *  `permits` and `leads`. */
  confidence: number;
}

/* Priority-ordered candidate keys — first non-empty value wins. Keys
 * are lowercased during comparison, so `OWNER_NAME` matches too. */
const KEY_LISTS = {
  owner_name: [
    "ownername", "owner_name", "owner", "owners", "owner_full_name",
    "owner_s_name", "own_name", "pr_name_full", "propowner",
    "property_owner", "record_owner",
    // Added 2026-08-04 after a live audit of the Orlando ingest: 26,873 of
    // its 28,612 permits carry `parcel_owner_name` and 22,049 carry
    // `property_owner_name`, while ZERO carry `owner_name`/`ownername`.
    // Every one of those real homeowner names was unreadable, so the leads
    // rendered blank and scored with contact_completeness suppressed.
    "parcel_owner_name", "property_owner_name", "parcel_owner", "owner_1",
  ],
  owner_first: [
    "owner_first", "owner_first_name", "owner_s_first_name",
    "own_first", "ownerfirstname", "first_name_owner",
  ],
  owner_last: [
    "owner_last", "owner_last_name", "owner_s_last_name",
    "own_last", "ownerlastname", "last_name_owner",
  ],
  applicant_name: [
    "applicant_name", "applicant", "applicantname",
    "applicant_full_name", "applicantfullname",
    "applicants_full_name", "permittee_full_name",
    "permittee_s_business_name", "permittee_business_name",
  ],
  contractor_name: [
    "contractorname", "contractor_name", "contractor",
    "gc_name", "general_contractor", "primary_contractor",
    "contractor_business_name", "builder_name", "builder",
  ],
  phone: [
    "owner_phone", "owner_s_phone__", "owner_s_phone",
    "ownerphone", "phone", "contact_phone",
    "permittee_s_phone__", "permittee_s_phone", "permittee_phone",
    "applicant_phone", "contractor_phone", "gc_phone", "homeowner_phone",
    // `..._number` / `..._1` variants. Orlando ships 18,804 populated
    // `contractor_phone_number` values (e.g. "(407)592-6291") that the old
    // list could not see; Bozeman MT ships `contractor_phone_1`. Phone fill
    // is the wedge's hardest ceiling — these were already in raw_json.
    "contractor_phone_number", "owner_phone_number", "applicant_phone_number",
    "permittee_phone_number", "contractor_phone_1", "phone_number",
  ],
  email: [
    "owner_email", "email", "contact_email", "applicant_email",
    "permittee_email", "contractor_email", "gc_email", "homeowner_email",
    "owner_email_address", "contractor_email_address", "email_address",
  ],
};

/** Lowercase-keyed view of the raw blob — built once per call so every
 *  lookup is O(n in blob) not O(n × candidates). */
function lowerKeyed(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    out[k.toLowerCase()] = v;
  }
  return out;
}

/** Return the first non-empty string value for any of the candidate
 *  keys, or null. Numbers and booleans are coerced to string if present. */
function pick(
  blob: Record<string, unknown>,
  candidates: string[],
): string | null {
  for (const c of candidates) {
    const v = blob[c];
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (!s) continue;
    return s;
  }
  return null;
}

/** US phone sanity: strip punctuation, reject obvious sentinels. */
function normalizePhone(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D+/g, "");
  if (digits.length < 10) return null;
  // 11-digit US numbers start with '1' — strip the country code.
  const trimmed = digits.length === 11 && digits.startsWith("1")
    ? digits.slice(1)
    : digits;
  if (trimmed.length !== 10) return null;
  // Reject all-zeros, all-ones, repeated digits — obvious sentinels.
  if (/^(\d)\1{9}$/.test(trimmed)) return null;
  if (trimmed.startsWith("0") || trimmed.startsWith("1")) return null;
  // US area codes never start with 0 or 1 — already filtered above.
  return `${trimmed.slice(0, 3)}-${trimmed.slice(3, 6)}-${trimmed.slice(6)}`;
}

/** Basic email sanity — accept anything with a `@` and a `.` after the
 *  `@`, reject empty / obvious garbage. We don't validate against RFC
 *  5322 — that's the MTA's job. */
function normalizeEmail(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  const at = s.indexOf("@");
  if (at < 1) return null;
  const dot = s.indexOf(".", at + 1);
  if (dot < at + 2) return null;
  if (s.length > 254) return null;
  return s;
}

/** Compose a display name when only first+last are available, or fall
 *  back to the combined `owner_name` field. Titlecases uppercase names
 *  (common in municipal data) for readability. */
function titlecase(s: string | null): string | null {
  if (!s) return null;
  if (!/[a-z]/.test(s)) {
    return s
      .toLowerCase()
      .split(/\s+/)
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
      .join(" ");
  }
  return s;
}

export function extractContact(raw: unknown): ExtractedContact {
  const blob = lowerKeyed(raw);
  const ownerNameRaw = pick(blob, KEY_LISTS.owner_name);
  const ownerFirstRaw = pick(blob, KEY_LISTS.owner_first);
  const ownerLastRaw = pick(blob, KEY_LISTS.owner_last);
  const applicantNameRaw = pick(blob, KEY_LISTS.applicant_name);
  const contractorNameRaw = pick(blob, KEY_LISTS.contractor_name);

  // Fallback: when we have no explicit first/last field but a full
  // combined-name string (owner_name, applicant_name, or contractor_name),
  // try heuristic splitting via the business-name-parser. Only accept the
  // result when the parser's confidence clears BUSINESS_PARSER_MIN_CONFIDENCE
  // — otherwise we'd invent fake owners out of REIT names.
  //
  // Priority: owner_name (cleanest signal) → applicant_name → contractor_name
  // (contractor_name is the noisiest because it's often just the GC firm,
  // not the homeowner).
  let parsedFirst: string | null = null;
  let parsedLast: string | null = null;
  if (!ownerFirstRaw && !ownerLastRaw) {
    const candidates = [ownerNameRaw, applicantNameRaw, contractorNameRaw];
    for (const c of candidates) {
      if (!c) continue;
      const parsed = parseBusinessName(c);
      if (
        parsed.confidence >= BUSINESS_PARSER_MIN_CONFIDENCE &&
        parsed.first &&
        parsed.last
      ) {
        parsedFirst = parsed.first;
        parsedLast = parsed.last;
        break;
      }
    }
  }

  // If we only have first + last, synthesize a combined name.
  const ownerName =
    titlecase(ownerNameRaw) ??
    (ownerFirstRaw || ownerLastRaw
      ? titlecase([ownerFirstRaw, ownerLastRaw].filter(Boolean).join(" "))
      : parsedFirst || parsedLast
      ? [parsedFirst, parsedLast].filter(Boolean).join(" ")
      : null);

  return {
    owner_name:      ownerName,
    owner_first:     titlecase(ownerFirstRaw) ?? parsedFirst,
    owner_last:      titlecase(ownerLastRaw) ?? parsedLast,
    applicant_name:  titlecase(applicantNameRaw),
    contractor_name: titlecase(contractorNameRaw),
    phone:           normalizePhone(pick(blob, KEY_LISTS.phone)),
    email:           normalizeEmail(pick(blob, KEY_LISTS.email)),
  };
}

/** True if the extracted record has anything worth persisting. Callers
 *  use this to skip update round-trips when raw_json had none of the
 *  recognised fields. */
export function hasAnyContact(c: ExtractedContact): boolean {
  return !!(
    c.owner_name ||
    c.owner_first ||
    c.owner_last ||
    c.applicant_name ||
    c.contractor_name ||
    c.phone ||
    c.email
  );
}

/* ── Provenance-aware extraction ───────────────────────────────────────
 * Everything below wraps the original `extractContact` with two extra
 * signals: `source` (which city / upstream shape the blob came from)
 * and `confidence` (how trustworthy the fields we pulled are).
 *
 * These populate `contact_source` / `contact_confidence` on permits +
 * leads (migration 00039). The original `extractContact` is left
 * untouched for backward compat — callers that only need the fields
 * still get the lean interface.
 * ──────────────────────────────────────────────────────────────────── */

/** Heuristic: which upstream shape is this raw blob? We look at the
 *  fingerprint keys each city's open-data portal uses. Order matters —
 *  the most specific markers (NYC's `owner_s_first_name`, KCMO's
 *  `kivapin`) are tested first so a generic Socrata feed that happens
 *  to share ALLCAPS headers with an ArcGIS feed doesn't get misfiled. */
function inferSource(raw: unknown): ContactSource {
  if (!raw || typeof raw !== "object") return "raw_json_generic";
  const keys = Object.keys(raw as Record<string, unknown>);
  if (keys.length === 0) return "raw_json_generic";

  // NYC DOB: distinctive `owner_s_first_name`, `permittee_s_phone__`,
  // `bin__` (the building ID #) — at least one is near-unique to NYC.
  const nycMarkers = ["owner_s_first_name", "permittee_s_phone__", "bin__"];
  if (keys.some((k) => nycMarkers.includes(k))) return "raw_json_nyc";

  // Baton Rouge EBRGIS: `ownername` alongside `parishname`.
  if (keys.includes("ownername") && keys.includes("parishname")) {
    return "raw_json_baton_rouge";
  }

  // Kansas City MO: the KIVA permit system exposes `kivapin` +
  // `structure_status`.
  if (keys.includes("structure_status") && keys.includes("kivapin")) {
    return "raw_json_kcmo";
  }

  // ArcGIS Open Data portals (Houston, many counties) send ALLCAPS
  // field names like `OWNER_NAME` / `ZONING`. We require >=3 all-caps
  // keys to avoid false positives on one-off legacy fields.
  const allCapsKeys = keys.filter((k) => /^[A-Z][A-Z0-9_]+$/.test(k));
  if (allCapsKeys.length >= 3) return "raw_json_arcgis";

  // Generic Socrata: lowercase-with-underscores dominates. We require
  // >=3 lowercase-with-underscore keys to avoid snap-classifying
  // 2-field blobs.
  const snakeKeys = keys.filter((k) => /^[a-z][a-z0-9_]+$/.test(k));
  if (snakeKeys.length >= 3) return "raw_json_socrata_generic";

  return "raw_json_generic";
}

/** Rubric (best match wins):
 *   0.90 — NYC-format: owner_s_first_name + owner_s_last_name + owner_s_phone__ ALL present
 *   0.80 — Full owner name recovered (first + last both set, directly or via parser)
 *   0.60 — Only owner_name / applicant_name recovered (single-field blob)
 *   0.40 — Only a contractor_name — owner side is empty
 *   0.30 — Synthesized owner by splitting a business / combined field with a weak parser score
 *   0.00 — Nothing usable extracted
 */
function inferConfidence(
  raw: unknown,
  c: ExtractedContact,
  source: ContactSource,
): number {
  const blob = lowerKeyed(raw);

  // 0.90: NYC DOB triple — our highest-signal upstream.
  if (
    source === "raw_json_nyc" &&
    pick(blob, ["owner_s_first_name"]) &&
    pick(blob, ["owner_s_last_name"]) &&
    pick(blob, ["owner_s_phone__"])
  ) {
    return 0.9;
  }

  // Detect the "synthesized from business name" case up-front: we have
  // a first+last but neither came from a structured first/last field.
  // That means the business-name-parser in extractContact produced
  // them. Even though it was above the parser threshold we still count
  // it as lower confidence than a directly-supplied first/last pair.
  const hadStructuredFirst = !!pick(blob, KEY_LISTS.owner_first);
  const hadStructuredLast = !!pick(blob, KEY_LISTS.owner_last);
  const synthesizedFirstLast =
    !!c.owner_first &&
    !!c.owner_last &&
    !hadStructuredFirst &&
    !hadStructuredLast;

  // 0.80: first + last present AND they came from structured fields.
  if (c.owner_first && c.owner_last && !synthesizedFirstLast) return 0.8;

  // 0.30: the parser invented a first/last split from a business-ish
  // combined field. Low trust — "Smith Roofing Inc" → "Smith" /
  // "Roofing" is the canonical failure mode.
  if (synthesizedFirstLast) return 0.3;

  // 0.60: single-field owner / applicant name with no first/last split.
  if (c.owner_name || c.applicant_name) return 0.6;

  // 0.40: only a contractor_name.
  if (c.contractor_name) return 0.4;

  // Nothing usable.
  return 0;
}

/** Provenance-aware extraction. Does the same field-picking as
 *  `extractContact`, then adds `source` (which city's shape) and
 *  `confidence` (how much we trust what we got).
 *
 *  Callers: permit ingest cron, Socrata fetcher fallback, backfill
 *  script — all persist the three resulting columns on `permits` and
 *  `leads` (migration 00039). */
export function extractContactWithProvenance(
  raw: unknown,
): ExtractedContactWithProvenance {
  const base = extractContact(raw);
  const source = inferSource(raw);
  const confidence = inferConfidence(raw, base, source);
  return { ...base, source, confidence };
}
