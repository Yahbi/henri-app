/**
 * DB-driven permit source loader
 *
 * Loads active scraping configurations from the `permit_sources` table
 * instead of using the hardcoded PERMIT_SOURCES array.
 *
 * Sources are returned ordered by last_scraped_at ASC NULLS FIRST so
 * never-scraped sources are always prioritised.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import type { PermitSource } from "./sources";

export interface DBPermitSource extends PermitSource {
  source_key: string;
  source_type: "socrata" | "arcgis" | "ckan";
  auth: string;
  update_freq: string | null;
  layer_index: number;
}

export async function getActiveSources(limit = 50): Promise<DBPermitSource[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("permit_sources")
    .select("source_key, city, jurisdiction, state, endpoint, source_type, auth, update_freq, layer_index, id_field, type_field, status_field, desc_field, address_field, date_field, value_field, lat_field, lng_field, enabled")
    .eq("enabled", true)
    .order("last_scraped_at", { ascending: true, nullsFirst: true })
    .limit(limit);

  if (error) {
    console.error("Failed to load permit sources from DB:", error.message);
    return [];
  }

  return (data ?? []).map((row) => ({
    source_key:   row.source_key,
    city:         row.city ?? row.jurisdiction ?? "",
    state:        row.state,
    endpoint:     row.endpoint,
    source_type:  row.source_type as "socrata" | "arcgis" | "ckan",
    auth:         row.auth ?? "none",
    update_freq:  row.update_freq ?? null,
    layer_index:  row.layer_index ?? 0,
    // PermitSource field mappings
    idField:      row.id_field ?? "id",
    typeField:    row.type_field ?? "permit_type",
    statusField:  row.status_field ?? "status",
    descField:    row.desc_field ?? "description",
    addressField: row.address_field ?? "address",
    dateField:    row.date_field ?? "issue_date",
    valueField:   row.value_field ?? "estimated_value",
    latField:     row.lat_field ?? "latitude",
    lngField:     row.lng_field ?? "longitude",
  }));
}

/** Mark a source as successfully scraped */
export async function markSourceScraped(
  sourceKey: string,
  rowCount: number
): Promise<void> {
  const supabase = createAdminClient();
  await supabase
    .from("permit_sources")
    .update({
      last_scraped_at: new Date().toISOString(),
      last_count: rowCount,
      error_count: 0,
    })
    .eq("source_key", sourceKey);
}

/** Increment error count on a source (disables after 10 consecutive errors) */
export async function markSourceError(sourceKey: string): Promise<void> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("permit_sources")
    .select("error_count")
    .eq("source_key", sourceKey)
    .single();

  const newCount = (data?.error_count ?? 0) + 1;
  await supabase
    .from("permit_sources")
    .update({
      error_count: newCount,
      enabled: newCount < 10, // auto-disable after 10 consecutive errors
    })
    .eq("source_key", sourceKey);
}
