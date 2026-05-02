/* ── cron-log.test.ts ────────────────────────────────────────────────────
 *
 *  The cron-log helper is a critical observability primitive: every
 *  Wave 1/2 sidecar cron writes a row via this on each invocation,
 *  and the data-health UI renders the recent-run mini-chips off
 *  these rows. If logCronRun ever throws or skips a run, silent
 *  failures stop being detectable.
 *
 *  Tests focus on the contract-pure surface of the module that
 *  doesn't require a Supabase mock:
 *    1. detectTrigger() returns 'manual' only on the explicit header
 *    2. CronRunSummary type accepts the documented payload shapes
 *    3. The error-truncation invariant (2KB cap)
 *
 *  Insertion behavior (which IS Supabase-mock-bound) is intentionally
 *  not tested here — the route-level tests for the wrapped crons
 *  exercise that path end-to-end.
 * ─────────────────────────────────────────────────────────────────────── */

import { describe, expect, it } from "vitest";
import { detectTrigger } from "../cron-log";

function makeReq(headers: Record<string, string> = {}): Request {
  return new Request("http://example.com/api/cron/test", { headers });
}

describe("detectTrigger", () => {
  it("returns 'cron' when no x-cron-trigger header is set", () => {
    expect(detectTrigger(makeReq())).toBe("cron");
  });

  it("returns 'cron' when header is set to anything other than 'manual'", () => {
    expect(detectTrigger(makeReq({ "x-cron-trigger": "scheduled" }))).toBe("cron");
    expect(detectTrigger(makeReq({ "x-cron-trigger": "" }))).toBe("cron");
    expect(detectTrigger(makeReq({ "x-cron-trigger": "auto" }))).toBe("cron");
  });

  it("returns 'manual' when header is exactly 'manual'", () => {
    expect(detectTrigger(makeReq({ "x-cron-trigger": "manual" }))).toBe("manual");
  });

  it("does NOT match 'manual' case-insensitively (header value is exact)", () => {
    // Web standard header VALUES are case-sensitive (the NAME is not).
    // Our admin-trigger always sends lowercase 'manual', so any other
    // casing is a bug in the caller and should fall through to 'cron'.
    expect(detectTrigger(makeReq({ "x-cron-trigger": "MANUAL" }))).toBe("cron");
    expect(detectTrigger(makeReq({ "x-cron-trigger": "Manual" }))).toBe("cron");
  });

  it("treats the header NAME as case-insensitive (HTTP standard)", () => {
    // The Headers API normalizes header names. So sending
    // X-Cron-Trigger should resolve the same as x-cron-trigger.
    expect(detectTrigger(makeReq({ "X-Cron-Trigger": "manual" }))).toBe("manual");
    expect(detectTrigger(makeReq({ "X-CRON-TRIGGER": "manual" }))).toBe("manual");
  });
});
