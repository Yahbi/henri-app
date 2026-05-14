import { redirect } from "next/navigation";

/**
 * Utility detail route. Navigating to /dashboard/leads/{id} (e.g. from
 * the Permits table row click, a Slack-pasted share link, or an email
 * deep-link) redirects to the main dashboard with `?focus={id}` so the
 * panel auto-opens that lead's drawer.
 *
 * Kept as a thin redirect rather than a standalone detail view because
 * the dashboard already has the map + LeadDetailDrawer + surrounding
 * context — duplicating the detail surface would drift over time.
 *
 * Phase AA — extended to forward incoming search params (utm_*, from=...,
 * etc.) so attribution tags survive the bounce. `?focus=` is forced to
 * the path-param id even if the caller passed a conflicting one.
 *
 * RLS on `leads` already enforces that contractors only see their own
 * rows, so a deep-link to a lead the viewer doesn't own falls through
 * to the drawer's "lead not found" path. No extra auth check needed.
 */
export default async function LeadDetailRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === "focus") continue;
    if (Array.isArray(v)) v.forEach((vv) => out.append(k, vv));
    else if (typeof v === "string") out.set(k, v);
  }
  out.set("focus", id);

  redirect(`/dashboard?${out.toString()}`);
}
