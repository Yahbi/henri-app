/**
 * Unit tests for the DIY-vs-pro permit applicant classifier.
 */

import { describe, it, expect } from "vitest";
import { classifyApplicant } from "../applicant-classifier";

describe("classifyApplicant", () => {
  it("homeowner: applicant_name == owner_name", () => {
    const r = classifyApplicant({
      applicant_name: "Jane Smith",
      owner_name: "Jane Smith",
    });
    expect(r.type).toBe("homeowner");
    expect(r.label).toBe("Homeowner-pulled");
  });

  it("homeowner: case + whitespace differences", () => {
    const r = classifyApplicant({
      applicant_name: "JANE   SMITH",
      owner_name: "Jane Smith",
    });
    expect(r.type).toBe("homeowner");
  });

  it("contractor: contractor_name set and distinct from owner", () => {
    const r = classifyApplicant({
      applicant_name: "Henderson Roofing LLC",
      contractor_name: "Henderson Roofing LLC",
      owner_name: "Jane Smith",
    });
    expect(r.type).toBe("contractor");
    expect(r.label).toBe("Pulled by Henderson Roofing LLC");
    expect(r.contractor_name).toBe("Henderson Roofing LLC");
  });

  it("contractor: applicant looks like a company even if contractor_name missing", () => {
    const r = classifyApplicant({
      applicant_name: "ACME Construction Inc",
      contractor_name: null,
      owner_name: "Jane Smith",
    });
    expect(r.type).toBe("contractor");
    expect(r.label).toContain("ACME Construction Inc");
  });

  it("contractor: roofing-suffix detection", () => {
    const r = classifyApplicant({
      applicant_name: "Smith Brothers Roofing",
      owner_name: "John Doe",
    });
    expect(r.type).toBe("contractor");
  });

  it("spec/investor: cascade_count > 3", () => {
    const r = classifyApplicant(
      {
        applicant_name: "Jane Smith",
        owner_name: "Jane Smith",
      },
      { cascade_count: 7 },
    );
    expect(r.type).toBe("spec");
    expect(r.label).toBe("Spec / investor");
  });

  it("spec takes precedence over homeowner-match", () => {
    // Same name on both, but cascade is 5 → still spec
    const r = classifyApplicant(
      {
        applicant_name: "Smith LLC",
        owner_name: "Smith LLC",
      },
      { cascade_count: 5 },
    );
    expect(r.type).toBe("spec");
  });

  it("homeowner fallback when no name fields populated", () => {
    const r = classifyApplicant({
      applicant_name: null,
      owner_name: null,
      contractor_name: null,
    });
    expect(r.type).toBe("homeowner");
    expect(r.label).toBe("Likely homeowner-pulled");
  });

  it("does not classify owner-self-pulled with cascade=2 as spec", () => {
    const r = classifyApplicant(
      {
        applicant_name: "Jane Smith",
        owner_name: "Jane Smith",
      },
      { cascade_count: 2 },
    );
    expect(r.type).toBe("homeowner");
  });

  it("hint text is present for every type", () => {
    const cases = [
      { permit: { applicant_name: "Jane", owner_name: "Jane" } },
      { permit: { applicant_name: "ACME LLC", owner_name: "Jane" } },
      { permit: {}, lead: { cascade_count: 10 } },
    ];
    for (const c of cases) {
      const r = classifyApplicant(c.permit, c.lead);
      expect(r.hint.length).toBeGreaterThan(20);
    }
  });
});
