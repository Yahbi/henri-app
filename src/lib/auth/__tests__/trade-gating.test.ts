/* ── trade-gating.test.ts ────────────────────────────────────────────────
 *
 *  Regression cover for the 2026-08-05 correctness fix.
 *
 *  The gate used to resolve to a single trade string that callers applied as
 *  `eq("trade", X)`. Live counts (2026-08-05, 274,783 leads) showed why that
 *  was wrong:
 *
 *    other 156,457 · residential 45,123 · commercial 41,003 · general 7,467
 *    ...vs hvac 776 · plumbing 233 · roofing 843 · electrical 1,850
 *
 *  90% of the table is an unclassifiable bucket, so exact-string equality
 *  showed a paying hvac contractor 776 rows and hid the rest — including
 *  16,922 leads that carry a populated `trade_tags` array while their `trade`
 *  column says "other".
 *
 *  Contract now:
 *    1. GENERIC_TRADE_BUCKETS names the four no-information buckets.
 *    2. tradeTagsFor() maps a profile trade onto the derive.ts tag taxonomy,
 *       falling back to the trade string (which is already the tag name for
 *       the common trades).
 *    3. Fan-out trades resolve to several tags; trades with no tag analogue
 *       resolve to none (the generic always-include carries them).
 *    4. No tag ever contains a comma — a comma inside `{}` would break the
 *       PostgREST `or=` expression the map route builds from these.
 * ─────────────────────────────────────────────────────────────────────── */

import { describe, expect, it } from "vitest";
import { GENERIC_TRADE_BUCKETS, tradeTagsFor } from "../trade-gating";

describe("GENERIC_TRADE_BUCKETS", () => {
  it("covers the four no-information leads.trade values", () => {
    expect([...GENERIC_TRADE_BUCKETS]).toEqual([
      "other",
      "residential",
      "commercial",
      "general",
    ]);
  });
});

describe("tradeTagsFor", () => {
  it("returns nothing for a null or empty trade", () => {
    expect(tradeTagsFor(null)).toEqual([]);
    expect(tradeTagsFor("")).toEqual([]);
  });

  it("falls back to the trade string for trades whose tag shares the name", () => {
    // hvac / roofing / electrical / solar / pool / landscaping / concrete
    // exist verbatim in deriveTradeTags()'s TRADE_KEYWORDS table.
    expect(tradeTagsFor("hvac")).toEqual(["hvac"]);
    expect(tradeTagsFor("roofing")).toEqual(["roofing"]);
    expect(tradeTagsFor("solar")).toEqual(["solar"]);
  });

  it("fans a trade out to every tag that belongs to it", () => {
    // A plumber wants the sewer work too; a renovation contractor wants the
    // kitchen / bath / flooring tags, not just the literal "remodel".
    expect(tradeTagsFor("plumbing")).toContain("plumbing");
    expect(tradeTagsFor("plumbing")).toContain("sewer");
    expect(tradeTagsFor("renovation")).toEqual([
      "remodel",
      "kitchen",
      "bath",
      "flooring",
    ]);
    expect(tradeTagsFor("windows_doors")).toEqual(["windows"]);
  });

  it("returns no tags for trades with no analogue in the tag taxonomy", () => {
    // These rely on the generic-bucket always-include instead of tag matching.
    expect(tradeTagsFor("signage")).toEqual([]);
    expect(tradeTagsFor("repair")).toEqual([]);
    expect(tradeTagsFor("fire_protection")).toEqual([]);
  });

  it("is not fooled by inherited Object properties", () => {
    // The alias table is a plain object and the key comes from the DB, so a
    // prototype key must not leak a function into the tag list.
    expect(tradeTagsFor("constructor")).toEqual(["constructor"]);
    expect(tradeTagsFor("toString")).toEqual(["toString"]);
  });

  it("never emits a tag containing a comma or brace", () => {
    // The map route interpolates these into `trade_tags.cs.{tag}` inside a
    // PostgREST `or=` expression, which is comma-separated.
    const trades = [
      "hvac",
      "plumbing",
      "renovation",
      "addition",
      "new_construction",
      "bathroom",
      "kitchen",
      "concrete",
      "foundation",
      "fencing",
      "decking",
      "demolition",
    ];
    for (const trade of trades) {
      for (const tag of tradeTagsFor(trade)) {
        expect(tag).toMatch(/^[a-z0-9_]+$/);
      }
    }
  });
});
