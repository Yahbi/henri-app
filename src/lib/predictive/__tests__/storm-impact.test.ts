/* ── storm-impact.test.ts ───────────────────────────────────────────────
 *
 *  Tier A+ Sprint 1 — F2.1 storm-impact prediction tests.
 *
 *  Locks the invariants:
 *    1. recencyWeight returns the documented buckets (1.0/0.7/0.4/0).
 *    2. predominantEventType returns the most-frequent event type, null on empty.
 *    3. maxMagnitude is null-safe.
 *    4. buildStormPrediction returns the no-storms sentinel when events=[].
 *    5. buildStormPrediction multiplies historical rate × recency weight.
 *    6. likelihood values are clamped to [0, 1] and rounded to 3 decimals.
 * ──────────────────────────────────────────────────────────────────────── */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NO_STORMS_PREDICTION,
  REPAIR_DRIVING_EVENTS,
  buildStormPrediction,
  daysAgo,
  maxMagnitude,
  predominantEventType,
  recencyWeight,
  type StormEvent,
} from "../storm-impact";

describe("recencyWeight", () => {
  it("returns 1.0 for storms within 14 days", () => {
    expect(recencyWeight(0)).toBe(1.0);
    expect(recencyWeight(7)).toBe(1.0);
    expect(recencyWeight(14)).toBe(1.0);
  });
  it("returns 0.7 for storms 15-30 days ago", () => {
    expect(recencyWeight(15)).toBe(0.7);
    expect(recencyWeight(30)).toBe(0.7);
  });
  it("returns 0.4 for storms 31-60 days ago", () => {
    expect(recencyWeight(31)).toBe(0.4);
    expect(recencyWeight(60)).toBe(0.4);
  });
  it("returns 0 for storms > 60 days ago", () => {
    expect(recencyWeight(61)).toBe(0);
    expect(recencyWeight(365)).toBe(0);
  });
});

describe("predominantEventType", () => {
  it("returns null on empty input", () => {
    expect(predominantEventType([])).toBe(null);
  });
  it("returns the most-frequent event type", () => {
    const events: StormEvent[] = [
      { begin_date: "2026-04-01", event_type: "Hail" },
      { begin_date: "2026-04-02", event_type: "Hail" },
      { begin_date: "2026-04-03", event_type: "Tornado" },
    ];
    expect(predominantEventType(events)).toBe("Hail");
  });
  it("returns the only type when only one in the list", () => {
    expect(
      predominantEventType([{ begin_date: "2026-04-01", event_type: "Tornado" }]),
    ).toBe("Tornado");
  });
});

describe("maxMagnitude", () => {
  it("returns null when no magnitudes", () => {
    expect(maxMagnitude([])).toBe(null);
    expect(
      maxMagnitude([{ begin_date: "2026-04-01", event_type: "Hail" }]),
    ).toBe(null);
  });
  it("returns the max magnitude across events", () => {
    expect(
      maxMagnitude([
        { begin_date: "2026-04-01", event_type: "Hail", magnitude: 1.5 },
        { begin_date: "2026-04-02", event_type: "Hail", magnitude: 2.75 },
        { begin_date: "2026-04-03", event_type: "Hail", magnitude: 0.5 },
      ]),
    ).toBe(2.75);
  });
  it("ignores null magnitudes", () => {
    expect(
      maxMagnitude([
        { begin_date: "2026-04-01", event_type: "Hail", magnitude: null },
        { begin_date: "2026-04-02", event_type: "Hail", magnitude: 1.0 },
      ]),
    ).toBe(1.0);
  });
});

describe("daysAgo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-30T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns days between an ISO date and now", () => {
    expect(daysAgo("2026-04-23")).toBe(7);
    expect(daysAgo("2026-04-30")).toBe(0);
    expect(daysAgo("2026-04-01")).toBe(29);
  });
  it("returns Infinity for invalid input", () => {
    expect(daysAgo("not a date")).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("buildStormPrediction", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-30T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns NO_STORMS_PREDICTION for empty events", () => {
    expect(buildStormPrediction([], 0.5, 0.6, 100)).toEqual(NO_STORMS_PREDICTION);
  });

  it("builds prediction with recent storm + medium history", () => {
    const events: StormEvent[] = [
      { begin_date: "2026-04-25", event_type: "Hail", magnitude: 2.0 },
    ];
    const prediction = buildStormPrediction(events, 0.5, 0.6, 100);

    expect(prediction.storm_event_count_60d).toBe(1);
    expect(prediction.last_storm_date).toBe("2026-04-25");
    expect(prediction.max_magnitude).toBe(2.0);
    expect(prediction.primary_event_type).toBe("Hail");
    // 5 days ago × historical rate 0.5 × recency 1.0 = 0.5
    expect(prediction.repair_likelihood_60d).toBe(0.5);
    expect(prediction.repair_likelihood_90d).toBe(0.6);
    expect(prediction.confidence_label).toBe("medium");
  });

  it("applies recency weight 0.4 for 31-60 day-old storm", () => {
    const events: StormEvent[] = [
      { begin_date: "2026-03-20", event_type: "Tornado" }, // ~41 days ago
    ];
    const prediction = buildStormPrediction(events, 0.5, 0.6, 100);
    // 0.5 × 0.4 = 0.2
    expect(prediction.repair_likelihood_60d).toBe(0.2);
    // 0.6 × 0.4 = 0.24
    expect(prediction.repair_likelihood_90d).toBe(0.24);
  });

  it("clamps likelihood at 1.0 when historical rate × recency exceeds 1", () => {
    const events: StormEvent[] = [
      { begin_date: "2026-04-30", event_type: "Hail" },
    ];
    const prediction = buildStormPrediction(events, 1.5, 1.5, 100);
    expect(prediction.repair_likelihood_60d).toBe(1);
    expect(prediction.repair_likelihood_90d).toBe(1);
  });

  it("picks the most-recent storm as last_storm_date", () => {
    const events: StormEvent[] = [
      { begin_date: "2026-04-20", event_type: "Hail" },
      { begin_date: "2026-04-25", event_type: "Tornado" }, // most recent
      { begin_date: "2026-04-15", event_type: "Hail" },
    ];
    const prediction = buildStormPrediction(events, 0.5, 0.6, 100);
    expect(prediction.last_storm_date).toBe("2026-04-25");
  });
});

describe("REPAIR_DRIVING_EVENTS list", () => {
  it("includes the documented repair-driving event types", () => {
    expect(REPAIR_DRIVING_EVENTS).toContain("Hail");
    expect(REPAIR_DRIVING_EVENTS).toContain("Tornado");
    expect(REPAIR_DRIVING_EVENTS).toContain("Wildfire");
    expect(REPAIR_DRIVING_EVENTS).toContain("Hurricane");
  });
});
