import { describe, expect, it } from "vitest";
import { haversineMi } from "../haversine";

describe("haversineMi", () => {
  it("returns 0 for the same point", () => {
    expect(haversineMi(40.7128, -74.006, 40.7128, -74.006)).toBe(0);
  });

  it("NYC to LA is ~2445 mi (within +/- 10)", () => {
    // NYC (40.7128, -74.0060) -> LA (34.0522, -118.2437)
    const mi = haversineMi(40.7128, -74.006, 34.0522, -118.2437);
    expect(mi).toBeGreaterThan(2435);
    expect(mi).toBeLessThan(2455);
  });

  it("is symmetric", () => {
    const a = haversineMi(40.7128, -74.006, 34.0522, -118.2437);
    const b = haversineMi(34.0522, -118.2437, 40.7128, -74.006);
    expect(Math.abs(a - b)).toBeLessThan(1e-6);
  });
});
