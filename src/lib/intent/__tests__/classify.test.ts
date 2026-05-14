import { describe, it, expect } from "vitest";
import { classify } from "../classify";
import type { ClassifyInput } from "../types";

/**
 * Unit tests for the intent classifier.
 *
 * Every test is a frozen fixture meant to lock in expected behavior for
 * one (input shape × stage) pair. When the classifier is extended in
 * Modules 3/4/5, new tests are appended here, never removed.
 */

const empty: ClassifyInput = {};

describe("classify — stage selection", () => {
  it("returns null stage on an empty input", () => {
    expect(classify(empty).stage).toBeNull();
  });

  it("homeowner intake → homeowner_submitted", () => {
    const out = classify({
      is_homeowner_intake: true,
      intake_status: "matched",
      phone: "555-1234",
      email: "homeowner@example.com",
    });
    expect(out.stage).toBe("homeowner_submitted");
    expect(out.reason_codes).toContain("homeowner_submitted_request");
    expect(out.reason_codes).toContain("homeowner_phone_verified");
    expect(out.reason_codes).toContain("homeowner_email_verified");
  });

  it("homeowner intake in draft → active_intent", () => {
    expect(classify({ is_homeowner_intake: true, intake_status: "draft" }).stage)
      .toBe("active_intent");
  });

  it("homeowner intake withdrawn → archived", () => {
    expect(classify({ is_homeowner_intake: true, intake_status: "withdrawn" }).stage)
      .toBe("archived");
  });

  it("permit_status='expired' → expired", () => {
    const out = classify({ permit_status: "expired", permit_age_days: 200 });
    expect(out.stage).toBe("expired");
    expect(out.reason_codes).toContain("permit_expired");
    expect(out.reason_codes).toContain("expediter_opportunity");
  });

  it("permit_status='revoked' → expired", () => {
    expect(classify({ permit_status: "revoked" }).stage).toBe("expired");
  });

  it("submitted >90 days → stalled", () => {
    const out = classify({ permit_status: "submitted", permit_age_days: 100 });
    expect(out.stage).toBe("stalled");
    expect(out.reason_codes).toContain("stalled_permit");
    expect(out.reason_codes).toContain("expediter_opportunity");
  });

  it("submitted within 90d → active_intent", () => {
    expect(classify({ permit_status: "submitted", permit_age_days: 14 }).stage)
      .toBe("active_intent");
  });

  it("final + completed >5y → maintenance_upsell", () => {
    expect(classify({ permit_status: "final", days_since_completion: 365 * 6 }).stage)
      .toBe("maintenance_upsell");
  });

  it("final + completed <5y → completed", () => {
    expect(classify({ permit_status: "final", days_since_completion: 200 }).stage)
      .toBe("completed");
  });

  it("issued + contractor_name → permit_filed_with_contractor", () => {
    const out = classify({
      permit_status: "issued",
      permit_age_days: 5,
      contractor_name: "Acme Roofing",
      permit_value: 30_000,
    });
    expect(out.stage).toBe("permit_filed_with_contractor");
    expect(out.reason_codes).toContain("contractor_listed");
  });

  it("issued + no contractor → permit_filed_no_contractor", () => {
    const out = classify({
      permit_status: "issued",
      permit_age_days: 0,
      permit_value: 25_000,
    });
    expect(out.stage).toBe("permit_filed_no_contractor");
    expect(out.reason_codes).toContain("permit_filed_no_contractor");
    expect(out.reason_codes).toContain("permit_filed_today");
  });

  it("issued + contractor + value≥$50k → adds subcontractor_opportunity", () => {
    const out = classify({
      permit_status: "issued",
      permit_age_days: 7,
      contractor_name: "BuildCo Inc",
      permit_value: 75_000,
    });
    expect(out.reason_codes).toContain("subcontractor_opportunity");
    expect(out.reason_codes).toContain("contractor_listed_high_value");
  });

  it("issued + contractor + value≥$250k → adds supplier_opportunity", () => {
    const out = classify({
      permit_status: "issued",
      permit_age_days: 7,
      contractor_name: "BigBuild",
      permit_value: 500_000,
      permit_type: "new_construction",
    });
    expect(out.reason_codes).toContain("supplier_opportunity");
    expect(out.reason_codes).toContain("large_project");
  });

  it("≥3 pre-intent codes + no permit → pre_intent", () => {
    const out = classify({
      year_built: 1980,           // → old_property
      lot_sqft: 8000,             // → lot_supports_adu
      days_since_sale: 200,       // → recent_home_sale
      permit_status: null,
    });
    expect(out.stage).toBe("pre_intent");
    expect(out.reason_codes.length).toBeGreaterThanOrEqual(3);
  });
});

describe("classify — pre-intent reason codes", () => {
  it("old_property fires when year_built ≥30y old", () => {
    const out = classify({ year_built: 1985 });
    expect(out.reason_codes).toContain("old_property");
  });

  it("old_roof_estimate fires when no roofing in permit_history", () => {
    const out = classify({
      year_built: 1990,
      permit_history: ["solar install 2020", "kitchen remodel 2015"],
    });
    expect(out.reason_codes).toContain("old_roof_estimate");
  });

  it("old_roof_estimate suppressed when roofing IS in permit_history", () => {
    const out = classify({
      year_built: 1990,
      permit_history: ["reroof 2018", "kitchen remodel 2015"],
    });
    expect(out.reason_codes).not.toContain("old_roof_estimate");
  });

  it("lot_supports_adu fires when lot_sqft ≥6000", () => {
    expect(classify({ lot_sqft: 7500 }).reason_codes).toContain("lot_supports_adu");
  });

  it("recent_home_sale fires when days_since_sale ≤365", () => {
    expect(classify({ days_since_sale: 90 }).reason_codes).toContain("recent_home_sale");
  });

  it("absentee_owner fires when owner_occupied=false", () => {
    expect(classify({ owner_occupied: false }).reason_codes).toContain("absentee_owner");
  });

  it("absentee_owner fires when mailing != situs (string compare)", () => {
    const out = classify({
      mailing_address: "123 Main St, Boston MA",
      situs_address: "456 Elm Rd, Boston MA",
    });
    expect(out.reason_codes).toContain("absentee_owner");
  });

  it("investor_owner fires on LLC name pattern", () => {
    expect(classify({ owner_name: "Acme Properties LLC" }).reason_codes)
      .toContain("investor_owner");
  });

  it("high_equity_proxy fires when assessed materially below market", () => {
    const out = classify({ assessed_value: 300_000, property_value: 500_000 });
    expect(out.reason_codes).toContain("high_equity_proxy");
  });

  it("nearby_adu_activity_90d fires at ≥3 ADU permits in ZIP", () => {
    expect(classify({ zip_adu_permits_90d: 4 }).reason_codes)
      .toContain("nearby_adu_activity_90d");
  });

  it("code_violation_open fires when has_open_code_violation=true", () => {
    expect(classify({ has_open_code_violation: true }).reason_codes)
      .toContain("code_violation_open");
  });

  it("nearby_disaster_event fires when has_recent_disaster=true", () => {
    expect(classify({ has_recent_disaster: true }).reason_codes)
      .toContain("nearby_disaster_event");
  });
});

describe("classify — scope codes from description", () => {
  it("kitchen + bath description → kitchen_bath_scope", () => {
    expect(classify({ permit_description: "Kitchen and bath remodel" }).reason_codes)
      .toContain("kitchen_bath_scope");
  });

  it("roof description → roofing_scope", () => {
    expect(classify({ permit_description: "Reroof asphalt shingles" }).reason_codes)
      .toContain("roofing_scope");
  });

  it("multi-trade scope when 3+ trade keywords", () => {
    const out = classify({
      permit_description: "Kitchen remodel including new electrical panel and plumbing",
    });
    expect(out.reason_codes).toContain("multi_trade_scope");
  });
});

describe("classify — maintenance reason codes", () => {
  it("solar without battery on a final permit → completed_solar_no_battery", () => {
    const out = classify({
      permit_status: "final",
      days_since_completion: 365 * 7,
      permit_description: "Rooftop solar panel installation",
    });
    expect(out.reason_codes).toContain("completed_solar_no_battery");
  });

  it("solar with battery on a final permit → no completed_solar_no_battery", () => {
    const out = classify({
      permit_status: "final",
      days_since_completion: 365 * 7,
      permit_description: "Solar with battery storage",
    });
    expect(out.reason_codes).not.toContain("completed_solar_no_battery");
  });

  it("ADU completed + 5y old → completed_adu_needs_landscaping", () => {
    const out = classify({
      permit_status: "final",
      days_since_completion: 365 * 6,
      permit_description: "ADU accessory dwelling unit construction",
    });
    expect(out.reason_codes).toContain("completed_adu_needs_landscaping");
  });
});

describe("classify — trade_tags", () => {
  it("emits adu + general_construction for ADU permit", () => {
    const out = classify({
      permit_description: "Accessory dwelling unit addition",
      permit_type: "addition",
    });
    expect(out.trade_tags).toContain("adu");
    expect(out.trade_tags).toContain("general_construction");
  });

  it("emits roofing + hvac for multi-trade description", () => {
    const out = classify({
      permit_description: "Reroof and replace HVAC system",
    });
    expect(out.trade_tags).toContain("roofing");
    expect(out.trade_tags).toContain("hvac");
  });

  it("returns empty when no description / type", () => {
    expect(classify({}).trade_tags).toEqual([]);
  });
});

describe("classify — reason-code priority ordering", () => {
  it("permit_filed_today appears before pre-intent codes", () => {
    const out = classify({
      permit_status: "issued",
      permit_age_days: 0,
      year_built: 1980,
    });
    const todayIdx = out.reason_codes.indexOf("permit_filed_today");
    const oldIdx = out.reason_codes.indexOf("old_property");
    expect(todayIdx).toBeGreaterThanOrEqual(0);
    expect(oldIdx).toBeGreaterThanOrEqual(0);
    expect(todayIdx).toBeLessThan(oldIdx);
  });

  it("subcontractor_opportunity appears before scope codes", () => {
    const out = classify({
      permit_status: "issued",
      permit_age_days: 5,
      contractor_name: "GC Co",
      permit_value: 100_000,
      permit_description: "Kitchen remodel",
    });
    const subIdx = out.reason_codes.indexOf("subcontractor_opportunity");
    const scopeIdx = out.reason_codes.indexOf("kitchen_bath_scope");
    expect(subIdx).toBeLessThan(scopeIdx);
  });
});

describe("classify — cascade history", () => {
  it("cascade_count ≥2 → cascade_count_high", () => {
    expect(classify({ cascade_count: 3 }).reason_codes).toContain("cascade_count_high");
  });

  it("cascade_count <2 → no code", () => {
    expect(classify({ cascade_count: 1 }).reason_codes).not.toContain("cascade_count_high");
  });
});
