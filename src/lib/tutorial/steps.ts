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
 * Adding/removing steps:
 *   - Keep total <=14. Beyond that, completion drops fast.
 *   - Each `target` must be a CSS selector that resolves on the
 *     declared `route` (Joyride retries up to 5s for late mounts).
 *   - The very first step uses `placement: "center"` so it appears
 *     as a centered welcome modal instead of pointing at an element.
 */

export interface TourStep extends Step {
  /** Route the target element lives on. Tour navigates here before showing. */
  route?: string;
}

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
    placement: "right",
    route: "/dashboard",
  },
  {
    target: "[data-tour='lead-map']",
    title: "Map view",
    content:
      "Pins show every geocoded lead. Toggle overlays (storm radar, FEMA flood, parcels) from the layer button to spot patterns at a glance.",
    placement: "left",
    route: "/dashboard",
  },
  {
    target: "[data-tour='dashboard-nav-leads']",
    title: "Leads tab",
    content:
      "The full list view of every lead, with filters by trade, urgency, and ZIP. Best when you want to bulk-review the queue.",
    placement: "bottom",
    route: "/dashboard",
  },
  {
    target: "[data-tour='dashboard-nav-pipeline']",
    title: "Pipeline (kanban)",
    content:
      "Drag leads through your pipeline stages: New → Contacted → Quoted → Won / Lost. The view auto-syncs with your lead status.",
    placement: "bottom",
    route: "/dashboard",
  },
  {
    target: "[data-tour='dashboard-nav-estimate']",
    title: "Estimate builder",
    content:
      "Build Good / Better / Best estimates from the trade-cost library, save them to a lead, and email or text the homeowner directly.",
    placement: "bottom",
    route: "/dashboard",
  },
  {
    target: "[data-tour='dashboard-nav-outreach']",
    title: "Outreach templates",
    content:
      "50 system-default email + SMS templates seeded for your trade. Customize, save your own, and send permit-specific messages in one click.",
    placement: "bottom",
    route: "/dashboard",
  },
  {
    target: "[data-tour='dashboard-nav-storm']",
    title: "Storm Center",
    content:
      "Live NOAA radar + a daily storm-events feed. When severe weather hits a ZIP you cover, affected leads bubble up with a storm-impact urgency boost.",
    placement: "bottom",
    route: "/dashboard",
  },
  {
    target: "[data-tour='dashboard-nav-intel']",
    title: "Market intel",
    content:
      "ZIP-level demand scores, project-value medians, and recent permit volume — useful when deciding which territories to add to your plan.",
    placement: "bottom",
    route: "/dashboard",
  },
  {
    target: "[data-tour='dashboard-nav-compliance']",
    title: "Compliance",
    content:
      "Henri re-verifies your contractor license every 24 hours against the state board. If it lapses, lead delivery pauses — you'll see the status here.",
    placement: "bottom",
    route: "/dashboard",
  },
  {
    target: "[data-tour='topbar-settings']",
    title: "Settings & billing",
    content:
      "Manage your plan, ZIP territories, capacity preferences, and notification settings. The Replay tutorial button lives here too.",
    placement: "bottom-end",
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
