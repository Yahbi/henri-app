export const MAPTILER_KEY  = process.env.NEXT_PUBLIC_MAPTILER_KEY  ?? "";

// Free CARTO GL styles — no API key required
export const MAP_STYLE_BY_THEME: Record<string, string> = {
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  dark:  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  dusk:  "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
};

export interface MapStyleOption {
  label: string;
  /** Unique key used by <select> and for theme-guard tracking. */
  value: string;
  group?: string;
  /**
   * Inline Mapbox GL Style Spec object — used for raster tile sources (ESRI, etc.)
   * that cannot be expressed as a single style URL.
   * When present, MapStyleSwitcher passes this to map.setStyle() instead of `value`.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  styleSpec?: Record<string, any>;
}

// ── Free raster tile style builders (ESRI — no API key required) ─────────────
// ESRI terms: https://www.esri.com/en-us/legal/terms/full-master-agreement
// Free for apps that use Esri tiles with attribution.

const ESRI_SAT   = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const ESRI_LBLS  = "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";
const ESRI_STREET= "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}";
const ESRI_ATTR  = "Tiles &copy; <a href='https://www.esri.com'>Esri</a>";

/** Pure ESRI satellite imagery — no labels */
export const ESRI_SATELLITE_SPEC = {
  version: 8,
  sources: {
    "esri-sat": { type: "raster", tiles: [ESRI_SAT], tileSize: 256, attribution: ESRI_ATTR, maxzoom: 19 },
  },
  layers: [{ id: "esri-sat", type: "raster", source: "esri-sat" }],
} as const;

/** ESRI satellite + place/road label overlay */
export const ESRI_HYBRID_SPEC = {
  version: 8,
  sources: {
    "esri-sat":  { type: "raster", tiles: [ESRI_SAT],  tileSize: 256, attribution: ESRI_ATTR, maxzoom: 19 },
    "esri-lbls": { type: "raster", tiles: [ESRI_LBLS], tileSize: 256, attribution: ESRI_ATTR, maxzoom: 19 },
  },
  layers: [
    { id: "esri-sat",  type: "raster", source: "esri-sat"  },
    { id: "esri-lbls", type: "raster", source: "esri-lbls" },
  ],
} as const;

/** ESRI World Street Map — clean, detailed road map */
export const ESRI_STREETS_SPEC = {
  version: 8,
  sources: {
    "esri-street": { type: "raster", tiles: [ESRI_STREET], tileSize: 256, attribution: ESRI_ATTR, maxzoom: 19 },
  },
  layers: [{ id: "esri-street", type: "raster", source: "esri-street" }],
} as const;

export const MAP_STYLES_DROPDOWN: MapStyleOption[] = [
  // ── CARTO — free vector styles, no key ───────────────────────────────────
  { label: "Voyager",      value: "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",     group: "CARTO" },
  { label: "Positron",     value: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",    group: "CARTO" },
  { label: "Dark Matter",  value: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json", group: "CARTO" },
  // ── OpenFreeMap — free vector road maps, no key ───────────────────────────
  { label: "Positron",     value: "https://tiles.openfreemap.org/styles/positron", group: "Free Road" },
  { label: "Bright",       value: "https://tiles.openfreemap.org/styles/bright",   group: "Free Road" },
  { label: "Liberty",      value: "https://tiles.openfreemap.org/styles/liberty",  group: "Free Road" },
  // ── ESRI — free satellite + road raster tiles, no key ────────────────────
  { label: "Satellite",    value: "__esri_satellite__", group: "Free Satellite", styleSpec: ESRI_SATELLITE_SPEC },
  { label: "Hybrid",       value: "__esri_hybrid__",    group: "Free Satellite", styleSpec: ESRI_HYBRID_SPEC   },
  { label: "ESRI Streets", value: "__esri_streets__",   group: "Free Satellite", styleSpec: ESRI_STREETS_SPEC  },
  // ── MapTiler (requires NEXT_PUBLIC_MAPTILER_KEY — free tier at maptiler.com) ─
  ...(MAPTILER_KEY
    ? [{ label: "Satellite HD", value: `https://api.maptiler.com/maps/satellite/style.json?key=${MAPTILER_KEY}`, group: "MapTiler" }]
    : []),
];

export interface GlobeMarker {
  location: [number, number];
  size: number;
}

export interface GlobeConfig {
  markers: GlobeMarker[];
  phi: number;
  theta: number;
  width: number;
  height: number;
  devicePixelRatio: number;
  dark: number;
  diffuse: number;
  mapSamples: number;
  mapBrightness: number;
  baseColor: [number, number, number];
  markerColor: [number, number, number];
  glowColor: [number, number, number];
}

export const HENRI_GLOBE_CONFIG: GlobeConfig = {
  markers: [
    { location: [41.8781, -87.6298], size: 0.08 },   // Chicago
    { location: [40.7128, -74.006], size: 0.1 },      // New York
    { location: [34.0522, -118.2437], size: 0.09 },   // Los Angeles
    { location: [29.7604, -95.3698], size: 0.07 },    // Houston
    { location: [33.4484, -112.074], size: 0.06 },    // Phoenix
    { location: [39.7392, -104.9903], size: 0.06 },   // Denver
    { location: [47.6062, -122.3321], size: 0.06 },   // Seattle
    { location: [25.7617, -80.1918], size: 0.07 },    // Miami
    { location: [42.3601, -71.0589], size: 0.06 },    // Boston
    { location: [37.7749, -122.4194], size: 0.08 },   // San Francisco
  ],
  phi: 0,
  theta: 0.3,
  width: 600,
  height: 600,
  devicePixelRatio: 2,
  dark: 1,
  diffuse: 1.2,
  mapSamples: 16000,
  mapBrightness: 6,
  baseColor: [0.3, 0.3, 0.3],
  markerColor: [0.1, 0.8, 1],
  glowColor: [0.1, 0.8, 1],
};
