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
import { useUser } from "@/hooks/useUser";
import { WeeklyBriefingBanner } from "@/components/dashboard/WeeklyBriefing";
import { useFEMAFlood, useCensusOverlay, useWeatherAlerts } from "@/hooks/useOverlayData";
import { useToast } from "@/components/ui/toast";
import { formatCurrency } from "@/types/lead";
import type { Lead } from "@/types/lead";
import {
  LEFT_PANEL_DEFAULT,
  LEFT_PANEL_MAX,
  LEFT_PANEL_COLLAPSED,
  BOTTOM_PANEL_DEFAULT,
} from "@/lib/constants/layout";

const MapDashboard = dynamic(() => import("@/components/map/MapDashboard"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-muted animate-pulse flex items-center justify-center">
      <p className="text-sm text-muted-foreground">Loading map...</p>
    </div>
  ),
});

/* ── Panel size constants ──
 * Most live in `src/lib/constants/layout.ts` now; `LEFT_PANEL_MIN` stays
 * local because 240 is the practical reading-width floor for the virtual
 * list and is unlikely to be reused elsewhere. */
const LEFT_PANEL_MIN = 240;

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
    // Supabase UUID on the joined permits row — used by PermitTimeline
    // to look up permit_events. Lives on the joined `permits` child via
    // useLeads → select("permits(id, ...)"). Typed in src/types/lead.ts
    // since 2026-04-30 type-safety pass.
    permitUuid: lead.permits?.id ?? undefined,
    filedDate: lead.permit_filed_date ?? undefined,
    // Phase 0b lifecycle fields for the project-stage timeline.
    appliedDate: lead.permits?.applied_date ?? lead.permit_filed_date ?? undefined,
    issuedDate: lead.permits?.issued_date ?? undefined,
    completedDate: lead.permits?.completed_date ?? undefined,
    permitStatus: lead.permits?.status ?? undefined,
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

    // Extended enrichment fields (migrations 00039/00044). Each may be
    // NULL on the row — drawer renders only when present, so older envs
    // without the migration applied are unaffected (graceful degrade).
    employer: lead.employer ?? undefined,
    occupation: lead.occupation ?? undefined,
    businessPhone: lead.business_phone ?? undefined,
    businessStatus: lead.business_status ?? undefined,
    businessWebsite: lead.business_website ?? undefined,
    licenseNumber: lead.license_number ?? undefined,
    licenseStatus: lead.license_status ?? undefined,
    naicsCode: lead.naics_code ?? undefined,
    contactSource: lead.contact_source ?? undefined,
    contactConfidence: lead.contact_confidence ?? undefined,

    // Phase 1.2: predictive cross-trade suggestions (migration 00045).
    // jsonb array per the rules engine output. Drawer's
    // CrossTradeOpportunities component renders these.
    crossTradeSuggestions: lead.cross_trade_suggestions,

    // Phase 1.3: DIY-vs-pro applicant fields (existing columns from
    // migration 00004 — surfaced via the joined permits row in useLeads).
    permitApplicantName: lead.permits?.applicant_name ?? undefined,
    permitContractorName: lead.permits?.contractor_name ?? undefined,

    rawValue: lead.permit_value ?? lead.pipeline_value ?? undefined,

    // Module 1 (2026-05-09) — intent classification fields.
    opportunityStage: lead.opportunity_stage ?? null,
    reasonCodes: lead.reason_codes ?? null,
    tradeTags: lead.trade_tags ?? null,
    // Phase AA-3 — provenance. Drives the "Pre-intent signal" badge
    // on LeadCard for parcel_synthesis leads.
    source: lead.source ?? null,
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

  /* ── Resizable panel state ──
   *
   * `bottomHeight` is persisted to localStorage so the user's preferred
   * lead-drawer size survives reloads, lead-switches, and full sign-outs
   * (per user request 2026-04-27 — "let the user set up how large the
   * banner should be by stretching it"). The drawer's drag handle
   * commits the height via `setBottomHeight`; we mirror that into
   * localStorage so the next click on a lead reopens at the same size
   * instead of resetting to BOTTOM_PANEL_DEFAULT every time. */
  // localStorage key bumped to v2 (2026-04-30) — earlier broken drag
  // attempts polluted some users' v1 storage with stuck-at-MIN_HEIGHT
  // values that kept reloading the drawer at 80px. v2 starts everyone
  // fresh at BOTTOM_PANEL_DEFAULT (420px); old v1 entries are simply
  // ignored. Future bumps: add v3, v4, etc. — never reuse a key.
  const BOTTOM_HEIGHT_STORAGE_KEY = "henri.dashboard.bottomHeight.v2";
  const [leftWidth, setLeftWidth] = useState(LEFT_PANEL_DEFAULT);
  const [bottomHeight, setBottomHeightState] = useState(BOTTOM_PANEL_DEFAULT);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const COLLAPSED_WIDTH = LEFT_PANEL_COLLAPSED;

  // Hydrate from localStorage on mount. Runs once; deliberate empty
  // deps. Wrapped in try/catch because storage access can throw in
  // private-browsing modes or when quota is exceeded — we never want
  // a stored preference to break the dashboard.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(BOTTOM_HEIGHT_STORAGE_KEY);
      if (!raw) return;
      const n = Number(raw);
      // Bounds: minimum 200 (not 80) so a previously-saved tiny height
      // from earlier broken drag-resize attempts doesn't lock the user
      // at the MIN_HEIGHT floor. Anything below 200 falls through to
      // BOTTOM_PANEL_DEFAULT, which the user can then drag to whatever
      // size they want. Upper bound 4000 covers any monitor we might
      // realistically see.
      if (Number.isFinite(n) && n >= 200 && n <= 4000) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setBottomHeightState(n);
      } else if (Number.isFinite(n) && n < 200) {
        // Clear any stuck small value so it doesn't keep loading on
        // every visit. Next user-committed height (≥200) writes a
        // healthy value back.
        try {
          localStorage.removeItem(BOTTOM_HEIGHT_STORAGE_KEY);
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore — fall back to default
    }
  }, []);

  // Wrapped setter that persists every committed height change.
  const setBottomHeight = useCallback((h: number) => {
    setBottomHeightState(h);
    try {
      localStorage.setItem(BOTTOM_HEIGHT_STORAGE_KEY, String(Math.round(h)));
    } catch {
      // ignore storage errors
    }
  }, []);

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
  //
  // We filter to `geocoded_only: true` — without it, the map appeared
  // empty because high-scored leads skew heavily non-geocoded (2026-04-22
  // measurement: top 1000 by score = 5% geocoded; first 1000 unsorted =
  // 50% geocoded; DB-wide = 70,182/138,568 = ~51%). The comment history
  // below is preserved because the timeout it describes is still real,
  // but the fix is a `skip_sort` branch that sidesteps the bad plan:
  //   • god-mode (skip_sort=true):  NOT NULL + no ORDER BY → fast scan
  //     on (contractor_id, latitude) index.
  //   • subscriber  (score DESC):   smaller contractor_id result sets
  //     mean the planner picks the (contractor_id, score) path and
  //     evaluates NOT NULL as a cheap row-level filter, not a plan flip.
  //
  // --- Historical comment, preserved ---
  // We used to force `geocoded_only: true` so every panel row had a pin, but
  // the `NOT NULL latitude` + score-order + contractor filter combination
  // pushed Postgres into a plan that timed out under scorer write load.
  // Dropping the filter let Postgres pick a fast index on
  // `(contractor_id, score DESC)`. The re-add above uses skip_sort for
  // god-mode to sidestep the same bad plan.
  const godMode = useGodMode();
  const leadCount = useLeadCount();
  // Tier A+ Sprint 3 — A2 weekly-briefing banner reads the contractor's
  // weekly_briefings row keyed on this user. Hides itself when the cron
  // hasn't run yet (graceful degrade) — never blank shells.
  const { user } = useUser();
  // First-paint fetch policy:
  //   - regular contractor: 1,000 rows with the wide SELECT (permits join)
  //     and `geocoded_only=true`. Subscription-tier ZIP cap keeps the
  //     pool small, so the join is cheap and the LeadCard still gets
  //     `permit_description` for free.
  //   - god-mode (founder + dev allowlist): 100,000 rows with
  //     `skip_permits_join: true`, NO `geocoded_only` filter, and
  //     progressive paint per-page (Move 2). The denormalized leads
  //     columns (address/city/state/zip/permit_type/permit_value,
  //     written by the score cron via migration 00019) feed the
  //     LeadCard directly, and the heavier permit fields (description,
  //     applicant_name, applied/issued/completed dates) load on demand
  //     via `usePermitDetail` in the LeadDetailDrawer.
  //
  //   Why the geocoded_only filter is dropped for god-mode:
  //     76% of permits in the DB have null latitude/longitude (the
  //     CSV-ingested 1.1M permits never went through the geocoder), so
  //     76% of derived leads are also null-geo. With `geocoded_only=true`
  //     the founder only saw ~36k of 147k leads. Dropping it for god-mode
  //     reveals the full pool in the panel; non-geocoded leads simply
  //     don't render on the map but DO appear in the list, which is what
  //     a dev wants. Background `backfill-geocode.ts` is closing the gap.
  // Users wanting the truly full pool can still navigate to
  // `/dashboard/map`, which does its own progressive two-stage loading.
  const { data: rawLeads, isLoading, error: leadsError } = useLeads({
    limit: godMode ? 100_000 : 1_000,
    skip_sort: godMode,         // 23× speedup for god-mode unsorted pulls
    skip_permits_join: godMode, // bypasses 3k row ceiling (see comment above)
    filters: { geocoded_only: !godMode },
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
      // Honor deep-link once leads arrive; handleSelectLead drives drawer state
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
      {/* Tier A+ Sprint 3 — A2 weekly-briefing banner. Renders at the top
       * of the dashboard once /api/cron/weekly-briefing has produced a row
       * for this contractor. Collapsible + dismissible per ISO week. */}
      <WeeklyBriefingBanner contractorId={user?.id ?? null} />
      {leadsError && (
        <div
          role="alert"
          className="flex items-center justify-between border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive"
        >
          <span>
            Some leads couldn&apos;t load —{" "}
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
        data-tour="leads-panel"
        className="shrink-0 h-full transition-[width] duration-200 ease-out"
        style={{ width: leftCollapsed ? COLLAPSED_WIDTH : leftWidth }}
      >
        {/* Render priority:
         *   1. Leads exist → show panel even while `isLoading=true`. The
         *      Move 2 progressive-paint path writes pages 1..N into the
         *      cache as they land (see useLeads.ts), so the panel fills
         *      from 1k → 25k visibly during god-mode cold-starts instead
         *      of staying skeleton-blank for ~30s.
         *   2. No leads + still loading → skeleton (true cold-start).
         *   3. No leads + finished loading → empty-state hint.
         */}
        {leads.length > 0 ? (
          <LeadsPanel
            leads={leads}
            activeLead={activeLead}
            onSelectLead={handleSelectLead}
            collapsed={leftCollapsed}
            onToggleCollapsed={() => setLeftCollapsed((c) => !c)}
            totalGeocoded={leadCount.geocoded}
          />
        ) : isLoading ? (
          <LeadsPanelSkeleton />
        ) : !leftCollapsed ? (
          <EmptyLeadsState />
        ) : null}
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
      <div data-tour="lead-map" className="relative flex-1 min-h-0">
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

          {/* Lead detail drawer — bottom panel, resizable.
           *
           * `key={activeLead.id}` forces a clean unmount + remount when
           * the user switches between leads. Without the key, React
           * reuses the same component instance and prior drag state
           * (`dragging.current`, in-flight document mouse listeners,
           * stale closures over the old lead) can leak across leads
           * and cause the drawer to "disappear" — the documented
           * top-3 root cause from the 2026-04-30 banner audit. */}
          {activeLead && (
            <LeadDetailDrawer
              key={activeLead.id}
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
