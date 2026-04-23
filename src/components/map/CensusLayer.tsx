"use client";

import { useEffect, useRef, useCallback } from "react";
import type maplibregl from "maplibre-gl";
import type { CensusRecord } from "@/hooks/useOverlayData";
import { safeRemoveLayers } from "./layerCleanup";

const SOURCE_ID = "census-choropleth-source";
const FILL_LAYER = "census-choropleth-fill";
const LINE_LAYER = "census-choropleth-line";
const LABEL_LAYER = "census-choropleth-label";

/**
 * Color stops for median home value choropleth.
 * Uses the Henri terracotta palette from light → dark.
 */
const VALUE_STOPS: [number, string][] = [
  [0, "rgba(245, 230, 220, 0.35)"],       // < $100K — very light
  [100_000, "rgba(230, 195, 170, 0.4)"],   // $100K — light tan
  [200_000, "rgba(215, 165, 135, 0.45)"],  // $200K — warm sand
  [350_000, "rgba(200, 135, 100, 0.5)"],   // $350K — medium terracotta
  [500_000, "rgba(180, 105, 70, 0.55)"],   // $500K — darker terracotta
  [750_000, "rgba(160, 80, 50, 0.6)"],     // $750K — deep terracotta
  [1_000_000, "rgba(130, 55, 30, 0.65)"],  // $1M+ — darkest
];

function valueToColor(value: number | null): string {
  if (value == null || value <= 0) return "rgba(200, 200, 200, 0.2)";
  for (let i = VALUE_STOPS.length - 1; i >= 0; i--) {
    if (value >= VALUE_STOPS[i][0]) return VALUE_STOPS[i][1];
  }
  return VALUE_STOPS[0][1];
}

function formatValue(v: number | null): string {
  if (v == null) return "N/A";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${Math.round(v / 1_000)}K`;
  return `$${v}`;
}

/**
 * Build a simple circle-based choropleth for ZIP-level Census data.
 * Each lead's ZIP gets a colored circle based on median home value.
 *
 * This uses point features (ZIP centroids) since we don't load
 * full ZIP boundary polygons — keeps it lightweight.
 */
function buildGeoJSON(
  censusData: Record<string, CensusRecord>,
  leadLocations: Array<{ zip: string; lat: number; lng: number }>,
): GeoJSON.FeatureCollection {
  // Group leads by ZIP, use first location as centroid
  const zipCentroids = new Map<string, { lat: number; lng: number }>();
  for (const loc of leadLocations) {
    if (loc.zip && !zipCentroids.has(loc.zip)) {
      zipCentroids.set(loc.zip, { lat: loc.lat, lng: loc.lng });
    }
  }

  const features: GeoJSON.Feature[] = [];
  for (const [zip, record] of Object.entries(censusData)) {
    const centroid = zipCentroids.get(zip);
    if (!centroid) continue;

    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [centroid.lng, centroid.lat],
      },
      properties: {
        zip,
        median_home_value: record.median_home_value,
        median_income: record.median_household_income,
        median_year_built: record.median_year_built,
        population: record.population,
        color: valueToColor(record.median_home_value),
        label: `${zip}: ${formatValue(record.median_home_value)}`,
      },
    });
  }

  return { type: "FeatureCollection", features };
}

interface CensusLayerProps {
  map: maplibregl.Map | null;
  censusData: Record<string, CensusRecord>;
  leadLocations: Array<{ zip: string; lat: number; lng: number }>;
  visible: boolean;
}

export function CensusLayer({ map, censusData, leadLocations, visible }: CensusLayerProps) {
  const addedRef = useRef(false);

  const addLayers = useCallback(() => {
    if (!map || !visible) return;

    const geojson = buildGeoJSON(censusData, leadLocations);
    if (geojson.features.length === 0) return;

    // Add or update source
    if (!map.getSource(SOURCE_ID)) {
      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: geojson,
      });
    } else {
      (map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource)?.setData(geojson);
    }

    // Large circle fill layer — colored by median home value
    if (!map.getLayer(FILL_LAYER)) {
      map.addLayer({
        id: FILL_LAYER,
        type: "circle",
        source: SOURCE_ID,
        paint: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          "circle-color": ["get", "color"] as any,
          "circle-radius": [
            "interpolate", ["linear"], ["zoom"],
            8, 20,
            11, 40,
            14, 60,
          ],
          "circle-opacity": 0.6,
          "circle-blur": 0.5,
        },
      });
    }

    // Outline ring
    if (!map.getLayer(LINE_LAYER)) {
      map.addLayer({
        id: LINE_LAYER,
        type: "circle",
        source: SOURCE_ID,
        paint: {
          "circle-color": "transparent",
          "circle-radius": [
            "interpolate", ["linear"], ["zoom"],
            8, 20,
            11, 40,
            14, 60,
          ],
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "rgba(180, 105, 70, 0.5)",
        },
      });
    }

    // ZIP label layer — visible at higher zoom
    if (!map.getLayer(LABEL_LAYER)) {
      map.addLayer({
        id: LABEL_LAYER,
        type: "symbol",
        source: SOURCE_ID,
        minzoom: 10,
        layout: {
          "text-field": ["get", "label"],
          "text-size": 11,
          "text-font": ["DIN Offc Pro Medium", "Arial Unicode MS Regular"],
          "text-allow-overlap": false,
        },
        paint: {
          "text-color": "rgba(80, 50, 30, 0.9)",
          "text-halo-color": "rgba(255, 255, 255, 0.9)",
          "text-halo-width": 1.5,
        },
      });
    }

    addedRef.current = true;
  }, [map, censusData, leadLocations, visible]);

  const removeLayers = useCallback(() => {
    safeRemoveLayers(map, [LABEL_LAYER, LINE_LAYER, FILL_LAYER], [SOURCE_ID]);
    addedRef.current = false;
  }, [map]);

  useEffect(() => {
    if (!map) return;

    if (visible && Object.keys(censusData).length > 0) {
      if (map.isStyleLoaded()) {
        addLayers();
      } else {
        map.once("style.load", addLayers);
      }
    } else {
      removeLayers();
    }

    return () => {
      removeLayers();
    };
  }, [map, censusData, visible, addLayers, removeLayers]);

  return null;
}
