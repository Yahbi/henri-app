/* ── Sliding Window Rate Limiter ────────────────────────────────────────────
 * IP-keyed, in-memory rate limiting for API routes.
 * Each serverless instance maintains its own window — this provides
 * per-instance burst protection, not globally distributed rate limiting.
 *
 * ## Upgrade path to distributed rate limiting (Phase 5+)
 *
 * The in-memory store is per-serverless-instance, so an attacker can
 * spread burst traffic across cold starts and evade the local limit.
 * For globally-consistent rate limiting we have two options:
 *
 *   1. **@upstash/ratelimit** — Redis-backed sliding window, runs on
 *      Vercel Edge. Drop-in replacement: install the package, instantiate
 *      a `Ratelimit` with an Upstash Redis client, and swap the
 *      `checkRateLimit` function body to `ratelimit.limit(identifier)`.
 *      Free tier supports up to 10k requests/day.
 *
 *   2. **Vercel KV** — Vercel's own key-value store, sliding-window
 *      recipe in their docs. Tighter integration with Vercel but slightly
 *      more bespoke — you build the sliding-window math yourself.
 *
 * Both require adding an env var (`UPSTASH_REDIS_REST_URL` etc.) and a
 * small init cost. Until then the in-memory version below is a sensible
 * default for Vercel's serverless model — most realistic abusers don't
 * juggle their traffic across regions to defeat per-instance limits.
 *
 * When the upgrade lands: keep this file's signatures exactly. All API
 * routes import `checkRateLimit(ip, config)` — swap the implementation
 * without touching any call site. Tests pin the behavior contract.
 * ────────────────────────────────────────────────────────────────────────── */

interface RateLimitEntry {
  timestamps: number[];
}

const store = new Map<string, RateLimitEntry>();

// Periodic cleanup to prevent unbounded memory growth
const CLEANUP_INTERVAL = 60_000; // 1 minute
let lastCleanup = Date.now();

function cleanup(windowMs: number) {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;

  const cutoff = now - windowMs;
  for (const [key, entry] of store) {
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
    if (entry.timestamps.length === 0) store.delete(key);
  }
}

interface RateLimitConfig {
  /** Maximum requests allowed within the window */
  maxRequests: number;
  /** Window duration in milliseconds (default: 60_000 = 1 minute) */
  windowMs?: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  retryAfterMs: number | null;
}

/**
 * Check rate limit for a given identifier (usually IP address).
 * Returns whether the request is allowed and metadata for headers.
 */
export function checkRateLimit(
  identifier: string,
  config: RateLimitConfig,
): RateLimitResult {
  const { maxRequests, windowMs = 60_000 } = config;
  const now = Date.now();
  const cutoff = now - windowMs;

  cleanup(windowMs);

  let entry = store.get(identifier);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(identifier, entry);
  }

  // Remove expired timestamps
  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

  if (entry.timestamps.length >= maxRequests) {
    const oldestInWindow = entry.timestamps[0];
    const retryAfterMs = oldestInWindow + windowMs - now;
    return {
      allowed: false,
      remaining: 0,
      limit: maxRequests,
      retryAfterMs,
    };
  }

  // Allow and record
  entry.timestamps.push(now);

  return {
    allowed: true,
    remaining: maxRequests - entry.timestamps.length,
    limit: maxRequests,
    retryAfterMs: null,
  };
}

/**
 * Extract client IP from Next.js request headers.
 * Prefers X-Forwarded-For (Vercel, Cloudflare) over direct connection.
 */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();

  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp;

  return "unknown";
}

/**
 * Build a 429 Too Many Requests response with rate limit headers.
 */
export function rateLimitResponse(result: RateLimitResult): Response {
  const headers: Record<string, string> = {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "Content-Type": "application/json",
  };

  if (result.retryAfterMs != null) {
    headers["Retry-After"] = String(Math.ceil(result.retryAfterMs / 1000));
  }

  return new Response(
    JSON.stringify({ error: "Too many requests. Please try again later." }),
    { status: 429, headers },
  );
}
