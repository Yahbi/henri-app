"use client";

import { useEffect, useState } from "react";
import type maplibregl from "maplibre-gl";
import { safeRemoveLayers } from "./layerCleanup";

/**
 * NOAA Storm Prediction Center Day-1 Convective Outlook.
 *
 * Renders categorical severe-weather risk polygons (marginal / slight /
 * enhanced / moderate / high) over the map. Critical for contractors in
 * storm-restoration territories — they can spot incoming severe weather
 * 12-24 hours ahead and pre-position crews.
 *
 * Data flows through /api/overlays/spc (server-side cached 30 min). The
 * SPC issues Day-1 updates at 0600, 1300, 1630, 2000, 0100 UTC roughly.
 */
interface SPCOutlookLayerProps {
  map: maplibregl.Map | null;
  visible: boolean;
}

const SOURCE_ID = "spc-outlook";
const FILL_LAYER_ID = "spc-outlook-fill";
const LINE_LAYER_ID = "spc-outlook-line";
const LABEL_LAYER_ID = "spc-outlook-label";

// SPC categorical color scheme (matches their published legend):
// TSTM / MRGL / SLGT / ENH / MDT / HIGH
const CATEGORY_COLORS: Record<string, string> = {
  TSTM: "#c0e8c0",
  MRGL: "#7fc97f",
  SLGT: "#f6eb7f",
  ENH: "#e6a84b",
  MDT: "#d9544d",
  HIGH: "#c21fdd",
};

export function SPCOutlookLayer({ map, visible }: SPCOutlookLayerProps) {
  const [geojson, setGeojson] = useState<GeoJSON.FeatureCollection | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/overlays/spc?day=1&product=cat");
        if (!res.ok) return;
        const data = (await res.json()) as GeoJSON.FeatureCollection;
        if (!cancelled) setGeojson(data);
      } catch {
        /* silent — empty overlay on failure */
      }
    })();
    // Refresh every 30 min — matches the server cache TTL.
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/overlays/spc?day=1&product=cat");
        if (res.ok) setGeojson(await res.json());
      } catch {/* ignore */}
    }, 30 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [visible]);

  useEffect(() => {
    if (!map) return;

    function addLayers() {
      if (!map || !visible || !geojson) return;
      if (map.getSource(SOURCE_ID)) {
        (map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource).setData(geojson);
        return;
      }
      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: geojson,
      });

      // Fill — tinted by the outlook category label (LABEL property).
      map.addLayer({
        id: FILL_LAYER_ID,
        type: "fill",
        source: SOURCE_ID,
        paint: {
          "fill-color": [
            "match",
            ["get", "LABEL"],
            "TSTM", CATEGORY_COLORS.TSTM,
            "MRGL", CATEGORY_COLORS.MRGL,
            "SLGT", CATEGORY_COLORS.SLGT,
            "ENH", CATEGORY_COLORS.ENH,
            "MDT", CATEGORY_COLORS.MDT,
            "HIGH", CATEGORY_COLORS.HIGH,
            "#999999",
          ],
          "fill-opacity": 0.35,
        },
      });

      // Crisp outline so the boundary is readable on any basemap.
      map.addLayer({
        id: LINE_LAYER_ID,
        type: "line",
        source: SOURCE_ID,
        paint: {
          "line-color": [
            "match",
            ["get", "LABEL"],
            "HIGH", "#c21fdd",
            "MDT", "#b0343b",
            "ENH", "#d68a2a",
            "SLGT", "#c8bd3b",
            "MRGL", "#5fa05f",
            "#777",
          ],
          "line-width": 1.5,
        },
      });

      // Centroid-anchored label ("ENH", "MDT", etc). Uses MapLibre's
      // default font stack (already loaded by the map style).
      map.addLayer({
        id: LABEL_LAYER_ID,
        type: "symbol",
        source: SOURCE_ID,
        layout: {
          "text-field": ["get", "LABEL"],
          "text-size": 12,
          "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
          "symbol-placement": "point",
        },
        paint: {
          "text-color": "#1a1a1a",
          "text-halo-color": "#fff",
          "text-halo-width": 1.5,
        },
      });
    }

    function removeLayers() {
      safeRemoveLayers(
        map,
        [LABEL_LAYER_ID, LINE_LAYER_ID, FILL_LAYER_ID],
        [SOURCE_ID],
      );
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
