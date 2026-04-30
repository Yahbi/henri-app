/* ── lead-summary.test.ts ───────────────────────────────────────────────
 *
 *  Tier A+ Sprint 3 — A1 lead summary agent prompt-construction tests.
 *  We test prompt assembly + sanitization. The actual LLM call is tested
 *  in the orchestrator test (mocked).
 * ──────────────────────────────────────────────────────────────────────── */

import { describe, expect, it } from "vitest";
import { buildLeadSummaryPrompt, type LeadSummaryInput } from "../lead-summary";

const baseInput: LeadSummaryInput = {
  contractorId: "contractor-1",
  leadId: "lead-1",
  permitType: "Roofing",
  permitValue: 42000,
  yearBuilt: 1985,
  address: "123 Main St",
  zip: "06112",
  appliedDate: "2026-04-15",
  score: 68,
  cascade: [],
  storm: null,
  anomaly: null,
};

describe("buildLeadSummaryPrompt", () => {
  it("includes basic permit facts", () => {
    const prompt = buildLeadSummaryPrompt(baseInput);
    expect(prompt).toContain("permit_type: Roofing");
    expect(prompt).toContain("permit_value: $42,000");
    expect(prompt).toContain("year_built: 1985");
    expect(prompt).toContain("address: 123 Main St");
    expect(prompt).toContain("zip 06112");
    expect(prompt).toContain("score: 68/100");
  });

  it("wraps content in DATA delimiters", () => {
    const prompt = buildLeadSummaryPrompt(baseInput);
    expect(prompt).toContain("<<<DATA>>>");
    expect(prompt).toContain("<<<END_DATA>>>");
    expect(prompt).toContain("LEAD_FACTS");
  });

  it("emits 'cascade_predictions: none' when no cascade data", () => {
    const prompt = buildLeadSummaryPrompt(baseInput);
    expect(prompt).toContain("cascade_predictions: none");
  });

  it("includes top 3 cascade predictions when present", () => {
    const prompt = buildLeadSummaryPrompt({
      ...baseInput,
      cascade: [
        { predicted_trade: "hvac", prob_90d: 0.5, prob_180d: 0.7, prob_365d: 0.8, sample_size: 100, confidence_label: "medium" },
        { predicted_trade: "plumbing", prob_90d: 0.3, prob_180d: 0.5, prob_365d: 0.6, sample_size: 80, confidence_label: "medium" },
        { predicted_trade: "solar", prob_90d: 0.2, prob_180d: 0.4, prob_365d: 0.5, sample_size: 30, confidence_label: "low" },
        { predicted_trade: "electrical", prob_90d: 0.1, prob_180d: 0.2, prob_365d: 0.3, sample_size: 25, confidence_label: "low" },
      ],
    });
    expect(prompt).toContain("hvac 50%/90d");
    expect(prompt).toContain("plumbing 30%/90d");
    expect(prompt).toContain("solar 20%/90d");
    // 4th prediction NOT included (top 3 only)
    expect(prompt).not.toContain("electrical 10%/90d");
  });

  it("emits 'storm_activity: none' when no storm", () => {
    const prompt = buildLeadSummaryPrompt(baseInput);
    expect(prompt).toContain("storm_activity: none in last 60 days");
  });

  it("includes storm count + repair likelihood when present", () => {
    const prompt = buildLeadSummaryPrompt({
      ...baseInput,
      storm: {
        storm_event_count_60d: 3,
        last_storm_date: "2026-04-25",
        max_magnitude: 2.0,
        primary_event_type: "Hail",
        repair_likelihood_60d: 0.45,
        repair_likelihood_90d: 0.55,
        sample_size: 100,
        confidence_label: "medium",
      },
    });
    expect(prompt).toContain("3 Hail(s)");
    expect(prompt).toContain("repair-likelihood 45%");
  });

  it("includes anomaly info when permit is stuck", () => {
    const prompt = buildLeadSummaryPrompt({
      ...baseInput,
      anomaly: {
        jurisdiction_key: "hartford|ct",
        applied_to_issued_gap_days: 120,
        jurisdiction_p95_gap_days: 50,
        anomaly_score: 2.4,
        is_stuck: true,
      },
    });
    expect(prompt).toContain("permit_anomaly: stuck");
    expect(prompt).toContain("120d gap");
    expect(prompt).toContain("p95 50d");
  });

  it("does NOT include anomaly section when not stuck", () => {
    const prompt = buildLeadSummaryPrompt({
      ...baseInput,
      anomaly: {
        jurisdiction_key: "hartford|ct",
        applied_to_issued_gap_days: 30,
        jurisdiction_p95_gap_days: 50,
        anomaly_score: 0.6,
        is_stuck: false,
      },
    });
    expect(prompt).not.toContain("permit_anomaly:");
  });

  it("emits 'unknown' for null permit fields", () => {
    const prompt = buildLeadSummaryPrompt({
      ...baseInput,
      permitType: null,
      permitValue: null,
      yearBuilt: null,
      address: null,
      zip: null,
      appliedDate: null,
      score: null,
    });
    expect(prompt).toContain("permit_type: unknown");
    expect(prompt).toContain("permit_value: unknown");
    expect(prompt).toContain("year_built: unknown");
    expect(prompt).toContain("score: unknown");
  });
});
