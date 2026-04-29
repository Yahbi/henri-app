/**
 * WeatherStack — current + recent weather context for a lead's ZIP.
 *
 * Free tier: 100 requests / month. Caching is critical.
 *
 * ## What it gives us
 *
 * Current conditions + last-week storm events near the property. Combines
 * with the NOAA Storm Events ingest (migration 00050) to produce a
 * "weather context" callout in the lead drawer:
 *
 *   - "Hail event 3 days ago, current conditions clear" → roofing chip
 *   - "Heavy rain forecast tomorrow" → urgency boost on outreach
 *   - "Ice damage event last week" → flag for ice-dam roofing leads
 *
 * ## Setup
 *
 *   1. Sign up at https://weatherstack.com
 *   2. Set WEATHERSTACK_API_KEY in Vercel / .env.local
 *   3. Free tier is 100/mo — cache aggressively (1h per ZIP)
 *
 * ## Pattern
 *
 * - Cache by ZIP for 1 hour (free tier budget: 100 calls / month / ZIP).
 *   If we ran 100 unique ZIPs once each, that's the whole budget.
 *   Defensive: cache = 1h means hot ZIPs hit ~24 calls/day max.
 * - Returns null on missing key or quota error — graceful-degrade
 * - Never throws to caller (per CLAUDE.md "feature-flag before migration")
 */

import { logger } from "@/lib/logger";

interface WeatherStackResponse {
  request?: {
    type: string;
    query: string;
    language: string;
    unit: string;
  };
  location?: {
    name: string;
    region: string;
    country: string;
    lat: string;
    lon: string;
    timezone_id: string;
    localtime: string;
  };
  current?: {
    observation_time: string;
    temperature: number;
    weather_code: number;
    weather_descriptions: string[];
    wind_speed: number;
    wind_degree: number;
    wind_dir: string;
    precip: number;
    humidity: number;
    cloudcover: number;
    feelslike: number;
    uv_index: number;
    visibility: number;
  };
  error?: { code: number; type: string; info: string };
}

export interface WeatherSnapshot {
  /** Display label like "Hartford, CT" */
  location: string;
  temperature_f: number;
  conditions: string; // e.g. "Partly cloudy"
  wind_mph: number;
  precip_in: number;
  /** Severity classification for outreach urgency */
  severity: "calm" | "minor" | "severe";
  /** Roof-relevant hazards detected */
  hazards: string[];
  /** Free-tier API used; surfacing for telemetry */
  source: "weatherstack";
  fetched_at: string;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const cache = new Map<string, { value: WeatherSnapshot | null; expires_at: number }>();

/* Map WeatherStack codes / keywords to a severity bucket. The free tier
 * doesn't expose alerts directly, so we infer from the description +
 * wind speed. Roofing/HVAC contractors care about wind, hail, and
 * precip the most. */
function classifySeverity(
  description: string,
  windMph: number,
  precipIn: number,
): { severity: WeatherSnapshot["severity"]; hazards: string[] } {
  const desc = description.toLowerCase();
  const hazards: string[] = [];

  if (/hail/.test(desc)) hazards.push("hail");
  if (/tornado|funnel/.test(desc)) hazards.push("tornado");
  if (/thunderstorm|severe/.test(desc)) hazards.push("thunderstorm");
  if (windMph >= 50) hazards.push("high-wind");
  if (precipIn >= 1.0) hazards.push("heavy-rain");
  if (/snow|blizzard/.test(desc)) hazards.push("snow");
  if (/freezing rain|sleet/.test(desc)) hazards.push("ice");

  if (hazards.includes("tornado") || hazards.includes("hail") || windMph >= 60) {
    return { severity: "severe", hazards };
  }
  if (hazards.length > 0 || windMph >= 30) {
    return { severity: "minor", hazards };
  }
  return { severity: "calm", hazards };
}

/**
 * Look up current weather for a US ZIP. Returns null on:
 * - Missing API key
 * - Cache hit returning null (budget exhausted)
 * - HTTP / quota error
 *
 * Pure I/O. Cache is module-scoped (per-Vercel-function lifetime).
 */
export async function lookupWeatherByZip(zip: string): Promise<WeatherSnapshot | null> {
  const apiKey = process.env.WEATHERSTACK_API_KEY;
  if (!apiKey) return null;
  if (!/^\d{5}$/.test(zip)) return null;

  const cacheKey = zip;
  const cached = cache.get(cacheKey);
  if (cached && cached.expires_at > Date.now()) return cached.value;

  try {
    // WeatherStack supports `query=ZIPCODE` for US lookups
    const url = `http://api.weatherstack.com/current?access_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(zip)}&units=f`;
    const res = await fetch(url, {
      // The API is HTTP-only on the free tier; HTTPS requires paid tier.
      // No PII in URL params here — ZIP is non-PII. Still, route via
      // server-side only (this module imports `logger` from `@/lib/logger`
      // which is server-only).
      headers: { "User-Agent": "Henri-Bot/1.0" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      logger.warn("weatherstack non-200", { zip, status: res.status });
      cache.set(cacheKey, { value: null, expires_at: Date.now() + CACHE_TTL_MS });
      return null;
    }
    const data = (await res.json()) as WeatherStackResponse;
    if (data.error) {
      // Common error: quota exceeded. Cache null briefly so we don't re-hammer.
      logger.warn("weatherstack api error", { zip, code: data.error.code, info: data.error.info });
      cache.set(cacheKey, { value: null, expires_at: Date.now() + CACHE_TTL_MS });
      return null;
    }
    if (!data.location || !data.current) {
      cache.set(cacheKey, { value: null, expires_at: Date.now() + CACHE_TTL_MS });
      return null;
    }
    const description = data.current.weather_descriptions?.[0] ?? "";
    const { severity, hazards } = classifySeverity(
      description,
      data.current.wind_speed,
      data.current.precip,
    );
    const snapshot: WeatherSnapshot = {
      location: `${data.location.name}, ${data.location.region}`,
      temperature_f: data.current.temperature,
      conditions: description,
      wind_mph: data.current.wind_speed,
      precip_in: data.current.precip,
      severity,
      hazards,
      source: "weatherstack",
      fetched_at: new Date().toISOString(),
    };
    cache.set(cacheKey, { value: snapshot, expires_at: Date.now() + CACHE_TTL_MS });
    return snapshot;
  } catch (err) {
    logger.warn("weatherstack fetch failed", { zip, error: String(err) });
    cache.set(cacheKey, { value: null, expires_at: Date.now() + CACHE_TTL_MS });
    return null;
  }
}
