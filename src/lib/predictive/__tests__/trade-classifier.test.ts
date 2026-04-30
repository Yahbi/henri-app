/* ── trade-classifier.test.ts ───────────────────────────────────────────
 *
 *  Tier A+ Sprint 2 — F2.3 trade classifier tests.
 * ──────────────────────────────────────────────────────────────────────── */

import { describe, expect, it } from "vitest";
import {
  classifyTrade,
  cosineSimilarity,
  isCanonicalTrade,
  tokenize,
} from "../trade-classifier";

describe("tokenize", () => {
  it("returns empty array on empty/null input", () => {
    expect(tokenize("")).toEqual([]);
  });
  it("lowercases and splits on non-word chars", () => {
    expect(tokenize("Roof Replacement!")).toEqual(["roof", "replacement"]);
  });
  it("filters out tokens shorter than 2 chars", () => {
    expect(tokenize("a b cd ef")).toEqual(["cd", "ef"]);
  });
});

describe("cosineSimilarity", () => {
  it("returns 0 on empty input", () => {
    expect(cosineSimilarity([], ["a", "b"])).toBe(0);
    expect(cosineSimilarity(["a"], [])).toBe(0);
  });
  it("returns 0 when no overlap", () => {
    expect(cosineSimilarity(["foo", "bar"], ["baz", "qux"])).toBe(0);
  });
  it("returns positive when overlap exists", () => {
    const sim = cosineSimilarity(["roof", "shingle"], ["roof", "gutter"]);
    expect(sim).toBeGreaterThan(0);
  });
  it("returns higher score on more overlap", () => {
    const some = cosineSimilarity(["roof"], ["roof", "shingle", "gutter"]);
    const more = cosineSimilarity(["roof", "shingle"], ["roof", "shingle", "gutter"]);
    expect(more).toBeGreaterThan(some);
  });
});

describe("classifyTrade — regex pass (high confidence)", () => {
  it("classifies roofing", () => {
    const result = classifyTrade("Roof Replacement", null);
    expect(result.trade).toBe("roofing");
    expect(result.method).toBe("regex");
    expect(result.confidence).toBe(0.9);
  });
  it("classifies plumbing (water heater takes priority over hvac heat)", () => {
    expect(classifyTrade("Water Heater Install", null).trade).toBe("plumbing");
    expect(classifyTrade("Plumbing Service", null).trade).toBe("plumbing");
  });
  it("classifies hvac", () => {
    expect(classifyTrade("HVAC Install", null).trade).toBe("hvac");
    expect(classifyTrade("Furnace Repair", null).trade).toBe("hvac");
    expect(classifyTrade("Heat Pump Replacement", null).trade).toBe("hvac");
  });
  it("classifies electrical", () => {
    expect(classifyTrade("Electric Panel Upgrade", null).trade).toBe("electrical");
    expect(classifyTrade("New Wiring Throughout", null).trade).toBe("electrical");
  });
  it("classifies solar", () => {
    expect(classifyTrade("Solar PV Install 8kW", null).trade).toBe("solar");
    expect(classifyTrade("Photovoltaic System", null).trade).toBe("solar");
  });
  it("classifies adu", () => {
    expect(classifyTrade("ADU Conversion", null).trade).toBe("adu");
    expect(classifyTrade("Accessory Dwelling Unit", null).trade).toBe("adu");
  });
  it("classifies general remodel", () => {
    expect(classifyTrade("Kitchen Remodel", null).trade).toBe("general remodel");
    expect(classifyTrade("Bath Renovation", null).trade).toBe("general remodel");
    expect(classifyTrade("Tenant Improvement", null).trade).toBe("general remodel");
  });
  it("uses description text as well", () => {
    const result = classifyTrade("Other", "Roof shingle replacement at 123 Main St");
    expect(result.trade).toBe("roofing");
  });
});

describe("classifyTrade — cosine fallback", () => {
  it("classifies via keyword bag when regex misses", () => {
    // None of these tokens are in the regex (fascia/gutter/roof/shingle excluded);
    // but cosine should match the roofing keyword bag (underlayment, ridge, soffit, valley).
    const result = classifyTrade("OTHER", "underlayment ridge soffit valley");
    expect(result.method).toBe("cosine");
    expect(result.trade).toBe("roofing");
    expect(result.confidence).toBeGreaterThan(0);
  });
  it("returns 'general remodel' fallback when no method works", () => {
    const result = classifyTrade("xyz", "qwerty asdfgh");
    expect(result.method).toBe("none");
    expect(result.trade).toBe("general remodel");
    expect(result.confidence).toBe(0);
  });
});

describe("classifyTrade — empty/null inputs", () => {
  it("returns the no-classification fallback on empty", () => {
    const result = classifyTrade(null, null);
    expect(result.method).toBe("none");
    expect(result.confidence).toBe(0);
  });
  it("returns the no-classification fallback on whitespace", () => {
    const result = classifyTrade("   ", "   ");
    expect(result.method).toBe("none");
  });
});

describe("isCanonicalTrade", () => {
  it("accepts the 7 canonical trades", () => {
    expect(isCanonicalTrade("roofing")).toBe(true);
    expect(isCanonicalTrade("hvac")).toBe(true);
    expect(isCanonicalTrade("plumbing")).toBe(true);
    expect(isCanonicalTrade("electrical")).toBe(true);
    expect(isCanonicalTrade("solar")).toBe(true);
    expect(isCanonicalTrade("adu")).toBe(true);
    expect(isCanonicalTrade("general remodel")).toBe(true);
  });
  it("rejects others", () => {
    expect(isCanonicalTrade("other")).toBe(false);
    expect(isCanonicalTrade("residential")).toBe(false);
    expect(isCanonicalTrade("")).toBe(false);
  });
});
