"use client";

/**
 * US coverage tile map.
 *
 * Replaces the empty floating-circle placeholder that previously sat
 * in the hero's right column. Each state is rendered as a small
 * rounded tile in a 12×7 grid that approximates the country's
 * geography. Tiles for states with permits ingested in the last 30
 * days light up in the brand terracotta with a subtle glow; the rest
 * sit as dim outlines.
 *
 * The grid layout is hand-tuned (no external geography deps, no
 * topojson, no d3). It's not a precise projection — the goal is
 * "this is the US, with these places covered" at a glance, not a
 * cartographic exercise.
 *
 * Data: receives `activeStates` from the server-fetched landing
 * stats. The component is otherwise pure — no client-side fetch, no
 * loading state, no skeleton.
 *
 * Truthfulness: the only thing this component asserts is "X states
 * have new permits in the last 30 days." That is a measurable
 * property of the database, not marketing copy.
 */

import { ALL_US_STATES, type UsState } from "@/lib/stats/landing";
import { cn } from "@/lib/utils/cn";

/**
 * (col, row) for each state. Rough US-shape approximation in a
 * 12-column × 7-row grid. Top-left = (0,0). Geography purists will
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

interface CoverageMapProps {
  /** States with new permits in the last 30 days — get from getLandingStats(). */
  activeStates: readonly UsState[];
  className?: string;
}

export function CoverageMap({ activeStates, className }: CoverageMapProps) {
  const activeSet = new Set<UsState>(activeStates);
  const width = COLS * STRIDE - GAP;
  const height = ROWS * STRIDE - GAP;

  return (
    <div className={cn("relative w-full max-w-[480px]", className)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="auto"
        role="img"
        aria-label={`US coverage map — ${activeStates.length} states active`}
        className="block"
      >
        {ALL_US_STATES.map((state) => {
          const pos = STATE_GRID[state];
          if (!pos) return null;
          const [col, row] = pos;
          const x = col * STRIDE;
          const y = row * STRIDE;
          const isActive = activeSet.has(state);
          return (
            <g key={state} transform={`translate(${x} ${y})`}>
              <rect
                width={CELL}
                height={CELL}
                rx={6}
                ry={6}
                className={cn(
                  "transition-colors duration-300",
                  isActive
                    ? "fill-primary/90 stroke-primary"
                    : "fill-transparent stroke-foreground/15",
                )}
                strokeWidth={1}
              />
              <text
                x={CELL / 2}
                y={CELL / 2}
                textAnchor="middle"
                dominantBaseline="central"
                className={cn(
                  "select-none font-medium",
                  isActive ? "fill-background" : "fill-foreground/40",
                )}
                style={{ fontSize: 11, letterSpacing: "0.02em" }}
              >
                {state}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
