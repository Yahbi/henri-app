"use client";

import { useEffect, useRef } from "react";
import type maplibregl from "maplibre-gl";
import type { LeadData } from "@/components/dashboard/LeadCard";
import { safeRemoveLayers } from "./layerCleanup";

/**
 * LeadLayer
 * ─────────
 * Headless MapLibre GL component — adds/updates three layers on the live map:
 *   lead-clusters        → orange cluster circles (terracotta brand color)
 *   lead-cluster-count   → white count labels inside clusters
 *   lead-unclustered     → individual score-colored dots (hot/warm/cold)
 *   lead-labels          → score number rendered inside each dot
 *
 * Clicking an individual marker fires onSelectLead so the LeadDetailDrawer opens.
 * Clicking a cluster zooms in to expand it.
 * The panel → map link is handled by the parent via flyTo (see dashboard/page.tsx).
 *
 * Survives map style changes — layers are re-added on every style.load event.
 */

const SOURCE_ID     = "leads-source";
const CLUSTER_LAYER = "lead-clusters";
const COUNT_LAYER   = "lead-cluster-count";
const POINT_LAYER   = "lead-unclustered";
const LABEL_LAYER   = "lead-labels";

interface LeadLayerProps {
  map: maplibregl.Map | null;
  leads: LeadData[];
  onSelectLead?: (lead: LeadData) => void;
}

/** Convert leads with valid WGS84 coords to a GeoJSON FeatureCollection */
function toGeoJSON(leads: LeadData[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: leads
      .filter(
        (l): l is LeadData & { lat: number; lng: number } =>
          typeof l.lat === "number" &&
          typeof l.lng === "number" &&
          Math.abs(l.lat) <= 90 &&
          Math.abs(l.lng) <= 180,
      )
      .map((l) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [l.lng, l.lat] },
        properties: {
          id:    l.id,
          score: l.score,
          addr:  l.addr,
          type:  l.type,
          value: l.value,
          status: l.status ?? "new",
        },
      })),
  };
}

export function LeadLayer({ map, leads, onSelectLead }: LeadLayerProps) {
  const addedRef   = useRef(false);
  const leadsRef   = useRef(leads);
  leadsRef.current = leads;   // keep current for click-handler closures

  /* ── Add / re-add source + layers ─────────────────────────────────────── */
  useEffect(() => {
    if (!map || typeof window === "undefined") return;

    function addLayers() {
      if (!map) return;

      /* Source */
      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
          type: "geojson",
          data: toGeoJSON(leadsRef.current),
          cluster: true,
          clusterMaxZoom: 14,
          clusterRadius: 40,
        });
      } else {
        // Source survived; just refresh data
        (map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource)?.setData(
          toGeoJSON(leadsRef.current),
        );
      }

      /* Cluster circles (terracotta) */
      if (!map.getLayer(CLUSTER_LAYER)) {
        map.addLayer({
          id:     CLUSTER_LAYER,
          type:   "circle",
          source: SOURCE_ID,
          filter: ["has", "point_count"],
          paint: {
            "circle-color":        "#D4886A",
            "circle-opacity":      0.9,
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
            "circle-radius": [
              "step", ["get", "point_count"],
              18,  // default
              10,  24,  // 10+ → 24 px
              50,  30,  // 50+ → 30 px
            ],
          },
        });
      }

      /* Cluster count labels */
      if (!map.getLayer(COUNT_LAYER)) {
        map.addLayer({
          id:     COUNT_LAYER,
          type:   "symbol",
          source: SOURCE_ID,
          filter: ["has", "point_count"],
          layout: {
            "text-field": ["get", "point_count_abbreviated"],
            "text-font":  ["DIN Offc Pro Bold", "Arial Unicode MS Bold"],
            "text-size":  12,
          },
          paint: { "text-color": "#ffffff" },
        });
      }

      /* Individual lead dots — color by score band */
      if (!map.getLayer(POINT_LAYER)) {
        map.addLayer({
          id:     POINT_LAYER,
          type:   "circle",
          source: SOURCE_ID,
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-color": [
              "case",
              [">=", ["get", "score"], 80], "#D4886A",  // hot  → terracotta
              [">=", ["get", "score"], 60], "#D4A24A",  // warm → amber
              "#4A7FC0",                                 // cold → blue
            ],
            "circle-radius":       8,
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
          },
        });
      }

      /* Score label inside each dot */
      if (!map.getLayer(LABEL_LAYER)) {
        map.addLayer({
          id:     LABEL_LAYER,
          type:   "symbol",
          source: SOURCE_ID,
          filter: ["!", ["has", "point_count"]],
          layout: {
            "text-field":  ["to-string", ["get", "score"]],
            "text-font":   ["DIN Offc Pro Bold", "Arial Unicode MS Bold"],
            "text-size":   9,
            "text-anchor": "center",
          },
          paint: { "text-color": "#ffffff" },
        });
      }

      addedRef.current = true;
    }

    if (map.isStyleLoaded()) addLayers();

    // Re-add after every style switch (style.load wipes all sources/layers)
    map.on("style.load", addLayers);
    return () => {
      map.off("style.load", addLayers);
      safeRemoveLayers(
        map,
        [LABEL_LAYER, POINT_LAYER, COUNT_LAYER, CLUSTER_LAYER],
        [SOURCE_ID],
      );
      addedRef.current = false;
    };
  }, [map]);

  /* ── Live-update source data when leads change ─────────────────────────── */
  useEffect(() => {
    if (!map || !addedRef.current) return;
    const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    source?.setData(toGeoJSON(leads));
  }, [map, leads]);

  /* ── Click / hover handlers ────────────────────────────────────────────── */
  useEffect(() => {
    if (!map || typeof window === "undefined") return;

    const onClusterClick = async (
      e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] },
    ) => {
      const feat = e.features?.[0];
      if (!feat || feat.geometry.type !== "Point") return;
      const cid = feat.properties?.cluster_id;
      const src = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (!src || cid == null) return;
      try {
        const zoom = await src.getClusterExpansionZoom(cid);
        if (zoom == null) return;
        map.easeTo({
          center: (feat.geometry as GeoJSON.Point).coordinates as [number, number],
          zoom,
        });
      } catch {
        // ignore
      }
    };

    const onPointClick = (
      e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] },
    ) => {
      const feat = e.features?.[0];
      if (!feat?.properties) return;
      const lead = leadsRef.current.find((l) => l.id === feat.properties!.id);
      if (lead) onSelectLead?.(lead);
    };

    const cursorOn  = () => { map.getCanvas().style.cursor = "pointer"; };
    const cursorOff = () => { map.getCanvas().style.cursor = ""; };

    map.on("click",      CLUSTER_LAYER, onClusterClick);
    map.on("click",      POINT_LAYER,   onPointClick);
    map.on("mouseenter", CLUSTER_LAYER, cursorOn);
    map.on("mouseleave", CLUSTER_LAYER, cursorOff);
    map.on("mouseenter", POINT_LAYER,   cursorOn);
    map.on("mouseleave", POINT_LAYER,   cursorOff);

    return () => {
      map.off("click",      CLUSTER_LAYER, onClusterClick);
      map.off("click",      POINT_LAYER,   onPointClick);
      map.off("mouseenter", CLUSTER_LAYER, cursorOn);
      map.off("mouseleave", CLUSTER_LAYER, cursorOff);
      map.off("mouseenter", POINT_LAYER,   cursorOn);
      map.off("mouseleave", POINT_LAYER,   cursorOff);
    };
  }, [map, onSelectLead]);

  return null;
}
