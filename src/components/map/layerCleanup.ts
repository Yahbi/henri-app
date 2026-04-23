import type maplibregl from "maplibre-gl";

/**
 * Crash-safe removal of MapLibre layers and sources on component unmount.
 *
 * The map's internal Style can be torn down before the owning React component
 * unmounts (parent unmount order), which causes `map.getLayer()` /
 * `map.removeLayer()` to throw `TypeError: Cannot read properties of undefined
 * (reading 'getLayer')`. Every overlay component should use this helper
 * instead of calling the MapLibre APIs directly from cleanup effects.
 */
export function safeRemoveLayers(
  map: maplibregl.Map | null | undefined,
  layerIds: string[],
  sourceIds: string[] = [],
): void {
  if (!map) return;
  // After teardown, MapLibre's internal `style` is set to undefined but the
  // Map prototype methods remain — so `typeof map.getLayer === "function"`
  // is still true and calling it throws "Cannot read properties of undefined
  // (reading 'getLayer')" with the Map instance as `this`. Check
  // `isStyleLoaded()` FIRST; it returns false (or throws which we catch)
  // once the style is gone, so we bail early and never hit the real
  // getLayer call.
  try {
    if (typeof map.getLayer !== "function") return;
    if (typeof map.isStyleLoaded === "function" && !map.isStyleLoaded()) {
      // Style not ready (still loading) OR already torn down. Either way
      // there's no style for us to mutate — skip.
      return;
    }
  } catch {
    return;
  }
  try {
    for (const id of layerIds) {
      try {
        if (map.getLayer(id)) map.removeLayer(id);
      } catch {
        /* layer already gone with style */
      }
    }
    for (const id of sourceIds) {
      try {
        if (map.getSource(id)) map.removeSource(id);
      } catch {
        /* source already gone */
      }
    }
  } catch {
    /* map was destroyed mid-loop; nothing to clean up */
  }
}
