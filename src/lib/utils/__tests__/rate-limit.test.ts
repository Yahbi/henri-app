import { describe, it, expect, beforeEach, vi } from "vitest";
import { checkRateLimit, getClientIp, rateLimitResponse } from "../rate-limit";

/* ── checkRateLimit ────────────────────────────────────────────────────── */

describe("checkRateLimit", () => {
  // Each test gets a unique identifier to avoid cross-test pollution
  let id: string;
  beforeEach(() => {
    id = `test-${Math.random().toString(36).slice(2)}`;
  });

  it("allows requests under the limit", () => {
    const result = checkRateLimit(id, { maxRequests: 5, windowMs: 60_000 });
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
    expect(result.limit).toBe(5);
    expect(result.retryAfterMs).toBeNull();
  });

  it("tracks remaining count correctly", () => {
    checkRateLimit(id, { maxRequests: 3, windowMs: 60_000 });
    checkRateLimit(id, { maxRequests: 3, windowMs: 60_000 });
    const third = checkRateLimit(id, { maxRequests: 3, windowMs: 60_000 });
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);
  });

  it("rejects requests over the limit", () => {
    const config = { maxRequests: 2, windowMs: 60_000 };
    checkRateLimit(id, config);
    checkRateLimit(id, config);
    const third = checkRateLimit(id, config);
    expect(third.allowed).toBe(false);
    expect(third.remaining).toBe(0);
    expect(third.retryAfterMs).toBeGreaterThan(0);
  });

  it("isolates identifiers from each other", () => {
    const config = { maxRequests: 1, windowMs: 60_000 };
    const r1 = checkRateLimit("ip-A", config);
    const r2 = checkRateLimit("ip-B", config);
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);

    const r3 = checkRateLimit("ip-A", config);
    expect(r3.allowed).toBe(false);

    // ip-B still has capacity since it's isolated
    const r4 = checkRateLimit("ip-B", config);
    expect(r4.allowed).toBe(false);
  });

  it("allows requests again after window expires", () => {
    const config = { maxRequests: 1, windowMs: 100 };
    const r1 = checkRateLimit(id, config);
    expect(r1.allowed).toBe(true);

    const r2 = checkRateLimit(id, config);
    expect(r2.allowed).toBe(false);

    // Fast-forward past the window
    vi.useFakeTimers();
    vi.advanceTimersByTime(150);

    const r3 = checkRateLimit(id, config);
    expect(r3.allowed).toBe(true);

    vi.useRealTimers();
  });

  it("defaults windowMs to 60_000", () => {
    const result = checkRateLimit(id, { maxRequests: 100 });
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(100);
  });
});

/* ── getClientIp ───────────────────────────────────────────────────────── */

describe("getClientIp", () => {
  it("extracts IP from X-Forwarded-For", () => {
    const req = new Request("http://localhost", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    expect(getClientIp(req)).toBe("1.2.3.4");
  });

  it("extracts IP from X-Real-IP", () => {
    const req = new Request("http://localhost", {
      headers: { "x-real-ip": "10.0.0.1" },
    });
    expect(getClientIp(req)).toBe("10.0.0.1");
  });

  it("prefers X-Forwarded-For over X-Real-IP", () => {
    const req = new Request("http://localhost", {
      headers: {
        "x-forwarded-for": "1.1.1.1",
        "x-real-ip": "2.2.2.2",
      },
    });
    expect(getClientIp(req)).toBe("1.1.1.1");
  });

  it("returns 'unknown' when no headers present", () => {
    const req = new Request("http://localhost");
    expect(getClientIp(req)).toBe("unknown");
  });
});

/* ── rateLimitResponse ─────────────────────────────────────────────────── */

describe("rateLimitResponse", () => {
  it("returns 429 status", () => {
    const resp = rateLimitResponse({
      allowed: false,
      remaining: 0,
      limit: 10,
      retryAfterMs: 30_000,
    });
    expect(resp.status).toBe(429);
  });

  it("includes rate limit headers", () => {
    const resp = rateLimitResponse({
      allowed: false,
      remaining: 0,
      limit: 30,
      retryAfterMs: 45_000,
    });
    expect(resp.headers.get("X-RateLimit-Limit")).toBe("30");
    expect(resp.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(resp.headers.get("Retry-After")).toBe("45");
  });

  it("returns JSON body with error message", async () => {
    const resp = rateLimitResponse({
      allowed: false,
      remaining: 0,
      limit: 5,
      retryAfterMs: 10_000,
    });
    const body = await resp.json();
    expect(body.error).toBeTruthy();
  });
});
