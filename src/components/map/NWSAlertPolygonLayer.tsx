"use client";

import { useEffect, useState } from "react";
import type maplibregl from "maplibre-gl";
import { safeRemoveLayers } from "./layerCleanup";

/**
 * Renders NWS active-alert polygons directly on the map. The banner-only
 * alert surface (WeatherAlertBanner) is useful for a single critical alert
 * but doesn't convey spatial distribution; this layer makes the coverage
 * visible (e.g. multi-county tornado warnings fanning out across a region).
 *
 * Uses /api/overlays/weather?bbox=... server proxy when available, or
 * fetches /api/overlays/alerts directly (created here). Refreshes every
 * 60 seconds while visible — NWS alerts change rapidly during severe
 * weather outbreaks.
 */
interface NWSAlertPolygonLayerProps {
  map: maplibregl.Map | null;
  visible: boolean;
}

const SOURCE_ID = "nws-alert-polygons";
const FILL_LAYER_ID = "nws-alert-fill";
const LINE_LAYER_ID = "nws-alert-line";

/** Severity-based paint. Mapped to NWS's Extreme/Severe/Moderate/Minor/Unknown. */
const SEVERITY_COLOR: Record<string, string> = {
  Extreme: "#b30000",
  Severe: "#e34a33",
  Moderate: "#fdae6b",
  Minor: "#fdd49e",
  Unknown: "#cccccc",
};

export function NWSAlertPolygonLayer({ map, visible }: NWSAlertPolygonLayerProps) {
  const [geojson, setGeojson] = useState<GeoJSON.FeatureCollection | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/overlays/alerts");
        if (!res.ok) return;
        const data = (await res.json()) as GeoJSON.FeatureCollection;
        if (!cancelled) setGeojson(data);
      } catch {
        /* silent */
      }
    }
    load();
    const interval = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [visible]);

  useEffect(() => {
    if (!map) return;

    function addLayers() {
      if (!map || !visible || !geojson) return;
      const existing = map.getSource(SOURCE_ID) as
        | maplibregl.GeoJSONSource
        | undefined;
      if (existing) {
        existing.setData(geojson);
        return;
      }

      map.addSource(SOURCE_ID, { type: "geojson", data: geojson });

      map.addLayer({
        id: FILL_LAYER_ID,
        type: "fill",
        source: SOURCE_ID,
        paint: {
          "fill-color": [
            "match",
            ["get", "severity"],
            "Extreme", SEVERITY_COLOR.Extreme,
            "Severe", SEVERITY_COLOR.Severe,
            "Moderate", SEVERITY_COLOR.Moderate,
            "Minor", SEVERITY_COLOR.Minor,
            SEVERITY_COLOR.Unknown,
          ],
          "fill-opacity": 0.3,
        },
      });

      map.addLayer({
        id: LINE_LAYER_ID,
        type: "line",
        source: SOURCE_ID,
        paint: {
          "line-color": [
            "match",
            ["get", "severity"],
            "Extreme", SEVERITY_COLOR.Extreme,
            "Severe", SEVERITY_COLOR.Severe,
            "Moderate", SEVERITY_COLOR.Moderate,
            "Minor", SEVERITY_COLOR.Minor,
            SEVERITY_COLOR.Unknown,
          ],
          "line-width": 1.2,
          "line-opacity": 0.85,
        },
      });
    }

    function removeLayers() {
      safeRemoveLayers(map, [LINE_LAYER_ID, FILL_LAYER_ID], [SOURCE_ID]);
    }

    if (visible) {
      if (map.isStyleLoaded()) addLayers();
      else map.once("styledata", addLayers);
    } else {
      removeLayers();
    }

    return () => removeLayers();
  }, [map, visible, geojson]);

  return null;
}
