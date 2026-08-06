import { redirect } from "next/navigation";

/**
 * Utility route. `/dashboard/permits` used to render its own permit table —
 * a second, diverging copy of the lead list already shown by
 * `/dashboard` (LeadsPanel + LeadDetailDrawer), fed by the same `useLeads`
 * hook and filtered to rows that happen to carry permit fields. Nothing in
 * the app linked to it (it is not in CORE_TABS, not in the command palette,
 * and not referenced by any nav), so it was reachable only by typing the URL
 * — while quietly needing the same maintenance as the real leads surface.
 *
 * Redirecting rather than deleting keeps any legacy link (old emails,
 * bookmarks, the archived scripts/_archive/audit-app.ts route list) landing
 * somewhere useful instead of on a 404. Mirrors the existing redirect at
 * src/app/(dashboard)/dashboard/leads/page.tsx.
 */
export default function PermitsPage() {
  redirect("/dashboard");
}
