/**
 * Shared request-parameter guards for API route handlers.
 *
 * Body validation lives in `@/lib/schemas/api` (Zod schemas + `parseBody`).
 * This module covers the *other* half — path params and query strings —
 * where an unvalidated value would otherwise reach Postgres directly and
 * come back as a raw `22P02 invalid input syntax for type uuid` error that
 * (a) 500s instead of 400s and (b) leaks the column type to the caller.
 *
 * Everything here is pure and dependency-free so it can be unit-tested and
 * reused from any handler without pulling in Supabase or Next internals.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when `value` is a syntactically valid UUID. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** True when `value` is a 5-digit US ZIP code. */
export function isZip5(value: unknown): value is string {
  return typeof value === "string" && /^\d{5}$/.test(value);
}

/**
 * Clamp a caller-supplied `?limit=` into a safe range.
 *
 * Guards three separate failure modes that a bare
 * `Number(searchParams.get("limit")) || 20` does not:
 *   - `NaN`      (`?limit=abc`)      → falls back to `fallback`
 *   - negatives  (`?limit=-5`)       → PostgREST rejects a negative LIMIT
 *   - unbounded  (`?limit=9999999`)  → statement timeout on big tables
 */
export function clampLimit(
  raw: string | null | undefined,
  fallback: number,
  max: number,
): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(1, Math.trunc(parsed)));
}

/**
 * Sanitize a free-text query value before it reaches a PostgREST
 * `ilike`/`eq` filter. Trims, caps length, and strips the characters
 * PostgREST treats as filter syntax (`,` `(` `)` `*`) plus the LIKE
 * wildcards, so a crafted value can't widen or restructure the filter.
 *
 * Returns `null` for empty input so callers can skip the filter entirely.
 */
export function sanitizeFilterText(
  raw: string | null | undefined,
  maxLength = 60,
): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/[,()*%_\\]/g, "").trim().slice(0, maxLength);
  return cleaned.length > 0 ? cleaned : null;
}
