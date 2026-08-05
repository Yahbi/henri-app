/**
 * /portal — server shell.
 *
 * Same shape as /contractors: the body is a client component (the intake
 * chat modal, the ZIP form, the FAQ accordion), so it cannot reach the
 * server-only `getLandingStats()`. Its coverage stat was therefore a
 * hardcoded "30+" that could only ever be corrected by a human noticing it
 * had drifted.
 *
 * `revalidate = 3600` keeps this ISR rather than frozen at build time.
 */

import { getLandingStats } from "@/lib/stats/landing";
import { PortalContent } from "./PortalContent";

export const revalidate = 3600;

export default async function PortalPage() {
  const stats = await getLandingStats();

  return <PortalContent activeStatesLabel={stats.activeStatesLabel} />;
}
