import { describe, it, expect, beforeEach } from "vitest";
import {
  mineDescription,
  mergeSuggestions,
  miningCache,
  type LlmClient,
} from "../llm-mining";
import type { CrossTradeSuggestion } from "../rules";

function mockLlm(response: string): LlmClient {
  return { async complete() { return response; } };
}

function failingLlm(): LlmClient {
  return { async complete() { throw new Error("LLM unavailable"); } };
}

beforeEach(() => {
  // Reset cache between tests by reaching into the private map field.
  // The cast through unknown lets us keep the public API tight without
  // exposing a clear() method just for tests.
  (miningCache as unknown as { map: Map<string, unknown> }).map = new Map();
});

describe("mineDescription", () => {
  it("returns parsed suggestions on valid LLM response", async () => {
    const llm = mockLlm(
      JSON.stringify([
        { trade: "hardscape", reason: "paver patio install", confidence: 0.85 },
        { trade: "landscaping", reason: "pool install with hardscape", confidence: 0.7 },
      ]),
    );
    const r = await mineDescription(
      { description: "install in-ground pool with paver patio", primaryTrade: "pool" },
      llm,
    );
    expect(r).toHaveLength(2);
    expect(r[0].trade).toBe("hardscape");
    expect(r[0].rule).toBe("llm-mining");
  });

  it("filters out same-trade suggestions", async () => {
    const llm = mockLlm(
      JSON.stringify([
        { trade: "pool", reason: "pool install", confidence: 0.9 },
        { trade: "landscaping", reason: "pool surround", confidence: 0.7 },
      ]),
    );
    const r = await mineDescription(
      { description: "pool install with new landscaping", primaryTrade: "pool" },
      llm,
    );
    expect(r.find((s) => s.trade === "pool")).toBeUndefined();
    expect(r.find((s) => s.trade === "landscaping")).toBeTruthy();
  });

  it("filters out non-allowlisted trades", async () => {
    const llm = mockLlm(
      JSON.stringify([
        { trade: "exorcism", reason: "spooky basement", confidence: 0.99 },
        { trade: "tile", reason: "shower tile", confidence: 0.7 },
      ]),
    );
    const r = await mineDescription(
      { description: "bathroom remodel with new tile shower", primaryTrade: "plumbing" },
      llm,
    );
    expect(r.find((s) => s.trade === "exorcism")).toBeUndefined();
    expect(r.find((s) => s.trade === "tile")).toBeTruthy();
  });

  it("filters low-confidence suggestions (<0.5)", async () => {
    const llm = mockLlm(
      JSON.stringify([
        { trade: "tile", reason: "speculative", confidence: 0.3 },
        { trade: "landscaping", reason: "more confident", confidence: 0.8 },
      ]),
    );
    const r = await mineDescription(
      { description: "kitchen remodel work", primaryTrade: "kitchen" },
      llm,
    );
    expect(r).toHaveLength(1);
    expect(r[0].trade).toBe("landscaping");
  });

  it("returns empty on malformed JSON", async () => {
    const llm = mockLlm("not valid json {{{");
    const r = await mineDescription(
      { description: "valid description here", primaryTrade: "general" },
      llm,
    );
    expect(r).toEqual([]);
  });

  it("returns empty on LLM error (graceful-degrade)", async () => {
    const llm = failingLlm();
    const r = await mineDescription(
      { description: "valid description here", primaryTrade: "general" },
      llm,
    );
    expect(r).toEqual([]);
  });

  it("returns empty for ultra-short descriptions", async () => {
    const llm = mockLlm(JSON.stringify([{ trade: "tile", reason: "x", confidence: 0.9 }]));
    const r = await mineDescription({ description: "repair", primaryTrade: "general" }, llm);
    expect(r).toEqual([]);
  });

  it("strips markdown fences from LLM output", async () => {
    const llm = mockLlm("```json\n[{\"trade\":\"tile\",\"reason\":\"shower tile\",\"confidence\":0.8}]\n```");
    const r = await mineDescription(
      { description: "bathroom remodel with shower tile install", primaryTrade: "plumbing" },
      llm,
    );
    expect(r).toHaveLength(1);
    expect(r[0].trade).toBe("tile");
  });

  it("caches results by description hash", async () => {
    let calls = 0;
    const llm: LlmClient = {
      async complete() {
        calls++;
        return JSON.stringify([{ trade: "tile", reason: "shower tile", confidence: 0.8 }]);
      },
    };
    const input = {
      description: "bathroom remodel with shower tile install",
      primaryTrade: "plumbing",
    };
    await mineDescription(input, llm);
    await mineDescription(input, llm);
    await mineDescription(input, llm);
    expect(calls).toBe(1); // cached after first call
  });

  it("caps suggestions at 3", async () => {
    const llm = mockLlm(
      JSON.stringify([
        { trade: "tile", reason: "x1", confidence: 0.9 },
        { trade: "countertops", reason: "x2", confidence: 0.85 },
        { trade: "flooring", reason: "x3", confidence: 0.8 },
        { trade: "painting", reason: "x4", confidence: 0.75 },
        { trade: "framing", reason: "x5", confidence: 0.7 },
      ]),
    );
    const r = await mineDescription(
      { description: "kitchen remodel with everything", primaryTrade: "general" },
      llm,
    );
    expect(r.length).toBeLessThanOrEqual(3);
  });

  it("rejects suspiciously long reason strings (defense-in-depth)", async () => {
    const longReason = "x".repeat(500);
    const llm = mockLlm(
      JSON.stringify([{ trade: "tile", reason: longReason, confidence: 0.9 }]),
    );
    const r = await mineDescription(
      { description: "bathroom remodel work scope", primaryTrade: "plumbing" },
      llm,
    );
    expect(r).toEqual([]);
  });
});

describe("mergeSuggestions", () => {
  const det: CrossTradeSuggestion[] = [
    { trade: "landscaping", rule: "pool-to-landscaper", confidence: 0.75, reason: "pool", generated_at: "x" },
  ];

  it("preserves deterministic, adds non-conflicting LLM", () => {
    const llm: CrossTradeSuggestion[] = [
      { trade: "hardscape", rule: "llm-mining", confidence: 0.85, reason: "paver", generated_at: "x" },
    ];
    const r = mergeSuggestions(det, llm);
    expect(r).toHaveLength(2);
  });

  it("deterministic wins on trade conflict", () => {
    const llm: CrossTradeSuggestion[] = [
      { trade: "landscaping", rule: "llm-mining", confidence: 0.95, reason: "different reason", generated_at: "x" },
    ];
    const r = mergeSuggestions(det, llm);
    expect(r).toHaveLength(1);
    expect(r[0].rule).toBe("pool-to-landscaper"); // deterministic wins
  });

  it("sorts by confidence desc", () => {
    const llm: CrossTradeSuggestion[] = [
      { trade: "hardscape", rule: "llm-mining", confidence: 0.9, reason: "p", generated_at: "x" },
    ];
    const r = mergeSuggestions(det, llm);
    expect(r[0].confidence).toBeGreaterThan(r[1].confidence);
  });
});
