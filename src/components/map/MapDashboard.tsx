"use client";

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
      await import("maplibre-gl/dist/maplibre-gl.css");

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
      });

      mapRef.current = map;
    }, [initialCenter, initialZoom, onMapReady, theme]);

    /* Initialize on mount */
    useEffect(() => {
      initMap();

      return () => {
        mapRef.current?.remove();
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
