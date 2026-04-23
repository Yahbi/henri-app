"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  Layers,
  FileText,
  MapPin,
  Droplets,
  Users,
  CloudAlert,
  Radar,
  Tornado,
  AlertOctagon,
  Grid3x3,
  Map as MapIcon,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface OverlayState {
  permits: boolean;
  territories: boolean;
  femaFloodZones: boolean;
  censusData: boolean;
  weatherAlerts: boolean;
  /** Live NEXRAD base-reflectivity radar (Iowa State mesonet, free). */
  noaaRadar: boolean;
  /** SPC Day-1 Convective Outlook polygons (NOAA SPC, free GeoJSON). */
  spcOutlook: boolean;
  /** NWS active-alert polygons rendered on the map surface. */
  alertPolygons: boolean;
  /** Parcel boundaries (county-GIS polygons). */
  parcels: boolean;
  /** Zoning districts (city-GIS polygons). */
  zoning: boolean;
}

interface OverlayControlsProps {
  initialState?: Partial<OverlayState>;
  onChange?: (state: OverlayState) => void;
  className?: string;
}

interface OverlayOption {
  key: keyof OverlayState;
  label: string;
  icon: typeof Layers;
}

const OVERLAYS: OverlayOption[] = [
  { key: "permits", label: "Permits", icon: FileText },
  { key: "territories", label: "Territories", icon: MapPin },
  { key: "femaFloodZones", label: "FEMA Flood Zones", icon: Droplets },
  { key: "censusData", label: "Census Data", icon: Users },
  { key: "weatherAlerts", label: "Weather Alerts", icon: CloudAlert },
  // NOAA-backed severe-weather layers — all free, no auth:
  { key: "noaaRadar", label: "NEXRAD Radar (live)", icon: Radar },
  { key: "spcOutlook", label: "SPC Storm Outlook", icon: Tornado },
  { key: "alertPolygons", label: "Alert Polygons", icon: AlertOctagon },
  // Jurisdictional layers — populated by free county/city ArcGIS services
  // (Hartford CT + LA County currently; extends via lib/enrichment):
  { key: "parcels", label: "Parcel Boundaries", icon: Grid3x3 },
  { key: "zoning", label: "Zoning Districts", icon: MapIcon },
];

const DEFAULT_STATE: OverlayState = {
  permits: false,
  territories: false,
  femaFloodZones: false,
  censusData: false,
  weatherAlerts: false,
  noaaRadar: false,
  spcOutlook: false,
  alertPolygons: false,
  parcels: false,
  zoning: false,
};

export function OverlayControls({
  initialState,
  onChange,
  className,
}: OverlayControlsProps) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<OverlayState>({
    ...DEFAULT_STATE,
    ...initialState,
  });
  const rootRef = useRef<HTMLDivElement>(null);

  // Auto-close when the user clicks anywhere outside the panel — including
  // on the map canvas itself. Without this the dropdown lingered and
  // blocked lead pins directly under it. Defer registration by a frame
  // so the current click that opened the panel doesn't immediately close it.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const t = setTimeout(
      () => document.addEventListener("mousedown", handler),
      0,
    );
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", handler);
    };
  }, [open]);

  // Don't call `onChange` from inside the setState updater — React
  // invokes the updater during reconciliation, so a parent setState
  // triggered there fires the "Cannot update a component while
  // rendering a different component" warning (seen on DashboardPage
  // ← OverlayControls). Compute + fire synchronously from the handler.
  const toggle = useCallback(
    (key: keyof OverlayState) => {
      setState((prev) => {
        const next = { ...prev, [key]: !prev[key] };
        // Schedule the parent update for after this render commits.
        queueMicrotask(() => onChange?.(next));
        return next;
      });
    },
    [onChange],
  );

  return (
    <div
      ref={rootRef}
      className={cn("absolute z-10 flex flex-col", className)}
    >
      {/* Toggle button */}
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card/90 shadow-lg backdrop-blur-sm transition-colors",
          "hover:bg-accent hover:text-accent-foreground",
          open && "bg-accent text-accent-foreground",
        )}
        aria-label={open ? "Close overlay panel" : "Open overlay panel"}
        aria-expanded={open}
      >
        <Layers className="h-4 w-4" />
      </button>

      {/* Collapsible panel */}
      {open && (
        <div className="mt-2 w-56 rounded-lg border border-border bg-card/95 p-3 shadow-lg backdrop-blur-sm">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Overlays
          </h3>
          <div className="space-y-1">
            {OVERLAYS.map(({ key, label, icon: Icon }) => (
              <label
                key={key}
                className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
              >
                <button
                  role="switch"
                  aria-checked={state[key]}
                  onClick={() => toggle(key)}
                  className={cn(
                    "relative h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors",
                    state[key] ? "bg-primary" : "bg-muted",
                  )}
                >
                  <span
                    className={cn(
                      "absolute left-0.5 top-0.5 h-3.5 w-3.5 rounded-full bg-background shadow transition-transform",
                      state[key] && "translate-x-4",
                    )}
                  />
                </button>
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="text-foreground">{label}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
