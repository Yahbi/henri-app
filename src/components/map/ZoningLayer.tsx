"use client";

import { useEffect, useRef, useState } from "react";
import type maplibregl from "maplibre-gl";
import { safeRemoveLayers } from "./layerCleanup";

/**
 * Zoning-district overlay. Colors each parcel/district by its zoning
 * classification (R = residential, C = commercial, I = industrial, etc)
 * so a contractor can instantly see where they can work — R-zoned for
 * residential roofing, C-zoned for commercial HVAC, etc.
 *
 * Free public ArcGIS endpoints:
 *   - Hartford CT  — City Planning zoning districts
 *   - LA County CA — County zoning
 *
 * Gated on zoom >= 13 so the client doesn't pull a city-wide polygon
 * set on every pan at state-level zoom.
 */
interface ZoningLayerProps {
  map: maplibregl.Map | null;
  visible: boolean;
  bounds: [number, number, number, number] | null;
}

const SOURCE_ID = "zoning";
const FILL_LAYER_ID = "zoning-fill";
const LINE_LAYER_ID = "zoning-line";
const LABEL_LAYER_ID = "zoning-label";

/** Minimum zoom — zoning polygons flood at zoom < 13. */
const MIN_ZOOM = 13;

// Verified live during prior enrichment work; each is a free public
// ArcGIS endpoint with a ZONING / Zoning / zone_class field.
const ZONING_ENDPOINTS: Array<{
  name: string;
  queryUrl: string;
  coverage: [number, number, number, number];
  labelField: string;
}> = [
  {
    name: "Hartford CT",
    queryUrl:
      "https://gis.hartford.gov/arcgis/rest/services/Planning/Zoning/MapServer/0/query",
    coverage: [-72.76, 41.72, -72.62, 41.82],
    labelField: "ZONE",
  },
  {
    name: "LA County CA",
    queryUrl:
      "https://public.gis.lacounty.gov/public/rest/services/PW_Open_Data/MapServer/0/query",
    coverage: [-118.95, 33.7, -117.65, 34.82],
    labelField: "ZONING",
  },
];

/** Broad classification → color mapping. Matches common municipal
 * cartography (residential greens, commercial reds, industrial purples). */
function zoneColor(label: string): string {
  const first = String(label ?? "")
    .trim()
    .toUpperCase()
    .charAt(0);
  switch (first) {
    case "R":
      return "#7ab27a"; // residential — green
    case "C":
    case "B":
      return "#d95f5f"; // commercial/business — red
    case "I":
    case "M":
      return "#a06bd4"; // industrial/manufacturing — purple
    case "O":
      return "#4a7fc0"; // open space — blue
    case "P":
      return "#e6a84b"; // public — amber
    default:
      return "#888888";
  }
}

export function ZoningLayer({ map, visible, bounds }: ZoningLayerProps) {
  const [geojson, setGeojson] = useState<GeoJSON.FeatureCollection | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const labelFieldRef = useRef<string>("ZONE");

  useEffect(() => {
    if (!visible || !map || !bounds) {
      setGeojson(null);
      return;
    }
    if (map.getZoom() < MIN_ZOOM) {
      setGeojson(null);
      return;
    }

    const [swLng, swLat, neLng, neLat] = bounds;
    const endpoint = ZONING_ENDPOINTS.find((e) => {
      const [sLng, sLat, nLng, nLat] = e.coverage;
      return neLng >= sLng && swLng <= nLng && neLat >= sLat && swLat <= nLat;
    });
    if (!endpoint) {
      setGeojson({ type: "FeatureCollection", features: [] });
      return;
    }
    labelFieldRef.current = endpoint.labelField;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          where: "1=1",
          geometry: `${swLng},${swLat},${neLng},${neLat}`,
          geometryType: "esriGeometryEnvelope",
          inSR: "4326",
          outSR: "4326",
          outFields: "*",
          spatialRel: "esriSpatialRelIntersects",
          returnGeometry: "true",
          f: "geojson",
          resultRecordCount: "500",
        });
        const res = await fetch(`${endpoint.queryUrl}?${params}`);
        if (!res.ok) return;
        setGeojson(await res.json());
      } catch {
        /* silent */
      }
    }, 400);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [visible, map, bounds]);

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

      // Pre-compute fill colors per feature so the paint expression stays
      // tiny and MapLibre doesn't have to evaluate JS at render.
      const labelField = labelFieldRef.current;
      const colored: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: geojson.features.map((f) => ({
          ...f,
          properties: {
            ...(f.properties ?? {}),
            _label: (f.properties ?? {})[labelField] ?? "?",
            _color: zoneColor((f.properties ?? {})[labelField] ?? "?"),
          },
        })),
      };

      map.addSource(SOURCE_ID, { type: "geojson", data: colored });

      map.addLayer({
        id: FILL_LAYER_ID,
        type: "fill",
        source: SOURCE_ID,
        paint: {
          "fill-color": ["get", "_color"],
          "fill-opacity": 0.22,
        },
      });
      map.addLayer({
        id: LINE_LAYER_ID,
        type: "line",
        source: SOURCE_ID,
        paint: {
          "line-color": ["get", "_color"],
          "line-width": 0.8,
        },
      });
      map.addLayer({
        id: LABEL_LAYER_ID,
        type: "symbol",
        source: SOURCE_ID,
        layout: {
          "text-field": ["get", "_label"],
          "text-size": 10,
          "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
        },
        paint: {
          "text-color": "#1a1a1a",
          "text-halo-color": "#fff",
          "text-halo-width": 1.2,
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
