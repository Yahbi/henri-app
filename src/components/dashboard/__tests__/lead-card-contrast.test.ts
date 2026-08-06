/**
 * WCAG AA regression guard for the two brand-tinted text surfaces that
 * repeat on every lead: the opportunity-stage chip and the score disc.
 *
 * Both paint "brand hex text on a 10-12% tint of the same brand hex", which
 * reads as one colour family but is two nearly-identical luminances. On the
 * shipped light theme the stage chips measured 1.56:1-3.23:1 and the score
 * disc 2.12:1-3.67:1 — every one under the 4.5:1 floor that applies to text
 * below 18.66px, and all of these render at 10-12px.
 *
 * These tests assert the solver's OUTPUT clears the floor for every stage in
 * the palette, so adding a stage to `STAGE_PALETTE` with an unusable colour
 * fails here rather than shipping an illegible chip.
 */

import { describe, it, expect } from "vitest";
import {
  contrastRatio,
  aaTextOn,
  tintTextColor,
  scoreHex,
  SCORE_TINT_ALPHA,
  STAGE_TINT_ALPHA,
} from "../LeadCard";
import { STAGE_PALETTE } from "@/lib/intent/stage-colors";

/** WCAG AA for text under 18.66px. */
const AA = 4.5;

/** `--card` per theme, from globals.css. */
const LIGHT = "#FFFFFF";
const DUSK = "#231A0E";
const DARK = "#1C1B18";

type RGB = [number, number, number];

function rgb(hex: string): RGB {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** Flatten `hex` at `alpha` over the opaque surface — what the chip's
 *  `backgroundColor: ${color}1A` actually resolves to. */
function tintOver(hex: string, alpha: number, surface: string): RGB {
  const f = rgb(hex);
  const b = rgb(surface);
  return [
    Math.round(f[0] * alpha + b[0] * (1 - alpha)),
    Math.round(f[1] * alpha + b[1] * (1 - alpha)),
    Math.round(f[2] * alpha + b[2] * (1 - alpha)),
  ];
}

/** Pull the two hexes out of `light-dark(#AAA, #BBB)`. */
function splitLightDark(value: string): { light: string; dark: string } {
  const m = /^light-dark\((#[0-9A-Fa-f]{6}),\s*(#[0-9A-Fa-f]{6})\)$/.exec(value);
  if (!m) throw new Error(`not a light-dark() pair: ${value}`);
  return { light: m[1], dark: m[2] };
}

describe("contrastRatio", () => {
  it("matches the WCAG reference extremes", () => {
    expect(contrastRatio(rgb("#000000"), rgb("#FFFFFF"))).toBeCloseTo(21, 5);
    expect(contrastRatio(rgb("#FFFFFF"), rgb("#FFFFFF"))).toBeCloseTo(1, 5);
  });

  it("is symmetric", () => {
    const a = rgb("#D4886A");
    const b = rgb("#FBF3F0");
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10);
  });
});

describe("stage chip text colour", () => {
  const stages = Object.entries(STAGE_PALETTE);

  it("covers the whole palette", () => {
    expect(stages.length).toBeGreaterThan(0);
  });

  it.each(stages)(
    "%s clears AA on every theme surface",
    (_stage, palette) => {
      const { light, dark } = splitLightDark(
        tintTextColor(palette.color, STAGE_TINT_ALPHA),
      );
      expect(
        contrastRatio(rgb(light), tintOver(palette.color, STAGE_TINT_ALPHA, LIGHT)),
      ).toBeGreaterThanOrEqual(AA);
      // Dusk is the lighter of the two dark card surfaces, so it is the
      // binding constraint; dark is asserted too in case that ever flips.
      expect(
        contrastRatio(rgb(dark), tintOver(palette.color, STAGE_TINT_ALPHA, DUSK)),
      ).toBeGreaterThanOrEqual(AA);
      expect(
        contrastRatio(rgb(dark), tintOver(palette.color, STAGE_TINT_ALPHA, DARK)),
      ).toBeGreaterThanOrEqual(AA);
    },
  );

  it("documents the failure it replaces — the raw hex never cleared AA on light", () => {
    for (const [, palette] of stages) {
      const raw = contrastRatio(
        rgb(palette.color),
        tintOver(palette.color, STAGE_TINT_ALPHA, LIGHT),
      );
      expect(raw).toBeLessThan(AA);
    }
  });

  it("leaves the dark themes on the raw brand hex wherever it already passed", () => {
    // `stalled` measured 8.4:1 in dark — the solver must not "fix" it.
    const { dark } = splitLightDark(
      tintTextColor(STAGE_PALETTE.stalled.color, STAGE_TINT_ALPHA),
    );
    expect(dark.toUpperCase()).toBe(STAGE_PALETTE.stalled.color.toUpperCase());
  });
});

describe("score disc text colour", () => {
  // 0.10 is the Leads-list disc, 0.12 the Kanban card disc.
  const alphas = [SCORE_TINT_ALPHA, 0.12];
  const tiers = [90, 60, 20]; // hot / warm / cool

  for (const alpha of alphas) {
    for (const score of tiers) {
      it(`score ${score} at ${alpha * 100}% tint clears AA on every theme surface`, () => {
        const hex = scoreHex(score);
        const { light, dark } = splitLightDark(tintTextColor(hex, alpha));
        expect(
          contrastRatio(rgb(light), tintOver(hex, alpha, LIGHT)),
        ).toBeGreaterThanOrEqual(AA);
        expect(
          contrastRatio(rgb(dark), tintOver(hex, alpha, DUSK)),
        ).toBeGreaterThanOrEqual(AA);
        expect(
          contrastRatio(rgb(dark), tintOver(hex, alpha, DARK)),
        ).toBeGreaterThanOrEqual(AA);
      });
    }
  }

  it("maps score bands to the canonical --hot / --warm / --cool hexes", () => {
    expect(scoreHex(75)).toBe("#D4886A");
    expect(scoreHex(74)).toBe("#D4A24A");
    expect(scoreHex(50)).toBe("#D4A24A");
    expect(scoreHex(49)).toBe("#4A7FC0");
    expect(scoreHex(0)).toBe("#4A7FC0");
  });
});

describe("aaTextOn", () => {
  it("returns the input unchanged when it already passes", () => {
    // Near-black on a near-white tint is already ~20:1.
    expect(aaTextOn("#000000", 0.1, LIGHT)).toBe("#000000");
  });

  it("is a no-op on malformed input rather than throwing", () => {
    expect(aaTextOn("not-a-hex", 0.1, LIGHT)).toBe("not-a-hex");
  });

  it("memoises tintTextColor so the virtualized list re-renders cheaply", () => {
    const a = tintTextColor("#D4886A", 0.1);
    const b = tintTextColor("#D4886A", 0.1);
    expect(a).toBe(b);
  });
});
