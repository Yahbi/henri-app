/**
 * Tests for `src/app/api/cron/re-enrich/helpers.ts` — audit priority #5.
 *
 * The B7 fix (2026-04-27 audit) changed the patch builder to use a
 * unified `assign()` helper for true field-change detection. Without
 * tests a future refactor could revert this and silently re-update
 * every previously-enriched lead nightly.
 *
 * Coverage:
 *   1. Skips fields where lead[key] is non-null AND === new value
 *   2. realFieldsChanged increments only for actual changes
 *   3. home_sqft / lot_sqft (text-coerced numerics) route through
 *      assign() — unchanged sqft does NOT bump realFieldsChanged
 *   4. Final patch always stamps last_enriched_at (proof-of-attempt)
 *   5. realFieldsChanged === 0 when only the timestamp differs
 *      (caller's enriched counter must not increment on this)
 *   6. WRITE_EXTENDED gate adds employer / occupation
 *   7. WRITE_PROVENANCE gates contact_source on realFieldsChanged > 0
 *      (no provenance when nothing changed)
 *   8. Null hit value never overwrites existing data
 *   9. Existing-null lead field accepts new non-null value
 *  10. Identical numeric values short-circuit (year_built, owner_occupied)
 */
import { describe, it, expect } from "vitest";
import { buildEnrichmentPatch, type EnrichmentHit, type LeadRowSubset } from "../helpers";

/** Minimal hit factory — start fully-null + override the bits a test cares about. */
function makeHit(over: Partial<EnrichmentHit> = {}): EnrichmentHit {
  return {
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
    employer: null,
    occupation: null,
    primary_source: null,
    confidence: null,
    ...over,
  };
}

describe("buildEnrichmentPatch — no-op write avoidance", () => {
  it("skips field where lead[key] is non-null AND identical to new value", () => {
    const lead: LeadRowSubset = { phone: "555-0100", email: "x@example.com" };
    const hit = makeHit({ phone: "555-0100", email: "x@example.com" });
    const { patch, realFieldsChanged } = buildEnrichmentPatch(lead, hit);

    // Neither phone nor email should appear in the patch — they're identical.
    expect(patch.phone).toBeUndefined();
    expect(patch.email).toBeUndefined();
    expect(realFieldsChanged).toBe(0);
    // last_enriched_at always present (proof-of-attempt)
    expect(typeof patch.last_enriched_at).toBe("string");
  });

  it("skips field when value matches even though other fields change", () => {
    const lead: LeadRowSubset = { phone: "555-0100", email: null };
    const hit = makeHit({ phone: "555-0100", email: "new@example.com" });
    const { patch, realFieldsChanged } = buildEnrichmentPatch(lead, hit);

    expect(patch.phone).toBeUndefined(); // unchanged
    expect(patch.email).toBe("new@example.com"); // newly added
    expect(realFieldsChanged).toBe(1);
  });

  it("never null-outs existing lead data when hit field is null", () => {
    const lead: LeadRowSubset = { owner_name: "Existing Owner", phone: "555-0100" };
    const hit = makeHit({ owner_name: null, phone: null });
    const { patch, realFieldsChanged } = buildEnrichmentPatch(lead, hit);

    expect(patch.owner_name).toBeUndefined();
    expect(patch.phone).toBeUndefined();
    expect(realFieldsChanged).toBe(0);
  });

  it("accepts new non-null value when existing field is null", () => {
    const lead: LeadRowSubset = { owner_name: null };
    const hit = makeHit({ owner_name: "Adan Martinez" });
    const { patch, realFieldsChanged } = buildEnrichmentPatch(lead, hit);

    expect(patch.owner_name).toBe("Adan Martinez");
    expect(realFieldsChanged).toBe(1);
  });

  it("accepts new value when existing field is undefined (key missing)", () => {
    const lead: LeadRowSubset = {}; // no owner_name key at all
    const hit = makeHit({ owner_name: "Adan Martinez" });
    const { patch, realFieldsChanged } = buildEnrichmentPatch(lead, hit);

    expect(patch.owner_name).toBe("Adan Martinez");
    expect(realFieldsChanged).toBe(1);
  });
});

describe("buildEnrichmentPatch — sqft text-coerced equality (B7 fix)", () => {
  it("home_sqft '1234' === '1234' short-circuits (no realFieldsChanged bump)", () => {
    // The lead row stores sqft as text; the orchestrator returns a number.
    // The helper must coerce to string before equality so the round-trip
    // doesn't churn the row.
    const lead: LeadRowSubset = { home_sqft: "1234", lot_sqft: "5000" };
    const hit = makeHit({ home_sqft: 1234, lot_sqft: 5000 });
    const { patch, realFieldsChanged } = buildEnrichmentPatch(lead, hit);

    expect(patch.home_sqft).toBeUndefined();
    expect(patch.lot_sqft).toBeUndefined();
    expect(realFieldsChanged).toBe(0);
  });

  it("home_sqft writes when the value actually differs", () => {
    const lead: LeadRowSubset = { home_sqft: "1234" };
    const hit = makeHit({ home_sqft: 1500 });
    const { patch, realFieldsChanged } = buildEnrichmentPatch(lead, hit);

    expect(patch.home_sqft).toBe("1500");
    expect(realFieldsChanged).toBe(1);
  });

  it("home_sqft writes when lead value is null", () => {
    const lead: LeadRowSubset = { home_sqft: null };
    const hit = makeHit({ home_sqft: 1500 });
    const { patch, realFieldsChanged } = buildEnrichmentPatch(lead, hit);

    expect(patch.home_sqft).toBe("1500");
    expect(realFieldsChanged).toBe(1);
  });

  it("home_sqft is stringified (not stored as number)", () => {
    const lead: LeadRowSubset = {};
    const hit = makeHit({ home_sqft: 1500 });
    const { patch } = buildEnrichmentPatch(lead, hit);

    expect(patch.home_sqft).toBe("1500");
    expect(typeof patch.home_sqft).toBe("string");
  });
});

describe("buildEnrichmentPatch — last_enriched_at always stamps", () => {
  it("stamps last_enriched_at even when no real fields changed", () => {
    const lead: LeadRowSubset = { phone: "555-0100" };
    const hit = makeHit({ phone: "555-0100" });
    const { patch, realFieldsChanged } = buildEnrichmentPatch(lead, hit, {
      nowIso: "2026-04-28T09:00:00.000Z",
    });

    expect(realFieldsChanged).toBe(0);
    expect(patch.last_enriched_at).toBe("2026-04-28T09:00:00.000Z");
    // Critical: only key in the patch is the timestamp.
    expect(Object.keys(patch)).toEqual(["last_enriched_at"]);
  });

  it("stamps last_enriched_at when real fields also changed", () => {
    const lead: LeadRowSubset = {};
    const hit = makeHit({ phone: "555-0100" });
    const { patch, realFieldsChanged } = buildEnrichmentPatch(lead, hit, {
      nowIso: "2026-04-28T09:00:00.000Z",
    });

    expect(realFieldsChanged).toBe(1);
    expect(patch.phone).toBe("555-0100");
    expect(patch.last_enriched_at).toBe("2026-04-28T09:00:00.000Z");
  });

  it("Object.keys(patch).length > 1 is NOT a valid 'enriched' check (B7)", () => {
    // The B7 fix called this out: the prior `Object.keys(patch).length > 1`
    // would always be true (because of the trailing last_enriched_at) and
    // therefore "enriched" would tick up on every run, even no-ops. The
    // contract is now `realFieldsChanged > 0` as the only acceptable gate.
    const lead: LeadRowSubset = { phone: "555-0100" };
    const hit = makeHit({ phone: "555-0100" });
    const { patch, realFieldsChanged } = buildEnrichmentPatch(lead, hit);

    expect(Object.keys(patch).length).toBeGreaterThanOrEqual(1); // last_enriched_at
    expect(realFieldsChanged).toBe(0); // but no real changes
    // The caller MUST gate on realFieldsChanged, not Object.keys.length.
  });
});

describe("buildEnrichmentPatch — typed value short-circuits", () => {
  it("year_built numeric equality short-circuits", () => {
    const lead: LeadRowSubset = { year_built: 1985 };
    const hit = makeHit({ year_built: 1985 });
    const { patch, realFieldsChanged } = buildEnrichmentPatch(lead, hit);

    expect(patch.year_built).toBeUndefined();
    expect(realFieldsChanged).toBe(0);
  });

  it("year_built differs → writes new value", () => {
    const lead: LeadRowSubset = { year_built: 1985 };
    const hit = makeHit({ year_built: 1990 });
    const { patch, realFieldsChanged } = buildEnrichmentPatch(lead, hit);

    expect(patch.year_built).toBe(1990);
    expect(realFieldsChanged).toBe(1);
  });

  it("owner_occupied boolean equality short-circuits", () => {
    const lead: LeadRowSubset = { owner_occupied: true };
    const hit = makeHit({ owner_occupied: true });
    const { patch, realFieldsChanged } = buildEnrichmentPatch(lead, hit);

    expect(patch.owner_occupied).toBeUndefined();
    expect(realFieldsChanged).toBe(0);
  });

  it("owner_occupied false → true is a real change", () => {
    const lead: LeadRowSubset = { owner_occupied: false };
    const hit = makeHit({ owner_occupied: true });
    const { patch, realFieldsChanged } = buildEnrichmentPatch(lead, hit);

    expect(patch.owner_occupied).toBe(true);
    expect(realFieldsChanged).toBe(1);
  });

  it("assessed_value numeric equality short-circuits", () => {
    const lead: LeadRowSubset = { assessed_value: 425000 };
    const hit = makeHit({ assessed_value: 425000 });
    const { patch, realFieldsChanged } = buildEnrichmentPatch(lead, hit);

    expect(patch.assessed_value).toBeUndefined();
    expect(realFieldsChanged).toBe(0);
  });
});

describe("buildEnrichmentPatch — WRITE_EXTENDED gate", () => {
  it("does NOT include employer/occupation when writeExtended is false", () => {
    const lead: LeadRowSubset = {};
    const hit = makeHit({ employer: "Acme Corp", occupation: "Engineer" });
    const { patch } = buildEnrichmentPatch(lead, hit, { writeExtended: false });

    expect(patch.employer).toBeUndefined();
    expect(patch.occupation).toBeUndefined();
  });

  it("includes employer/occupation when writeExtended is true", () => {
    const lead: LeadRowSubset = {};
    const hit = makeHit({ employer: "Acme Corp", occupation: "Engineer" });
    const { patch, realFieldsChanged } = buildEnrichmentPatch(lead, hit, {
      writeExtended: true,
    });

    expect(patch.employer).toBe("Acme Corp");
    expect(patch.occupation).toBe("Engineer");
    expect(realFieldsChanged).toBe(2);
  });

  it("writeExtended still respects no-op short-circuit", () => {
    const lead: LeadRowSubset = { employer: "Acme Corp" };
    const hit = makeHit({ employer: "Acme Corp", occupation: "Engineer" });
    const { patch, realFieldsChanged } = buildEnrichmentPatch(lead, hit, {
      writeExtended: true,
    });

    expect(patch.employer).toBeUndefined();
    expect(patch.occupation).toBe("Engineer");
    expect(realFieldsChanged).toBe(1);
  });
});

describe("buildEnrichmentPatch — WRITE_PROVENANCE gate", () => {
  it("attaches contact_source ONLY when realFieldsChanged > 0", () => {
    // No real changes → no provenance, even with writeProvenance=true
    const lead: LeadRowSubset = { phone: "555-0100" };
    const hit = makeHit({
      phone: "555-0100", // unchanged
      primary_source: "regrid-parcel",
      confidence: 0.9,
    });
    const { patch, realFieldsChanged } = buildEnrichmentPatch(lead, hit, {
      writeProvenance: true,
      nowIso: "2026-04-28T09:00:00.000Z",
    });

    expect(realFieldsChanged).toBe(0);
    expect(patch.contact_source).toBeUndefined();
    expect(patch.contact_confidence).toBeUndefined();
    expect(patch.contact_extracted_at).toBeUndefined();
  });

  it("attaches contact_source + confidence + extracted_at on real change", () => {
    const lead: LeadRowSubset = { phone: null };
    const hit = makeHit({
      phone: "555-0100",
      primary_source: "regrid-parcel",
      confidence: 0.9,
    });
    const { patch, realFieldsChanged } = buildEnrichmentPatch(lead, hit, {
      writeProvenance: true,
      nowIso: "2026-04-28T09:00:00.000Z",
    });

    expect(realFieldsChanged).toBe(1);
    expect(patch.contact_source).toBe("regrid-parcel");
    expect(patch.contact_confidence).toBe(0.9);
    expect(patch.contact_extracted_at).toBe("2026-04-28T09:00:00.000Z");
  });

  it("does NOT attach provenance without primary_source even with changes", () => {
    const lead: LeadRowSubset = {};
    const hit = makeHit({
      phone: "555-0100",
      primary_source: null, // no source attribution
    });
    const { patch, realFieldsChanged } = buildEnrichmentPatch(lead, hit, {
      writeProvenance: true,
    });

    expect(realFieldsChanged).toBe(1);
    expect(patch.contact_source).toBeUndefined();
  });

  it("writeProvenance off → never attaches provenance", () => {
    const lead: LeadRowSubset = {};
    const hit = makeHit({
      phone: "555-0100",
      primary_source: "regrid-parcel",
      confidence: 0.9,
    });
    const { patch } = buildEnrichmentPatch(lead, hit, {
      writeProvenance: false,
    });

    expect(patch.contact_source).toBeUndefined();
    expect(patch.contact_confidence).toBeUndefined();
    expect(patch.contact_extracted_at).toBeUndefined();
  });
});

describe("buildEnrichmentPatch — composite", () => {
  it("realistic mixed update: 2 changes + 1 unchanged + provenance", () => {
    const lead: LeadRowSubset = {
      owner_name: "Existing Owner",
      phone: null,
      email: null,
      year_built: 1985,
    };
    const hit = makeHit({
      owner_name: "Existing Owner", // unchanged
      phone: "555-0100", // newly added
      email: "owner@example.com", // newly added
      year_built: 1985, // unchanged
      primary_source: "regrid-parcel",
      confidence: 0.85,
    });
    const { patch, realFieldsChanged } = buildEnrichmentPatch(lead, hit, {
      writeProvenance: true,
      nowIso: "2026-04-28T09:00:00.000Z",
    });

    expect(realFieldsChanged).toBe(2);
    expect(patch.phone).toBe("555-0100");
    expect(patch.email).toBe("owner@example.com");
    expect(patch.owner_name).toBeUndefined();
    expect(patch.year_built).toBeUndefined();
    expect(patch.contact_source).toBe("regrid-parcel");
    expect(patch.last_enriched_at).toBe("2026-04-28T09:00:00.000Z");
  });

  it("empty hit on fully-populated lead → only timestamp in patch", () => {
    const lead: LeadRowSubset = {
      owner_name: "Owner",
      phone: "555-0100",
      email: "x@example.com",
      year_built: 1985,
      home_sqft: "1234",
    };
    const hit = makeHit(); // all-null
    const { patch, realFieldsChanged } = buildEnrichmentPatch(lead, hit, {
      nowIso: "2026-04-28T09:00:00.000Z",
    });

    expect(realFieldsChanged).toBe(0);
    expect(Object.keys(patch)).toEqual(["last_enriched_at"]);
  });

  it("greenfield lead + full enrichment hit → all fields land", () => {
    const lead: LeadRowSubset = {}; // entirely empty
    const hit = makeHit({
      owner_name: "Adan Martinez",
      owner_first: "Adan",
      owner_last: "Martinez",
      phone: "555-0100",
      email: "adan@example.com",
      mailing_address: "PO Box 1",
      year_built: 1985,
      home_sqft: 1234,
      lot_sqft: 5000,
      assessed_value: 425000,
      property_value: 500000,
      owner_occupied: true,
    });
    const { patch, realFieldsChanged } = buildEnrichmentPatch(lead, hit);

    // 12 real fields above
    expect(realFieldsChanged).toBe(12);
    expect(patch.owner_name).toBe("Adan Martinez");
    expect(patch.home_sqft).toBe("1234");
    expect(patch.lot_sqft).toBe("5000");
    expect(patch.owner_occupied).toBe(true);
    expect(patch.assessed_value).toBe(425000);
    expect(typeof patch.last_enriched_at).toBe("string");
  });
});
