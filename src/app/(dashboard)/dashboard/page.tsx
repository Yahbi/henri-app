"use client";

import dynamic from "next/dynamic";
import { useRef, useState, useMemo, useCallback, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { MapStyleSwitcher } from "@/components/map/MapStyleSwitcher";
import { OverlayControls } from "@/components/map/OverlayControls";
import type { OverlayState } from "@/components/map/OverlayControls";
import { LeadLayer } from "@/components/map/LeadLayer";
import { FEMAFloodLayer } from "@/components/map/FEMAFloodLayer";
import { CensusLayer } from "@/components/map/CensusLayer";
import { WeatherAlertBanner } from "@/components/map/WeatherAlertBanner";
import { NOAARadarLayer } from "@/components/map/NOAARadarLayer";
import { SPCOutlookLayer } from "@/components/map/SPCOutlookLayer";
import { NWSAlertPolygonLayer } from "@/components/map/NWSAlertPolygonLayer";
import { ParcelLayer } from "@/components/map/ParcelLayer";
import { ZoningLayer } from "@/components/map/ZoningLayer";
import { LeadsPanel } from "@/components/dashboard/LeadsPanel";
import { LeadDetailDrawer } from "@/components/dashboard/LeadDetailDrawer";
import { Skeleton } from "@/components/ui/skeleton";
import type { LeadData } from "@/components/dashboard/LeadCard";
import type { MapDashboardHandle } from "@/components/map/MapDashboard";
import type maplibregl from "maplibre-gl";
import { useLeads } from "@/hooks/useLeads";
import { useGodMode } from "@/hooks/useGodMode";
import { useLeadCount } from "@/hooks/useLeadCount";
import { useFEMAFlood, useCensusOverlay, useWeatherAlerts } from "@/hooks/useOverlayData";
import { useToast } from "@/components/ui/toast";
import { formatCurrency } from "@/types/lead";
import type { Lead } from "@/types/lead";

const MapDashboard = dynamic(() => import("@/components/map/MapDashboard"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-muted animate-pulse flex items-center justify-center">
      <p className="text-sm text-muted-foreground">Loading map...</p>
    </div>
  ),
});

/* ── Panel size constants ── */
const LEFT_PANEL_MIN = 240;
// Widened so the user can stretch the leads panel to almost half the
// screen when they want a wide card-like list on large monitors.
// Previously capped at 600 which felt cramped on 1440+ displays.
const LEFT_PANEL_MAX = 900;
const LEFT_PANEL_DEFAULT = 320;
const BOTTOM_PANEL_DEFAULT = 240;

/* ── Map Lead (Supabase) → LeadData (UI card shape) ── */
function mapLead(lead: Lead): LeadData {
  const cityState = [lead.city, lead.state].filter(Boolean).join(", ");
  const zipLabel = lead.zip ? `ZIP ${lead.zip}${cityState ? ` · ${cityState}` : ""}` : "";

  return {
    id: lead.id,
    addr: lead.address ?? "Unknown address",
    zip: zipLabel,
    fullAddress: [lead.address, lead.city, lead.state, lead.zip].filter(Boolean).join(", "),
    score: lead.score,
    owner: lead.owner_name ?? [lead.owner_first, lead.owner_last].filter(Boolean).join(" ") ?? "Unknown",
    firstName: lead.owner_first ?? "",
    lastName: lead.owner_last ?? "",
    coOwner: lead.co_owner ?? undefined,
    phone: lead.phone ?? "",
    phone2: lead.phone2 ?? undefined,
    email: lead.email ?? "",
    email2: lead.email2 ?? undefined,
    mailing: lead.mailing_address ?? undefined,
    type: lead.permit_type ?? lead.trade ?? "Permit",
    value: lead.permit_value ? formatCurrency(lead.permit_value) : (lead.pipeline_value ? formatCurrency(lead.pipeline_value) : "---"),
    permitDescription: lead.permit_description ?? undefined,
    permitNumber: lead.permit_id ?? undefined,
    // Supabase UUID on the permits row — used by PermitTimeline to
    // look up permit_events. Lives on the joined `permits` child via
    // useLeads → select("permits(id, ...)"). The Lead type doesn't
    // declare `permits`; cast via unknown to read it safely.
    permitUuid: ((lead as unknown as Record<string, unknown>).permits as Record<string, unknown> | undefined)?.id as string | undefined,
    filedDate: lead.permit_filed_date ?? undefined,
    // Phase 0b lifecycle fields for the project-stage timeline.
    appliedDate: (((lead as unknown as Record<string, unknown>).permits as Record<string, unknown> | undefined)?.applied_date as string | undefined)
      ?? lead.permit_filed_date ?? undefined,
    issuedDate: ((lead as unknown as Record<string, unknown>).permits as Record<string, unknown> | undefined)?.issued_date as string | undefined,
    completedDate: ((lead as unknown as Record<string, unknown>).permits as Record<string, unknown> | undefined)?.completed_date as string | undefined,
    permitStatus: ((lead as unknown as Record<string, unknown>).permits as Record<string, unknown> | undefined)?.status as string | undefined,
    propertyValue: lead.property_value ? formatCurrency(lead.property_value) : undefined,
    assessedValue: lead.assessed_value ? formatCurrency(lead.assessed_value) : undefined,
    yearBuilt: lead.year_built ?? undefined,
    lotSqft: lead.lot_sqft ?? undefined,
    homeSqft: lead.home_sqft ?? undefined,
    ownerSince: lead.owner_since ?? undefined,
    ownerOccupied: lead.owner_occupied,
    permitHistory: lead.permit_history ?? [],
    cascade: lead.cascade_flag,
    cascadeCount: lead.cascade_count,
    permitAge: lead.permit_age_days ?? undefined,
    freshScore: lead.score_freshness,
    valueScore: lead.score_value,
    contactScore: lead.score_contact,
    demandScore: lead.score_demand,
    engagementScore: lead.score_engagement,
    conversionScore: lead.score_conversion,
    scoreSignals: lead.score_signals,
    status: lead.status,
    trade: lead.trade ?? undefined,
    isHomeowner: lead.is_homeowner_intake,
    lat: lead.latitude  ?? null,
    lng: lead.longitude ?? null,
    cityState: cityState || undefined,
    rawValue: lead.permit_value ?? lead.pipeline_value ?? undefined,
  };
}

function LeadsPanelSkeleton() {
  return (
    <div className="flex flex-col h-full bg-card border-r border-border">
      <div className="px-4 py-3 border-b border-border">
        <Skeleton className="h-5 w-24 mb-2" />
        <div className="flex gap-2">
          <Skeleton className="h-7 w-28 rounded-lg" />
          <Skeleton className="h-7 w-20 rounded-lg ml-auto" />
        </div>
      </div>
      <div className="flex-1 divide-y divide-border">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="px-4 py-3 flex items-start gap-3">
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-3 w-20" />
            </div>
            <Skeleton className="h-9 w-9 rounded-full shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyLeadsState() {
  return (
    <div className="flex flex-col h-full bg-card border-r border-border items-center justify-center p-8 text-center">
      <div className="w-14 h-14 rounded-full bg-primary-08 flex items-center justify-center mb-4">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-primary">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="currentColor"/>
        </svg>
      </div>
      <p className="text-sm font-semibold text-foreground">No leads yet</p>
      <p className="text-xs text-muted-foreground mt-1 max-w-[180px]">
        Your territories are being monitored. Check back soon.
      </p>
    </div>
  );
}

function DashboardContent() {
  const mapRef = useRef<MapDashboardHandle>(null);
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null);
  const [activeLead, setActiveLead] = useState<LeadData | null>(null);
  const searchParams = useSearchParams();
  const { addToast } = useToast();
  // `?focus={leadId}` — set by the /dashboard/leads/[id] utility redirect
  // (and by the Permits table row click). After leads hydrate, find the
  // matching lead and auto-open its detail drawer + fly the map to it.
  const focusLeadId = searchParams?.get("focus") ?? null;

  // Surface middleware redirect reasons as toasts so redirects are never silent.
  useEffect(() => {
    const reason = searchParams?.get("reason");
    if (!reason) return;
    const messages: Record<string, string> = {
      contractor_area: "That area is for contractors only.",
      homeowner_area: "That area is for homeowners only.",
      onboarding_required: "Please complete onboarding to access the dashboard.",
      step_license_required: "Please verify your license to continue.",
      step_plan_required: "Please select a plan to continue.",
      step_payment_required: "Please complete payment to continue.",
    };
    const msg = messages[reason];
    if (msg) addToast({ title: msg, type: "info" });
  }, [searchParams, addToast]);

  /* ── Overlay state ── */
  const [overlayState, setOverlayState] = useState<OverlayState>({
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
  });
  const [mapBounds, setMapBounds] = useState<[number, number, number, number] | null>(null);
  const [mapCenter, setMapCenter] = useState<[number, number] | null>(null);

  /* ── Overlay data hooks ── */
  const { data: femaData } = useFEMAFlood(mapBounds, overlayState.femaFloodZones);
  const { alerts: weatherAlerts } = useWeatherAlerts(mapCenter, overlayState.weatherAlerts);


  /* ── Track map bounds for overlay fetching ── */
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
    // Initial bounds
    updateBounds();
    return () => { mapInstance.off("moveend", updateBounds); };
  }, [mapInstance]);

  /* ── Resizable panel state ── */
  const [leftWidth, setLeftWidth] = useState(LEFT_PANEL_DEFAULT);
  const [bottomHeight, setBottomHeight] = useState(BOTTOM_PANEL_DEFAULT);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const COLLAPSED_WIDTH = 44;

  /* ── Left panel drag-to-resize ── */
  const leftDragging = useRef(false);
  const leftStartX = useRef(0);
  const leftStartW = useRef(0);

  const onLeftHandleDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      leftDragging.current = true;
      leftStartX.current = e.clientX;
      leftStartW.current = leftWidth;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [leftWidth],
  );

  const onLeftHandleMove = useCallback(
    (e: React.PointerEvent) => {
      if (!leftDragging.current) return;
      const delta = e.clientX - leftStartX.current;
      const next = Math.min(
        LEFT_PANEL_MAX,
        Math.max(LEFT_PANEL_MIN, leftStartW.current + delta),
      );
      setLeftWidth(next);
    },
    [],
  );

  const onLeftHandleUp = useCallback(() => {
    leftDragging.current = false;
  }, []);

  /* Double-click left handle to toggle compact/wide */
  const onLeftHandleDblClick = useCallback(() => {
    setLeftWidth((w) => (w > LEFT_PANEL_DEFAULT ? LEFT_PANEL_DEFAULT : 480));
  }, []);

  // Lead-pull:
  //   god-mode: 2,000 leads (virtualized panel handles the volume; map
  //     shows pins for the subset with lat/lng).
  //   subscriber: 500 leads (plan-tier enforcement will tighten).
  // We used to force `geocoded_only: true` so every panel row had a pin, but
  // the `NOT NULL latitude` + score-order + contractor filter combination
  // pushed Postgres into a plan that timed out under scorer write load.
  // Dropping the filter lets Postgres pick a fast index on
  // `(contractor_id, score DESC)`; the map layer naturally renders pins
  // only for leads whose lat/lng are present (the `LeadLayer` filter in
  // `toGeoJSON` discards rows without coords).
  const godMode = useGodMode();
  const leadCount = useLeadCount();
  // Keep the first-paint fetch at a single 1000-row page (PostgREST caps
  // a single select at 1000 regardless of limit, and useLeads's paginated
  // branch kicks in only when limit > 1000 — each extra page is another
  // leads+permits join round-trip). Previous 500k god-mode limit fanned
  // out into 500 sequential round-trips and made the panel stuck on
  // skeleton for 10-15 minutes. 1000 rows paints in ~3s and still fills
  // the virtualized panel + map clustering meaningfully. Users needing
  // deeper filter exploration go to `/dashboard/map` which has
  // progressive two-stage loading built in.
  const { data: rawLeads, isLoading, error: leadsError } = useLeads({
    limit: 1000,
    skip_sort: godMode, // 23× speedup for god-mode unsorted pulls
  });

  const leads = useMemo<LeadData[]>(
    () => (rawLeads ?? []).map(mapLead),
    [rawLeads],
  );

  /* Census overlay: collect unique ZIPs and locations from leads */
  const leadZips = useMemo(() => {
    return [...new Set(leads.map((l) => l.zip).filter(Boolean))] as string[];
  }, [leads]);
  const { data: censusData } = useCensusOverlay(leadZips, overlayState.censusData);
  const leadLocations = useMemo(() => {
    return leads
      .filter(
        (l): l is typeof l & { lat: number; lng: number } =>
          l.lat != null && l.lng != null && !!l.zip
      )
      .map((l) => ({ zip: l.zip, lat: l.lat, lng: l.lng }));
  }, [leads]);

  /** Auto-fit map to lead bounds on first load */
  useEffect(() => {
    if (!mapInstance || leads.length === 0) return;
    const geoLeads = leads.filter(
      (l): l is typeof l & { lat: number; lng: number } =>
        l.lat != null && l.lng != null
    );
    if (geoLeads.length === 0) return;

    const lngs = geoLeads.map((l) => l.lng);
    const lats = geoLeads.map((l) => l.lat);

    const sw: [number, number] = [Math.min(...lngs), Math.min(...lats)];
    const ne: [number, number] = [Math.max(...lngs), Math.max(...lats)];

    if (sw[0] !== ne[0] || sw[1] !== ne[1]) {
      mapInstance.fitBounds([sw, ne], { padding: 60, maxZoom: 14, duration: 1200 });
    }
  }, [mapInstance, leads.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Select a lead and fly the map to its location */
  const handleSelectLead = useCallback(
    (lead: LeadData) => {
      setActiveLead(lead);
      if (lead.lat != null && lead.lng != null && mapInstance) {
        mapInstance.flyTo({
          center: [lead.lng, lead.lat],
          zoom: Math.max(mapInstance.getZoom(), 14),
          duration: 800,
        });
      }
    },
    [mapInstance],
  );

  /** Auto-open a lead when arriving via /dashboard?focus={id}. Runs once
   * after leads are loaded — tracks whether we've already honored this
   * focus param so toggling the drawer closed doesn't immediately reopen. */
  const focusHonored = useRef<string | null>(null);
  useEffect(() => {
    if (!focusLeadId) return;
    if (focusHonored.current === focusLeadId) return;
    if (leads.length === 0) return;
    const target = leads.find((l) => l.id === focusLeadId);
    if (target) {
      focusHonored.current = focusLeadId;
      handleSelectLead(target);
    }
  }, [focusLeadId, leads, handleSelectLead]);

  /** Resize map when panel sizes change */
  useEffect(() => {
    if (mapInstance) {
      // Slight delay so the DOM updates first. Matches the CSS transition
      // duration (200ms) so the canvas is still crisp after the rail expands.
      const t = setTimeout(() => mapInstance.resize(), 220);
      return () => clearTimeout(t);
    }
  }, [leftWidth, bottomHeight, leftCollapsed, mapInstance]);

  return (
    <div className="relative flex-1 flex flex-col overflow-hidden">
      {leadsError && (
        <div
          role="alert"
          className="flex items-center justify-between border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive"
        >
          <span>
            Some leads couldn't load —{" "}
            {leadsError instanceof Error ? leadsError.message : "unknown error"}
            . Refresh to retry.
          </span>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md border border-destructive/40 px-2 py-1 text-xs font-medium hover:bg-destructive/20"
          >
            Reload
          </button>
        </div>
      )}
      <div className="relative flex flex-1 overflow-hidden">
      {/* Leads panel — left side, resizable (or collapsed to rail) */}
      <div
        className="shrink-0 h-full transition-[width] duration-200 ease-out"
        style={{ width: leftCollapsed ? COLLAPSED_WIDTH : leftWidth }}
      >
        {isLoading ? (
          <LeadsPanelSkeleton />
        ) : leads.length === 0 && !leftCollapsed ? (
          <EmptyLeadsState />
        ) : (
          <LeadsPanel
            leads={leads}
            activeLead={activeLead}
            onSelectLead={handleSelectLead}
            collapsed={leftCollapsed}
            onToggleCollapsed={() => setLeftCollapsed((c) => !c)}
            totalGeocoded={leadCount.geocoded}
          />
        )}
      </div>

      {/* Left resize handle — disabled while collapsed (no drag on rail) */}
      {!leftCollapsed && (
        <div
          onPointerDown={onLeftHandleDown}
          onPointerMove={onLeftHandleMove}
          onPointerUp={onLeftHandleUp}
          onDoubleClick={onLeftHandleDblClick}
          className="w-1 shrink-0 cursor-col-resize bg-border hover:bg-primary/30 active:bg-primary/50 transition-colors touch-none select-none z-10"
        />
      )}

      {/* Map area — fills remaining space */}
      <div className="relative flex-1 min-h-0">
        <div className="absolute inset-0">
          <MapDashboard
            ref={mapRef}
            // Default to US-wide view so pins are visible regardless of which
            // territories the contractor owns; the auto-fit effect below will
            // zoom in to their data once leads load.
            initialCenter={[-98.5795, 39.8283]}
            initialZoom={4}
            onMapReady={(map) => setMapInstance(map)}
          />

          {/* Floating controls — overlay toggles + basemap picker sit
           * adjacent in the top-left corner so the toolbar reads as a
           * row of icon buttons instead of being split across corners. */}
          <OverlayControls
            className="top-4 left-4"
            onChange={setOverlayState}
          />
          <MapStyleSwitcher
            map={mapInstance}
            className="top-4 left-16"
            onStyleChange={(style) => mapRef.current?.setCurrentStyle(style)}
          />

          {/* Weather alert banner */}
          {overlayState.weatherAlerts && weatherAlerts.length > 0 && (
            <WeatherAlertBanner
              alerts={weatherAlerts}
              className="absolute top-4 left-72 right-72 z-20"
            />
          )}

          {/* FEMA flood zone overlay */}
          <FEMAFloodLayer
            map={mapInstance}
            geojson={femaData}
            visible={overlayState.femaFloodZones}
          />

          {/* NOAA NEXRAD live radar (free via Iowa State mesonet). */}
          <NOAARadarLayer map={mapInstance} visible={overlayState.noaaRadar} />

          {/* NOAA SPC Day-1 convective outlook polygons. */}
          <SPCOutlookLayer map={mapInstance} visible={overlayState.spcOutlook} />

          {/* NWS active-alert polygons on-map (banner is separate). */}
          <NWSAlertPolygonLayer
            map={mapInstance}
            visible={overlayState.alertPolygons}
          />

          {/* Parcel boundaries — county ArcGIS, zoom-gated to avoid
              flooding the client at state-level zoom. */}
          <ParcelLayer
            map={mapInstance}
            visible={overlayState.parcels}
            bounds={mapBounds}
          />

          {/* Zoning districts — colored by R/C/I/O classification. */}
          <ZoningLayer
            map={mapInstance}
            visible={overlayState.zoning}
            bounds={mapBounds}
          />

          {/* Census median home value choropleth */}
          <CensusLayer
            map={mapInstance}
            censusData={censusData}
            leadLocations={leadLocations}
            visible={overlayState.censusData}
          />

          {/* Geolocated lead pins */}
          <LeadLayer
            map={mapInstance}
            leads={leads}
            onSelectLead={handleSelectLead}
          />

          {/* Lead detail drawer — bottom panel, resizable */}
          {activeLead && (
            <LeadDetailDrawer
              lead={activeLead}
              onClose={() => setActiveLead(null)}
              height={bottomHeight}
              onHeightChange={setBottomHeight}
            />
          )}
        </div>
      </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense>
      <DashboardContent />
    </Suspense>
  );
}
