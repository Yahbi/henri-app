"use client";

import dynamic from "next/dynamic";
import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { MapStyleSwitcher } from "@/components/map/MapStyleSwitcher";
import { OverlayControls } from "@/components/map/OverlayControls";
import type { OverlayState } from "@/components/map/OverlayControls";
import { FEMAFloodLayer } from "@/components/map/FEMAFloodLayer";
import { CensusLayer } from "@/components/map/CensusLayer";
import { NOAARadarLayer } from "@/components/map/NOAARadarLayer";
import { SPCOutlookLayer } from "@/components/map/SPCOutlookLayer";
import { NWSAlertPolygonLayer } from "@/components/map/NWSAlertPolygonLayer";
import { ParcelLayer } from "@/components/map/ParcelLayer";
import { ZoningLayer } from "@/components/map/ZoningLayer";
import { WeatherAlertBanner } from "@/components/map/WeatherAlertBanner";
import { useFEMAFlood, useCensusOverlay, useWeatherAlerts } from "@/hooks/useOverlayData";
import type { MapDashboardHandle } from "@/components/map/MapDashboard";
import type maplibregl from "maplibre-gl";
import { createClient } from "@/lib/supabase/client";
import { ExpandableBanner } from "@/components/ui/expandable-banner";
import { AlertTriangle } from "lucide-react";
import { useLeadCount } from "@/hooks/useLeadCount";

const MapDashboard = dynamic(() => import("@/components/map/MapDashboard"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-muted animate-pulse flex items-center justify-center">
      <p className="text-sm text-muted-foreground">Loading map...</p>
    </div>
  ),
});

/* ── Trade colours — deterministic, accessible palette ───────────────────── */

const TRADE_COLORS: Record<string, string> = {
  roofing: "#D4886A",
  hvac: "#4A7FC0",
  plumbing: "#3B8A6E",
  electrical: "#D4A24A",
  solar: "#E8B931",
  painting: "#9B6DB0",
  landscaping: "#5DAA68",
  foundation: "#8C7355",
  "general remodel": "#D4886A",
  adu: "#D47B8A",
  windows: "#5BA4C9",
  other: "#8E8E93",
};

const TRADE_OPTIONS = [
  "all",
  "roofing",
  "hvac",
  "plumbing",
  "electrical",
  "solar",
  "painting",
  "landscaping",
  "foundation",
  "general remodel",
  "adu",
  "windows",
] as const;

const STATUS_OPTIONS = ["all", "new", "contacted", "quoted", "won"] as const;

/* ── Main page component ─────────────────────────────────────────────────── */

export default function MapPage() {
  const mapRef = useRef<MapDashboardHandle>(null);
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null);
  const [geojson, setGeojson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tradeFilter, setTradeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [daysFilter, setDaysFilter] = useState<number>(90);
  const [showRawPermits, setShowRawPermits] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const leadCount = useLeadCount();
  const popupRef = useRef<maplibregl.Popup | null>(null);

  /* ── Overlay state ── */
  const [overlayState, setOverlayState] = useState<OverlayState>({
    permits: false, territories: false, femaFloodZones: false, censusData: false, weatherAlerts: false,
    noaaRadar: false, spcOutlook: false, alertPolygons: false,
    parcels: false, zoning: false,
  });
  const [mapBounds, setMapBounds] = useState<[number, number, number, number] | null>(null);
  const [mapCenter, setMapCenter] = useState<[number, number] | null>(null);

  const { data: femaData } = useFEMAFlood(mapBounds, overlayState.femaFloodZones);
  const { alerts: weatherAlerts } = useWeatherAlerts(mapCenter, overlayState.weatherAlerts);

  /* Census overlay: extract ZIPs + locations from GeoJSON features */
  const leadZips = useMemo(() => {
    if (!geojson) return [];
    return [...new Set(geojson.features.map((f) => f.properties?.zip).filter(Boolean))] as string[];
  }, [geojson]);
  const { data: censusData } = useCensusOverlay(leadZips, overlayState.censusData);
  const censusLeadLocations = useMemo(() => {
    if (!geojson) return [];
    return geojson.features
      .filter((f) => f.properties?.zip && f.geometry.type === "Point")
      .map((f) => ({
        zip: f.properties!.zip as string,
        lat: (f.geometry as GeoJSON.Point).coordinates[1],
        lng: (f.geometry as GeoJSON.Point).coordinates[0],
      }));
  }, [geojson]);

  useEffect(() => {
    if (!mapInstance) return;
    function updateBounds() {
      if (!mapInstance) return;
      const b = mapInstance.getBounds();
      setMapBounds([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
      const c = mapInstance.getCenter();
      setMapCenter([c.lng, c.lat]);
    }
    mapInstance.on("moveend", updateBounds);
    updateBounds();
    return () => { mapInstance.off("moveend", updateBounds); };
  }, [mapInstance]);

  /* ── Fetch leads from API (progressive paint) ────────────────────────────
   * Two-stage strategy so the map feels instant even at god-mode volume:
   *   Stage 1: small `limit=2000` request — pins render in ~2s.
   *   Stage 2: background fetch with full cap — swaps in more pins when ready.
   * User always sees something fast; the richer dataset backfills silently. */
  const fetchMapData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const buildParams = (limit: number) => {
      const params = new URLSearchParams();
      if (tradeFilter !== "all") params.set("trade", tradeFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
      params.set("days", String(daysFilter));
      if (showRawPermits) params.set("include_permits", "1");
      params.set("limit", String(limit));
      return params;
    };

    // Stage 1: fast first paint
    try {
      const res = await fetch(`/api/leads/map?${buildParams(2000)}`);
      if (!res.ok) {
        if (res.status === 401) {
          const supabase = createClient();
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) {
            setError("Please sign in to view the map.");
            return;
          }
        }
        throw new Error(`Request failed (${res.status})`);
      }
      const data: GeoJSON.FeatureCollection = await res.json();
      setGeojson(data);
      setTotalCount(data.features.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load map data");
      setLoading(false);
      return;
    }
    setLoading(false);

    // Stage 2: background refinement — quietly upgrades the geojson with
    // ALL pins in the account. 500k = server hard ceiling; /api/leads/map
    // paginates through in 1000-row Supabase pages with partial-result
    // tolerance so statement timeouts on a later page still render what
    // came back. We don't set loading=true so the UI stays interactive.
    try {
      const res = await fetch(`/api/leads/map?${buildParams(500_000)}`);
      if (!res.ok) return;
      const data: GeoJSON.FeatureCollection = await res.json();
      // Only swap in if we actually got more features (avoids replacing a
      // stable paint with the same thing if the API returns identical data).
      setGeojson((prev) => {
        if (prev && data.features.length <= prev.features.length) return prev;
        return data;
      });
      setTotalCount(data.features.length);
    } catch {
      // Silent — stage 1 data is still on screen.
    }
  }, [tradeFilter, statusFilter, daysFilter, showRawPermits]);

  useEffect(() => {
    fetchMapData();
  }, [fetchMapData]);

  /* ── Add/update map layers when data or map changes ────────────────────── */
  useEffect(() => {
    if (!mapInstance || !geojson) return;

    const SOURCE_ID = "map-leads";
    const CLUSTER_LAYER = "map-lead-clusters";
    const COUNT_LAYER = "map-lead-cluster-count";
    const POINT_LAYER = "map-lead-points";

    // Handlers declared at effect scope (not inside addLayers) so the
    // cleanup below can detach them. Previously addLayers re-registered
    // a fresh closure every geojson tick which stacked duplicate click
    // listeners and eventually swallowed user clicks.
    let onClusterClick: (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => void = () => {};
    let onPointClick: (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => void = () => {};
    const cursorOn = () => { if (mapInstance) mapInstance.getCanvas().style.cursor = "pointer"; };
    const cursorOff = () => { if (mapInstance) mapInstance.getCanvas().style.cursor = ""; };

    function addLayers() {
      if (!mapInstance) return;
      // Capture non-null reference for closures below.
      const map = mapInstance;

      /* Source */
      if (!mapInstance.getSource(SOURCE_ID)) {
        mapInstance.addSource(SOURCE_ID, {
          type: "geojson",
          data: geojson!,
          cluster: true,
          clusterMaxZoom: 14,
          clusterRadius: 45,
        });
      } else {
        // Source already exists — update its data, then fall through to the
        // per-layer getLayer() checks below so any missing layers (e.g., after
        // a previous cleanup/style-switch wiped them) get rebuilt. The
        // per-layer `if (!getLayer(id))` guards prevent double-add.
        (mapInstance.getSource(SOURCE_ID) as maplibregl.GeoJSONSource)?.setData(
          geojson!,
        );
      }

      /* Cluster circles */
      if (!mapInstance.getLayer(CLUSTER_LAYER)) {
        mapInstance.addLayer({
          id: CLUSTER_LAYER,
          type: "circle",
          source: SOURCE_ID,
          filter: ["has", "point_count"],
          paint: {
            "circle-color": "#D4886A",
            "circle-opacity": 0.9,
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
            "circle-radius": [
              "step",
              ["get", "point_count"],
              18,
              10, 24,
              50, 32,
            ],
          },
        });
      }

      /* Cluster count */
      if (!mapInstance.getLayer(COUNT_LAYER)) {
        mapInstance.addLayer({
          id: COUNT_LAYER,
          type: "symbol",
          source: SOURCE_ID,
          filter: ["has", "point_count"],
          layout: {
            "text-field": ["get", "point_count_abbreviated"],
            "text-font": ["DIN Offc Pro Bold", "Arial Unicode MS Bold"],
            "text-size": 12,
          },
          paint: { "text-color": "#ffffff" },
        });
      }

      /* Individual permit points — coloured by trade */
      if (!mapInstance.getLayer(POINT_LAYER)) {
        const tradeColorStops: (string | unknown)[] = ["match", ["get", "trade"]];
        for (const [trade, color] of Object.entries(TRADE_COLORS)) {
          tradeColorStops.push(trade, color);
        }
        tradeColorStops.push("#8E8E93"); // fallback

        mapInstance.addLayer({
          id: POINT_LAYER,
          type: "circle",
          source: SOURCE_ID,
          filter: ["!", ["has", "point_count"]],
          paint: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            "circle-color": tradeColorStops as any,
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["get", "score"],
              0, 6,
              50, 8,
              100, 11,
            ],
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
          },
        });
      }

      /* Interaction handlers — assigned to outer refs so the effect
       * cleanup can detach them. Must NOT re-register on every re-entry
       * into addLayers (e.g. after a style.load re-fire), so we guard
       * at the bottom of this function. */
      onClusterClick = async (
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
          /* ignore */
        }
      };

      onPointClick = async (
        e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] },
      ) => {
        const feat = e.features?.[0];
        if (!feat?.properties || feat.geometry.type !== "Point") return;

        const p = feat.properties;
        const coords = (feat.geometry as GeoJSON.Point).coordinates.slice() as [number, number];

        const maplibreModule = await import("maplibre-gl");
        const PopupClass = maplibreModule.default.Popup;

        popupRef.current?.remove();

        const valueStr = p.permit_value && Number(p.permit_value) > 0
          ? `$${Number(p.permit_value).toLocaleString()}`
          : "N/A";

        const tradeLabel = p.trade
          ? String(p.trade).charAt(0).toUpperCase() + String(p.trade).slice(1)
          : "Other";

        const scoreNum = Number(p.score ?? 0);
        const scoreColor = scoreNum >= 80 ? "#D4886A" : scoreNum >= 60 ? "#D4A24A" : "#4A7FC0";

        // HTML-escape helper — popup content is set via setHTML so user
        // strings must not break out of attributes.
        const esc = (s: unknown) =>
          String(s ?? "").replace(/[&<>"']/g, (c) =>
            c === "&" ? "&amp;" :
            c === "<" ? "&lt;" :
            c === ">" ? "&gt;" :
            c === '"' ? "&quot;" : "&#39;");
        const popupId = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        const descRaw = String(p.description ?? "");
        const hasMoreDesc = descRaw.length > 120;
        const descPreview = hasMoreDesc ? descRaw.slice(0, 120) + "…" : descRaw;

        // Owner info — name + contact. Fall back through owner_name →
        // applicant_name so we surface whatever the upstream source has.
        const ownerName = String(
          p.owner_name ??
          p.applicant_name ??
          [p.owner_first, p.owner_last].filter(Boolean).join(" ").trim() ??
          "",
        ).trim();
        const phoneRaw = String(p.phone ?? "").trim();
        const emailRaw = String(p.email ?? "").trim();
        const contractorRaw = String(p.contractor_name ?? "").trim();
        const hasOwnerBlock = !!(
          ownerName || phoneRaw || emailRaw || contractorRaw || p.mailing_address
        );

        // Multi-permit / cascade intelligence
        const cascadeCount = Number(p.cascade_count ?? 0);
        const pipelineVal = p.pipeline_value && Number(p.pipeline_value) > 0
          ? `$${Number(p.pipeline_value).toLocaleString()}` : null;

        // Permit dates (YYYY-MM-DD)
        const issuedDate = String(p.issued_date ?? "").slice(0, 10);
        const appliedDate = String(p.applied_date ?? "").slice(0, 10);

        // Score breakdown — render as bars (0-20 freshness/value, 0-15 others)
        const breakdownRow = (label: string, value: number, max: number) =>
          `<div style="display:flex;align-items:center;gap:6px;font-size:11px;opacity:0.8">
            <span style="flex:0 0 72px">${esc(label)}</span>
            <span style="flex:1;height:4px;background:rgba(0,0,0,0.08);border-radius:2px;overflow:hidden">
              <span style="display:block;height:100%;width:${Math.max(0, Math.min(100, (value / max) * 100))}%;background:${scoreColor};border-radius:2px"></span>
            </span>
            <span style="flex:0 0 32px;text-align:right;font-variant-numeric:tabular-nums">${value}/${max}</span>
          </div>`;

        // Popup stays open until user clicks the X — don't auto-close on
        // map click (closeOnClick) or pan/zoom (closeOnMove). Lets the user
        // inspect the lead, pan the map around, keep the popup visible.
        const popup = new PopupClass({
          closeButton: true,
          closeOnClick: false,
          closeOnMove: false,
          // Don't steal focus — MapLibre's default focus grab triggers a
          // layout reflow in the parent canvas that noticeably lags the
          // "Show details" expand when the source has 30k+ features.
          focusAfterOpen: false,
          maxWidth: "360px",
          className: "henri-lead-popup",
        })
          .setLngLat(coords)
          .setHTML(
            `<div style="font-family:system-ui,-apple-system,sans-serif;line-height:1.45" data-popup-root="${popupId}">
              <!-- Always visible: trade, score, address -->
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
                <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${TRADE_COLORS[String(p.trade)] ?? "#8E8E93"}"></span>
                <span style="font-weight:600;font-size:14px">${esc(tradeLabel)}</span>
                ${p.cascade_flag ? `<span style="font-size:10px;font-weight:600;padding:1px 6px;border-radius:3px;background:rgba(212,136,106,0.15);color:#D4886A">CASCADE ${cascadeCount || ""}</span>` : ""}
                <span style="margin-left:auto;font-size:12px;font-weight:600;color:${scoreColor}">${scoreNum}/100</span>
              </div>
              <p style="margin:0 0 4px;font-size:13px;font-weight:500">${esc(p.address ?? "Unknown address")}</p>
              <p style="margin:0 0 8px;font-size:12px;opacity:0.7">${esc(p.city ?? "")}${p.state ? `, ${esc(p.state)}` : ""} ${esc(p.zip ?? "")}</p>

              <!-- Collapsible details block -->
              <div data-popup-details style="display:none">
                ${hasOwnerBlock ? `
                <div data-popup-owner style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(0,0,0,0.08)">
                  <div style="font-size:10px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;opacity:0.5;margin-bottom:4px">Owner / applicant</div>
                  ${ownerName ? `<div style="font-size:12px;margin-bottom:2px;font-weight:500">${esc(ownerName)}</div>` : ""}
                  ${phoneRaw ? `<div style="font-size:12px;opacity:0.8;margin-bottom:2px">${esc(phoneRaw)}</div>` : ""}
                  ${emailRaw ? `<div style="font-size:12px;opacity:0.8;word-break:break-all;margin-bottom:2px">${esc(emailRaw)}</div>` : ""}
                  ${p.mailing_address ? `<div style="font-size:11px;opacity:0.8;margin-top:2px">Mailing: ${esc(p.mailing_address)}</div>` : ""}
                  ${contractorRaw ? `<div style="font-size:11px;opacity:0.65;margin-top:2px">Listed contractor: ${esc(contractorRaw)}</div>` : ""}
                </div>` : ""}

                <div data-popup-property style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(0,0,0,0.08)">
                  <div style="font-size:10px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;opacity:0.5;margin-bottom:4px">Property &amp; permit</div>
                  <div style="display:grid;grid-template-columns:auto 1fr;gap:2px 10px;font-size:12px">
                    ${p.permit_type ? `<span style="opacity:0.6">Type</span><span>${esc(p.permit_type)}</span>` : ""}
                    <span style="opacity:0.6">Est. value</span><span>${valueStr}</span>
                    ${p.status ? `<span style="opacity:0.6">Status</span><span>${esc(p.status)}</span>` : ""}
                    ${issuedDate ? `<span style="opacity:0.6">Issued</span><span>${esc(issuedDate)}</span>` : ""}
                    ${appliedDate && appliedDate !== issuedDate ? `<span style="opacity:0.6">Applied</span><span>${esc(appliedDate)}</span>` : ""}
                    ${cascadeCount > 1 ? `<span style="opacity:0.6">Prior permits</span><span>${cascadeCount} at this address</span>` : ""}
                    ${pipelineVal ? `<span style="opacity:0.6">Pipeline</span><span>${pipelineVal} (all permits)</span>` : ""}
                    <!-- Parcel enrichment (from /api/cron/enrich county-GIS lookups). -->
                    ${p.year_built ? `<span style="opacity:0.6">Year built</span><span>${esc(p.year_built)}</span>` : ""}
                    ${p.home_sqft ? `<span style="opacity:0.6">Home sqft</span><span>${Number(p.home_sqft).toLocaleString()}</span>` : ""}
                    ${p.lot_sqft ? `<span style="opacity:0.6">Lot sqft</span><span>${Number(p.lot_sqft).toLocaleString()}</span>` : ""}
                    ${p.assessed_value ? `<span style="opacity:0.6">Assessed</span><span>$${Number(p.assessed_value).toLocaleString()}</span>` : ""}
                    ${p.owner_since ? `<span style="opacity:0.6">Owner since</span><span>${esc(p.owner_since)}</span>` : ""}
                    ${typeof p.owner_occupied === "boolean" ? `<span style="opacity:0.6">Occupancy</span><span>${p.owner_occupied ? "Owner-occupied" : "Non-owner"}</span>` : ""}
                  </div>
                </div>

                <div data-popup-score style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(0,0,0,0.08)">
                  <div style="font-size:10px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;opacity:0.5;margin-bottom:4px">Score breakdown</div>
                  ${breakdownRow("Freshness", Number(p.score_freshness ?? 0), 20)}
                  ${breakdownRow("Value", Number(p.score_value ?? 0), 20)}
                  ${breakdownRow("Contact", Number(p.score_contact ?? 0), 15)}
                  ${breakdownRow("Demand", Number(p.score_demand ?? 0), 15)}
                </div>

                ${descRaw ? `
                <div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(0,0,0,0.08)">
                  <div style="font-size:10px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;opacity:0.5;margin-bottom:4px">Description</div>
                  <div data-desc-preview style="font-size:11px;opacity:0.85">${esc(descPreview)}</div>
                  <div data-desc-full style="display:none;font-size:11px;opacity:0.85;white-space:pre-wrap">${esc(descRaw)}</div>
                  ${hasMoreDesc ? `<button type="button" data-desc-toggle style="margin-top:4px;font-size:10px;color:#D4886A;background:transparent;border:none;padding:0;cursor:pointer;text-decoration:underline">Show full description</button>` : ""}
                </div>` : ""}
              </div>

              <button type="button" data-popup-toggle
                style="margin-top:8px;display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:500;color:#D4886A;background:transparent;border:1px solid rgba(212,136,106,0.4);padding:3px 8px;border-radius:4px;cursor:pointer">
                <span data-toggle-label>Show details</span>
                <span data-toggle-caret>▾</span>
              </button>
            </div>`,
          )
          .addTo(map);

        popupRef.current = popup;

        // Wire handlers against the popup's own DOM (popup.getElement())
        // rather than the document — avoids the race where React updates
        // the document before the popup mounts, and keeps the listeners
        // scoped to this specific popup so they GC when it closes.
        const wireUp = () => {
          const container = popup.getElement();
          if (!container) return;
          const el = container.querySelector<HTMLElement>(`[data-popup-root="${popupId}"]`);
          if (!el) return;

          // Main details toggle
          const btn = el.querySelector<HTMLButtonElement>("[data-popup-toggle]");
          if (btn && !btn.dataset.wired) {
            btn.dataset.wired = "1";
            let open = false;
            btn.addEventListener("click", () => {
              open = !open;
              const details = el.querySelector<HTMLElement>("[data-popup-details]");
              const caret = el.querySelector<HTMLElement>("[data-toggle-caret]");
              const label = el.querySelector<HTMLElement>("[data-toggle-label]");
              if (details) details.style.display = open ? "block" : "none";
              if (caret) caret.textContent = open ? "▴" : "▾";
              if (label) label.textContent = open ? "Hide details" : "Show details";
            });
          }
          // Description full-text toggle (only present if the description is long)
          const descBtn = el.querySelector<HTMLButtonElement>("[data-desc-toggle]");
          if (descBtn && !descBtn.dataset.wired) {
            descBtn.dataset.wired = "1";
            let descOpen = false;
            descBtn.addEventListener("click", () => {
              descOpen = !descOpen;
              const preview = el.querySelector<HTMLElement>("[data-desc-preview]");
              const full = el.querySelector<HTMLElement>("[data-desc-full]");
              if (preview) preview.style.display = descOpen ? "none" : "";
              if (full) full.style.display = descOpen ? "block" : "none";
              descBtn.textContent = descOpen ? "Show shorter" : "Show full description";
            });
          }
        };
        // Wire on next frame so the popup DOM has mounted, then once more
        // on popup 'open' as a belt-and-braces (MapLibre re-emits on style
        // reloads).
        requestAnimationFrame(wireUp);
        popup.on("open", wireUp);
      };

      // Detach any previous registrations before re-attaching. Idempotent:
      // calling .off with a handler that was never attached is a no-op in
      // maplibre, so this is safe on first run.
      mapInstance.off("click", CLUSTER_LAYER, onClusterClick);
      mapInstance.off("click", POINT_LAYER, onPointClick);
      mapInstance.off("mouseenter", CLUSTER_LAYER, cursorOn);
      mapInstance.off("mouseleave", CLUSTER_LAYER, cursorOff);
      mapInstance.off("mouseenter", POINT_LAYER, cursorOn);
      mapInstance.off("mouseleave", POINT_LAYER, cursorOff);

      mapInstance.on("click", CLUSTER_LAYER, onClusterClick);
      mapInstance.on("click", POINT_LAYER, onPointClick);
      mapInstance.on("mouseenter", CLUSTER_LAYER, cursorOn);
      mapInstance.on("mouseleave", CLUSTER_LAYER, cursorOff);
      mapInstance.on("mouseenter", POINT_LAYER, cursorOn);
      mapInstance.on("mouseleave", POINT_LAYER, cursorOff);
      // Suppress unused-var lint for the local `map` alias (kept for the
      // easeTo/setLngLat calls above even though we now reference mapInstance).
      void map;
    }

    if (mapInstance.isStyleLoaded()) {
      addLayers();
    }
    mapInstance.on("style.load", addLayers);

    return () => {
      if (!mapInstance) return;
      mapInstance.off("style.load", addLayers);
      mapInstance.off("click", CLUSTER_LAYER, onClusterClick);
      mapInstance.off("click", POINT_LAYER, onPointClick);
      mapInstance.off("mouseenter", CLUSTER_LAYER, cursorOn);
      mapInstance.off("mouseleave", CLUSTER_LAYER, cursorOff);
      mapInstance.off("mouseenter", POINT_LAYER, cursorOn);
      mapInstance.off("mouseleave", POINT_LAYER, cursorOff);
    };
  }, [mapInstance, geojson]);

  /* ── Fit map to data bounds ────────────────────────────────────────────── */
  useEffect(() => {
    if (!mapInstance || !geojson || geojson.features.length === 0) return;

    // Cap the coords loop at ~5,000 samples. With up to 50k features, iterating
    // every one to compute bounds is wasteful (bounds converge fast). Sample
    // evenly so the fit is still representative.
    const FIT_SAMPLE_CAP = 5000;
    const all = geojson.features;
    const stride = all.length > FIT_SAMPLE_CAP ? Math.ceil(all.length / FIT_SAMPLE_CAP) : 1;
    const coords: [number, number][] = [];
    for (let i = 0; i < all.length; i += stride) {
      const f = all[i];
      if (f.geometry.type === "Point") {
        coords.push(f.geometry.coordinates as [number, number]);
      }
    }

    if (coords.length === 0) return;

    if (coords.length === 1) {
      mapInstance.flyTo({ center: coords[0], zoom: 13, duration: 600 });
      return;
    }

    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const [lng, lat] of coords) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }

    mapInstance.fitBounds(
      [[minLng, minLat], [maxLng, maxLat]],
      { padding: 60, maxZoom: 15, duration: 800 },
    );
  }, [mapInstance, geojson]);

  return (
    <div className="relative flex-1 flex flex-col overflow-hidden h-full">
      {/* Filter bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-card shrink-0">
        <h1 className="font-heading font-normal text-lg text-foreground mr-2">
          Territory Map
        </h1>

        <div className="flex items-center gap-1.5">
          <label htmlFor="trade-filter" className="text-xs text-muted-foreground">
            Trade
          </label>
          <select
            id="trade-filter"
            value={tradeFilter}
            onChange={(e) => setTradeFilter(e.target.value)}
            className="h-7 px-2 text-xs rounded-md border border-border bg-background text-foreground"
          >
            {TRADE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t === "all" ? "All trades" : t.charAt(0).toUpperCase() + t.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1.5">
          <label htmlFor="status-filter" className="text-xs text-muted-foreground">
            Status
          </label>
          <select
            id="status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-7 px-2 text-xs rounded-md border border-border bg-background text-foreground"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s === "all" ? "All statuses" : s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1.5">
          <label htmlFor="days-filter" className="text-xs text-muted-foreground">
            Period
          </label>
          <select
            id="days-filter"
            value={daysFilter}
            onChange={(e) => setDaysFilter(Number(e.target.value))}
            className="h-7 px-2 text-xs rounded-md border border-border bg-background text-foreground"
          >
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
            <option value={60}>Last 60 days</option>
            <option value={90}>Last 90 days</option>
            <option value={180}>Last 180 days</option>
            <option value={365}>Last year</option>
            <option value={3650}>All time</option>
          </select>
        </div>

        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={showRawPermits}
            onChange={(e) => setShowRawPermits(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-border text-primary accent-primary"
          />
          <span className="text-xs text-muted-foreground">Show new permits</span>
        </label>

        <div className="ml-auto flex items-center gap-3">
          {loading && (
            <span className="text-xs text-muted-foreground">Loading...</span>
          )}
          {!loading && !error && (
            <span className="text-xs text-muted-foreground">
              {totalCount.toLocaleString()} lead{totalCount !== 1 ? "s" : ""} on map
              {leadCount.geocoded > totalCount && (
                <span className="opacity-70"> · of ~{leadCount.geocoded.toLocaleString()} geocoded</span>
              )}
            </span>
          )}
          <button
            onClick={fetchMapData}
            disabled={loading}
            className="h-7 px-3 text-xs rounded-md border border-border bg-background text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Map — wrapper uses absolute positioning so MapLibre resolves height */}
      <div className="relative flex-1 min-h-0">
        {/* Error banner — overlays the map so expanding doesn't resize the
         * canvas (which caused noticeable lag while the map re-rendered). */}
        {error && (
          <div className="absolute top-0 left-0 right-0 z-20 shadow-lg">
            <ExpandableBanner
              tone="error"
              icon={<AlertTriangle className="h-4 w-4" />}
              title={<span className="font-medium">Map data couldn&apos;t load</span>}
              dismissible
              onDismiss={() => setError(null)}
            >
              <div className="space-y-2 pt-2">
                <p>{error}</p>
                <p className="opacity-80">
                  Try widening the period filter to &quot;All time&quot; or clicking
                  Refresh. If the problem persists, the map API may be temporarily
                  unavailable — the rest of the app still works.
                </p>
                <button
                  onClick={fetchMapData}
                  className="inline-flex h-7 px-3 text-xs rounded-md border border-current/30 hover:bg-current/10 transition-colors"
                >
                  Retry now
                </button>
              </div>
            </ExpandableBanner>
          </div>
        )}

        <div className="absolute inset-0">
        <MapDashboard
          ref={mapRef}
          initialCenter={[-98.5795, 39.8283]}
          initialZoom={4}
          onMapReady={(map) => setMapInstance(map)}
        />

        <OverlayControls
          className="top-4 left-4"
          onChange={setOverlayState}
        />
        <MapStyleSwitcher
          map={mapInstance}
          className="top-4 left-16"
          onStyleChange={(style) => mapRef.current?.setCurrentStyle(style)}
        />

        {/* Weather alerts */}
        {overlayState.weatherAlerts && weatherAlerts.length > 0 && (
          <WeatherAlertBanner
            alerts={weatherAlerts}
            className="absolute top-4 left-72 right-72 z-20"
          />
        )}

        {/* FEMA flood zones */}
        <FEMAFloodLayer
          map={mapInstance}
          geojson={femaData}
          visible={overlayState.femaFloodZones}
        />

        {/* Census median home value choropleth */}
        <CensusLayer
          map={mapInstance}
          censusData={censusData}
          leadLocations={censusLeadLocations}
          visible={overlayState.censusData}
        />

        {/* NOAA NEXRAD live radar (free Iowa State mesonet tiles). */}
        <NOAARadarLayer map={mapInstance} visible={overlayState.noaaRadar} />

        {/* NOAA SPC Day-1 Convective Outlook — severe weather risk polygons. */}
        <SPCOutlookLayer map={mapInstance} visible={overlayState.spcOutlook} />

        {/* NWS active-alert polygons on-map. */}
        <NWSAlertPolygonLayer
          map={mapInstance}
          visible={overlayState.alertPolygons}
        />

        {/* Parcel boundaries + Zoning districts (county ArcGIS). */}
        <ParcelLayer
          map={mapInstance}
          visible={overlayState.parcels}
          bounds={mapBounds}
        />
        <ZoningLayer
          map={mapInstance}
          visible={overlayState.zoning}
          bounds={mapBounds}
        />

        {/* Trade legend */}
        <div className="absolute bottom-6 left-4 z-10 bg-card/90 backdrop-blur-sm rounded-lg border border-border p-3 shadow-sm">
          <p className="text-xs font-medium text-foreground mb-2">Leads by trade</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {Object.entries(TRADE_COLORS)
              .filter(([key]) => key !== "other")
              .map(([trade, color]) => (
                <div key={trade} className="flex items-center gap-1.5">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <span className="text-[11px] text-muted-foreground capitalize">
                    {trade}
                  </span>
                </div>
              ))}
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
