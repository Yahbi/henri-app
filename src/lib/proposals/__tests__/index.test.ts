import { describe, it, expect } from "vitest";
import { generateProposal } from "../index";

/**
 * Tests for the predictive proposal builder. Audit priority #9
 * extracted this from `LeadDetailDrawer.tsx`; the test surface is
 * straightforward because the function is pure (no I/O, no React).
 *
 * Coverage targets:
 *   1. Each trade-specific path emits the right headline + insight + actions
 *   2. Description-token branching (replacement vs repair, kitchen vs bathroom, etc.)
 *   3. Urgency thresholds (≤3 = high, ≤10 = medium, > 10 = low)
 *   4. Time-window phrasing (≤2 = 48h, ≤7 = N-day countdown, > 7 = follow-up)
 *   5. Revenue estimation across $K and $M ranges + null when unparseable
 *   6. Default proposal when trade is unknown
 */

describe("generateProposal", () => {
  it("returns roofing-replacement variant when description contains 'replacement'", () => {
    const p = generateProposal({
      trade: "roofing",
      permitAge: 1,
      value: "$50K",
      permitDescription: "ROOF REPLACEMENT",
    });
    expect(p.headline).toMatch(/Roof project/i);
    expect(p.insight).toMatch(/concentrated buying intent/);
    expect(p.actions).toContain("Call within 24 hours to schedule a free estimate");
    expect(p.urgency).toBe("high");
    expect(p.window).toMatch(/48 hours/);
  });

  it("returns roofing-repair variant when description omits 'replacement'", () => {
    const p = generateProposal({
      trade: "roofing",
      permitAge: 5,
      value: "$10K",
      permitDescription: "Patch leak in flashing",
    });
    expect(p.insight).toMatch(/expand in scope/);
    expect(p.urgency).toBe("medium");
    expect(p.window).toMatch(/2 days before/);
  });

  it("returns hvac-replacement variant when description contains 'replacement'", () => {
    const p = generateProposal({
      trade: "hvac",
      permitAge: 0,
      value: "$8K",
      permitDescription: "Furnace replacement and ductwork",
    });
    expect(p.headline).toMatch(/HVAC system/);
    expect(p.insight).toMatch(/time-sensitive/);
    expect(p.urgency).toBe("high");
  });

  it("branches plumbing on sewer / repipe keywords", () => {
    const p = generateProposal({
      trade: "plumbing",
      permitAge: 4,
      value: "$15K",
      permitDescription: "Whole-house repipe",
    });
    expect(p.insight).toMatch(/committed homeowner/i);
  });

  it("branches electrical on panel / 200 keywords", () => {
    const p = generateProposal({
      trade: "electrical",
      permitAge: 6,
      value: "$8K",
      permitDescription: "Service panel upgrade to 200 amp",
    });
    expect(p.insight).toMatch(/Panel upgrades/);
  });

  it("returns the static solar copy regardless of description", () => {
    const p = generateProposal({
      trade: "solar",
      permitAge: 2,
      value: "$30K",
      permitDescription: "10kW PV array, no battery",
    });
    expect(p.headline).toMatch(/Solar/);
    expect(p.insight).toMatch(/comparing installers/);
    expect(p.insight).toMatch(/speed of response/i);
  });

  it("branches general-remodel on kitchen vs bathroom", () => {
    const k = generateProposal({
      trade: "general remodel",
      permitAge: 8,
      value: "$60K",
      permitDescription: "Kitchen remodel - cabinets and tile",
    });
    expect(k.insight).toMatch(/Kitchen remodels/);

    const b = generateProposal({
      trade: "general remodel",
      permitAge: 8,
      value: "$25K",
      permitDescription: "Master bathroom remodel",
    });
    expect(b.insight).toMatch(/Bathroom remodels/);

    const g = generateProposal({
      trade: "general remodel",
      permitAge: 12,
      value: "$80K",
      permitDescription: "Living room addition",
    });
    expect(g.insight).toMatch(/active property improvement/);
    expect(g.urgency).toBe("low");
  });

  it("falls back to default proposal for unknown trade", () => {
    const p = generateProposal({
      trade: "stuccodonations",
      type: "commercial",
      permitAge: 5,
      value: null,
      permitDescription: null,
    });
    expect(p.headline).toMatch(/New construction permit/);
    expect(p.insight).toMatch(/commercial permit was filed 5 days ago/);
  });

  it("estimates revenue range from $K value", () => {
    const p = generateProposal({
      trade: "roofing",
      permitAge: 1,
      value: "$100K",
      permitDescription: "Roof replacement",
    });
    expect(p.estimatedRevenue).toMatch(/\$40K - \$70K/);
  });

  /* ── Revenue magnitude (audit 2026-08-04) ───────────────────────────
   * The $M branch used to strip the "M" suffix, parse "$2.5M" as 2.5, and
   * interpolate it into a template hardcoding "K" — so every $1M+ permit
   * rendered "$0K - $1K contractor revenue" (1,957 live leads in the
   * $1M-$10M band collapsed to $0). These tests pin the MAGNITUDE, not
   * just the string shape, so the 1000x bug cannot come back. */
  it("estimates revenue range from $M value at the correct magnitude", () => {
    const p = generateProposal({
      trade: "adu",
      permitAge: 2,
      value: "$1M",
      permitDescription: "ADU detached",
    });
    // $1M × 40-70% = $400K - $700K. Never "$0K".
    expect(p.estimatedRevenue).toMatch(/\$400K - \$700K/);
    expect(p.estimatedRevenue).not.toMatch(/\$0K/);

    const p12 = generateProposal({
      trade: "adu",
      permitAge: 2,
      value: "$1.2M",
      permitDescription: "Custom build",
    });
    expect(p12.estimatedRevenue).toMatch(/\$480K - \$840K/);

    // Above $1M on the LOW end the band re-formats into $M so it stays
    // readable instead of printing "$1000K".
    const p25 = generateProposal({
      trade: "adu",
      permitAge: 2,
      value: "$2.5M",
      permitDescription: "Custom build",
    });
    expect(p25.estimatedRevenue).toMatch(/\$1\.0M - \$1\.8M/);
    expect(p25.estimatedRevenue).not.toMatch(/\$0K/);
  });

  it("discloses the derivation of the contract-value band", () => {
    // Truthfulness: the band is a stated percentage of the permit's OWN
    // declared value, so a contractor can reproduce the arithmetic. It is
    // never presented as a measured margin or close rate.
    const p = generateProposal({
      trade: "roofing",
      permitAge: 1,
      value: "$100K",
      permitDescription: "Roof replacement",
    });
    expect(p.estimatedRevenue).toContain("40-70% of the $100K permit value");
    expect(p.estimatedRevenue).toContain("not a quote");
  });

  it("scales linearly across magnitudes (no unit mismatch between K and M)", () => {
    const k = generateProposal({ trade: "adu", permitAge: 1, value: "$500K" });
    const m = generateProposal({ trade: "adu", permitAge: 1, value: "$0.5M" });
    // $500K and $0.5M are the same amount — they must produce the same band.
    expect(k.estimatedRevenue).toBe(m.estimatedRevenue);
  });

  it("returns null revenue when value is missing", () => {
    const p = generateProposal({
      trade: "plumbing",
      permitAge: 3,
      value: null,
      permitDescription: "Repair",
    });
    expect(p.estimatedRevenue).toBeNull();
  });

  it("returns null revenue when value is below $5K threshold", () => {
    const p = generateProposal({
      trade: "plumbing",
      permitAge: 3,
      value: "$3K",
      permitDescription: "Repair",
    });
    expect(p.estimatedRevenue).toBeNull();
  });

  it("urgency thresholds: ≤3 high, ≤10 medium, > 10 low", () => {
    expect(generateProposal({ trade: "roofing", permitAge: 0 }).urgency).toBe("high");
    expect(generateProposal({ trade: "roofing", permitAge: 3 }).urgency).toBe("high");
    expect(generateProposal({ trade: "roofing", permitAge: 4 }).urgency).toBe("medium");
    expect(generateProposal({ trade: "roofing", permitAge: 10 }).urgency).toBe("medium");
    expect(generateProposal({ trade: "roofing", permitAge: 11 }).urgency).toBe("low");
    expect(generateProposal({ trade: "roofing", permitAge: 100 }).urgency).toBe("low");
  });

  it("window phrasing matches age band", () => {
    expect(generateProposal({ trade: "roofing", permitAge: 0 }).window).toMatch(/48 hours/);
    expect(generateProposal({ trade: "roofing", permitAge: 5 }).window).toMatch(/2 days before/);
    expect(generateProposal({ trade: "roofing", permitAge: 30 }).window).toMatch(/Follow up promptly/);
  });

  it("treats null trade as 'other' (default proposal)", () => {
    const p = generateProposal({
      trade: null,
      type: "renovation",
      permitAge: 5,
      value: null,
    });
    expect(p.headline).toMatch(/New construction permit/);
  });

  /* ── Unknown permit age (audit 2026-08-04) ──────────────────────────
   * `lead.permitAge ?? 0` used to turn "we have no filing date" into the
   * single most urgent value in the model: an "Act Now" badge, a "48
   * hours — first-mover advantage" window, and a "filed 0 days ago"
   * sentence. /dashboard/map hardcodes `permitAge: undefined`, so EVERY
   * lead opened from the map drawer hit this. Unknown must stay unknown. */
  describe("unknown permit age", () => {
    for (const missing of [undefined, null] as const) {
      it(`permitAge=${String(missing)} never claims maximum urgency`, () => {
        const p = generateProposal({
          trade: "roofing",
          permitAge: missing,
          permitDescription: "Roof replacement",
        });
        expect(p.urgency).toBe("low");
        expect(p.window).toMatch(/date unknown/i);
        expect(p.window).not.toMatch(/48 hours/);
      });
    }

    it("drops the 'filed N days ago' clause from the default proposal", () => {
      const p = generateProposal({
        trade: "stuccodonations",
        type: "commercial",
        permitAge: null,
      });
      expect(p.insight).not.toMatch(/filed \d+ days? ago/i);
      expect(p.insight).toMatch(/filing date unknown/i);
      expect(p.insight).toMatch(/commercial permit/);
    });

    it("treats a non-finite or negative age as unknown, not as fresh", () => {
      for (const bad of [Number.POSITIVE_INFINITY, Number.NaN, -3]) {
        const p = generateProposal({ trade: "roofing", permitAge: bad });
        expect(p.urgency).toBe("low");
        expect(p.window).toMatch(/date unknown/i);
      }
    });

    it("still claims high urgency when the age IS known and fresh", () => {
      // Guard against over-correcting: a real fresh permit must keep its
      // first-mover framing.
      const p = generateProposal({ trade: "roofing", permitAge: 0 });
      expect(p.urgency).toBe("high");
      expect(p.window).toMatch(/48 hours/);
    });
  });

  /* ── Truthfulness (audit 2026-08-04) ────────────────────────────────
   * Every insight string is rendered ungated in the drawer's "Predictive
   * Proposal" block. None of them may assert a metric Henri has never
   * measured. This is a standing guard, not a one-off assertion. */
  it("no insight string asserts an unmeasured conversion rate or dollar average", () => {
    const trades = [
      "roofing", "hvac", "plumbing", "electrical", "solar", "adu",
      "general remodel", "unknown-trade", null,
    ];
    const descriptions = ["", "replacement", "sewer repipe", "panel 200", "kitchen", "bathroom"];

    for (const trade of trades) {
      for (const permitDescription of descriptions) {
        const p = generateProposal({
          trade,
          type: "residential",
          permitAge: 2,
          permitDescription,
        });
        // No percentage claims ("close at 40%+").
        expect(p.insight).not.toMatch(/\d+\s*%/);
        // No hardcoded dollar averages ("$35K-$75K", "$80K-$200K+").
        expect(p.insight).not.toMatch(/\$\d/);
        // No unquantified close-rate assertions either — the pattern the
        // marketing sweep already removed from /contractors.
        expect(p.insight).not.toMatch(/close (at|rate)/i);
      }
    }
  });
});
