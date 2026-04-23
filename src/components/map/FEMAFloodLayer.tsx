"use client";

import { useEffect, useRef } from "react";
import type maplibregl from "maplibre-gl";

const SOURCE_ID = "fema-flood-source";
const FILL_LAYER = "fema-flood-fill";
const LINE_LAYER = "fema-flood-line";
const LABEL_LAYER = "fema-flood-label";

/**
 * FEMA flood zone color mapping:
 * - AE/A/AH/AO = high risk (Special Flood Hazard Area) → red
 * - VE/V       = coastal high hazard → purple
 * - X          = minimal risk → green
 * - D          = undetermined → gray
 */
const ZONE_COLORS: [string, string][] = [
  ["AE", "rgba(220, 60, 60, 0.3)"],
  ["A", "rgba(220, 60, 60, 0.3)"],
  ["AH", "rgba(220, 100, 60, 0.25)"],
  ["AO", "rgba(220, 100, 60, 0.25)"],
  ["VE", "rgba(130, 60, 180, 0.3)"],
  ["V", "rgba(130, 60, 180, 0.3)"],
  ["X", "rgba(60, 160, 80, 0.15)"],
  ["D", "rgba(150, 150, 150, 0.2)"],
];

const ZONE_LINE_COLORS: [string, string][] = [
  ["AE", "rgba(180, 40, 40, 0.6)"],
  ["A", "rgba(180, 40, 40, 0.6)"],
  ["AH", "rgba(180, 70, 40, 0.5)"],
  ["AO", "rgba(180, 70, 40, 0.5)"],
  ["VE", "rgba(100, 40, 150, 0.6)"],
  ["V", "rgba(100, 40, 150, 0.6)"],
  ["X", "rgba(40, 120, 60, 0.3)"],
  ["D", "rgba(120, 120, 120, 0.3)"],
];

function buildColorExpression(pairs: [string, string][], fallback: string): unknown[] {
  const expr: unknown[] = ["match", ["get", "FLD_ZONE"]];
  for (const [zone, color] of pairs) {
    expr.push(zone, color);
  }
  expr.push(fallback);
  return expr;
}

interface FEMAFloodLayerProps {
  map: maplibregl.Map | null;
  geojson: GeoJSON.FeatureCollection | null;
  visible: boolean;
}

export function FEMAFloodLayer({ map, geojson, visible }: FEMAFloodLayerProps) {
  const addedRef = useRef(false);

  useEffect(() => {
    if (!map) return;

    function addLayers() {
      if (!map || !geojson || !visible) return;

      // Add or update source
      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
          type: "geojson",
          data: geojson,
        });
      } else {
        (map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource)?.setData(geojson);
      }

      // Fill layer
      if (!map.getLayer(FILL_LAYER)) {
        map.addLayer({
          id: FILL_LAYER,
          type: "fill",
          source: SOURCE_ID,
          paint: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            "fill-color": buildColorExpression(ZONE_COLORS, "rgba(150,150,150,0.15)") as any,
          },
        });
      }

      // Line layer
      if (!map.getLayer(LINE_LAYER)) {
        map.addLayer({
          id: LINE_LAYER,
          type: "line",
          source: SOURCE_ID,
          paint: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            "line-color": buildColorExpression(ZONE_LINE_COLORS, "rgba(120,120,120,0.3)") as any,
            "line-width": 1,
          },
        });
      }

      // Label layer (at higher zoom)
      if (!map.getLayer(LABEL_LAYER)) {
        map.addLayer({
          id: LABEL_LAYER,
          type: "symbol",
          source: SOURCE_ID,
          minzoom: 14,
          layout: {
            "text-field": ["concat", "Zone ", ["get", "FLD_ZONE"]],
            "text-size": 10,
            "text-font": ["DIN Offc Pro Medium", "Arial Unicode MS Regular"],
          },
          paint: {
            "text-color": "rgba(100, 100, 100, 0.8)",
            "text-halo-color": "rgba(255, 255, 255, 0.9)",
            "text-halo-width": 1,
          },
        });
      }

      addedRef.current = true;
    }

    function removeLayers() {
      if (!map) return;
      // The map's internal Style may be torn down before the component unmount
      // effect runs (parent unmount order). Guard every call so we never throw
      // a TypeError: Cannot read properties of undefined (reading 'getLayer').
      try {
        if (typeof map.getLayer !== "function") return;
        [LABEL_LAYER, LINE_LAYER, FILL_LAYER].forEach((id) => {
          try {
            if (map.getLayer(id)) map.removeLayer(id);
          } catch {
            /* layer already gone with style */
          }
        });
        try {
          if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
        } catch {
          /* source already gone */
        }
      } catch {
        /* map was destroyed; nothing to clean up */
      }
      addedRef.current = false;
    }

    if (visible && geojson && geojson.features.length > 0) {
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
  }, [map, geojson, visible]);

  return null;
}
