/**
 * US coverage tile map.
 *
 * Each state is a rounded tile in a 12x7 grid that approximates the
 * country's geography, shaded by how many permits Henri actually holds
 * for that state. The grid is hand-tuned (no topojson, no d3, no
 * external geography deps) — the goal is "this is the US, and here is
 * where the catalog is deep" at a glance, not a cartographic exercise.
 *
 * 2026-08-04 — real volume, not a binary.
 * Until now this rendered a lit/unlit binary driven by a hand-curated
 * array of 25 state codes frozen on 2026-05-07, because the underlying
 * `GROUP BY state` is a 37s parallel sequential scan (measured) against
 * PostgREST's 8s statement_timeout — the map structurally could not
 * tell the truth. Migration 00115 moved that aggregate into the
 * `landing_stats` cache, so `statePermits` now carries a live per-state
 * histogram and every tile is shaded by real volume with its exact
 * count exposed on hover.
 *
 * Graceful degrade: when `statePermits` is empty (cache row missing, or
 * the build ran without Supabase secrets) the component falls back to
 * the previous lit/unlit rendering driven by `activeStates`. It never
 * renders a state as "0 permits" on missing data — absent means unknown.
 *
 * Truthfulness: every number here is a stored count. The only editorial
 * choice is ACTIVE_STATE_MIN_PERMITS, the floor at which we are willing
 * to call a state "covered" — states below it still render, in their
 * own dimmer tier, rather than being hidden.
 */

import {
  ALL_US_STATES,
  ACTIVE_STATE_MIN_PERMITS,
  type UsState,
} from "@/lib/stats/us-states";
import { cn } from "@/lib/utils/cn";

/**
 * (col, row) for each state. Rough US-shape approximation in a
 * 12-column x 7-row grid. Top-left = (0,0). Geography purists will
 * have notes; the grid trades pinpoint accuracy for legibility.
 */
const STATE_GRID: Record<UsState, [col: number, row: number]> = {
  // Top row — northern New England
  VT: [9, 0],
  NH: [10, 0],
  ME: [11, 0],

  // Row 1 — northern tier
  WA: [1, 1],
  ID: [2, 1],
  MT: [3, 1],
  ND: [4, 1],
  MN: [5, 1],
  WI: [6, 1],
  MI: [7, 1],
  NY: [9, 1],
  MA: [10, 1],

  // Row 2 — Pacific NW down to upper Midwest, into Mid-Atlantic
  AK: [0, 2],
  OR: [1, 2],
  NV: [2, 2],
  WY: [3, 2],
  SD: [4, 2],
  IA: [5, 2],
  IL: [6, 2],
  IN: [7, 2],
  OH: [8, 2],
  PA: [9, 2],
  CT: [10, 2],
  RI: [11, 2],

  // Row 3 — California coast east to the seaboard
  HI: [0, 3],
  CA: [1, 3],
  UT: [2, 3],
  CO: [3, 3],
  NE: [4, 3],
  MO: [5, 3],
  KY: [6, 3],
  WV: [7, 3],
  VA: [8, 3],
  NJ: [9, 3],
  DE: [10, 3],

  // Row 4 — south-central + DC/MD
  AZ: [2, 4],
  NM: [3, 4],
  KS: [4, 4],
  AR: [5, 4],
  TN: [6, 4],
  NC: [7, 4],
  DC: [9, 4],
  MD: [10, 4],

  // Row 5 — deep south
  OK: [4, 5],
  LA: [5, 5],
  MS: [6, 5],
  AL: [7, 5],
  GA: [8, 5],
  SC: [9, 5],

  // Row 6 — Texas and Florida
  TX: [4, 6],
  FL: [8, 6],
};

const COLS = 12;
const ROWS = 7;
const CELL = 38; // px per tile
const GAP = 4; // px between tiles
const STRIDE = CELL + GAP;

/**
 * Volume tiers. Thresholds are eyeballed against the live distribution
 * (2026-08-04: CA 615k at the top, a dense 20k-70k middle, a long tail
 * of states holding single-digit rows) so that all five tiers are
 * actually populated — a scale where one tier is always empty reads as
 * a rendering bug.
 *
 * `seeded` is deliberately distinct from `covered`: those states have
 * permits but not enough to promise a contractor anything, so they get
 * a visible-but-faint treatment instead of being counted in the
 * "N states" headline. See ACTIVE_STATE_MIN_PERMITS.
 */
type Tier = "none" | "seeded" | "low" | "mid" | "high" | "top";

const TIER_MIN: ReadonlyArray<[Tier, number]> = [
  ["top", 100_000],
  ["high", 25_000],
  ["mid", 5_000],
  ["low", ACTIVE_STATE_MIN_PERMITS],
];

function tierFor(count: number | undefined): Tier {
  if (count == null || count <= 0) return "none";
  for (const [tier, min] of TIER_MIN) {
    if (count >= min) return tier;
  }
  return "seeded";
}

/* Tailwind needs literal class strings, so these can't be templated. */
const TIER_STYLES: Record<Tier, { rect: string; text: string }> = {
  none: { rect: "fill-transparent stroke-foreground/15", text: "fill-foreground/35" },
  seeded: { rect: "fill-primary/15 stroke-primary/25", text: "fill-foreground/60" },
  low: { rect: "fill-primary/35 stroke-primary/45", text: "fill-foreground/80" },
  mid: { rect: "fill-primary/55 stroke-primary/65", text: "fill-foreground" },
  high: { rect: "fill-primary/80 stroke-primary", text: "fill-background" },
  top: { rect: "fill-primary stroke-primary", text: "fill-background" },
};

/** Legend swatches, densest first — mirrors how the eye reads the map. */
const LEGEND: ReadonlyArray<{ tier: Tier; label: string }> = [
  { tier: "top", label: "100k+" },
  { tier: "high", label: "25k+" },
  { tier: "mid", label: "5k+" },
  { tier: "low", label: "500+" },
  { tier: "seeded", label: "Seeded" },
];

const nf = new Intl.NumberFormat("en-US");

interface CoverageMapProps {
  /** States at or above ACTIVE_STATE_MIN_PERMITS — from getLandingStats(). */
  activeStates: readonly UsState[];
  /**
   * Live per-state permit counts from the `landing_stats` cache. Absent
   * keys mean "no data", not zero. Empty object degrades the map to the
   * lit/unlit rendering driven by `activeStates`.
   */
  statePermits?: Readonly<Partial<Record<UsState, number>>>;
  /** Optional caption line, e.g. "2.2M+ permits · 18,000+ ZIP codes". */
  caption?: string;
  className?: string;
}

export function CoverageMap({
  activeStates,
  statePermits,
  caption,
  className,
}: CoverageMapProps) {
  const counts = statePermits ?? {};
  const hasHistogram = Object.keys(counts).length > 0;
  const activeSet = new Set<UsState>(activeStates);
  const width = COLS * STRIDE - GAP;
  const height = ROWS * STRIDE - GAP;

  return (
    <div className={cn("relative w-full max-w-[480px]", className)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        // No `height`. SVG geometry attributes take a <length>; `auto` is a
        // CSS-only keyword, so the attribute parser rejected it and every
        // single homepage view logged `Error: <svg> attribute height:
        // Expected length, "auto"`. The map rendered correctly anyway — the
        // viewBox plus `w-full` already give it an intrinsic ratio — so the
        // only symptom was a guaranteed error on the most-visited page,
        // burning the Sentry free tier's 5k events/month on a non-bug and
        // burying real errors underneath it.
        role="img"
        aria-label={
          hasHistogram
            ? `US coverage map. ${activeStates.length} states with active permit coverage, shaded by permit volume.`
            : `US coverage map — ${activeStates.length} states active`
        }
        className="block"
      >
        {ALL_US_STATES.map((state) => {
          const pos = STATE_GRID[state];
          if (!pos) return null;
          const [col, row] = pos;
          const count = counts[state];
          // Without a histogram, reproduce the old binary so the map
          // still reads correctly rather than going entirely dark.
          const tier: Tier = hasHistogram
            ? tierFor(count)
            : activeSet.has(state)
              ? "high"
              : "none";
          const style = TIER_STYLES[tier];
          return (
            <g key={state} transform={`translate(${col * STRIDE} ${row * STRIDE})`}>
              {/* Native tooltip — no JS, works on hover and for the
                  accessibility tree since the parent is role="img". */}
              <title>
                {count != null
                  ? `${state} — ${nf.format(count)} permit${count === 1 ? "" : "s"}`
                  : `${state} — no coverage yet`}
              </title>
              <rect
                width={CELL}
                height={CELL}
                rx={6}
                ry={6}
                className={cn("transition-colors duration-300", style.rect)}
                strokeWidth={1}
              />
              <text
                x={CELL / 2}
                y={CELL / 2}
                textAnchor="middle"
                dominantBaseline="central"
                className={cn("select-none font-medium", style.text)}
                style={{ fontSize: 11, letterSpacing: "0.02em" }}
              >
                {state}
              </text>
            </g>
          );
        })}
      </svg>

      {hasHistogram && (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Permits
          </span>
          {LEGEND.map(({ tier, label }) => (
            <span key={tier} className="flex items-center gap-1.5">
              <svg width={10} height={10} aria-hidden="true" className="shrink-0">
                <rect
                  width={10}
                  height={10}
                  rx={2}
                  className={TIER_STYLES[tier].rect}
                  strokeWidth={1}
                />
              </svg>
              <span className="text-[11px] text-muted-foreground">{label}</span>
            </span>
          ))}
        </div>
      )}

      {caption && (
        <p className="mt-3 text-xs text-muted-foreground">{caption}</p>
      )}
    </div>
  );
}
