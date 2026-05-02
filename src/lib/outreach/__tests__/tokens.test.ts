/* ── tokens.test.ts ──────────────────────────────────────────────────────
 *
 *  Wedge contract bullet #4 — outreach is permit-specific. Templates
 *  use {{tokens}} that get resolved with real lead/permit/contractor
 *  data at render time. This file locks the resolver invariants:
 *
 *    1. Every documented token in OutreachTokenContext is in
 *       FALLBACKS so KNOWN_TOKENS surfaces it in the editor picker.
 *    2. Unknown tokens are left intact (don't silently delete
 *       contractor-typed templates).
 *    3. Null / undefined / empty-string raw values resolve to the
 *       documented fallback (graceful sentence).
 *    4. Numeric tokens (permit_value etc.) format compact: 1.5M, 25K.
 *    5. days_ago has the today/yesterday/N branches.
 *    6. New disaster-context tokens (nfip_claim_count, nri_risk_tier,
 *       etc.) resolve only when raw value is meaningful (>0 numeric
 *       or non-empty string) — zero counts don't surface as false
 *       "0 claims" signals.
 * ─────────────────────────────────────────────────────────────────────── */

import { describe, expect, it } from "vitest";
import {
  resolveTokens,
  renderTemplate,
  KNOWN_TOKENS,
  type OutreachTokenContext,
} from "../tokens";

const FULL_CTX: OutreachTokenContext = {
  owner_first: "Jane",
  owner_last: "Doe",
  address_short: "642 PARK ST",
  address_full: "642 PARK ST, HARTFORD, CT 06106",
  city: "Hartford",
  zip: "06106",
  permit_number: "MISC-PLM-25-000078",
  permit_scope: "Install new flooring, plumbing rough-in",
  days_ago: 3,
  trade: "plumbing",
  permit_value: 25_000,
  contractor_name: "Sam Carter",
  contractor_company: "Carter Plumbing",
  contractor_phone: "+18601234567",
  value_min: 5_000,
  value_max: 50_000,
  nfip_claim_count: 12,
  nri_risk_score: 78,
  nri_risk_tier: "Relatively High",
  recent_disaster_title: "Severe Storms and Flooding",
  recent_disaster_id: "DR-4806",
  storm_count_30d: 3,
  lien_count_90d: 2,
};

describe("KNOWN_TOKENS contract surface", () => {
  it("includes every disaster-context token (Wave 1.5/2.A/2.B)", () => {
    const expectedNew = [
      "nfip_claim_count",
      "nri_risk_score",
      "nri_risk_tier",
      "recent_disaster_title",
      "recent_disaster_id",
      "storm_count_30d",
      "lien_count_90d",
    ] as const;
    for (const t of expectedNew) {
      expect(KNOWN_TOKENS).toContain(t);
    }
  });

  it("includes the original Phase 0a tokens", () => {
    const original = [
      "owner_first",
      "address_short",
      "permit_number",
      "permit_scope",
      "days_ago",
      "permit_value",
      "contractor_name",
    ] as const;
    for (const t of original) expect(KNOWN_TOKENS).toContain(t);
  });
});

describe("resolveTokens — populated context", () => {
  it("substitutes simple text tokens", () => {
    expect(resolveTokens("Hi {{owner_first}}", FULL_CTX)).toBe("Hi Jane");
  });

  it("formats permit_value compactly (25K)", () => {
    const out = resolveTokens("worth {{permit_value}}", FULL_CTX);
    expect(out).toBe("worth $25K");
  });

  it("formats value_max ($50K)", () => {
    expect(resolveTokens("up to {{value_max}}", FULL_CTX)).toBe("up to $50K");
  });

  it("days_ago branches: 3 → '3', 1 → 'yesterday', 0 → 'today'", () => {
    expect(resolveTokens("{{days_ago}}", FULL_CTX)).toBe("3");
    expect(resolveTokens("{{days_ago}}", { ...FULL_CTX, days_ago: 1 })).toBe("yesterday");
    expect(resolveTokens("{{days_ago}}", { ...FULL_CTX, days_ago: 0 })).toBe("today");
  });

  it("preserves multiple substitutions in a single string", () => {
    const out = resolveTokens(
      "Hi {{owner_first}}, your {{permit_number}} at {{address_short}}",
      FULL_CTX,
    );
    expect(out).toBe(
      "Hi Jane, your MISC-PLM-25-000078 at 642 PARK ST",
    );
  });

  it("ignores whitespace around token names", () => {
    expect(resolveTokens("Hi {{ owner_first  }}", FULL_CTX)).toBe("Hi Jane");
  });

  it("is case-insensitive", () => {
    expect(resolveTokens("{{OWNER_FIRST}}", FULL_CTX)).toBe("Jane");
  });
});

describe("resolveTokens — fallback path", () => {
  it("uses the 'there' fallback when owner_first is null", () => {
    expect(resolveTokens("Hi {{owner_first}}", { owner_first: null })).toBe("Hi there");
  });

  it("uses 'your project' fallback when permit_scope is empty", () => {
    expect(resolveTokens("about {{permit_scope}}", { permit_scope: "" })).toBe(
      "about your project",
    );
  });

  it("uses 'recently' fallback when days_ago is null", () => {
    expect(resolveTokens("{{days_ago}}", { days_ago: null })).toBe("recently");
  });

  it("leaves UNKNOWN tokens intact (don't delete contractor-typed text)", () => {
    expect(resolveTokens("Hi {{not_a_real_token}}", FULL_CTX)).toBe(
      "Hi {{not_a_real_token}}",
    );
  });
});

describe("Wave 1.5/2.A/2.B disaster-context tokens", () => {
  it("renders nfip_claim_count when populated", () => {
    expect(
      resolveTokens("we saw {{nfip_claim_count}} flood claims", FULL_CTX),
    ).toBe("we saw 12 flood claims");
  });

  it("falls back to '' when nfip_claim_count is 0 — don't surface 'zero claims'", () => {
    expect(
      resolveTokens(
        "{{nfip_claim_count}} claims",
        { ...FULL_CTX, nfip_claim_count: 0 },
      ),
    ).toBe(" claims");
  });

  it("renders nri_risk_tier as a qualitative phrase", () => {
    expect(resolveTokens("{{nri_risk_tier}} disaster zone", FULL_CTX)).toBe(
      "Relatively High disaster zone",
    );
  });

  it("renders recent_disaster_id (DR-4806)", () => {
    expect(resolveTokens("after {{recent_disaster_id}}", FULL_CTX)).toBe(
      "after DR-4806",
    );
  });

  it("renders recent_disaster_title with multiple words", () => {
    expect(
      resolveTokens(
        "after the {{recent_disaster_title}} declaration",
        FULL_CTX,
      ),
    ).toBe("after the Severe Storms and Flooding declaration");
  });

  it("renders storm_count_30d numeric only when >0", () => {
    expect(
      resolveTokens("{{storm_count_30d}} hailstorms", FULL_CTX),
    ).toBe("3 hailstorms");
    expect(
      resolveTokens(
        "{{storm_count_30d}}",
        { ...FULL_CTX, storm_count_30d: 0 },
      ),
    ).toBe("");
  });

  it("renders lien_count_90d numeric only when >0", () => {
    expect(resolveTokens("{{lien_count_90d}}", FULL_CTX)).toBe("2");
    expect(
      resolveTokens(
        "{{lien_count_90d}}",
        { ...FULL_CTX, lien_count_90d: 0 },
      ),
    ).toBe("");
  });

  it("renders nri_risk_score numeric only when >0", () => {
    expect(resolveTokens("{{nri_risk_score}}/100", FULL_CTX)).toBe("78/100");
    expect(
      resolveTokens(
        "{{nri_risk_score}}",
        { ...FULL_CTX, nri_risk_score: 0 },
      ),
    ).toBe("");
  });

  it("disaster context tokens fall back when entirely null (storm-free zone)", () => {
    const ctx: Partial<OutreachTokenContext> = {
      owner_first: "Jane",
      nfip_claim_count: null,
      nri_risk_tier: null,
      recent_disaster_title: null,
      storm_count_30d: null,
      lien_count_90d: null,
    };
    const out = resolveTokens(
      "Hi {{owner_first}} — {{nfip_claim_count}} {{nri_risk_tier}} {{storm_count_30d}}",
      ctx,
    );
    // Three blanks where the disaster tokens used to be, but message
    // is still legible (graceful degradation).
    expect(out.startsWith("Hi Jane —")).toBe(true);
    expect(out.includes("undefined")).toBe(false);
    expect(out.includes("null")).toBe(false);
  });
});

describe("renderTemplate", () => {
  it("renders subject + body in one call", () => {
    const t = {
      subject: "Re: {{permit_number}} — quick question",
      body: "Hi {{owner_first}}, I noticed your project at {{address_short}}.",
    };
    const out = renderTemplate(t, FULL_CTX);
    expect(out.subject).toBe("Re: MISC-PLM-25-000078 — quick question");
    expect(out.body).toBe(
      "Hi Jane, I noticed your project at 642 PARK ST.",
    );
  });

  it("renders empty subject when template subject is null", () => {
    const t = { subject: null, body: "{{owner_first}}" };
    const out = renderTemplate(t, FULL_CTX);
    expect(out.subject).toBe("");
    expect(out.body).toBe("Jane");
  });
});
