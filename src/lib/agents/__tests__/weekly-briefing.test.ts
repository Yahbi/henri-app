/* ── weekly-briefing.test.ts ────────────────────────────────────────────
 *
 *  Tier A+ Sprint 3 — A2 weekly briefing prompt-construction tests.
 * ──────────────────────────────────────────────────────────────────────── */

import { describe, expect, it } from "vitest";
import { buildWeeklyBriefingPrompt, type WeeklyBriefingInput } from "../weekly-briefing";

const baseInput: WeeklyBriefingInput = {
  contractorId: "contractor-1",
  newLeadsCount: 14,
  hotLeadsCount: 3,
  stormImpactedZipsCount: 5,
  cascadeHotspotsCount: 2,
  stuckPermitsCount: 1,
  topZips: ["06112", "06095", "06108"],
  topTrades: ["roofing", "hvac"],
};

describe("buildWeeklyBriefingPrompt", () => {
  it("includes the 5 aggregate counts", () => {
    const prompt = buildWeeklyBriefingPrompt(baseInput);
    expect(prompt).toContain("new_leads_last_7d: 14");
    expect(prompt).toContain("hot_leads_last_7d: 3");
    expect(prompt).toContain("storm_impacted_zips_in_territory: 5");
    expect(prompt).toContain("cascade_hotspots: 2");
    expect(prompt).toContain("stuck_permits_in_territory: 1");
  });

  it("includes top zips when present", () => {
    const prompt = buildWeeklyBriefingPrompt(baseInput);
    expect(prompt).toContain("top_zips: 06112, 06095, 06108");
  });

  it("includes top trades when present", () => {
    const prompt = buildWeeklyBriefingPrompt(baseInput);
    expect(prompt).toContain("top_trades: roofing, hvac");
  });

  it("caps top zips at 5 + top trades at 3", () => {
    const prompt = buildWeeklyBriefingPrompt({
      ...baseInput,
      topZips: ["1", "2", "3", "4", "5", "6", "7"],
      topTrades: ["a", "b", "c", "d", "e"],
    });
    expect(prompt).toContain("top_zips: 1, 2, 3, 4, 5");
    expect(prompt).not.toContain("6, 7");
    expect(prompt).toContain("top_trades: a, b, c");
    expect(prompt).not.toContain("d, e");
  });

  it("omits top_zips when empty", () => {
    const prompt = buildWeeklyBriefingPrompt({
      ...baseInput,
      topZips: [],
    });
    expect(prompt).not.toContain("top_zips:");
  });

  it("wraps content in DATA delimiters", () => {
    const prompt = buildWeeklyBriefingPrompt(baseInput);
    expect(prompt).toContain("<<<DATA>>>");
    expect(prompt).toContain("<<<END_DATA>>>");
    expect(prompt).toContain("WEEKLY_AGGREGATES");
  });

  it("handles zero-activity input", () => {
    const prompt = buildWeeklyBriefingPrompt({
      contractorId: "x",
      newLeadsCount: 0,
      hotLeadsCount: 0,
      stormImpactedZipsCount: 0,
      cascadeHotspotsCount: 0,
      stuckPermitsCount: 0,
      topZips: [],
      topTrades: [],
    });
    expect(prompt).toContain("new_leads_last_7d: 0");
    expect(prompt).not.toContain("top_zips");
    expect(prompt).not.toContain("top_trades");
  });
});
