import { describe, it, expect } from "vitest";
import {
  deriveRoofAge,
  deriveHvacAge,
  derivePoolPresence,
  deriveSolarPresence,
  derivePanelAge,
  deriveAll,
  type DerivationContext,
} from "../index";
import type { Lead } from "@/types/lead";
import type { AddressPermitHistory } from "@/lib/predictive/rules";

const thisYear = new Date().getFullYear();

function mkLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "test", permit_id: "p1", contractor_id: "c1",
    score: 50, urgency: "warm", status: "new",
    score_freshness: 10, score_value: 10, score_contact: 5, score_demand: 5,
    address: "123 Test St", zip: "06106",
    year_built: null, trade: null, permit_type: null, permit_description: null,
    ...overrides,
  } as unknown as Lead;
}

function mkHistory(
  permits: { trade?: string; applied_date?: string; description?: string }[],
): AddressPermitHistory {
  return {
    address_norm: "123 test st|06106",
    address: "123 Test St", city: "Hartford", state: "CT", zip: "06106",
    permit_count: permits.length,
    total_value: null,
    first_permit_date: null,
    last_permit_date: null,
    trades: permits.map((p) => p.trade ?? ""),
    permits,
  };
}

describe("deriveRoofAge", () => {
  it("derives from permit history when roof permit present", () => {
    const ctx: DerivationContext = {
      lead: mkLead(),
      history: mkHistory([{ trade: "roofing", applied_date: `${thisYear - 22}-06-01T00:00:00Z` }]),
    };
    const r = deriveRoofAge(ctx);
    expect(r?.years_since).toBe(22);
    expect(r?.derived_from).toBe("permit-history");
    expect(r?.replacement_window).toBe("due");
  });

  it("falls back to year_built when no roof permit", () => {
    const ctx: DerivationContext = {
      lead: mkLead({ year_built: thisYear - 30 }),
      history: null,
    };
    const r = deriveRoofAge(ctx);
    expect(r?.years_since).toBe(30);
    expect(r?.derived_from).toBe("year-built");
    expect(r?.replacement_window).toBe("due");
  });

  it("returns null when no signal at all", () => {
    const ctx: DerivationContext = { lead: mkLead(), history: null };
    expect(deriveRoofAge(ctx)).toBeNull();
  });
});

describe("deriveHvacAge", () => {
  it("derives from history (mechanical/heating/hvac/cooling)", () => {
    const ctx: DerivationContext = {
      lead: mkLead(),
      history: mkHistory([{ trade: "mechanical", applied_date: `${thisYear - 18}-06-01T00:00:00Z` }]),
    };
    const r = deriveHvacAge(ctx);
    expect(r?.years_since).toBe(18);
    expect(r?.replacement_window).toBe("due");
  });

  it("returns null when home too young + no HVAC permit", () => {
    const ctx: DerivationContext = {
      lead: mkLead({ year_built: thisYear - 10 }),
      history: mkHistory([{ trade: "kitchen" }]),
    };
    expect(deriveHvacAge(ctx)).toBeNull();
  });
});

describe("derivePoolPresence", () => {
  it("detects pool from current permit trade", () => {
    const r = derivePoolPresence({
      lead: mkLead({ trade: "pool" }),
      history: null,
    });
    expect(r.present).toBe(true);
    expect(r.source).toBe("current-permit");
  });

  it("detects pool from current permit description", () => {
    const r = derivePoolPresence({
      lead: mkLead({ permit_description: "in-ground pool with paver deck" }),
      history: null,
    });
    expect(r.present).toBe(true);
  });

  it("detects pool from history", () => {
    const r = derivePoolPresence({
      lead: mkLead(),
      history: mkHistory([{ trade: "pool", applied_date: `${thisYear - 5}-06-01T00:00:00Z` }]),
    });
    expect(r.present).toBe(true);
    expect(r.source).toBe("history");
  });

  it("returns false when no signal", () => {
    const r = derivePoolPresence({
      lead: mkLead({ trade: "kitchen", permit_description: "remodel kitchen" }),
      history: null,
    });
    expect(r.present).toBe(false);
  });
});

describe("deriveSolarPresence", () => {
  it("detects from current permit", () => {
    const r = deriveSolarPresence({
      lead: mkLead({ trade: "solar" }),
      history: null,
    });
    expect(r.present).toBe(true);
    expect(r.years_since).toBe(0);
  });

  it("computes years_since from history", () => {
    const r = deriveSolarPresence({
      lead: mkLead(),
      history: mkHistory([{ trade: "solar", applied_date: `${thisYear - 7}-06-01T00:00:00Z` }]),
    });
    expect(r.present).toBe(true);
    expect(r.years_since).toBe(7);
  });
});

describe("derivePanelAge", () => {
  it("recent electrical → modernized", () => {
    const r = derivePanelAge({
      lead: mkLead(),
      history: mkHistory([{ trade: "electrical", applied_date: `${thisYear - 8}-06-01T00:00:00Z` }]),
    });
    expect(r.estimate).toBe("likely-modernized");
  });

  it("old electrical → undersized", () => {
    const r = derivePanelAge({
      lead: mkLead(),
      history: mkHistory([{ trade: "electrical", applied_date: `${thisYear - 20}-06-01T00:00:00Z` }]),
    });
    expect(r.estimate).toBe("likely-undersized");
  });

  it("pre-1980 home with no electrical → undersized", () => {
    const r = derivePanelAge({
      lead: mkLead({ year_built: 1965 }),
      history: null,
    });
    expect(r.estimate).toBe("likely-undersized");
  });

  it("modern home no signal → unknown", () => {
    const r = derivePanelAge({
      lead: mkLead({ year_built: 2010 }),
      history: null,
    });
    expect(r.estimate).toBe("unknown");
  });
});

describe("deriveAll", () => {
  it("returns all five derivations", () => {
    const r = deriveAll({
      lead: mkLead({ trade: "pool", year_built: 1955 }),
      history: mkHistory([
        { trade: "roofing", applied_date: `${thisYear - 25}-06-01T00:00:00Z` },
      ]),
    });
    expect(r.roof_age).not.toBeNull();
    expect(r.pool.present).toBe(true);
    expect(r.solar.present).toBe(false);
    expect(r.panel_age.estimate).toBe("likely-undersized");
  });
});
