import { describe, it, expect } from "vitest";
import { loadQuotaRemaining, SOURCE_SPECS, periodKey } from "../quota";

/**
 * Tests the quota snapshot math (WS2). loadQuotaRemaining seeds every
 * budgeted source with its full budget, then subtracts the current
 * period's recorded usage and floors at 0. A fake Supabase client returns
 * canned usage rows so we exercise the arithmetic without a DB.
 */

function fakeSupabase(usageRows: Array<{ source: string; period: string; used: number }>) {
  return {
    from() {
      return {
        select() {
          return {
            // .in("period", [...]) resolves to { data }
            in() {
              return Promise.resolve({ data: usageRows, error: null });
            },
          };
        },
      };
    },
  } as never;
}

const NOW = new Date(Date.UTC(2026, 5, 9)); // 2026-06-09

describe("loadQuotaRemaining", () => {
  it("seeds full budget for every budgeted source when there is no usage", async () => {
    const rem = await loadQuotaRemaining(fakeSupabase([]), NOW);
    for (const [source, spec] of Object.entries(SOURCE_SPECS)) {
      if (spec.budget == null) {
        expect(rem[source]).toBeUndefined(); // free sources aren't budgeted
      } else {
        expect(rem[source]).toBe(spec.budget);
      }
    }
  });

  it("subtracts the current period's usage", async () => {
    const period = periodKey(SOURCE_SPECS.numverify.window, NOW);
    const rem = await loadQuotaRemaining(
      fakeSupabase([{ source: "numverify", period, used: 30 }]),
      NOW,
    );
    expect(rem.numverify).toBe(SOURCE_SPECS.numverify.budget! - 30);
  });

  it("floors remaining at 0 when usage exceeds budget", async () => {
    const period = periodKey(SOURCE_SPECS.hunter_io.window, NOW);
    const rem = await loadQuotaRemaining(
      fakeSupabase([{ source: "hunter_io", period, used: 9999 }]),
      NOW,
    );
    expect(rem.hunter_io).toBe(0);
  });

  it("ignores usage rows from a different period", async () => {
    const rem = await loadQuotaRemaining(
      fakeSupabase([{ source: "numverify", period: "1999-01", used: 50 }]),
      NOW,
    );
    expect(rem.numverify).toBe(SOURCE_SPECS.numverify.budget);
  });
});
