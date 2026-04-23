import { redirect } from "next/navigation";

/**
 * Utility route: the full leads list lives on the main dashboard at
 * `/dashboard` (LeadsPanel + LeadDetailDrawer). This redirect keeps
 * legacy links (e.g. from old emails / permit-row clicks that pointed
 * at /dashboard/leads) alive. The /dashboard/leads/[id]/page.tsx child
 * route opens the specific lead in the drawer via ?focus=.
 */
export default function LeadsPage() {
  redirect("/dashboard");
}
