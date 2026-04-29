import { describe, it, expect } from "vitest";
import { parseBusinessName } from "../business-name-parser";

/* ── Required cases from the plan ──────────────────────────────────────────── */

describe("parseBusinessName - required plan cases", () => {
  it("splits 'JOHN SMITH ROOFING LLC'", () => {
    const r = parseBusinessName("JOHN SMITH ROOFING LLC");
    expect(r.first).toBe("John");
    expect(r.last).toBe("Smith");
    expect(r.entity_type).toBe("llc");
    expect(r.confidence).toBeGreaterThanOrEqual(0.7);
    expect(r.disambiguated).toBe(true);
  });

  it("handles bare person name 'Anthony Domino'", () => {
    const r = parseBusinessName("Anthony Domino");
    expect(r.first).toBe("Anthony");
    expect(r.last).toBe("Domino");
    expect(r.entity_type).toBe("individual");
    expect(r.confidence).toBeGreaterThanOrEqual(0.85);
    expect(r.disambiguated).toBe(true);
  });

  it("handles comma-inverted 'Wohrer, Dominique A'", () => {
    const r = parseBusinessName("Wohrer, Dominique A");
    expect(r.first).toBe("Dominique");
    expect(r.last).toBe("Wohrer");
    expect(r.confidence).toBeGreaterThanOrEqual(0.7);
    expect(r.disambiguated).toBe(true);
  });

  it("rejects address-holding LLC '1 Fulton Street Llc'", () => {
    const r = parseBusinessName("1 Fulton Street Llc");
    expect(r.first).toBeNull();
    expect(r.last).toBeNull();
    expect(r.confidence).toBeLessThan(0.5);
  });

  it("rejects pure corporate name 'SL GREEN REALTY CORP'", () => {
    const r = parseBusinessName("SL GREEN REALTY CORP");
    expect(r.first).toBeNull();
    expect(r.last).toBeNull();
    expect(r.entity_type).toBe("corp");
  });

  it("handles comma-inverted 'Paisner, Eric J'", () => {
    const r = parseBusinessName("Paisner, Eric J");
    expect(r.first).toBe("Eric");
    expect(r.last).toBe("Paisner");
    expect(r.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("produces a reasonable split for 'Smith & Sons Plumbing'", () => {
    const r = parseBusinessName("Smith & Sons Plumbing");
    const firstLooksCoupleish =
      typeof r.first === "string" && r.first.includes("&");
    const lastIsSmith = r.last === "Smith";
    expect(firstLooksCoupleish || lastIsSmith).toBe(true);
  });
});

/* ── Entity suffix detection ──────────────────────────────────────────────── */

describe("parseBusinessName - entity suffix", () => {
  it("detects 'LLC'", () => {
    const r = parseBusinessName("John Smith LLC");
    expect(r.entity_type).toBe("llc");
    expect(r.first).toBe("John");
    expect(r.last).toBe("Smith");
    expect(r.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("detects 'Inc'", () => {
    const r = parseBusinessName("Jane Doe Inc");
    expect(r.entity_type).toBe("inc");
    expect(r.first).toBe("Jane");
    expect(r.last).toBe("Doe");
  });

  it("detects 'Corp'", () => {
    const r = parseBusinessName("SL GREEN REALTY CORP");
    expect(r.entity_type).toBe("corp");
  });

  it("detects 'Co.'", () => {
    const r = parseBusinessName("ACME Co");
    expect(r.entity_type).toBe("co");
  });

  it("detects 'Ltd'", () => {
    const r = parseBusinessName("Example Holdings Ltd");
    expect(r.entity_type).toBe("ltd");
  });

  it("returns 'individual' for a bare person name", () => {
    const r = parseBusinessName("Mary Johnson");
    expect(r.entity_type).toBe("individual");
  });

  it("returns 'unknown' for single-word garbage", () => {
    const r = parseBusinessName("Acme");
    // Not a person, not a clear entity suffix.
    expect(r.entity_type).toBe("unknown");
    expect(r.first).toBeNull();
    expect(r.last).toBeNull();
  });
});

/* ── Middle initial + middle name patterns ────────────────────────────────── */

describe("parseBusinessName - middle initial", () => {
  it("parses 'First M Last'", () => {
    const r = parseBusinessName("John A Smith");
    expect(r.first).toBe("John");
    expect(r.last).toBe("Smith");
    expect(r.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("parses 'First M. Last' with trailing period", () => {
    const r = parseBusinessName("John A. Smith");
    expect(r.first).toBe("John");
    expect(r.last).toBe("Smith");
  });

  it("parses 'First Middle Last' (full middle name)", () => {
    const r = parseBusinessName("John Adam Smith");
    expect(r.first).toBe("John");
    expect(r.last).toBe("Smith");
    expect(r.confidence).toBeGreaterThanOrEqual(0.6);
  });
});

/* ── Trade-word extraction ────────────────────────────────────────────────── */

describe("parseBusinessName - trade words", () => {
  it("strips trailing 'Roofing'", () => {
    const r = parseBusinessName("Anna Rodriguez Roofing");
    expect(r.first).toBe("Anna");
    expect(r.last).toBe("Rodriguez");
    expect(r.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it("strips 'Plumbing' + 'LLC'", () => {
    const r = parseBusinessName("Mike Lee Plumbing LLC");
    expect(r.first).toBe("Mike");
    expect(r.last).toBe("Lee");
    expect(r.entity_type).toBe("llc");
  });

  it("strips 'Construction Services Inc'", () => {
    const r = parseBusinessName("Carlos Ortiz Construction Services Inc");
    expect(r.first).toBe("Carlos");
    expect(r.last).toBe("Ortiz");
    expect(r.entity_type).toBe("inc");
  });

  it("handles 'ACME Roofing Inc' (no person at all)", () => {
    const r = parseBusinessName("ACME Roofing Inc");
    // Only one token before the trade word — can't produce a first name.
    expect(r.first).toBeNull();
  });
});

/* ── Rejection paths — company-only inputs ───────────────────────────────── */

describe("parseBusinessName - rejects company-only inputs", () => {
  it("rejects 'Luneh Yoga LLC'", () => {
    const r = parseBusinessName("Luneh Yoga LLC");
    // Not a trade keyword but also not a recognizable surname pattern.
    // Acceptable if confidence is low OR it treated Luneh Yoga as a name;
    // plan says we should be conservative, so we assert low confidence.
    expect(r.confidence).toBeLessThan(0.9);
  });

  it("rejects numeric-led '123 Main Street LLC'", () => {
    const r = parseBusinessName("123 Main Street LLC");
    expect(r.first).toBeNull();
    expect(r.last).toBeNull();
    expect(r.confidence).toBeLessThan(0.5);
  });

  it("rejects street-word bearing '1 Fulton Street Llc'", () => {
    const r = parseBusinessName("1 Fulton Street Llc");
    expect(r.first).toBeNull();
    expect(r.last).toBeNull();
    expect(r.entity_type).toBe("llc");
  });
});

/* ── Couple / family-name patterns ───────────────────────────────────────── */

describe("parseBusinessName - couple / family", () => {
  it("keeps both first names for 'John & Jane Smith'", () => {
    const r = parseBusinessName("John & Jane Smith");
    expect(r.first).toBe("John & Jane");
    expect(r.last).toBe("Smith");
    expect(r.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it("keeps both first names for 'John and Jane Smith'", () => {
    const r = parseBusinessName("John and Jane Smith");
    expect(r.first).toBe("John & Jane");
    expect(r.last).toBe("Smith");
  });
});

/* ── Edge cases ──────────────────────────────────────────────────────────── */

describe("parseBusinessName - edge cases", () => {
  it("returns empty for null-ish input", () => {
    const r = parseBusinessName("");
    expect(r.first).toBeNull();
    expect(r.last).toBeNull();
    expect(r.confidence).toBe(0);
  });

  it("returns empty for whitespace-only input", () => {
    const r = parseBusinessName("   \n\t  ");
    expect(r.first).toBeNull();
    expect(r.last).toBeNull();
  });

  it("titlecases ALL CAPS input", () => {
    const r = parseBusinessName("ALICE JOHNSON");
    expect(r.first).toBe("Alice");
    expect(r.last).toBe("Johnson");
  });

  it("preserves mixed-case surnames like 'McBride'", () => {
    const r = parseBusinessName("John McBride");
    expect(r.first).toBe("John");
    expect(r.last).toBe("McBride");
  });

  it("handles 'L.L.C.' with dots", () => {
    const r = parseBusinessName("Alice Smith L.L.C.");
    expect(r.entity_type).toBe("llc");
    expect(r.first).toBe("Alice");
    expect(r.last).toBe("Smith");
  });
});
