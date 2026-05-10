import { describe, it, expect } from "vitest";
import { __test } from "../hygiene";

describe("hygiene — zipToTimezone", () => {
  it("00501 (NY) → America/New_York", () => {
    expect(__test.zipToTimezone("00501")).toBe("America/New_York");
  });
  it("90210 (Beverly Hills CA) → America/Los_Angeles", () => {
    expect(__test.zipToTimezone("90210")).toBe("America/Los_Angeles");
  });
  it("60601 (Chicago IL) → America/Chicago", () => {
    expect(__test.zipToTimezone("60601")).toBe("America/Chicago");
  });
  it("80202 (Denver CO) → America/Denver", () => {
    expect(__test.zipToTimezone("80202")).toBe("America/Denver");
  });
  it("85004 (Phoenix AZ) → America/Phoenix", () => {
    expect(__test.zipToTimezone("85004")).toBe("America/Phoenix");
  });
  it("99501 (Anchorage AK) → America/Anchorage", () => {
    expect(__test.zipToTimezone("99501")).toBe("America/Anchorage");
  });
  it("missing ZIP → America/New_York fallback", () => {
    expect(__test.zipToTimezone(null)).toBe("America/New_York");
    expect(__test.zipToTimezone("")).toBe("America/New_York");
    expect(__test.zipToTimezone("XYZ")).toBe("America/New_York");
  });
});

describe("hygiene — isQuietHour", () => {
  // 2026-05-09 14:00 UTC → 10am Eastern, 7am Pacific.
  const noonUTC = new Date("2026-05-09T14:00:00Z");
  // 2026-05-09 02:00 UTC → 10pm Eastern (prev day), 7pm Pacific.
  const lateNightUTC = new Date("2026-05-09T02:00:00Z");
  // 2026-05-09 11:00 UTC → 7am Eastern, 4am Pacific.
  const earlyAMUTC = new Date("2026-05-09T11:00:00Z");

  it("permits SMS at 10am Eastern (NY ZIP)", () => {
    expect(__test.isQuietHour("10001", "sms", noonUTC)).toBe(false);
  });
  it("blocks SMS at 7am Pacific (CA ZIP) — before 8am local", () => {
    expect(__test.isQuietHour("90210", "sms", noonUTC)).toBe(true);
  });
  it("blocks SMS at 10pm Eastern (NY ZIP) — past 9pm local", () => {
    expect(__test.isQuietHour("10001", "sms", lateNightUTC)).toBe(true);
  });
  it("blocks call at 4am Pacific", () => {
    expect(__test.isQuietHour("90210", "call", earlyAMUTC)).toBe(true);
  });
  it("permits email regardless of hour", () => {
    expect(__test.isQuietHour("10001", "email", lateNightUTC)).toBe(false);
    expect(__test.isQuietHour("90210", "email", earlyAMUTC)).toBe(false);
  });
});
