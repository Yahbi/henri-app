import type { Step } from "react-joyride";

/**
 * Contractor first-run guided tour.
 *
 * The tour fires on first dashboard visit after onboarding completes
 * (gated by profiles.tutorial_completed_at IS NULL). Steps anchor to
 * DOM elements via `data-tour="..."` attributes on the actual UI;
 * those attributes are added inline at each anchor site.
 *
 * Cross-route navigation: when a step's `target` is on a different
 * route, the tour controller (ContractorTour) navigates first and
 * waits for the element to mount before showing the step. The
 * `route` field on each step tells the controller which path the
 * target lives at.
 *
 * Overlay policy (changed 2026-04-30 per founder feedback):
 *   - Welcome + Finish: keep the dim overlay (modal feel).
 *   - Every other step: hideOverlay=true. The user can still see the
 *     map + overlays + nav while reading the tooltip; only the
 *     spotlight outlines the target. Eliminates the "the map isn't
 *     showing" perception when the tour is open.
 *
 * Placement policy:
 *   - Anything on the leftmost rail (leads-panel) gets `right-start`
 *     with bottom/top fallbacks ONLY — never flip to `left` since the
 *     tooltip would push past the viewport's left edge.
 *   - The map step uses `bottom-end` so the tooltip lands at the
 *     bottom-right of the map area, away from the leads panel.
 */

export interface TourStep extends Step {
  /** Route the target element lives on. Tour navigates here before showing. */
  route?: string;
}

/* Floating-UI options that EXCLUDE `left` from the auto-flip fallback
 * chain. Used on every step that targets a left-side element so the
 * tooltip never gets clipped by the viewport's left edge. The mutable
 * arrays are required by Joyride's flipOptions.fallbackPlacements
 * (Placement[], not readonly tuple). */
const NEVER_FLIP_LEFT = {
  flipOptions: {
    fallbackPlacements: ["bottom-start" as const, "top-start" as const, "bottom" as const],
  },
};

/* Floating-UI options for top-bar nav buttons — keep tooltip below the
 * topbar; if there's no room below, fall back to bottom-start (anchored
 * to the button's left edge) instead of going above into the topbar. */
const TOPBAR_FLIP = {
  flipOptions: {
    fallbackPlacements: ["bottom-start" as const, "bottom-end" as const],
  },
};

export const CONTRACTOR_TOUR_STEPS: TourStep[] = [
  {
    target: "body",
    placement: "center",
    title: "Welcome to Henri.",
    content:
      "Quick tour of the dashboard — about 90 seconds. You can skip any time and replay it later from Settings.",
    route: "/dashboard",
  },
  {
    target: "[data-tour='leads-panel']",
    title: "Your lead list",
    content:
      "Every permit Henri has scored for your territory shows up here, sorted hottest-first. Click any row to open the detail drawer.",
    placement: "right-start",
    hideOverlay: true,
    floatingOptions: NEVER_FLIP_LEFT,
    route: "/dashboard",
  },
  {
    target: "[data-tour='lead-map']",
    title: "Map view",
    content:
      "Pins show every geocoded lead. Toggle overlays (storm radar, FEMA flood, parcels) from the layer button top-left of the map to spot patterns at a glance.",
    placement: "bottom-end",
    hideOverlay: true,
    route: "/dashboard",
  },
  {
    target: "[data-tour='dashboard-nav-leads']",
    title: "Leads tab",
    content:
      "The full list view of every lead, with filters by trade, urgency, and ZIP. Best when you want to bulk-review the queue.",
    placement: "bottom-start",
    hideOverlay: true,
    floatingOptions: TOPBAR_FLIP,
    route: "/dashboard",
  },
  {
    target: "[data-tour='dashboard-nav-pipeline']",
    title: "Pipeline (kanban)",
    content:
      "Drag leads through your pipeline stages: New → Contacted → Quoted → Won / Lost. The view auto-syncs with your lead status.",
    placement: "bottom-start",
    hideOverlay: true,
    floatingOptions: TOPBAR_FLIP,
    route: "/dashboard",
  },
  {
    target: "[data-tour='dashboard-nav-estimate']",
    title: "Estimate builder",
    content:
      "Build Good / Better / Best estimates from the trade-cost library, save them to a lead, and email or text the homeowner directly.",
    placement: "bottom-start",
    hideOverlay: true,
    floatingOptions: TOPBAR_FLIP,
    route: "/dashboard",
  },
  {
    target: "[data-tour='dashboard-nav-outreach']",
    title: "Outreach templates",
    content:
      "50 system-default email + SMS templates seeded for your trade. Customize, save your own, and send permit-specific messages in one click.",
    placement: "bottom-start",
    hideOverlay: true,
    floatingOptions: TOPBAR_FLIP,
    route: "/dashboard",
  },
  {
    target: "[data-tour='dashboard-nav-storm']",
    title: "Storm Center",
    content:
      "Live NOAA radar + a daily storm-events feed. When severe weather hits a ZIP you cover, affected leads bubble up with a storm-impact urgency boost.",
    placement: "bottom-start",
    hideOverlay: true,
    floatingOptions: TOPBAR_FLIP,
    route: "/dashboard",
  },
  {
    target: "[data-tour='dashboard-nav-intel']",
    title: "Market intel",
    content:
      "ZIP-level demand scores, project-value medians, and recent permit volume — useful when deciding which territories to add to your plan.",
    placement: "bottom-start",
    hideOverlay: true,
    floatingOptions: TOPBAR_FLIP,
    route: "/dashboard",
  },
  {
    target: "[data-tour='dashboard-nav-compliance']",
    title: "Compliance",
    content:
      "Henri re-verifies your contractor license every 24 hours against the state board. If it lapses, lead delivery pauses — you'll see the status here.",
    placement: "bottom-start",
    hideOverlay: true,
    floatingOptions: TOPBAR_FLIP,
    route: "/dashboard",
  },
  {
    target: "[data-tour='topbar-settings']",
    title: "Settings & billing",
    content:
      "Manage your plan, ZIP territories, capacity preferences, and notification settings. The Replay tutorial button lives here too.",
    placement: "bottom-end",
    hideOverlay: true,
    route: "/dashboard",
  },
  {
    target: "body",
    placement: "center",
    title: "You're all set",
    content:
      "That's the tour. Open any lead to see the full enriched packet — homeowner contact, score breakdown, and outreach options. Good luck out there.",
    route: "/dashboard",
  },
];
