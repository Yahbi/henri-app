"use client";

// CRITICAL: maplibre-gl.css MUST be a static top-level import so
// Next.js's CSS extractor processes it at build time and ships it
// in the dashboard route's CSS bundle. The previous dynamic-await
// `import("maplibre-gl/dist/maplibre-gl.css")` worked in dev (where
// CSS handling is permissive) but produced a promise the production
// build silently dropped — leaving the maplibre canvas mounted but
// with zero style rules, which renders as "no map" on prod even
// though the JS is fully loaded. Audit 2026-04-30; founder report.
import "maplibre-gl/dist/maplibre-gl.css";

import {
  useEffect,
  useRef,
  useCallback,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import { useTheme } from "@/components/ThemeProvider";
import { MAP_STYLE_BY_THEME } from "@/lib/mapbox/config";
import type maplibregl from "maplibre-gl";

interface MapDashboardProps {
  initialCenter?: [number, number];
  initialZoom?: number;
  onMapReady?: (map: maplibregl.Map) => void;
}

export interface MapDashboardHandle {
  getMap: () => maplibregl.Map | null;
  /** Notify the map which style is active so the theme-sync guard works correctly. */
  setCurrentStyle: (style: string) => void;
}

const MapDashboard = forwardRef<MapDashboardHandle, MapDashboardProps>(
  function MapDashboard(
    {
      initialCenter = [-98.5795, 39.8283],
      initialZoom = 4,
      onMapReady,
    },
    ref,
  ) {
    const containerRef    = useRef<HTMLDivElement>(null);
    const mapRef          = useRef<maplibregl.Map | null>(null);
    const currentStyleRef = useRef<string | null>(null);
    const [isLoaded, setIsLoaded] = useState(false);
    const { theme } = useTheme();

    useImperativeHandle(ref, () => ({
      getMap: () => mapRef.current,
      setCurrentStyle: (style: string) => {
        currentStyleRef.current = style;
      },
    }));

    const initMap = useCallback(async () => {
      if (typeof window === "undefined") return;
      if (!containerRef.current) return;
      if (mapRef.current) return;

      const maplibregl = (await import("maplibre-gl")).default;
      // CSS is now imported statically at the top of this file — see
      // the comment there. No dynamic CSS import here.

      const style = MAP_STYLE_BY_THEME[theme] ?? MAP_STYLE_BY_THEME.light;

      const map = new maplibregl.Map({
        container: containerRef.current,
        style,
        center: initialCenter,
        zoom: initialZoom,
        attributionControl: false,
      });

      map.addControl(new maplibregl.NavigationControl(), "top-right");
      map.addControl(
        new maplibregl.AttributionControl({ compact: true }),
        "bottom-right",
      );

      map.on("load", () => {
        setIsLoaded(true);
        onMapReady?.(map);
        // Defensive resize after load. If the parent flex container
        // grew between map construction and the load event (common on
        // dashboards where the leads panel + drawer settle async),
        // maplibre's default 400x300 canvas can stick. Forcing a
        // resize after load picks up the real container dimensions.
        // Audit 2026-04-30 — founder reported "the map doesn't show"
        // which on slow first paint was the canvas locked tiny.
        try { map.resize(); } catch { /* style not ready */ }
      });

      mapRef.current = map;

      // Belt-and-suspenders ResizeObserver: if maplibre's built-in
      // observer misses the first parent-grow tick, this catches it.
      // Throttled via requestAnimationFrame so a layout that reads back
      // dimensions during the resize callback can't whip up an
      // observer loop. Skips the call if the container is 0x0
      // (typically during unmount), which would also crash maplibre's
      // internal style.
      if (typeof ResizeObserver !== "undefined" && containerRef.current) {
        let rafId: number | null = null;
        const ro = new ResizeObserver((entries) => {
          if (rafId !== null) return;
          // Bail if the container is zero — happens during unmount.
          const box = entries[0]?.contentRect;
          if (!box || box.width === 0 || box.height === 0) return;
          rafId = requestAnimationFrame(() => {
            rafId = null;
            try { map.resize(); } catch { /* during teardown */ }
          });
        });
        ro.observe(containerRef.current);
        // Stash the observer so cleanup can disconnect it.
        (map as unknown as { __henriRO?: ResizeObserver }).__henriRO = ro;
      }
    }, [initialCenter, initialZoom, onMapReady, theme]);

    /* Initialize on mount */
    useEffect(() => {
      initMap();

      return () => {
        const m = mapRef.current as unknown as
          | (maplibregl.Map & { __henriRO?: ResizeObserver })
          | null;
        m?.__henriRO?.disconnect();
        m?.remove();
        mapRef.current = null;
      };
      // Only run once on mount
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /* Update style when theme changes — but only if the user hasn't manually
       selected a non-theme style (e.g. OpenFreeMap Liberty or ESRI Satellite). */
    useEffect(() => {
      if (!mapRef.current || !isLoaded) return;
      const themeStyleValues = Object.values(MAP_STYLE_BY_THEME);
      // If the user has picked an external style, leave it untouched.
      if (
        currentStyleRef.current !== null &&
        !themeStyleValues.includes(currentStyleRef.current)
      ) {
        return;
      }
      const style = MAP_STYLE_BY_THEME[theme] ?? MAP_STYLE_BY_THEME.light;
      mapRef.current.setStyle(style);
      currentStyleRef.current = style;
    }, [theme, isLoaded]);

    return (
      <div
        ref={containerRef}
        className="w-full h-full bg-muted"
        aria-label="Interactive map"
      />
    );
  },
);

export default MapDashboard;
