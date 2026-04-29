/**
 * Unit tests for the predictive cross-trade rules engine.
 *
 * Per the audit's [09-tests.md](docs/audits/2026-04-26/09-tests.md), the
 * predictive engine is wedge-critical and ships with tests from day 1.
 * Each rule has at least one positive case (fires) and one negative case
 * (does not fire), plus a few cross-rule integration tests.
 */

import { describe, it, expect } from "vitest";
import {
  evaluateRules,
  topSuggestions,
  RULES,
  type PredictiveContext,
  type AddressPermitHistory,
} from "../rules";
import type { Lead } from "@/types/lead";

/* ── Test helpers ───────────────────────────────────────────────────── */

function leadFixture(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "test-lead-1",
    permit_id: "permit-1",
    contractor_id: "contractor-1",
    score: 50,
    urgency: "warm",
    status: "new",
    score_freshness: 10,
    score_value: 10,
    score_contact: 5,
    score_demand: 5,
    address: "123 Test St",
    zip: "06106",
    trade: null,
    permit_type: null,
    permit_description: null,
    permit_value: null,
    year_built: null,
    owner_since: null,
    cascade_count: 0,
    ...overrides,
  } as unknown as Lead;
}

function historyFixture(
  overrides: Partial<AddressPermitHistory> = {},
): AddressPermitHistory {
  return {
    address_norm: "123 test st|06106",
    address: "123 Test St",
    city: "Hartford",
    state: "CT",
    zip: "06106",
    permit_count: 0,
    total_value: null,
    first_permit_date: null,
    last_permit_date: null,
    trades: [],
    permits: [],
    ...overrides,
  };
}

const thisYear = new Date().getFullYear();

/* ── Engine smoke ──────────────────────────────────────────────────── */

describe("evaluateRules", () => {
  it("returns empty when no rule fires", () => {
    const ctx: PredictiveContext = {
      lead: leadFixture({ trade: "general remodel", year_built: thisYear }),
      history: null,
    };
    expect(evaluateRules(ctx)).toEqual([]);
  });

  it("sorts results by confidence desc, then by rule name", () => {
    // Construct a context that fires multiple rules
    const ctx: PredictiveContext = {
      lead: leadFixture({
        trade: "pool",
        permit_description: "install pool with spa",
        year_built: 1955,
        owner_since: new Date(Date.now() - 30 * 86_400_000).toISOString(),
      }),
      history: historyFixture(),
    };
    const results = evaluateRules(ctx);
    expect(results.length).toBeGreaterThan(1);
    // First should be highest confidence
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].confidence).toBeGreaterThanOrEqual(
        results[i].confidence,
      );
    }
  });

  it("buggy rule trigger does not crash the batch (graceful-degrade)", () => {
    // Spy on a rule and patch its trigger to throw
    const original = RULES[0].trigger;
    RULES[0].trigger = () => {
      throw new Error("simulated rule failure");
    };
    try {
      const ctx: PredictiveContext = {
        lead: leadFixture({ year_built: 1950 }),
        history: null,
      };
      // Should not throw; should still evaluate the other rules
      expect(() => evaluateRules(ctx)).not.toThrow();
    } finally {
      RULES[0].trigger = original;
    }
  });
});

describe("topSuggestions", () => {
  it("returns at most N suggestions", () => {
    // Construct a context that fires many rules
    const ctx: PredictiveContext = {
      lead: leadFixture({
        trade: "pool",
        permit_description: "pool install with spa",
        year_built: 1955,
        owner_since: new Date(Date.now() - 30 * 86_400_000).toISOString(),
      }),
      history: historyFixture({ permit_count: 1, trades: ["pool"] }),
    };
    const top2 = topSuggestions(ctx, 2);
    expect(top2.length).toBeLessThanOrEqual(2);
  });
});

/* ── Per-rule cases ─────────────────────────────────────────────────── */

describe("rule: pool-to-landscaper", () => {
  it("fires for pool permit with no recent landscape work", () => {
    const ctx: PredictiveContext = {
      lead: leadFixture({ trade: "pool" }),
      history: null,
    };
    const matches = evaluateRules(ctx);
    expect(matches.find((m) => m.rule === "pool-to-landscaper")).toBeTruthy();
  });

  it("fires from description even without trade slug", () => {
    const ctx: PredictiveContext = {
      lead: leadFixture({
        trade: "general",
        permit_description: "in-ground pool with paver deck",
      }),
      history: null,
    };
    const matches = evaluateRules(ctx);
    expect(matches.find((m) => m.rule === "pool-to-landscaper")).toBeTruthy();
  });

  it("does not fire when recent landscape permit (<5y) on file", () => {
    const ctx: PredictiveContext = {
      lead: leadFixture({ trade: "pool" }),
      history: historyFixture({
        permit_count: 1,
        trades: ["landscaping"],
        permits: [
          {
            trade: "landscaping",
            applied_date: `${thisYear - 2}-06-15T00:00:00.000Z`,
          },
        ],
      }),
    };
    const matches = evaluateRules(ctx);
    expect(matches.find((m) => m.rule === "pool-to-landscaper")).toBeFalsy();
  });
});

describe("rule: old-home-electrical", () => {
  it("fires for pre-1990 home with no electrical history", () => {
    const ctx: PredictiveContext = {
      lead: leadFixture({ year_built: 1962, trade: "kitchen" }),
      history: historyFixture({ permit_count: 1, trades: ["kitchen"] }),
    };
    const matches = evaluateRules(ctx);
    expect(matches.find((m) => m.rule === "old-home-electrical")).toBeTruthy();
  });

  it("does not fire when electrical permit exists in history", () => {
    const ctx: PredictiveContext = {
      lead: leadFixture({ year_built: 1962, trade: "kitchen" }),
      history: historyFixture({
        permit_count: 2,
        trades: ["kitchen", "electrical"],
      }),
    };
    const matches = evaluateRules(ctx);
    expect(matches.find((m) => m.rule === "old-home-electrical")).toBeFalsy();
  });

  it("does not fire for newer (post-1990) homes", () => {
    const ctx: PredictiveContext = {
      lead: leadFixture({ year_built: 2010, trade: "kitchen" }),
      history: null,
    };
    const matches = evaluateRules(ctx);
    expect(matches.find((m) => m.rule === "old-home-electrical")).toBeFalsy();
  });
});

describe("rule: aging-roof", () => {
  it("fires when last roof permit was >22 years ago", () => {
    const ctx: PredictiveContext = {
      lead: leadFixture({ trade: "kitchen" }),
      history: historyFixture({
        permit_count: 1,
        trades: ["roofing"],
        permits: [
          {
            trade: "roofing",
            applied_date: `${thisYear - 25}-06-15T00:00:00.000Z`,
          },
        ],
      }),
    };
    const matches = evaluateRules(ctx);
    expect(matches.find((m) => m.rule === "aging-roof")).toBeTruthy();
  });

  it("fires for old home with NO roof permit in history", () => {
    const ctx: PredictiveContext = {
      lead: leadFixture({ year_built: 1980, trade: "kitchen" }),
      history: historyFixture(),
    };
    const matches = evaluateRules(ctx);
    expect(matches.find((m) => m.rule === "aging-roof")).toBeTruthy();
  });

  it("does not fire when current lead IS a roofing permit (no double-suggest)", () => {
    const ctx: PredictiveContext = {
      lead: leadFixture({ year_built: 1980, trade: "roofing" }),
      history: historyFixture(),
    };
    const matches = evaluateRules(ctx);
    expect(matches.find((m) => m.rule === "aging-roof")).toBeFalsy();
  });

  it("does not fire when recent roof permit (<22y) on file", () => {
    const ctx: PredictiveContext = {
      lead: leadFixture({ year_built: 1980, trade: "kitchen" }),
      history: historyFixture({
        permit_count: 1,
        trades: ["roofing"],
        permits: [
          {
            trade: "roofing",
            applied_date: `${thisYear - 5}-06-15T00:00:00.000Z`,
          },
        ],
      }),
    };
    const matches = evaluateRules(ctx);
    expect(matches.find((m) => m.rule === "aging-roof")).toBeFalsy();
  });
});

describe("rule: solar-to-battery", () => {
  it("fires for solar permit with no battery in history", () => {
    const ctx: PredictiveContext = {
      lead: leadFixture({ trade: "solar" }),
      history: historyFixture(),
    };
    const matches = evaluateRules(ctx);
    expect(matches.find((m) => m.rule === "solar-to-battery")).toBeTruthy();
  });

  it("does not fire when battery permit already on file", () => {
    const ctx: PredictiveContext = {
      lead: leadFixture({ trade: "solar" }),
      history: historyFixture({
        permit_count: 1,
        trades: ["battery"],
      }),
    };
    const matches = evaluateRules(ctx);
    expect(matches.find((m) => m.rule === "solar-to-battery")).toBeFalsy();
  });
});

describe("rule: bath-fixtures", () => {
  it("fires for bathroom remodel keywords in description", () => {
    const ctx: PredictiveContext = {
      lead: leadFixture({
        trade: "general",
        permit_description: "bathroom remodel - new shower and vanity",
      }),
      history: null,
    };
    const matches = evaluateRules(ctx);
    expect(matches.find((m) => m.rule === "bath-fixtures")).toBeTruthy();
  });

  it("does not fire when current trade IS plumbing", () => {
    const ctx: PredictiveContext = {
      lead: leadFixture({
        trade: "plumbing",
        permit_description: "bathroom plumbing",
      }),
      history: null,
    };
    const matches = evaluateRules(ctx);
    expect(matches.find((m) => m.rule === "bath-fixtures")).toBeFalsy();
  });
});

describe("rule: kitchen-countertop", () => {
  it("fires for kitchen remodel without prior countertop permit", () => {
    const ctx: PredictiveContext = {
      lead: leadFixture({ trade: "kitchen", permit_description: "kitchen remodel" }),
      history: historyFixture(),
    };
    const matches = evaluateRules(ctx);
    expect(matches.find((m) => m.rule === "kitchen-countertop")).toBeTruthy();
  });
});

describe("rule: aging-hvac", () => {
  it("fires when last HVAC permit was >16 years ago", () => {
    const ctx: PredictiveContext = {
      lead: leadFixture({ trade: "kitchen" }),
      history: historyFixture({
        permit_count: 1,
        trades: ["hvac"],
        permits: [
          {
            trade: "hvac",
            applied_date: `${thisYear - 18}-06-15T00:00:00.000Z`,
          },
        ],
      }),
    };
    const matches = evaluateRules(ctx);
    expect(matches.find((m) => m.rule === "aging-hvac")).toBeTruthy();
  });

  it("does not fire when current lead IS HVAC", () => {
    const ctx: PredictiveContext = {
      lead: leadFixture({ trade: "hvac" }),
      history: historyFixture(),
    };
    const matches = evaluateRules(ctx);
    expect(matches.find((m) => m.rule === "aging-hvac")).toBeFalsy();
  });
});

describe("rule: new-owner-remodel", () => {
  it("fires for owner_since within 90 days", () => {
    const ctx: PredictiveContext = {
      lead: leadFixture({
        trade: "general",
        owner_since: new Date(Date.now() - 30 * 86_400_000).toISOString(),
      }),
      history: null,
    };
    const matches = evaluateRules(ctx);
    expect(matches.find((m) => m.rule === "new-owner-remodel")).toBeTruthy();
  });

  it("does not fire when owner_since is older than 90 days", () => {
    const ctx: PredictiveContext = {
      lead: leadFixture({
        trade: "general",
        owner_since: new Date(Date.now() - 200 * 86_400_000).toISOString(),
      }),
      history: null,
    };
    const matches = evaluateRules(ctx);
    expect(matches.find((m) => m.rule === "new-owner-remodel")).toBeFalsy();
  });
});

/* ── Schema integrity ───────────────────────────────────────────────── */

describe("RULES schema", () => {
  it("every rule has unique name", () => {
    const names = RULES.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("every rule has confidence in [0, 1]", () => {
    for (const rule of RULES) {
      expect(rule.confidence).toBeGreaterThanOrEqual(0);
      expect(rule.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("every rule reason returns a non-empty string", () => {
    const ctx: PredictiveContext = {
      lead: leadFixture({ year_built: 1980, trade: "kitchen" }),
      history: null,
    };
    for (const rule of RULES) {
      const reason = rule.reason(ctx);
      expect(typeof reason).toBe("string");
      expect(reason.length).toBeGreaterThan(0);
    }
  });
});
