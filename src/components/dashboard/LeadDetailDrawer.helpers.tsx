/**
 * LeadDetailDrawer.helpers.tsx
 *
 * Pure helpers + tiny presentational components extracted from
 * `LeadDetailDrawer.tsx` so the giant component body (1,000+ LOC) shrinks
 * by ~80 lines and these utilities become independently testable.
 *
 * Audit-04-29 (priority D): the drawer was 1,127 LOC. Step 1 of the refactor
 * was to pull out the no-state, no-context helpers. The render-method body
 * itself still needs further surgery — see the spawned follow-up task.
 *
 * Contents:
 *   - SOURCE_LABELS: snake_case enrichment-source key → human-readable name
 *   - formatSource(): one-line resolver with a sensible underscores-to-spaces fallback
 *   - ProvenanceChip: tiny "via X" attribution badge
 *   - scoreColor() / scoreLabel(): map a 0-100 score to UI tokens
 *   - formatDate(): "Jan 5, 2026" formatter with a "---" fallback
 */

/* Phase 2.6 (2026-04-26 session): per-field provenance attribution.
 *
 * The orchestrator at `src/lib/enrichment/orchestrator.ts` writes the
 * primary contact source into `leads.contact_source` (string) — e.g.
 * "voter_file_fl", "opencorporates", "apollo", "numverify". We surface
 * this as a tiny "via X" chip below the relevant contact row so the
 * contractor can see WHERE each piece of data came from. Trust-building.
 *
 * Source-label mapping: snake_case → human-readable. Falls back to the
 * raw label for unknown sources (better than dropping the chip).
 */
export const SOURCE_LABELS: Record<string, string> = {
  upstream: "permit",
  same_address_permit: "sibling permit",
  voter_file_fl: "FL voter file",
  voter_file_nc: "NC voter file",
  voter_file_oh: "OH voter file",
  county_gis: "county GIS",
  regrid: "Regrid",
  contractor_license: "license board",
  cslb: "CSLB",
  opencorporates: "OpenCorporates",
  fec: "FEC",
  voter_reg_vendor: "voter reg",
  hunter_io: "Hunter",
  google_places: "Google Places",
  yelp: "Yelp",
  osm_contact: "OpenStreetMap",
  ppp_sba: "PPP loan",
  permit_description: "permit text",
  numverify: "Numverify",
  cloudmersive: "Cloudmersive",
  weatherstack: "WeatherStack",
  apollo: "Apollo",
};

export function formatSource(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return SOURCE_LABELS[raw] ?? raw.replace(/_/g, " ");
}

/** Tiny attribution chip rendered below an enriched value. Pure CSS,
 *  zero data fetching — sources are already on the lead row. */
export function ProvenanceChip({
  source,
}: {
  source: string | null | undefined;
}) {
  const label = formatSource(source);
  if (!label) return null;
  return (
    <span className="text-[9px] text-muted-foreground/70 italic ml-[18px]">
      via {label}
    </span>
  );
}

export function scoreColor(score: number) {
  if (score >= 75) return "text-hot border-hot";
  if (score >= 50) return "text-warm border-warm";
  return "text-cool border-cool";
}

export function scoreLabel(score: number) {
  if (score >= 75) return "Hot Lead";
  if (score >= 50) return "Warm Lead";
  if (score >= 25) return "Cool Lead";
  return "Cold Lead";
}

export function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return "---";
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "---";
  }
}
