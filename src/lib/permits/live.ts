/* ── Live Socrata Permit Fetcher ──────────────────────────────────────────────
 * Fetches real permit data directly from Socrata Open Data APIs.
 * Used in demo/preview mode to display genuine permit records on the map
 * instead of hardcoded sample data.
 *
 * Server-side only — called from API routes.
 * ────────────────────────────────────────────────────────────────────────── */

import { PERMIT_SOURCES } from "./sources";
import { fetchPermits, type NormalizedPermit } from "./fetcher";
import { logger } from "@/lib/logger";
import type { Lead, LeadUrgency } from "@/types/lead";
import { getUrgency } from "@/types/lead";
import { enrichProperty } from "@/lib/enrichment/pipeline";

/* ── In-memory cache ──────────────────────────────────────────────────────── */

interface CacheEntry {
  data: Lead[];
  timestamp: number;
}

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let cachedLeads: CacheEntry | null = null;

/* ── Source selection ──────────────────────────────────────────────────────
 * These Socrata portals are the most reliable, have coordinates, and
 * return rich work-description fields.
 * ────────────────────────────────────────────────────────────────────────── */

const LIVE_SOURCE_IDS = ["la", "chicago", "nyc", "cincinnati"];

/* ── Simple deterministic hash for stable score generation ────────────── */

function hashCode(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/* ── Convert NormalizedPermit → Lead ──────────────────────────────────── */

function permitToLead(p: NormalizedPermit, index: number): Lead {
  const daysOld = p.applied_date
    ? Math.max(0, Math.floor((Date.now() - new Date(p.applied_date).getTime()) / 86_400_000))
    : 0;

  // Score based on real permit characteristics
  // Aligned with 6-signal model: freshness/value max 20, contact 15, demand 15.
  // engagement and conversion not available live; score out of 70 + normalize.
  const freshnessScore = Math.min(20, Math.round(20 * (1 - Math.min(daysOld, 90) / 90)));
  const valueScore = Math.min(20, Math.round((Math.min(p.estimated_value ?? 0, 200_000) / 200_000) * 20));
  const contactScore = (p.owner_first || p.owner_last) ? 15 : 8;
  const demandScore = Math.min(15, 5 + (hashCode(p.address ?? `p${index}`) % 11));
  const totalScore = Math.min(100, freshnessScore + valueScore + contactScore + demandScore);

  const urgency: LeadUrgency = getUrgency(totalScore);
  const now = new Date().toISOString();
  const created = p.applied_date ?? now;

  return {
    id: `live-${String(index).padStart(3, "0")}`,
    permit_id: p.permit_number ?? `live-permit-${index}`,
    contractor_id: "live-demo",

    score: totalScore,
    urgency,
    status: "new",
    score_reasoning: null,
    score_model: null,

    score_freshness: freshnessScore,
    score_value: valueScore,
    score_contact: contactScore,
    score_demand: demandScore,
    score_engagement: 0,
    score_conversion: 0,

    address: p.address ?? "Address pending",
    city: p.city,
    state: p.state,
    zip: p.zip ?? "",
    latitude: p.latitude,
    longitude: p.longitude,
    property_value: null,
    assessed_value: null,
    year_built: null,
    lot_sqft: null,
    home_sqft: null,

    owner_name: [p.owner_first, p.owner_last].filter(Boolean).join(" ") || null,
    owner_first: p.owner_first,
    owner_last: p.owner_last,
    co_owner: null,
    owner_since: null,
    owner_occupied: undefined,
    phone: null,
    phone2: null,
    email: null,
    email2: null,
    mailing_address: null,

    permit_type: p.permit_type,
    permit_description: p.description,
    permit_value: p.estimated_value,
    permit_filed_date: created,
    permit_age_days: daysOld,
    trade: p.trade,
    pipeline_value: p.estimated_value,

    cascade_flag: false,
    cascade_count: 0,
    permit_history: [],

    notes: null,
    contacted_at: null,
    won_at: null,
    is_homeowner_intake: false,
    created_at: created,
    updated_at: now,
  };
}

/* ── Main fetch function ──────────────────────────────────────────────────── */

export async function fetchLivePermits(): Promise<Lead[]> {
  // Return cached data if still fresh
  if (cachedLeads && Date.now() - cachedLeads.timestamp < CACHE_TTL) {
    return cachedLeads.data;
  }

  const sources = PERMIT_SOURCES.filter((s) => LIVE_SOURCE_IDS.includes(s.id));

  // Fetch all sources in parallel — individual failures don't break the whole set
  const results = await Promise.allSettled(
    sources.map((source) =>
      fetchPermits(source, { limit: 40, daysBack: 90 })
    ),
  );

  const allPermits: NormalizedPermit[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      allPermits.push(...result.value);
    } else {
      logger.warn("live-fetch source failed", {
        reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  }

  // Keep only permits with valid coordinates (continental US) and real addresses
  const validPermits = allPermits.filter(
    (p) =>
      p.latitude != null &&
      p.longitude != null &&
      p.latitude >= 24 && p.latitude <= 50 &&
      p.longitude >= -125 && p.longitude <= -66 &&
      p.address != null &&
      p.address.length > 3 &&
      p.address !== "[object Object]",
  );

  // Convert to Lead objects and sort by score
  const leads = validPermits.map(permitToLead);
  leads.sort((a, b) => b.score - a.score);

  // Enrich with property data (best-effort, non-blocking for top 50 leads)
  const enrichBatch = leads.slice(0, 50);
  const ENRICH_CONCURRENCY = 5;

  try {
    for (let i = 0; i < enrichBatch.length; i += ENRICH_CONCURRENCY) {
      const batch = enrichBatch.slice(i, i + ENRICH_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((lead) =>
          enrichProperty({
            address: lead.address,
            city: lead.city,
            state: lead.state,
            zip: lead.zip,
            latitude: lead.latitude ?? undefined,
            longitude: lead.longitude ?? undefined,
          }),
        ),
      );

      for (let j = 0; j < batch.length; j++) {
        const r = results[j];
        if (r.status === "fulfilled" && r.value.source !== "none") {
          const e = r.value;
          const lead = batch[j];
          if (e.property_value != null) lead.property_value = e.property_value;
          if (e.assessed_value != null) lead.assessed_value = e.assessed_value;
          if (e.year_built != null) lead.year_built = e.year_built;
          if (e.lot_sqft != null) lead.lot_sqft = e.lot_sqft;
          if (e.home_sqft != null) lead.home_sqft = e.home_sqft;
          if (e.owner_name != null && !lead.owner_name) lead.owner_name = e.owner_name;
          if (e.co_owner != null) lead.co_owner = e.co_owner;
          if (e.owner_since != null) lead.owner_since = e.owner_since;
          if (e.owner_occupied != null) lead.owner_occupied = e.owner_occupied;
          if (e.mailing_address != null) lead.mailing_address = e.mailing_address;
        }
      }
    }
  } catch {
    // Enrichment failed — continue with base permit data
  }

  // Cache the result
  cachedLeads = { data: leads, timestamp: Date.now() };

  return leads;
}

/* ── GeoJSON output for map endpoints ─────────────────────────────────── */

interface LiveGeoJSONOptions {
  trade?: string;
  status?: string;
  days?: number;
}

export async function fetchLivePermitsGeoJSON(
  opts?: LiveGeoJSONOptions,
): Promise<GeoJSON.FeatureCollection> {
  let leads = await fetchLivePermits();

  if (opts?.trade && opts.trade !== "all") {
    leads = leads.filter((l) => l.trade === opts.trade);
  }
  if (opts?.status && opts.status !== "all") {
    leads = leads.filter((l) => l.status === opts.status);
  }
  if (opts?.days) {
    const since = Date.now() - opts.days * 86_400_000;
    leads = leads.filter((l) => new Date(l.created_at).getTime() >= since);
  }

  return {
    type: "FeatureCollection",
    features: leads
      .filter((l) => l.latitude != null && l.longitude != null)
      .map((l) => ({
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [l.longitude!, l.latitude!],
        },
        properties: {
          id: l.id,
          address: l.address,
          city: l.city ?? "",
          state: l.state ?? "",
          zip: l.zip,
          trade: l.trade ?? "other",
          status: l.status ?? "new",
          score: l.score,
          urgency: l.urgency,
          permit_type: l.permit_type ?? "",
          permit_value: l.permit_value ?? 0,
          description: l.permit_description ?? "",
          created_at: l.created_at,
        },
      })),
  };
}
