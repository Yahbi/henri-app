"use client";

import { useEffect, useRef } from "react";
import type maplibregl from "maplibre-gl";
import { safeRemoveLayers } from "./layerCleanup";

/**
 * Expected GeoJSON Feature properties:
 *   contractorId: string, name: string, color: string (CSS color value)
 *
 * Each Feature should be a Polygon or MultiPolygon.
 */

const SOURCE_ID = "territories-source";
const FILL_LAYER = "territory-fill";
const LINE_LAYER = "territory-line";

interface TerritoryLayerProps {
  map: maplibregl.Map | null;
  visible: boolean;
  territories?: GeoJSON.FeatureCollection;
}

export function TerritoryLayer({
  map,
  visible,
  territories,
}: TerritoryLayerProps) {
  const addedRef = useRef(false);

  /* Add source + layers */
  useEffect(() => {
    if (!map || !territories || typeof window === "undefined") return;

    function setup() {
      if (!map || addedRef.current || !territories) return;

      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
          type: "geojson",
          data: territories,
        });
      }

      /* Semi-transparent fill using each feature's color property */
      if (!map.getLayer(FILL_LAYER)) {
        map.addLayer({
          id: FILL_LAYER,
          type: "fill",
          source: SOURCE_ID,
          paint: {
            "fill-color": ["coalesce", ["get", "color"], "hsl(var(--primary))"],
            "fill-opacity": 0.2,
          },
          layout: {
            visibility: visible ? "visible" : "none",
          },
        });
      }

      /* Border outline */
      if (!map.getLayer(LINE_LAYER)) {
        map.addLayer({
          id: LINE_LAYER,
          type: "line",
          source: SOURCE_ID,
          paint: {
            "line-color": ["coalesce", ["get", "color"], "hsl(var(--primary))"],
            "line-width": 2,
            "line-opacity": 0.7,
          },
          layout: {
            visibility: visible ? "visible" : "none",
          },
        });
      }

      addedRef.current = true;
    }

    if (map.isStyleLoaded()) {
      setup();
    } else {
      map.on("style.load", setup);
    }

    return () => {
      map.off("style.load", setup);
      safeRemoveLayers(map, [LINE_LAYER, FILL_LAYER], [SOURCE_ID]);
      addedRef.current = false;
    };
  }, [map, territories, visible]);

  /* Toggle visibility */
  useEffect(() => {
    if (!map || !addedRef.current) return;
    const vis = visible ? "visible" : "none";
    if (map.getLayer(FILL_LAYER)) {
      map.setLayoutProperty(FILL_LAYER, "visibility", vis);
    }
    if (map.getLayer(LINE_LAYER)) {
      map.setLayoutProperty(LINE_LAYER, "visibility", vis);
    }
  }, [map, visible]);

  /* Update source data */
  useEffect(() => {
    if (!map || !territories || !addedRef.current) return;
    const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(territories);
    }
  }, [map, territories]);

  return null;
}
