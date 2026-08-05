/**
 * DB-driven permit source loader
 *
 * Loads active scraping configurations from the `permit_sources` table
 * instead of using the hardcoded PERMIT_SOURCES array.
 *
 * Two-lane rotation (2026-06-09 starvation fix): producers (last_count > 0)
 * get 60% of each run's slots so proven city feeds stay fresh; explorers
 * (never-produced) fill the rest so new endpoints still get probed. The old
 * pure `last_scraped_at ASC NULLS FIRST` order let the ~50 never-scraped
 * stubs that activate-arcgis-sources enables daily monopolize every run —
 * verified feeds (e.g. Tampa, the only territory-holding market) starved
 * for 7+ weeks behind 12k unverified hub stubs.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import type { PermitSource } from "./sources";

export interface DBPermitSource extends PermitSource {
  source_key: string;
  source_type: "socrata" | "arcgis" | "ckan";
  auth: string;
  update_freq: string | null;
  layer_index: number;
}

const SOURCE_COLUMNS =
  "source_key, city, jurisdiction, state, endpoint, source_type, auth, update_freq, layer_index, id_field, type_field, status_field, desc_field, address_field, date_field, value_field, lat_field, lng_field, enabled";

export async function getActiveSources(limit = 50): Promise<DBPermitSource[]> {
  const supabase = createAdminClient();

  const producerSlots = Math.ceil(limit * 0.6);

  // priority DESC first in BOTH lanes so human-verified / high-value
  // sources (priority=10, e.g. the Tampa territory feed + GOLD contact
  // feeds) always scrape before the long tail, then last_scraped_at
  // rotates within each priority band.
  const [producersRes, explorersRes] = await Promise.all([
    // Lane A: proven producers, highest priority + oldest-scraped first.
    supabase
      .from("permit_sources")
      .select(SOURCE_COLUMNS)
      .eq("enabled", true)
      .gt("last_count", 0)
      .order("priority", { ascending: false })
      .order("last_scraped_at", { ascending: true, nullsFirst: true })
      .limit(producerSlots),
    // Lane B: never-produced explorers (NULL or 0 last_count).
    supabase
      .from("permit_sources")
      .select(SOURCE_COLUMNS)
      .eq("enabled", true)
      .or("last_count.is.null,last_count.eq.0")
      .order("priority", { ascending: false })
      .order("last_scraped_at", { ascending: true, nullsFirst: true })
      .limit(limit),
  ]);

  if (producersRes.error && explorersRes.error) {
    logger.error("Failed to load permit sources from DB", {
      error: producersRes.error.message,
    });
    return [];
  }
  if (producersRes.error) {
    logger.warn("Producer-lane query failed; running explorers only", {
      error: producersRes.error.message,
    });
  }
  if (explorersRes.error) {
    logger.warn("Explorer-lane query failed; running producers only", {
      error: explorersRes.error.message,
    });
  }

  const producers = producersRes.data ?? [];
  const seen = new Set(producers.map((r) => r.source_key));
  const data = [
    ...producers,
    ...(explorersRes.data ?? []).filter((r) => !seen.has(r.source_key)),
  ].slice(0, limit);

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

/**
 * Fetch specific sources by key, bypassing the producer/explorer rotation.
 *
 * Exists so a newly-registered feed can actually be TESTED. getActiveSources()
 * splits every run 60/40 between proven producers and the ~12k never-produced
 * explorer stubs, so a freshly-added high-value source can wait many runs for a
 * slot — and until it gets one there is no way to tell a correct field mapping
 * from a wrong one. Used by /api/cron/scrape?source_key=a,b,c.
 *
 * Still respects `enabled`, so this cannot resurrect a deliberately-disabled
 * source.
 */
export async function getSourcesByKeys(keys: string[]): Promise<DBPermitSource[]> {
  if (keys.length === 0) return [];
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("permit_sources")
    .select(SOURCE_COLUMNS)
    .in("source_key", keys)
    .eq("enabled", true);

  if (error) {
    logger.error("sources-db.by-keys-failed", { error: error.message, keys });
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
