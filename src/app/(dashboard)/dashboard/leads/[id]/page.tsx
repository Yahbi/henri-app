import { redirect } from "next/navigation";

/**
 * Utility detail route. Navigating to /dashboard/leads/{id} (e.g. from
 * the Permits table row click) redirects to the main dashboard with
 * ?focus={id} so the panel auto-opens that lead's drawer.
 *
 * Kept as a thin redirect rather than a standalone detail view because
 * the dashboard already has the map + LeadDetailDrawer + surrounding
 * context — duplicating the detail surface would drift over time.
 */
export default async function LeadDetailRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/dashboard?focus=${encodeURIComponent(id)}`);
}
