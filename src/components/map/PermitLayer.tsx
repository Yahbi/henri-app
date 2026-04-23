"use client";

import { useEffect, useRef, useCallback } from "react";
import type maplibregl from "maplibre-gl";
import { safeRemoveLayers } from "./layerCleanup";

/**
 * Expected GeoJSON Feature properties:
 *   permitId: string, type: string, address: string,
 *   applicant: string, status: string, date: string
 */

const SOURCE_ID = "permits-source";
const CLUSTER_LAYER = "permit-clusters";
const CLUSTER_COUNT_LAYER = "permit-cluster-count";
const UNCLUSTERED_LAYER = "permit-unclustered";

interface PermitLayerProps {
  map: maplibregl.Map | null;
  visible: boolean;
  permits?: GeoJSON.FeatureCollection;
}

export function PermitLayer({ map, visible, permits }: PermitLayerProps) {
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const addedRef = useRef(false);

  const getPopupClass = useCallback(async () => {
    if (typeof window === "undefined") return null;
    const maplibregl = (await import("maplibre-gl")).default;
    return maplibregl.Popup;
  }, []);

  /* Add source + layers */
  useEffect(() => {
    if (!map || !permits || typeof window === "undefined") return;

    function setup() {
      if (!map || addedRef.current || !permits) return;

      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
          type: "geojson",
          data: permits,
          cluster: true,
          clusterMaxZoom: 14,
          clusterRadius: 50,
        });
      }

      /* Cluster circles */
      if (!map.getLayer(CLUSTER_LAYER)) {
        map.addLayer({
          id: CLUSTER_LAYER,
          type: "circle",
          source: SOURCE_ID,
          filter: ["has", "point_count"],
          paint: {
            "circle-color": [
              "step",
              ["get", "point_count"],
              "hsl(var(--primary))",
              25,
              "hsl(var(--warning))",
              100,
              "hsl(var(--destructive))",
            ],
            "circle-radius": [
              "step",
              ["get", "point_count"],
              18,
              25,
              24,
              100,
              32,
            ],
            "circle-opacity": 0.85,
          },
          layout: {
            visibility: visible ? "visible" : "none",
          },
        });
      }

      /* Cluster count labels */
      if (!map.getLayer(CLUSTER_COUNT_LAYER)) {
        map.addLayer({
          id: CLUSTER_COUNT_LAYER,
          type: "symbol",
          source: SOURCE_ID,
          filter: ["has", "point_count"],
          layout: {
            "text-field": ["get", "point_count_abbreviated"],
            "text-font": ["DIN Offc Pro Medium", "Arial Unicode MS Bold"],
            "text-size": 12,
            visibility: visible ? "visible" : "none",
          },
          paint: {
            "text-color": "hsl(var(--primary-foreground))",
          },
        });
      }

      /* Individual permit dots */
      if (!map.getLayer(UNCLUSTERED_LAYER)) {
        map.addLayer({
          id: UNCLUSTERED_LAYER,
          type: "circle",
          source: SOURCE_ID,
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-color": [
              "match",
              ["get", "type"],
              "residential",
              "hsl(var(--success))",
              "commercial",
              "hsl(var(--primary))",
              "demolition",
              "hsl(var(--destructive))",
              "hsl(var(--muted-foreground))",
            ],
            "circle-radius": 5,
            "circle-stroke-width": 1,
            "circle-stroke-color": "hsl(var(--border))",
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
      safeRemoveLayers(
        map,
        [UNCLUSTERED_LAYER, CLUSTER_COUNT_LAYER, CLUSTER_LAYER],
        [SOURCE_ID],
      );
      addedRef.current = false;
    };
  }, [map, permits, visible]);

  /* Toggle visibility */
  useEffect(() => {
    if (!map || !addedRef.current) return;
    const vis = visible ? "visible" : "none";
    for (const layer of [CLUSTER_LAYER, CLUSTER_COUNT_LAYER, UNCLUSTERED_LAYER]) {
      if (map.getLayer(layer)) {
        map.setLayoutProperty(layer, "visibility", vis);
      }
    }
  }, [map, visible]);

  /* Update source data */
  useEffect(() => {
    if (!map || !permits || !addedRef.current) return;
    const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(permits);
    }
  }, [map, permits]);

  /* Click handler: zoom into cluster or show popup */
  useEffect(() => {
    if (!map || typeof window === "undefined") return;

    const handleClusterClick = async (
      e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] },
    ) => {
      const feature = e.features?.[0];
      if (!feature || feature.geometry.type !== "Point") return;

      const clusterId = feature.properties?.cluster_id;
      const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (!source || clusterId == null) return;

      try {
        const zoom = await source.getClusterExpansionZoom(clusterId);
        if (zoom == null) return;
        map.easeTo({
          center: (feature.geometry as GeoJSON.Point).coordinates as [number, number],
          zoom,
        });
      } catch {
        // ignore
      }
    };

    const handlePointClick = async (
      e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] },
    ) => {
      const feature = e.features?.[0];
      if (!feature?.properties || feature.geometry.type !== "Point") return;

      const props = feature.properties;
      const coords = (feature.geometry as GeoJSON.Point).coordinates.slice() as [
        number,
        number,
      ];

      const PopupClass = await getPopupClass();
      if (!PopupClass) return;

      popupRef.current?.remove();

      const popup = new PopupClass({ closeButton: true, maxWidth: "280px" })
        .setLngLat(coords)
        .setHTML(
          `<div style="font-family:inherit">
            <p style="margin:0 0 4px;font-weight:600;font-size:14px">${props.type ?? "Permit"}</p>
            <p style="margin:0 0 2px;font-size:12px">${props.address ?? ""}</p>
            <p style="margin:0 0 2px;font-size:12px;opacity:0.8">Applicant: ${props.applicant ?? "N/A"}</p>
            <p style="margin:0 0 2px;font-size:12px;opacity:0.7">Status: ${props.status ?? "Unknown"}</p>
            <p style="margin:0;font-size:11px;opacity:0.5">${props.date ?? ""}</p>
          </div>`,
        )
        .addTo(map);

      popupRef.current = popup;
    };

    map.on("click", CLUSTER_LAYER, handleClusterClick);
    map.on("click", UNCLUSTERED_LAYER, handlePointClick);

    const onEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const onLeave = () => {
      map.getCanvas().style.cursor = "";
    };

    map.on("mouseenter", CLUSTER_LAYER, onEnter);
    map.on("mouseleave", CLUSTER_LAYER, onLeave);
    map.on("mouseenter", UNCLUSTERED_LAYER, onEnter);
    map.on("mouseleave", UNCLUSTERED_LAYER, onLeave);

    return () => {
      map.off("click", CLUSTER_LAYER, handleClusterClick);
      map.off("click", UNCLUSTERED_LAYER, handlePointClick);
      map.off("mouseenter", CLUSTER_LAYER, onEnter);
      map.off("mouseleave", CLUSTER_LAYER, onLeave);
      map.off("mouseenter", UNCLUSTERED_LAYER, onEnter);
      map.off("mouseleave", UNCLUSTERED_LAYER, onLeave);
      popupRef.current?.remove();
    };
  }, [map, getPopupClass]);

  return null;
}
