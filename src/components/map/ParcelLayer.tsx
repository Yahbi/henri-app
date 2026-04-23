"use client";

import { useEffect, useRef, useState } from "react";
import type maplibregl from "maplibre-gl";
import { safeRemoveLayers } from "./layerCleanup";

/**
 * Parcel-boundary overlay. Fetches county-GIS parcel polygons for the
 * current map viewport from the free public ArcGIS REST endpoints we
 * already verified for enrichment. Only active when the viewer has
 * zoomed in close enough that parcel outlines won't flood the render —
 * parcel datasets are ~30k features per city so zoom-gated.
 *
 * Jurisdictions wired:
 *   - Hartford CT  — AssessorParcels MapServer/3
 *   - LA County CA — Clariti LA_County_Parcels FeatureServer/0
 *
 * More coverage is just more entries in CITY_ENDPOINTS; the shape is
 * already generic across Esri services.
 */
interface ParcelLayerProps {
  map: maplibregl.Map | null;
  visible: boolean;
  bounds: [number, number, number, number] | null; // [swLng, swLat, neLng, neLat]
}

const SOURCE_ID = "parcels";
const FILL_LAYER_ID = "parcels-fill";
const LINE_LAYER_ID = "parcels-line";

// Each entry: an ArcGIS query URL + a bounding box the endpoint covers.
// Layer queries with `geometry={bbox}&geometryType=esriGeometryEnvelope`
// return only features intersecting the viewport, so the network payload
// scales with what's on screen.
const PARCEL_ENDPOINTS: Array<{
  name: string;
  queryUrl: string;
  coverage: [number, number, number, number]; // rough extent
}> = [
  {
    name: "Hartford CT",
    queryUrl:
      "https://gis.hartford.gov/arcgis/rest/services/AssessorParcels/MapServer/3/query",
    coverage: [-72.76, 41.72, -72.62, 41.82],
  },
  {
    name: "LA County CA",
    queryUrl:
      "https://arcgis.claritisoftware.com/server/rest/services/Hosted/LA_County_Parcels/FeatureServer/0/query",
    coverage: [-118.95, 33.7, -117.65, 34.82],
  },
];

/** zoom >= 15 gives ~250m across the screen horizontally — the natural
 * threshold where parcel outlines are readable rather than pixel-soup. */
const MIN_ZOOM = 15;

export function ParcelLayer({ map, visible, bounds }: ParcelLayerProps) {
  const [geojson, setGeojson] = useState<GeoJSON.FeatureCollection | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!visible || !map || !bounds) {
      setGeojson(null);
      return;
    }
    const z = map.getZoom();
    if (z < MIN_ZOOM) {
      setGeojson(null);
      return;
    }

    // Pick whichever endpoint covers the current bounds. If the viewport
    // crosses multiple coverage areas we'd stitch them — single endpoint
    // is enough for MVP.
    const [swLng, swLat, neLng, neLat] = bounds;
    const endpoint = PARCEL_ENDPOINTS.find((e) => {
      const [sLng, sLat, nLng, nLat] = e.coverage;
      return neLng >= sLng && swLng <= nLng && neLat >= sLat && swLat <= nLat;
    });
    if (!endpoint) {
      setGeojson({ type: "FeatureCollection", features: [] });
      return;
    }

    // Debounce — user pans rapidly, and each ArcGIS query is a round-trip.
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
          resultRecordCount: "2000",
        });
        const res = await fetch(`${endpoint.queryUrl}?${params}`);
        if (!res.ok) return;
        const data = await res.json();
        setGeojson(data);
      } catch {
        /* silent — parcel layer is nice-to-have */
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

      map.addSource(SOURCE_ID, { type: "geojson", data: geojson });

      map.addLayer({
        id: FILL_LAYER_ID,
        type: "fill",
        source: SOURCE_ID,
        paint: { "fill-color": "#D4886A", "fill-opacity": 0.04 },
      });
      map.addLayer({
        id: LINE_LAYER_ID,
        type: "line",
        source: SOURCE_ID,
        paint: {
          "line-color": "#D4886A",
          "line-width": 0.7,
          "line-opacity": 0.6,
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
