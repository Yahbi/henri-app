"use client";

import { useEffect, useRef, useState } from "react";
import type maplibregl from "maplibre-gl";
import { safeRemoveLayers } from "./layerCleanup";

/**
 * Zoning-district overlay — hybrid sourcing:
 *
 *   1. Primary: National Zoning Atlas PMTiles bundle (7 states' worth of
 *      harmonized zoning classes, 6,264 zones, 59 MB tileset shipped from
 *      /public/zoning-atlas.pmtiles). Covers HI, MT, NH, TN, VA, CO
 *      (Denver metro) and TX (DFW). Renders instantly from vector tiles,
 *      no per-pan fetch, zooms smoothly — exactly what the contractor
 *      dashboard needs.
 *
 *   2. Fallback: Per-jurisdiction ArcGIS queries for places NZA doesn't
 *      cover yet (Hartford CT + LA County CA). Keeps the pre-2026-04-22
 *      behaviour alive for two markets we've validated live.
 *
 * The contractor sees one "Zoning Districts" toggle in OverlayControls —
 * this component picks the best source automatically based on the map
 * viewport. Colors parcels/districts by broad classification so
 * residential roofing, commercial HVAC, etc. are readable at a glance.
 *
 * Gated on zoom >= 13 so we don't flood the style at state-level zoom.
 */
interface ZoningLayerProps {
  map: maplibregl.Map | null;
  visible: boolean;
  bounds: [number, number, number, number] | null;
}

const MIN_ZOOM = 13;

/* ── PMTiles source (primary) ─────────────────────────────────────── */

const PMTILES_URL = "/zoning-atlas.pmtiles";
const PMTILES_SOURCE_ID = "zoning-nza";
const PMTILES_FILL_ID = "zoning-nza-fill";
const PMTILES_LINE_ID = "zoning-nza-line";
const PMTILES_LABEL_ID = "zoning-nza-label";

/* NZA bounding boxes — coarse envelopes that cover each region's data.
   When the map viewport intersects any of these, we use the PMTiles
   bundle and skip the ArcGIS fallback. Updated manually when the
   National Zoning Atlas adds a new state. */
const NZA_COVERAGE: Array<{ state: string; bbox: [number, number, number, number] }> = [
  { state: "HI", bbox: [-160.5, 18.9, -154.7, 22.3] },
  { state: "MT", bbox: [-116.1, 44.3, -103.9, 49.1] },
  { state: "NH", bbox: [-72.7, 42.6, -70.5, 45.4] },
  { state: "TN-Middle", bbox: [-88.4, 34.9, -84.0, 36.7] },
  { state: "VA-HamptonRoads", bbox: [-77.5, 36.5, -75.8, 37.9] },
  { state: "CO-DenverMetro", bbox: [-105.4, 39.3, -104.4, 40.2] },
  { state: "TX-DFW", bbox: [-97.6, 32.3, -96.4, 33.4] },
];

/* Is the current viewport inside one of the NZA regions? If yes, the
   PMTiles source can satisfy the request; otherwise we fall through to
   the per-jurisdiction ArcGIS fetch. */
function isInNzaCoverage(
  bounds: [number, number, number, number] | null,
): boolean {
  if (!bounds) return false;
  const [swLng, swLat, neLng, neLat] = bounds;
  return NZA_COVERAGE.some(({ bbox: [sLng, sLat, nLng, nLat] }) => {
    return neLng >= sLng && swLng <= nLng && neLat >= sLat && swLat <= nLat;
  });
}

/* NZA tilesets expose a top-level `zoning_type` field on every feature.
   The four canonical values (and null / empty for unclassified ones): */
const NZA_COLOR_EXPR: maplibregl.ExpressionSpecification = [
  "match",
  ["get", "zoning_type"],
  "Primarily Residential", "#7ab27a",
  "Mixed with Residential", "#e6a84b",
  "Nonresidential",         "#d95f5f",
  "Overlay",                "#a06bd4",
  /* default */             "#888888",
];

/* ── ArcGIS source (fallback) ─────────────────────────────────────── */

const ARCGIS_SOURCE_ID = "zoning-arcgis";
const ARCGIS_FILL_ID = "zoning-arcgis-fill";
const ARCGIS_LINE_ID = "zoning-arcgis-line";
const ARCGIS_LABEL_ID = "zoning-arcgis-label";

const ARCGIS_ENDPOINTS: Array<{
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

/** Broad classification → color for ArcGIS zone codes. Matches common
 * municipal cartography (residential greens, commercial reds, industrial
 * purples). */
function arcgisZoneColor(label: string): string {
  const first = String(label ?? "")
    .trim()
    .toUpperCase()
    .charAt(0);
  switch (first) {
    case "R": return "#7ab27a";
    case "C":
    case "B": return "#d95f5f";
    case "I":
    case "M": return "#a06bd4";
    case "O": return "#4a7fc0";
    case "P": return "#e6a84b";
    default:  return "#888888";
  }
}

/* ── PMTiles protocol registration (module-scope, idempotent) ─────── */

/* MapLibre needs the pmtiles:// protocol handler registered before it
   can resolve vector sources hosted as a single PMTiles archive. The
   handler is process-global and must only be installed once — doing it
   at module scope with a guard keeps the cost negligible and avoids
   re-registration on every component remount. */
let pmtilesProtocolInstalled = false;
async function ensurePmtilesProtocol(mapLib: typeof maplibregl): Promise<void> {
  if (pmtilesProtocolInstalled) return;
  // Dynamic import keeps pmtiles out of the SSR path (it touches window).
  const { Protocol } = await import("pmtiles");
  const protocol = new Protocol();
  mapLib.addProtocol("pmtiles", protocol.tile);
  pmtilesProtocolInstalled = true;
}

export function ZoningLayer({ map, visible, bounds }: ZoningLayerProps) {
  const [geojson, setGeojson] = useState<GeoJSON.FeatureCollection | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const labelFieldRef = useRef<string>("ZONE");
  const pmtilesReadyRef = useRef(false);

  /* One-time protocol install on the first mount. The MapLibre handle
     lives on `map._map?.constructor`-style paths, so we pull the library
     via dynamic import — matches how MapDashboard initialises itself. */
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      const mapLib = (await import("maplibre-gl")).default;
      if (cancelled) return;
      await ensurePmtilesProtocol(mapLib);
      pmtilesReadyRef.current = true;
    })();
    return () => { cancelled = true; };
  }, [visible]);

  /* ── ArcGIS fallback fetch — only runs when NZA doesn't cover ──── */
  useEffect(() => {
    if (!visible || !map || !bounds) {
      setGeojson(null);
      return;
    }
    if (map.getZoom() < MIN_ZOOM) {
      setGeojson(null);
      return;
    }
    if (isInNzaCoverage(bounds)) {
      // NZA handles this viewport — skip the ArcGIS fetch so we don't
      // double-draw polygons.
      setGeojson(null);
      return;
    }

    const [swLng, swLat, neLng, neLat] = bounds;
    const endpoint = ARCGIS_ENDPOINTS.find((e) => {
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
        /* silent — zoning is non-critical intel */
      }
    }, 400);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [visible, map, bounds]);

  /* ── Render PMTiles layers (primary) ──────────────────────────── */
  useEffect(() => {
    if (!map) return;

    function addNzaLayers() {
      if (!map || !visible || !pmtilesReadyRef.current) return;
      if (map.getSource(PMTILES_SOURCE_ID)) return;

      map.addSource(PMTILES_SOURCE_ID, {
        type: "vector",
        url: `pmtiles://${window.location.origin}${PMTILES_URL}`,
      });

      // Source-layer name is determined by the PMTiles metadata. Our
      // NZA bundle emits every feature under the "zoning" source layer;
      // if that changes we'll need to update the string or query the
      // header (PMTiles#getHeader) at runtime.
      map.addLayer({
        id: PMTILES_FILL_ID,
        type: "fill",
        source: PMTILES_SOURCE_ID,
        "source-layer": "zoning",
        minzoom: MIN_ZOOM - 2, // tiles can paint a touch earlier than the
                                // per-pan ArcGIS path — they're cheap.
        paint: {
          "fill-color": NZA_COLOR_EXPR,
          "fill-opacity": 0.22,
        },
      });
      map.addLayer({
        id: PMTILES_LINE_ID,
        type: "line",
        source: PMTILES_SOURCE_ID,
        "source-layer": "zoning",
        minzoom: MIN_ZOOM - 2,
        paint: {
          "line-color": NZA_COLOR_EXPR,
          "line-width": 0.8,
        },
      });
      map.addLayer({
        id: PMTILES_LABEL_ID,
        type: "symbol",
        source: PMTILES_SOURCE_ID,
        "source-layer": "zoning",
        minzoom: MIN_ZOOM,
        layout: {
          // Per the NZA PMTiles metadata (tippecanoe --layer zoning), the
          // label-friendly fields are `district_name` (free-form local
          // name, often blank) and `zoning_type_label` (human-readable
          // canonical form of `zoning_type`). Fall back to the raw
          // `zoning_type` enum if both are missing.
          "text-field": [
            "coalesce",
            ["get", "district_name"],
            ["get", "zoning_type_label"],
            ["get", "zoning_type"],
            "",
          ],
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

    function removeNzaLayers() {
      safeRemoveLayers(
        map,
        [PMTILES_LABEL_ID, PMTILES_LINE_ID, PMTILES_FILL_ID],
        [PMTILES_SOURCE_ID],
      );
    }

    if (visible && pmtilesReadyRef.current) {
      if (map.isStyleLoaded()) addNzaLayers();
      else map.once("styledata", addNzaLayers);
    } else {
      removeNzaLayers();
    }

    return () => removeNzaLayers();
    // Re-run whenever visibility flips. The pmtilesReadyRef is checked
    // inside addNzaLayers so late protocol install still hooks up the
    // layers on the next render.
  }, [map, visible]);

  /* ── Render ArcGIS fallback layers ────────────────────────────── */
  useEffect(() => {
    if (!map) return;

    function addArcgisLayers() {
      if (!map || !visible || !geojson) return;
      const existing = map.getSource(ARCGIS_SOURCE_ID) as
        | maplibregl.GeoJSONSource
        | undefined;

      const labelField = labelFieldRef.current;
      const colored: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: geojson.features.map((f) => ({
          ...f,
          properties: {
            ...(f.properties ?? {}),
            _label: (f.properties ?? {})[labelField] ?? "?",
            _color: arcgisZoneColor((f.properties ?? {})[labelField] ?? "?"),
          },
        })),
      };

      if (existing) {
        existing.setData(colored);
        return;
      }

      map.addSource(ARCGIS_SOURCE_ID, { type: "geojson", data: colored });

      map.addLayer({
        id: ARCGIS_FILL_ID,
        type: "fill",
        source: ARCGIS_SOURCE_ID,
        paint: {
          "fill-color": ["get", "_color"],
          "fill-opacity": 0.22,
        },
      });
      map.addLayer({
        id: ARCGIS_LINE_ID,
        type: "line",
        source: ARCGIS_SOURCE_ID,
        paint: {
          "line-color": ["get", "_color"],
          "line-width": 0.8,
        },
      });
      map.addLayer({
        id: ARCGIS_LABEL_ID,
        type: "symbol",
        source: ARCGIS_SOURCE_ID,
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

    function removeArcgisLayers() {
      safeRemoveLayers(
        map,
        [ARCGIS_LABEL_ID, ARCGIS_LINE_ID, ARCGIS_FILL_ID],
        [ARCGIS_SOURCE_ID],
      );
    }

    if (visible) {
      if (map.isStyleLoaded()) addArcgisLayers();
      else map.once("styledata", addArcgisLayers);
    } else {
      removeArcgisLayers();
    }

    return () => removeArcgisLayers();
  }, [map, visible, geojson]);

  return null;
}
