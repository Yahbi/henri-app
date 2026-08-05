import { describe, it, expect } from "vitest";
import { extractZip, normalizeStatus, deriveState } from "../normalizer";

/**
 * Normaliser tests for the 2026-08-04 audit findings.
 *
 * All three functions feed columns the paid product is built on:
 *   permits.zip    -> territory routing (the exclusivity wedge)
 *   permits.status -> opportunity_stage shown in the lead drawer
 *   permits.state  -> NRI / lien score boosters and coverage claims
 */

describe("extractZip", () => {
  it("does NOT return a 5-digit house number as the ZIP", () => {
    // These are the reproduced live failures. A Baton Rouge property numbered
    // 33647 was being delivered into the Tampa 33647 exclusive territory.
    expect(extractZip("12345 VENTURA BLVD")).toBeNull();
    expect(extractZip("11848 HOOPER RD  BAKER LA 70714")).toBe("70714");
    expect(extractZip("33647 GREENWELL SPRINGS RD, LA 70739")).toBe("70739");
  });

  it("still extracts a trailing ZIP correctly", () => {
    expect(extractZip("400 N ASHLEY DR, TAMPA FL 33602")).toBe("33602");
    expect(extractZip("123 Main St, Austin, TX 78701")).toBe("78701");
  });

  it("takes the LAST 5-digit token when several are present", () => {
    expect(extractZip("10645 BRYTON CORPORATE CENTER DR, CHARLOTTE NC 28269")).toBe("28269");
  });

  it("handles ZIP+4", () => {
    expect(extractZip("1 A St, Town, MA 02101-1234")).toBe("02101");
  });

  it("returns null when there is no ZIP at all", () => {
    expect(extractZip("MAIN ST")).toBeNull();
    expect(extractZip("")).toBeNull();
    // 4- and 6-digit runs are not ZIPs.
    expect(extractZip("1234 SOME RD")).toBeNull();
    expect(extractZip("123456 SOME RD")).toBeNull();
  });
});

describe("normalizeStatus", () => {
  it("does NOT classify INACTIVE as approved", () => {
    // "inactive".includes("active") was true under the old substring match,
    // mis-classifying ~9.8k Elk Grove rows as live work.
    expect(normalizeStatus("INACTIVE")).toBe("expired");
    expect(normalizeStatus("In-Active")).toBe("expired");
  });

  it("classifies the bare COMPLETE as final, not submitted", () => {
    // The `final` list had "completed" but not "complete", and
    // "complete".includes("completed") is false — ~7k SF rows fell through
    // to `submitted`.
    expect(normalizeStatus("COMPLETE")).toBe("final");
    expect(normalizeStatus("Completed")).toBe("final");
  });

  it("classifies DISAPPROVED as revoked, not approved", () => {
    expect(normalizeStatus("DISAPPROVED")).toBe("revoked");
    expect(normalizeStatus("Not Approved")).toBe("revoked");
    expect(normalizeStatus("UNAPPROVED")).toBe("revoked");
  });

  it("keeps the classifications that already worked", () => {
    expect(normalizeStatus("ACTIVE")).toBe("approved");
    expect(normalizeStatus("APPROVED")).toBe("approved");
    expect(normalizeStatus("Issued")).toBe("issued");
    expect(normalizeStatus("EXPIRED")).toBe("expired");
    expect(normalizeStatus("Pending")).toBe("submitted");
    expect(normalizeStatus("Under Review")).toBe("submitted");
    expect(normalizeStatus("CANCELLED")).toBe("revoked");
    expect(normalizeStatus("Denied")).toBe("revoked");
    expect(normalizeStatus("CLOSED")).toBe("final");
  });

  it("matches across punctuation separators", () => {
    expect(normalizeStatus("APPROVED_2024")).toBe("approved");
    expect(normalizeStatus("under-review")).toBe("submitted");
    expect(normalizeStatus("permit/issued")).toBe("issued");
  });

  it("keeps legacy glued-word behaviour via the safe substring pass", () => {
    expect(normalizeStatus("FINALED")).toBe("final");
    expect(normalizeStatus("ISSUEDPERMIT")).toBe("issued");
  });

  it("falls back to the DB default for unknown or empty input", () => {
    expect(normalizeStatus("")).toBe("submitted");
    expect(normalizeStatus("ZZZZ")).toBe("submitted");
  });
});

describe("deriveState with an untrusted ZIP", () => {
  it("prefers the declared state over a ZIP parsed from free text", () => {
    // '10000 HOLMAN RD NW' is in Seattle; prefix 100 maps to NY.
    expect(deriveState("10000 HOLMAN RD NW", "10000", "WA", false)).toBe("WA");
    expect(deriveState("11848 HOOPER RD", "11848", "LA", false)).toBe("LA");
  });

  it("still uses an untrusted ZIP when there is no usable declared state", () => {
    expect(deriveState("123 Main St", "33602", "US", false)).toBe("FL");
    expect(deriveState("123 Main St", "33602", null, false)).toBe("FL");
  });

  it("an explicit trailing state token still wins over everything", () => {
    expect(deriveState("1 A St, Seattle, WA 98101", "98101", "NY", false)).toBe("WA");
  });

  it("keeps the ZIP-first behaviour when the ZIP is trusted (default)", () => {
    // Backwards-compatible: existing 3-arg callers are unaffected.
    expect(deriveState("123 Main St", "33602", "US")).toBe("FL");
    expect(deriveState("123 Main St", "98101", "NY", true)).toBe("WA");
  });
});
