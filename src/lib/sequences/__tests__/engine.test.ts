import { describe, it, expect } from "vitest";
import { interpolate, checkCondition } from "../engine";

/* ── interpolate() ─────────────────────────────────────────────────────── */

describe("interpolate", () => {
  it("replaces single variable", () => {
    expect(interpolate("Hi {name}!", { name: "John" })).toBe("Hi John!");
  });

  it("replaces multiple variables", () => {
    const result = interpolate(
      "Hi {name}, your project at {address} in {city} is ready.",
      { name: "Jane", address: "123 Oak St", city: "Portland" },
    );
    expect(result).toBe(
      "Hi Jane, your project at 123 Oak St in Portland is ready.",
    );
  });

  it("leaves unmatched tokens as-is", () => {
    expect(interpolate("Hi {name}, your {missing} is here.", { name: "Bob" })).toBe(
      "Hi Bob, your {missing} is here.",
    );
  });

  it("handles empty variables map", () => {
    expect(interpolate("Hi {name}!", {})).toBe("Hi {name}!");
  });

  it("handles template with no variables", () => {
    expect(interpolate("No variables here.", { name: "John" })).toBe(
      "No variables here.",
    );
  });

  it("handles empty template string", () => {
    expect(interpolate("", { name: "John" })).toBe("");
  });

  it("replaces repeated occurrences of the same variable", () => {
    expect(interpolate("{name} and {name}", { name: "Jo" })).toBe("Jo and Jo");
  });
});

/* ── checkCondition() ──────────────────────────────────────────────────── */

describe("checkCondition", () => {
  it("returns true for 'always' condition", () => {
    expect(checkCondition("always", { status: "contacted" })).toBe(true);
  });

  it("returns true for undefined condition", () => {
    expect(checkCondition(undefined, { status: "new" })).toBe(true);
  });

  it("returns true for empty string condition", () => {
    expect(checkCondition("", { status: "new" })).toBe(true);
  });

  describe("no_response", () => {
    it("returns true when lead status is 'new'", () => {
      expect(checkCondition("no_response", { status: "new" })).toBe(true);
    });

    it("returns false when lead status is 'contacted'", () => {
      expect(checkCondition("no_response", { status: "contacted" })).toBe(false);
    });

    it("returns false when lead status is 'won'", () => {
      expect(checkCondition("no_response", { status: "won" })).toBe(false);
    });
  });

  describe("no_contact", () => {
    it("returns true when contacted_at is null", () => {
      expect(checkCondition("no_contact", { contacted_at: null })).toBe(true);
    });

    it("returns true when contacted_at is undefined", () => {
      expect(checkCondition("no_contact", {})).toBe(true);
    });

    it("returns false when contacted_at has a value", () => {
      expect(
        checkCondition("no_contact", { contacted_at: "2025-01-01T00:00:00Z" }),
      ).toBe(false);
    });
  });

  it("returns false for unknown conditions (fail-safe)", () => {
    expect(checkCondition("unknown_condition", { status: "new" })).toBe(false);
  });
});
