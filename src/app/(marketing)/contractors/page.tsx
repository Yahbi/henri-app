/**
 * /contractors — server shell.
 *
 * The page body is a large client component (accordions, tab state, the
 * pricing toggle), so it cannot call the server-only `getLandingStats()`
 * itself. For months that meant the permit count on this page was a
 * hand-maintained constant, bumped by a human on 2026-05-03, 2026-06-10
 * and 2026-08-04 — and stale on at least two of those, always UNDER-stating
 * coverage, because nobody notices a drifted literal until an audit.
 *
 * This shell fixes that the same way the homepage already did: fetch on the
 * server, pass measured labels down as props. The client component keeps all
 * its interactivity; it just stops inventing its own numbers.
 *
 * `revalidate = 3600` makes this ISR rather than build-time static. Without
 * it the numbers would freeze at deploy time and only move on the next push,
 * which is the same staleness problem in a different costume.
 */

import { getLandingStats } from "@/lib/stats/landing";
import { ContractorsContent } from "./ContractorsContent";

export const revalidate = 3600;

export default async function ContractorsPage() {
  const stats = await getLandingStats();

  return (
    <ContractorsContent
      permitsLabel={stats.permitsLabel}
      activeStatesLabel={stats.activeStatesLabel}
    />
  );
}
