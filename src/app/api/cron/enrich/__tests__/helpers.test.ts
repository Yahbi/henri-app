/**
 * Tests for `src/app/api/cron/enrich/helpers.ts` — the attempt marker.
 *
 * The defect these guard against: the cron selects candidates with
 * `year_built IS NULL` and used to write only when enrichment produced a
 * field, so a lead whose sources cannot produce a year_built was never
 * marked in any way, matched the identical filter on the next run, and was
 * re-processed on every run forever. In the claimed territories that is
 * nearly every lead, so the queue never advanced and the rest of the corpus
 * was never reached.
 *
 * `enrich_attempted_at` is the fix: stamped for every lead ATTEMPTED, not
 * only the ones that succeeded, and excluded from the next scan for a retry
 * window. Same shape as `permits.geocode_attempted_at` (migration 00134).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildEnrichPatch,
  enrichAttemptCutoff,
  ENRICH_RETRY_AFTER_DAYS,
  type EnrichHit,
} from "../helpers";

const EMPTY_HIT: EnrichHit = {
  owner_name: null,
  owner_first: null,
  owner_last: null,
  phone: null,
  email: null,
  mailing_address: null,
  year_built: null,
  home_sqft: null,
  lot_sqft: null,
  assessed_value: null,
  property_value: null,
  owner_occupied: null,
};

const NOW = "2026-08-06T12:00:00.000Z";

describe("buildEnrichPatch — attempt marker", () => {
  it("stamps a lead that yielded absolutely nothing", () => {
    const { patch, realFieldsChanged } = buildEnrichPatch({}, EMPTY_HIT, {
      stampAttempt: true,
      nowIso: NOW,
    });
    // This is the whole point: an unproductive attempt still produces a
    // write, so the lead drops out of the next scan.
    expect(patch).toEqual({ enrich_attempted_at: NOW });
    expect(realFieldsChanged).toBe(0);
  });

  it("stamps a lead whose every field already matches the hit", () => {
    const lead = { owner_name: "Jane Owner", year_built: 1961 };
    const { patch, realFieldsChanged } = buildEnrichPatch(
      lead,
      { ...EMPTY_HIT, owner_name: "Jane Owner", year_built: 1961 },
      { stampAttempt: true, nowIso: NOW },
    );
    expect(patch).toEqual({ enrich_attempted_at: NOW });
    expect(realFieldsChanged).toBe(0);
  });

  it("does not count the stamp as an enriched field", () => {
    const { patch, realFieldsChanged } = buildEnrichPatch(
      {},
      { ...EMPTY_HIT, owner_name: "New Owner", phone: "5551234567" },
      { stampAttempt: true, nowIso: NOW },
    );
    expect(realFieldsChanged).toBe(2);
    expect(patch.owner_name).toBe("New Owner");
    expect(patch.phone).toBe("5551234567");
    expect(patch.enrich_attempted_at).toBe(NOW);
  });

  it("omits the stamp when the column is not available yet", () => {
    // Graceful degrade before migration 00139 lands: naming a column that
    // does not exist fails the whole UPDATE, which would drop the contact
    // data the run just found.
    const { patch } = buildEnrichPatch(
      {},
      { ...EMPTY_HIT, owner_name: "New Owner" },
      { stampAttempt: false, nowIso: NOW },
    );
    expect(patch).toEqual({ owner_name: "New Owner" });
    expect("enrich_attempted_at" in patch).toBe(false);
  });
});

describe("buildEnrichPatch — field write rules", () => {
  it("never nulls out data already on the lead", () => {
    const lead = { owner_name: "Existing Owner", phone: "5550001111" };
    const { patch, realFieldsChanged } = buildEnrichPatch(lead, EMPTY_HIT, {
      stampAttempt: true,
      nowIso: NOW,
    });
    expect(patch.owner_name).toBeUndefined();
    expect(patch.phone).toBeUndefined();
    expect(realFieldsChanged).toBe(0);
  });

  it("overwrites a differing existing value", () => {
    const lead = { year_built: 1900 };
    const { patch, realFieldsChanged } = buildEnrichPatch(
      lead,
      { ...EMPTY_HIT, year_built: 1974 },
      { stampAttempt: true, nowIso: NOW },
    );
    expect(patch.year_built).toBe(1974);
    expect(realFieldsChanged).toBe(1);
  });

  it("compares home_sqft / lot_sqft as text, matching the column type", () => {
    const lead = { home_sqft: "1800", lot_sqft: "5000" };
    const { patch, realFieldsChanged } = buildEnrichPatch(
      lead,
      { ...EMPTY_HIT, home_sqft: 1800, lot_sqft: 5000 },
      { stampAttempt: true, nowIso: NOW },
    );
    // Same value, stored as text — no churn write.
    expect(patch.home_sqft).toBeUndefined();
    expect(patch.lot_sqft).toBeUndefined();
    expect(realFieldsChanged).toBe(0);
  });

  it("writes home_sqft as a string when it actually changed", () => {
    const { patch } = buildEnrichPatch(
      { home_sqft: "1200" },
      { ...EMPTY_HIT, home_sqft: 1800 },
      { stampAttempt: true, nowIso: NOW },
    );
    expect(patch.home_sqft).toBe("1800");
  });

  it("gates employer / occupation behind writeExtended", () => {
    const hit = { ...EMPTY_HIT, employer: "Acme", occupation: "Engineer" };
    expect(buildEnrichPatch({}, hit, { nowIso: NOW }).patch.employer).toBeUndefined();
    expect(
      buildEnrichPatch({}, hit, { writeExtended: true, nowIso: NOW }).patch.employer,
    ).toBe("Acme");
  });

  it("writes provenance only when a real field also changed", () => {
    const hitNoChange = { ...EMPTY_HIT, primary_source: "county_gis_la", confidence: 0.9 };
    const noChange = buildEnrichPatch({}, hitNoChange, {
      writeProvenance: true,
      stampAttempt: true,
      nowIso: NOW,
    });
    expect(noChange.patch.contact_source).toBeUndefined();

    const changed = buildEnrichPatch(
      {},
      { ...hitNoChange, owner_name: "Jane Owner" },
      { writeProvenance: true, stampAttempt: true, nowIso: NOW },
    );
    expect(changed.patch.contact_source).toBe("county_gis_la");
    expect(changed.patch.contact_confidence).toBe(0.9);
    expect(changed.patch.contact_extracted_at).toBe(NOW);
  });
});

describe("enrichAttemptCutoff", () => {
  it("is the retry window before `now`", () => {
    const now = new Date("2026-08-06T00:00:00.000Z");
    expect(enrichAttemptCutoff(now, 30)).toBe("2026-07-07T00:00:00.000Z");
  });

  it("defaults to the documented retry window", () => {
    const now = new Date("2026-08-06T00:00:00.000Z");
    expect(enrichAttemptCutoff(now)).toBe(
      new Date(now.getTime() - ENRICH_RETRY_AFTER_DAYS * 86_400_000).toISOString(),
    );
  });

  it("leaves a re-try possible rather than retiring a lead forever", () => {
    expect(ENRICH_RETRY_AFTER_DAYS).toBeGreaterThan(0);
  });
});

/* ── Structural: the candidate scans must actually use the marker ────────
 *
 * The patch builder can stamp every lead and the queue would STILL never
 * advance if the SELECTs didn't exclude attempted leads. Both scans (the
 * priority-ZIP one and the general-pool one) need the filter, so assert on
 * the route source directly.
 */
describe("structural — both candidate scans filter on the attempt marker", () => {
  it("applies the null-or-older-than-cutoff filter twice", () => {
    const src = readFileSync(resolve(__dirname, "..", "route.ts"), "utf8");
    const matches = src.match(/enrich_attempted_at\.is\.null,enrich_attempted_at\.lt\./g);
    expect(matches?.length).toBe(2);
  });

  it("feeds the stamp through buildEnrichPatch rather than an ad-hoc write", () => {
    const src = readFileSync(resolve(__dirname, "..", "route.ts"), "utf8");
    expect(src).toContain("stampAttempt: attemptMarkerReady");
  });
});
