"use client";

import { useEffect, useRef, useCallback } from "react";
import type maplibregl from "maplibre-gl";
import { safeRemoveLayers } from "./layerCleanup";

/**
 * ZIP availability status used for color-coding.
 *   - "available"  : < 3 contractors (green)
 *   - "limited"    : 2-3 slots remaining (yellow)
 *   - "full"       : no open slots (red)
 *
 * Each Feature in the GeoJSON should include properties:
 *   zip: string, slotsUsed: number, slotsTotal: number,
 *   contractors: string[], status: "available" | "limited" | "full"
 */

const SOURCE_ID = "zip-boundaries";
const FILL_LAYER = "zip-fill";
const LINE_LAYER = "zip-line";

interface ZIPLayerProps {
  map: maplibregl.Map | null;
  visible: boolean;
  geojson?: GeoJSON.FeatureCollection;
}

export function ZIPLayer({ map, visible, geojson }: ZIPLayerProps) {
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const addedRef = useRef(false);

  /* Helper: safely load maplibre-gl Popup class */
  const getPopupClass = useCallback(async () => {
    if (typeof window === "undefined") return null;
    const maplibregl = (await import("maplibre-gl")).default;
    return maplibregl.Popup;
  }, []);

  /* Add source + layers once map is ready */
  useEffect(() => {
    if (!map || !geojson || typeof window === "undefined") return;

    function setup() {
      if (!map || addedRef.current || !geojson) return;

      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
          type: "geojson",
          data: geojson,
        });
      }

      if (!map.getLayer(FILL_LAYER)) {
        map.addLayer({
          id: FILL_LAYER,
          type: "fill",
          source: SOURCE_ID,
          paint: {
            "fill-color": [
              "match",
              ["get", "status"],
              "available",
              "hsl(var(--success))",
              "limited",
              "hsl(var(--warning))",
              "full",
              "hsl(var(--destructive))",
              "hsl(var(--muted))",
            ],
            "fill-opacity": 0.35,
          },
          layout: {
            visibility: visible ? "visible" : "none",
          },
        });
      }

      if (!map.getLayer(LINE_LAYER)) {
        map.addLayer({
          id: LINE_LAYER,
          type: "line",
          source: SOURCE_ID,
          paint: {
            "line-color": "hsl(var(--border))",
            "line-width": 1,
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
  }, [map, geojson, visible]);

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

  /* Update source data when geojson changes */
  useEffect(() => {
    if (!map || !geojson || !addedRef.current) return;
    const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(geojson);
    }
  }, [map, geojson]);

  /* Click handler for popup */
  useEffect(() => {
    if (!map || typeof window === "undefined") return;

    const handleClick = async (
      e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] },
    ) => {
      const feature = e.features?.[0];
      if (!feature || !feature.properties) return;

      const { zip, slotsUsed, slotsTotal, contractors } = feature.properties;
      const contractorList = typeof contractors === "string"
        ? JSON.parse(contractors)
        : contractors ?? [];

      const PopupClass = await getPopupClass();
      if (!PopupClass) return;

      popupRef.current?.remove();

      const popup = new PopupClass({
        closeButton: true,
        maxWidth: "260px",
      })
        .setLngLat(e.lngLat)
        .setHTML(
          `<div style="font-family:inherit">
            <p style="margin:0 0 4px;font-weight:600;font-size:14px">ZIP ${zip ?? "N/A"}</p>
            <p style="margin:0 0 4px;font-size:12px;opacity:0.8">Slots: ${slotsUsed ?? 0} / ${slotsTotal ?? 0}</p>
            ${
              contractorList.length > 0
                ? `<p style="margin:0;font-size:12px;opacity:0.7">${contractorList.join(", ")}</p>`
                : ""
            }
          </div>`,
        )
        .addTo(map);

      popupRef.current = popup;
    };

    map.on("click", FILL_LAYER, handleClick);

    /* Pointer cursor on hover */
    const onEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const onLeave = () => {
      map.getCanvas().style.cursor = "";
    };

    map.on("mouseenter", FILL_LAYER, onEnter);
    map.on("mouseleave", FILL_LAYER, onLeave);

    return () => {
      map.off("click", FILL_LAYER, handleClick);
      map.off("mouseenter", FILL_LAYER, onEnter);
      map.off("mouseleave", FILL_LAYER, onLeave);
      popupRef.current?.remove();
    };
  }, [map, getPopupClass]);

  /* This component manages map layers imperatively; no DOM output */
  return null;
}
