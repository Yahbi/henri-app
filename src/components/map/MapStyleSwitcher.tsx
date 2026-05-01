"use client";

import { useEffect, useRef, useState } from "react";
// `Map` icon — represents basemap style switching (Voyager / Satellite /
// Streets). `OverlayControls` uses the `Layers` icon for stacking-layers
// semantics; using a different icon here disambiguates the two toolbar
// buttons. Was `Layers` until 2026-04-26 — both buttons looked identical.
import { Map as MapIcon, Check } from "lucide-react";
import { MAP_STYLES_DROPDOWN, type MapStyleOption } from "@/lib/mapbox/config";
import { cn } from "@/lib/utils/cn";
import type maplibregl from "maplibre-gl";

interface MapStyleSwitcherProps {
  map: maplibregl.Map | null;
  className?: string;
  onStyleChange?: (value: string) => void;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// helper — applies a basemap option to a maplibregl.Map. Pulled out
// of handleChange so we can also call it when a queued click resolves
// after the map finishes its initial load.
function applyStyle(map: maplibregl.Map, option: MapStyleOption) {
  // Maplibre accepts either a URL string or an inline style spec.
  // Inline specs (ESRI sat/hybrid/streets) preserve raster sources
  // exactly as defined; URL specs hit the network for the JSON.
  map.setStyle((option.styleSpec as any) ?? option.value);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Basemap style switcher. Prior version rendered as a labeled dropdown
 * showing "Voyager" / "Satellite" text in the top-right. The user asked
 * for an icon button that sits next to the overlay toggle so the toolbar
 * reads as a consistent row of square icons. Implemented as a popover
 * instead of a native <select> so the visual hierarchy matches
 * OverlayControls.
 *
 * Auto-closes on outside click — same behavior as OverlayControls.
 */
export function MapStyleSwitcher({
  map,
  className,
  onStyleChange,
}: MapStyleSwitcherProps) {
  const [current, setCurrent] = useState<string>(
    MAP_STYLES_DROPDOWN[0]?.value ?? "",
  );
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Queue a basemap pick if the user clicks before the map instance has
  // mounted. The previous version of handleChange hit `if (!map) return`
  // and silently swallowed the click — the popover would close (or stay
  // open?), the basemap row wouldn't show a checkmark, and the canvas
  // wouldn't change. This flushes any pending pick the moment `map`
  // becomes non-null. Audit 2026-04-30.
  const pendingPickRef = useRef<MapStyleOption | null>(null);

  // Close when the user clicks anywhere outside the popover — including
  // on the map canvas. Matches the Overlay panel pattern.
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    // Defer by a frame so the open-click itself doesn't immediately close.
    const t = setTimeout(
      () => document.addEventListener("mousedown", handler),
      0,
    );
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", handler);
    };
  }, [open]);

  // Flush a queued pick the moment the map instance becomes available.
  useEffect(() => {
    if (!map) return;
    const queued = pendingPickRef.current;
    if (!queued) return;
    pendingPickRef.current = null;
    applyStyle(map, queued);
    onStyleChange?.(queued.value);
  }, [map, onStyleChange]);

  function handleChange(option: MapStyleOption) {
    // Always update the visible "selected" state so the user gets
    // feedback (checkmark moves to the new row) even if the map isn't
    // ready yet — eliminates the prior "click does nothing" failure.
    setCurrent(option.value);
    setOpen(false);
    if (!map) {
      // Queue and apply the moment the map mounts.
      pendingPickRef.current = option;
      return;
    }
    applyStyle(map, option);
    onStyleChange?.(option.value);
  }

  const groups = MAP_STYLES_DROPDOWN.reduce<Record<string, MapStyleOption[]>>(
    (acc, opt) => {
      const g = opt.group ?? "Other";
      (acc[g] ??= []).push(opt);
      return acc;
    },
    {},
  );

  return (
    <div ref={ref} className={cn("absolute z-10", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Map style"
        aria-expanded={open}
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card/90 shadow-lg backdrop-blur-sm transition-colors hover:bg-accent",
          open && "bg-accent text-accent-foreground",
        )}
      >
        <MapIcon className="h-4 w-4" />
      </button>

      {open && (
        <div className="mt-2 w-56 rounded-lg border border-border bg-card/95 p-3 shadow-lg backdrop-blur-sm">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Basemap
          </h3>
          {Object.entries(groups).map(([groupLabel, opts]) => (
            <div key={groupLabel} className="mb-2 last:mb-0">
              <p className="mb-1 px-1 text-[10px] uppercase tracking-wider text-muted-foreground/70">
                {groupLabel}
              </p>
              <ul>
                {opts.map((style) => (
                  <li key={style.value}>
                    <button
                      type="button"
                      onClick={() => handleChange(style)}
                      className={cn(
                        "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent",
                        current === style.value && "bg-accent/60 font-medium",
                      )}
                    >
                      <span>{style.label}</span>
                      {current === style.value && (
                        <Check className="h-3.5 w-3.5 text-primary" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
