"use client";

import { useEffect, useRef } from "react";
import type maplibregl from "maplibre-gl";
import { safeRemoveLayers } from "./layerCleanup";

/**
 * NEXRAD base-reflectivity radar, served as XYZ raster tiles by the Iowa
 * State University Mesonet (`mesonet.agron.iastate.edu`). Tiles refresh
 * every ~5 min, cover all of CONUS, and are free to use for non-commercial
 * and commercial overlays alike. No API key, no rate limits documented.
 *
 * We don't proxy through our server — these are public raster tiles, safe
 * to load straight from the client. Cache-bust every 5 min by appending
 * a minute-coarse timestamp so the layer re-fetches fresh frames.
 */
interface NOAARadarLayerProps {
  map: maplibregl.Map | null;
  visible: boolean;
}

const SOURCE_ID = "noaa-radar";
const LAYER_ID = "noaa-radar-layer";
// Iowa State mesonet — {z}/{x}/{y} pattern. `n0q` = composite base
// reflectivity; other layers available (n0r, ref0, etc). 900913 suffix
// = Web Mercator projection (matches MapLibre's default).
const NEXRAD_TILE_URL =
  "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png";

export function NOAARadarLayer({ map, visible }: NOAARadarLayerProps) {
  // Rotate the cache-buster every 5 minutes so stale tiles in the browser
  // cache get replaced with new radar frames. Initialized in effect so
  // Date.now() isn't called during render (react-hooks/purity).
  const cacheBucket = useRef<number>(0);
  useEffect(() => {
    cacheBucket.current = Math.floor(Date.now() / 300_000);
  }, []);

  useEffect(() => {
    if (!map) return;

    function addLayer() {
      if (!map || !visible) return;
      if (map.getSource(SOURCE_ID)) return;

      const tileUrl = `${NEXRAD_TILE_URL}?v=${cacheBucket.current}`;
      map.addSource(SOURCE_ID, {
        type: "raster",
        tiles: [tileUrl],
        tileSize: 256,
        attribution:
          '<a href="https://mesonet.agron.iastate.edu/" target="_blank" rel="noopener">Iowa State Mesonet NEXRAD</a>',
      });
      // Render below any symbol layers so lead pins sit on top of the
      // radar sweep. Fallback: add at the top if no symbol layers exist.
      const layers = map.getStyle()?.layers ?? [];
      const firstSymbol = layers.find((l) => l.type === "symbol")?.id;
      map.addLayer(
        {
          id: LAYER_ID,
          type: "raster",
          source: SOURCE_ID,
          paint: { "raster-opacity": 0.55 },
        },
        firstSymbol,
      );
    }

    function removeLayer() {
      // safeRemoveLayers swallows the "map style torn down" throw that
      // fires during client-side nav away from /dashboard. See plan gap
      // for the nav-crash root cause.
      safeRemoveLayers(map, [LAYER_ID], [SOURCE_ID]);
    }

    if (visible) {
      if (map.isStyleLoaded()) addLayer();
      else map.once("styledata", addLayer);
    } else {
      removeLayer();
    }

    return () => {
      removeLayer();
    };
  }, [map, visible]);

  // Refresh every 5 min when visible — swap the source tiles to a new URL
  // so browsers don't serve stale radar.
  useEffect(() => {
    if (!map || !visible) return;
    const interval = setInterval(() => {
      cacheBucket.current = Math.floor(Date.now() / 300_000);
      const src = map.getSource(SOURCE_ID) as maplibregl.RasterTileSource | undefined;
      if (src && typeof (src as unknown as { setTiles?: (u: string[]) => void }).setTiles === "function") {
        // MapLibre v2+ exposes setTiles on raster sources; cast to access.
        (src as unknown as { setTiles: (u: string[]) => void }).setTiles([
          `${NEXRAD_TILE_URL}?v=${cacheBucket.current}`,
        ]);
      }
    }, 300_000);
    return () => clearInterval(interval);
  }, [map, visible]);

  return null;
}
