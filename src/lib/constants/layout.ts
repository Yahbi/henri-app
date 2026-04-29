/**
 * Shared layout constants used by the dashboard + its panels.
 *
 * These are NOT design tokens (tokens live in `src/app/globals.css`
 * as CSS vars); they're runtime JS numbers that state-management code
 * reads to seed initial sizes / persist user resize preferences. Keeping
 * them centralised means the "wedge contract #2 demands the score
 * breakdown be visible" commitment survives page-level refactors —
 * anyone changing the drawer default height has to come here and confront
 * the comment explaining why 420 is the minimum, not just 240.
 */

/** Left leads-panel default width in px. Collapses to COLLAPSED_WIDTH
 *  on user toggle. Growable up to LEFT_PANEL_MAX. */
export const LEFT_PANEL_DEFAULT = 320;

/** Left leads-panel max width — hard ceiling so a curious drag can't
 *  eat the entire map. 900px fits comfortably on 1440+ displays. */
export const LEFT_PANEL_MAX = 900;

/** Left panel when collapsed to the rail (expand chevron + count badge). */
export const LEFT_PANEL_COLLAPSED = 44;

/**
 * Lead-detail drawer default height in px.
 *
 * MUST be large enough that `ScoreSignalBreakdown` (the 6-signal
 * transparency pane, wedge contract #2) is visible without any scroll.
 * At 420px the breakdown lands above the fold on ≥900px viewports and
 * within the first scroll-viewport on shorter screens. Do NOT lower
 * without reviewing the wedge-contract compliance check in
 * `src/components/dashboard/LeadDetailDrawer.tsx` — the drawer has
 * height-gated secondary content (Competitive Window at >250px,
 * Recommended Actions at >280px, Property Details at >250px) but the
 * score breakdown itself is always rendered. The minimum default that
 * satisfies "breakdown visible without scroll" is empirically ~400px.
 */
export const BOTTOM_PANEL_DEFAULT = 420;

/** Minimum drawer height the user can drag to before the drag-handle
 *  floors it. Matches `MIN_HEIGHT` in LeadDetailDrawer. */
export const BOTTOM_PANEL_MIN = 140;

/** Maximum drawer height as a ratio of the parent container (map +
 *  drawer region). Caps the drag so the lead list stays visible. */
export const BOTTOM_PANEL_MAX_RATIO = 0.92;
