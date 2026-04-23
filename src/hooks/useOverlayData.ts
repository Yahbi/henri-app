"use client";

import { useState, useEffect, useCallback, useRef } from "react";

/* ── FEMA Flood Zone Data ────────────────────────────────────────────────── */

export interface FEMAFloodData {
  type: "FeatureCollection";
  features: GeoJSON.Feature[];
}

export function useFEMAFlood(
  bounds: [number, number, number, number] | null, // [swLng, swLat, neLng, neLat]
  enabled: boolean,
) {
  const [data, setData] = useState<FEMAFloodData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchFEMA = useCallback(async (b: [number, number, number, number]) => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/overlays/fema?bounds=${b.join(",")}`);
      if (!res.ok) {
        setData(null);
        return;
      }
      const geojson = await res.json();
      setData(geojson);
    } catch {
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled || !bounds) {
      setData(null);
      return;
    }

    // Debounce to avoid hammering the API on every pan
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchFEMA(bounds), 400);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [enabled, bounds?.[0], bounds?.[1], bounds?.[2], bounds?.[3], fetchFEMA]); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, isLoading };
}

/* ── Census Overlay Data ─────────────────────────────────────────────────── */

export interface CensusRecord {
  name: string | null;
  population: number | null;
  median_household_income: number | null;
  total_housing_units: number | null;
  occupied_housing_units: number | null;
  vacant_housing_units: number | null;
  median_year_built: number | null;
  median_home_value: number | null;
}

export function useCensusOverlay(zips: string[], enabled: boolean) {
  const [data, setData] = useState<Record<string, CensusRecord>>({});
  const [isLoading, setIsLoading] = useState(false);
  const fetchedZips = useRef<Set<string>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled || zips.length === 0) return;

    // Only fetch ZIPs we haven't fetched yet
    const newZips = zips.filter((z) => !fetchedZips.current.has(z));
    if (newZips.length === 0) return;

    let cancelled = false;

    async function fetchAll() {
      setIsLoading(true);
      const results: Record<string, CensusRecord> = {};

      // Fetch in batches of 5 to avoid overwhelming the API
      for (let i = 0; i < newZips.length; i += 5) {
        const batch = newZips.slice(i, i + 5);
        const promises = batch.map(async (zip) => {
          try {
            const res = await fetch(`/api/overlays/census?zip=${zip}`);
            if (!res.ok) return;
            const json = await res.json();
            if (json.data?.[0]) {
              results[zip] = json.data[0];
              fetchedZips.current.add(zip);
            }
          } catch {
            // Skip failed ZIPs silently
          }
        });
        await Promise.all(promises);
      }

      if (!cancelled) {
        setData((prev) => ({ ...prev, ...results }));
        setIsLoading(false);
      }
    }

    // Debounce to avoid a fetch storm while the user pans and the ZIPs
    // array is changing rapidly (GeoJSON updates per zoom/move).
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fetchAll, 500);

    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [enabled, zips.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, isLoading };
}

/* ── Weather Alert Data ──────────────────────────────────────────────────── */

export interface WeatherAlert {
  id: string;
  event: string;
  severity: string;
  certainty: string;
  urgency: string;
  headline: string;
  description: string;
  instruction: string | null;
  onset: string;
  expires: string;
  sender: string;
  areas: string;
}

export function useWeatherAlerts(
  center: [number, number] | null, // [lng, lat]
  enabled: boolean,
) {
  const [alerts, setAlerts] = useState<WeatherAlert[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const lastFetchCenter = useRef<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled || !center) {
      setAlerts([]);
      return;
    }

    // Only refetch if center moved significantly (> 0.5 degrees)
    const key = `${center[1].toFixed(1)},${center[0].toFixed(1)}`;
    if (lastFetchCenter.current === key) return;

    let cancelled = false;

    async function fetchWeather() {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/overlays/weather?point=${center![1]},${center![0]}`);
        if (!res.ok) {
          setAlerts([]);
          return;
        }
        const json = await res.json();
        if (!cancelled) {
          setAlerts(json.alerts ?? []);
          lastFetchCenter.current = key;
        }
      } catch {
        if (!cancelled) setAlerts([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    // Debounce: user pans frequently → one fetch per 500ms window even if
    // the center changes 10 times in a burst.
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fetchWeather, 500);

    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [enabled, center?.[0], center?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps

  return { alerts, isLoading };
}
