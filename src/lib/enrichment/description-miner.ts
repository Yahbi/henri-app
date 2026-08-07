/**
 * Permit description text mining
 * ───────────────────────────────────────────────────────────────────────────
 * Purpose: many permits embed contact data directly in the free-text
 * `description` / `scope_of_work` field that upstream parsers skip.
 * Examples from real ingested data:
 *
 *   "Re-roof per plans. Contact John Smith 555-123-4567"
 *   "Install 4-ton HVAC. Owner: Maria Gonzalez, (512) 555-9012"
 *   "Contact: mike@acmeplumbing.com or 415.555.1234"
 *   "Emergency repair - call Tom 650/555/8899"
 *   "Owner contact jsmith@example.com for access instructions"
 *
 * This module scans description text for phone + email patterns that
 * bypass the structured-field extractor entirely. Zero external calls,
 * zero API cost — just regex against text we already have in the DB.
 *
 * Empirically on a sample of 1000 permits with description text:
 *   - ~8% contained an embedded phone number
 *   - ~2% contained an embedded email
 *   - ~1% contained both
 *
 * ## Why this wasn't caught by extract-contact.ts
 *
 * That module reads STRUCTURED JSON fields (`contact_phone`, `email`,
 * etc.). When a jurisdiction ships the contact info as part of the
 * free-text description, the structured fields are null and the text
 * contains the data. This module is the fallback.
 *
 * ## Safety
 *
 * Two classes of false positives to avoid:
 *   - **Job-site phones** ("call 1-800-JUNK-USA") — not the homeowner.
 *   - **Permit-number-that-looks-like-a-phone** ("4081234567") — 10 digits
 *     but not a phone.
 *
 * We filter by:
 *   - Rejecting toll-free prefixes (800, 844, 855, 866, 877, 888)
 *     since those are businesses, not homeowners.
 *   - Requiring phone-shape formatting characters (dash, dot, paren, or
 *     space between groups) — raw 10-digit numbers without separators
 *     are too likely to be permit IDs.
 *   - Rejecting emails from domains that are clearly not personal
 *     (e.g. `@example.com`, `@city.gov`, `@permit-admin.com`).
 */

export interface MinedContact {
  phones: string[];       // normalized xxx-xxx-xxxx
  emails: string[];       // lowercased
}

const TOLL_FREE_PREFIXES = new Set([
  "800", "833", "844", "855", "866", "877", "888",
]);

const NON_PERSONAL_EMAIL_DOMAINS = new Set([
  "example.com",
  "example.org",
  "test.com",
  "permit.com",
]);

/**
 * Domain suffixes that identify the ISSUING AUTHORITY rather than a party to
 * the job. Measured 2026-08-07 against the live corpus: of 292 email-shaped
 * strings found in `permits.raw_json` across a 5% lead sample, 290 sat under
 * the key `ASSIGNED_TO` and were of the form `<staff-id>@hartford.gov` — the
 * city permit inspector assigned to the file. Exactly 2 were a party to the
 * work (`PERMIT_APPLICANT`).
 *
 * `leads.email` is presented to the contractor as the way to reach the
 * homeowner. Writing an inspector's address there would send outreach to a
 * municipal employee who never consented, under a message written in the
 * homeowner's voice — the same failure mode the 2026-08-05 contractor-phone
 * decision in `src/lib/ingest/extract-contact.ts` was made to prevent.
 *
 * Matched on the domain's tail so `hartford.gov`, `ci.austin.tx.us` and
 * `dc.gov` are all rejected without enumerating every municipality.
 */
const AUTHORITY_EMAIL_SUFFIXES = [".gov", ".mil", ".us", ".state", ".courts"];

/** Phone-shape regex. Requires at least one separator between groups
 *  to avoid matching bare 10-digit permit IDs. Accepts:
 *    (555) 123-4567
 *    555-123-4567
 *    555.123.4567
 *    555/123/4567
 *    555 123 4567
 *  Also +1 / 1- prefixed US numbers. */
const PHONE_RE =
  /(?:\+?1[\s\-\.]?)?\(?(\d{3})\)?[\s\-\.\/]+(\d{3})[\s\-\.\/]+(\d{4})\b/g;

/** Email regex — standard RFC-relaxed form. Bounded by word boundary.
 *
 *  The domain is one-or-more dot-separated labels followed by the TLD. The
 *  prior form allowed exactly ONE label plus a TLD, so any multi-label domain
 *  matched only its own prefix: `planner@ci.austin.tx.us` came back as
 *  `planner@ci.austin`. That is both a malformed address to write into
 *  `leads.email` AND a bypass of the authority guard below, which decides on
 *  the domain's suffix — `.us` had already been chopped off by the time
 *  `isPersonalEmail` saw it. Municipal domains are exactly the multi-label
 *  case (`ci.<city>.<st>.us`, `co.<county>.<st>.us`), so the truncation hit
 *  precisely the addresses that most needed rejecting. */
const EMAIL_RE =
  /\b[a-zA-Z0-9][a-zA-Z0-9._+-]*@(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}\b/g;

/** Normalize a 3-part phone capture into xxx-xxx-xxxx. */
function normalizePhone(a: string, b: string, c: string): string | null {
  // Strip any formatting digits accidentally captured (shouldn't happen
  // with this regex but defensive).
  const clean = `${a}${b}${c}`.replace(/\D/g, "");
  if (clean.length !== 10) return null;
  const area = clean.slice(0, 3);
  if (TOLL_FREE_PREFIXES.has(area)) return null;
  // US area codes can't start with 0 or 1
  if (area[0] === "0" || area[0] === "1") return null;
  return `${area}-${clean.slice(3, 6)}-${clean.slice(6)}`;
}

/** Filter non-personal emails. Heuristic — when in doubt, keep it
 *  (the caller can still decide to skip). */
function isPersonalEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return false;
  if (NON_PERSONAL_EMAIL_DOMAINS.has(domain)) return false;
  // Reject the permit-issuing authority — see AUTHORITY_EMAIL_SUFFIXES.
  if (AUTHORITY_EMAIL_SUFFIXES.some((s) => domain.endsWith(s))) return false;
  // Reject addresses that are obvious shared inboxes — they're business
  // contacts but generic, not the homeowner we're trying to reach.
  const local = email.split("@")[0]?.toLowerCase();
  if (!local) return false;
  const genericLocals = new Set([
    "info", "contact", "admin", "webmaster", "postmaster", "noreply",
    "no-reply", "support", "sales", "hello",
    // Municipal shared inboxes seen on non-.gov vanity domains.
    "permits", "permitting", "inspections", "inspection", "building",
    "clerk", "records", "office", "help", "service", "services",
    "donotreply", "do-not-reply", "notifications",
  ]);
  if (genericLocals.has(local)) return false;
  return true;
}

/**
 * Mine a free-text description for embedded phones + emails.
 * Returns de-duplicated arrays. Never throws.
 *
 * @param text  The `description` / `scope_of_work` / `notes` text to scan.
 */
export function mineDescription(text: string | null | undefined): MinedContact {
  const out: MinedContact = { phones: [], emails: [] };
  if (!text) return out;

  const phoneSet = new Set<string>();
  let phoneMatch: RegExpExecArray | null;
  PHONE_RE.lastIndex = 0;
  while ((phoneMatch = PHONE_RE.exec(text)) !== null) {
    const normalized = normalizePhone(phoneMatch[1], phoneMatch[2], phoneMatch[3]);
    if (normalized) phoneSet.add(normalized);
  }
  out.phones = [...phoneSet];

  const emailSet = new Set<string>();
  let emailMatch: RegExpExecArray | null;
  EMAIL_RE.lastIndex = 0;
  while ((emailMatch = EMAIL_RE.exec(text)) !== null) {
    const e = emailMatch[0].toLowerCase();
    if (isPersonalEmail(e)) emailSet.add(e);
  }
  out.emails = [...emailSet];

  return out;
}

/**
 * Convenience wrapper — mine multiple text fields at once, merging
 * results. Useful when a permit has description + scope_notes + notes
 * separately.
 */
export function mineMultiple(texts: Array<string | null | undefined>): MinedContact {
  const all: MinedContact = { phones: [], emails: [] };
  const phoneSet = new Set<string>();
  const emailSet = new Set<string>();
  for (const text of texts) {
    const m = mineDescription(text);
    m.phones.forEach((p) => phoneSet.add(p));
    m.emails.forEach((e) => emailSet.add(e));
  }
  all.phones = [...phoneSet];
  all.emails = [...emailSet];
  return all;
}

/* ── raw_json free-text collection ─────────────────────────────────────────
 *
 * The enrich cron used to hand the miner exactly one string: the
 * `permits.description` COLUMN. But `description` is only populated for the
 * subset of sources whose upstream blob happens to use that key name. Many
 * jurisdictions put the same scope-of-work prose under `work_desc`,
 * `DESC_OF_WORK`, `JobDescription`, `COMMENTS`, `permit_condition` or
 * `projectdescription`, and those never reached the miner at all.
 *
 * Measured 2026-08-07 on a 20% sample (55,085 leads with `phone IS NULL`):
 *   - phone-shaped string in the `permits.description` column ...... 22
 *   - phone-shaped string in a raw_json FREE-TEXT key .............. 53
 *   - of those, NOT also present in the description column ......... 32
 * So reading raw_json free-text recovers ~0.058% of phone-less leads that
 * the column-only path structurally cannot see.
 *
 * ## Why contractor-attributed keys are excluded
 *
 * The same sample found 566 phone-shaped strings (1.03% of phone-less leads)
 * under contractor-attributed keys — overwhelmingly one `contractor` blob per
 * permit of the form
 *   "1ST CLASS PLUMBING 1108 summit ave #3, plano, TX 75074 (214) 227-9554".
 * That is 91% of every free phone number in the corpus, and it is deliberately
 * off-limits: on 2026-08-05 `contractor_phone` / `gc_phone` /
 * `contractor_phone_number` / `contractor_phone_1` were removed from the
 * upstream extractor's phone list (see `src/lib/ingest/extract-contact.ts`)
 * because `leads.phone` is rendered under the drawer's "Homeowner" heading and
 * is the SMS destination for messages written in the homeowner's voice —
 * texting a COMPETING CONTRACTOR such a message is wrong for the subscriber,
 * wrong for the recipient, and TCPA exposure on a business line.
 *
 * Reading those numbers back in through the free-text door would silently undo
 * that decision, so `CONTRACTOR_KEY_RE` drops them here too. The numbers stay
 * in raw_json, verbatim, for a future contractor-intel surface.
 */

/** Keys whose value is prose we are willing to scan for embedded contacts. */
const FREE_TEXT_KEY_RE =
  /(desc|comment|remark|note|scope|work|condition|project|narrative|detail|purpose)/i;

/** Keys attributable to the permit-pulling contractor — never mined. */
const CONTRACTOR_KEY_RE = /contract|builder|\bgc[_-]?/i;

/** Upper bound on a single mined value. Guards against a pathological blob
 *  turning the regex scan into a hot loop; the longest raw_json in the corpus
 *  is 4,527 bytes total, so this never truncates real scope text. */
const MAX_TEXT_LEN = 8_000;

/**
 * Pull the free-text values out of a permit's `raw_json` that are safe to
 * mine for embedded contact data.
 *
 * Never throws — a malformed / non-object blob yields an empty array.
 * Returns values only; the caller passes them to `mineMultiple`.
 */
export function collectMinableText(raw: unknown): string[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "string") continue;
    if (CONTRACTOR_KEY_RE.test(key)) continue;
    if (!FREE_TEXT_KEY_RE.test(key)) continue;
    const text = value.trim();
    if (!text) continue;
    out.push(text.length > MAX_TEXT_LEN ? text.slice(0, MAX_TEXT_LEN) : text);
  }
  return out;
}
