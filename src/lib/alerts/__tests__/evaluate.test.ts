/**
 * Module 14 — alert evaluator tests.
 *
 * Covers each of the 4 rule kinds + non-match branches. Pure-function
 * tests; no DB or network. Subject + body strings checked for
 * inclusion of context (address, score) so a future renderer change
 * doesn't silently drop the human-readable signal.
 */

import { describe, it, expect } from "vitest";
import { evaluateRule, evaluateRules } from "../evaluate";
import type { AlertRule, AlertEvaluationLead } from "../types";

const baseLead: AlertEvaluationLead = {
  id: "lead-1",
  contractor_id: "contractor-A",
  score: 80,
  trade: "roofing",
  zip: "06106",
  address: "642 PARK ST, HARTFORD, CT",
  permit_number: "MISC-PLM-25-000078",
  permit_description: "Re-roof + new gutters",
  opportunity_stage: "permit_filed_no_contractor",
};

const baseRule = (overrides: Partial<AlertRule> = {}): AlertRule => ({
  id: "rule-1",
  contractor_id: "contractor-A",
  kind: "high_score",
  criteria: { min_score: 75 },
  enabled: true,
  channel: "email",
  last_fired_at: null,
  fire_count: 0,
  ...overrides,
});

describe("evaluateRule — high_score", () => {
  it("fires when score >= min_score", () => {
    const hit = evaluateRule(baseRule(), baseLead);
    expect(hit).not.toBeNull();
    expect(hit!.subject).toMatch(/80/);
    expect(hit!.body).toMatch(/642 PARK ST/);
  });

  it("does not fire when score below threshold", () => {
    const hit = evaluateRule(baseRule(), { ...baseLead, score: 60 });
    expect(hit).toBeNull();
  });

  it("respects trade allowlist when set", () => {
    const r = baseRule({ criteria: { min_score: 75, trades: ["solar", "hvac"] } });
    expect(evaluateRule(r, baseLead)).toBeNull();
    expect(evaluateRule(r, { ...baseLead, trade: "solar" })).not.toBeNull();
  });

  it("ignores trade allowlist when null/empty", () => {
    const r = baseRule({ criteria: { min_score: 75, trades: null } });
    expect(evaluateRule(r, baseLead)).not.toBeNull();
  });
});

describe("evaluateRule — permit_no_contractor", () => {
  it("fires when stage is permit_filed_no_contractor and zip matches", () => {
    const r = baseRule({ kind: "permit_no_contractor", criteria: { zip: "06106" } });
    expect(evaluateRule(r, baseLead)).not.toBeNull();
  });

  it("does not fire when stage is something else", () => {
    const r = baseRule({ kind: "permit_no_contractor", criteria: { zip: null } });
    expect(
      evaluateRule(r, { ...baseLead, opportunity_stage: "completed" }),
    ).toBeNull();
  });

  it("treats null zip as 'any zip in my territories'", () => {
    const r = baseRule({ kind: "permit_no_contractor", criteria: { zip: null } });
    expect(evaluateRule(r, baseLead)).not.toBeNull();
    expect(evaluateRule(r, { ...baseLead, zip: "94102" })).not.toBeNull();
  });

  it("rejects non-matching zip when set", () => {
    const r = baseRule({ kind: "permit_no_contractor", criteria: { zip: "06108" } });
    expect(evaluateRule(r, baseLead)).toBeNull();
  });
});

describe("evaluateRule — homeowner_match", () => {
  it("fires when is_homeowner_intake is true and trade matches", () => {
    const r = baseRule({
      kind: "homeowner_match",
      criteria: { trades: ["roofing", "adu"] },
    });
    expect(
      evaluateRule(r, { ...baseLead, is_homeowner_intake: true }),
    ).not.toBeNull();
  });

  it("does not fire when is_homeowner_intake is false", () => {
    const r = baseRule({
      kind: "homeowner_match",
      criteria: { trades: ["roofing"] },
    });
    expect(evaluateRule(r, baseLead)).toBeNull();
  });

  it("respects trade allowlist", () => {
    const r = baseRule({
      kind: "homeowner_match",
      criteria: { trades: ["plumbing"] },
    });
    expect(
      evaluateRule(r, { ...baseLead, is_homeowner_intake: true }),
    ).toBeNull();
  });
});

describe("evaluateRule — stage_change", () => {
  it("fires when previous_stage matches `from` and current matches `to`", () => {
    const r = baseRule({
      kind: "stage_change",
      criteria: { from: "active_intent", to: "permit_filed_no_contractor" },
    });
    expect(
      evaluateRule(r, { ...baseLead, previous_stage: "active_intent" }),
    ).not.toBeNull();
  });

  it("does not fire when `to` is null", () => {
    const r = baseRule({
      kind: "stage_change",
      criteria: { from: "active_intent", to: null },
    });
    expect(evaluateRule(r, baseLead)).toBeNull();
  });

  it("ignores `from` when null/empty (any source)", () => {
    const r = baseRule({
      kind: "stage_change",
      criteria: { from: null, to: "permit_filed_no_contractor" },
    });
    expect(evaluateRule(r, baseLead)).not.toBeNull();
  });
});

describe("evaluateRule — gates", () => {
  it("disabled rule never fires", () => {
    const r = baseRule({ enabled: false });
    expect(evaluateRule(r, baseLead)).toBeNull();
  });

  it("rule for a different contractor never fires", () => {
    const r = baseRule({ contractor_id: "contractor-B" });
    expect(evaluateRule(r, baseLead)).toBeNull();
  });
});

describe("evaluateRules — fan-out", () => {
  it("returns one hit per matching (rule, lead) pair", () => {
    const rules: AlertRule[] = [
      baseRule({ id: "r1", criteria: { min_score: 75 } }),
      baseRule({ id: "r2", criteria: { min_score: 90 } }), // misses
    ];
    const leads: AlertEvaluationLead[] = [
      { ...baseLead, id: "L1", score: 80 },
      { ...baseLead, id: "L2", score: 95 },
    ];
    const hits = evaluateRules(rules, leads);
    // r1 matches both leads; r2 matches only L2 (score=95 >= 90).
    expect(hits).toHaveLength(3);
  });
});
