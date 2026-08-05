"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Search, MapPin, Check, X, Loader2, AlertCircle } from "lucide-react";
import { OnboardingProgress } from "@/components/onboarding/OnboardingProgress";
import { useUser } from "@/hooks/useUser";
import { createClient } from "@/lib/supabase/client";
import { isGodModeEmail } from "@/lib/auth/god-mode";
import { cn } from "@/lib/utils/cn";
import { PLAN_ZIP_LIMITS } from "@/lib/plans/constants";

/* ── Plan ZIP limits ──
 * Sourced from the shared constant so this page can't drift from
 * pricing / settings / the claim_territory cap (migration 00088).
 * The local copy that used to live here duplicated all four tiers.
 * `free` isn't a paid tier and has no constant — 1 ZIP locally. */
const PLAN_LIMITS: Record<string, number> = {
  ...PLAN_ZIP_LIMITS,
  free: 1,
};

/* ── ZIP metadata by city (names curated; availability fetched live) ── */
type ZipMeta = { zip: string; name: string };
type ZipWithAvailability = ZipMeta & {
  available: boolean;
  loading: boolean;
  /** null when the availability probe failed — NOT the same as 0. */
  slotsUsed: number | null;
  slotsTotal: number | null;
  /** True when we could not determine occupancy. Renders as "unknown",
   *  never as a green "Available" check. */
  unknown: boolean;
};

/** Per-ZIP availability derived from the get_zip_availability payload. */
type ZipSlots = {
  available: boolean;
  slotsUsed: number | null;
  slotsTotal: number | null;
  unknown: boolean;
};

const UNKNOWN_SLOTS: ZipSlots = {
  // Fail *closed* on the display: an unknown ZIP is not asserted to be
  // available. Selection is still permitted — the server is the real
  // authority (claim_territory) — but the UI must not render a green
  // check it cannot back up.
  available: true,
  slotsUsed: null,
  slotsTotal: null,
  unknown: true,
};

/**
 * Read occupancy from the RPC payload.
 *
 * Until 2026-08-04 both call sites did `available: !data?.is_claimed`.
 * `get_zip_availability` has never returned an `is_claimed` key (see
 * supabase/migrations/00008_ziplock_rpc.sql), so the expression was
 * `!undefined` — a hardcoded `true`. Every ZIP always displayed
 * "Available", which made the "Taken" badge and the whole Join-waitlist
 * flow unreachable and steered contractors into occupied ZIPs that then
 * failed at Confirm, after payment.
 */
function readSlots(data: unknown): ZipSlots {
  const d = data as { slots_used?: unknown; slots_total?: unknown } | null;
  if (!d || typeof d.slots_used !== "number" || typeof d.slots_total !== "number") {
    return UNKNOWN_SLOTS;
  }
  return {
    available: d.slots_used < d.slots_total,
    slotsUsed: d.slots_used,
    slotsTotal: d.slots_total,
    unknown: false,
  };
}

const CITY_ZIPS: Record<string, { city: string; state: string; zips: ZipMeta[] }> = {
  "Los Angeles, CA": {
    city: "Los Angeles", state: "CA",
    zips: [
      { zip: "90001", name: "Florence" },
      { zip: "90002", name: "Watts" },
      { zip: "90003", name: "South LA" },
      { zip: "90004", name: "Hancock Park" },
      { zip: "90005", name: "Koreatown" },
      { zip: "90006", name: "Westlake" },
      { zip: "90007", name: "USC" },
      { zip: "90008", name: "Baldwin Hills" },
      { zip: "90010", name: "Mid-Wilshire" },
      { zip: "90011", name: "South Central" },
      { zip: "90012", name: "Downtown" },
      { zip: "90013", name: "Arts District" },
      { zip: "90015", name: "Staples Center" },
      { zip: "90016", name: "West Adams" },
      { zip: "90017", name: "Financial District" },
      { zip: "90018", name: "Jefferson Park" },
      { zip: "90019", name: "Mid-City" },
      { zip: "90020", name: "Koreatown West" },
      { zip: "90024", name: "Westwood" },
      { zip: "90025", name: "West LA" },
      { zip: "90026", name: "Echo Park" },
      { zip: "90027", name: "Los Feliz" },
      { zip: "90028", name: "Hollywood" },
      { zip: "90029", name: "Thai Town" },
      { zip: "90031", name: "Lincoln Heights" },
      { zip: "90032", name: "El Sereno" },
      { zip: "90033", name: "Boyle Heights" },
      { zip: "90034", name: "Palms" },
      { zip: "90035", name: "Beverlywood" },
      { zip: "90036", name: "Fairfax" },
      { zip: "90037", name: "Vermont Square" },
      { zip: "90038", name: "Hollywood Center" },
      { zip: "90039", name: "Silver Lake" },
      { zip: "90041", name: "Eagle Rock" },
      { zip: "90042", name: "Highland Park" },
      { zip: "90043", name: "View Park" },
      { zip: "90044", name: "Athens" },
      { zip: "90045", name: "Westchester" },
      { zip: "90046", name: "Hollywood Hills" },
      { zip: "90047", name: "Gramercy Park" },
      { zip: "90048", name: "Beverly Grove" },
      { zip: "90049", name: "Brentwood" },
      { zip: "90056", name: "Ladera Heights" },
      { zip: "90057", name: "Pico-Union" },
      { zip: "90058", name: "Vernon" },
      { zip: "90059", name: "Willowbrook" },
      { zip: "90061", name: "Athens Park" },
      { zip: "90062", name: "Chesterfield Square" },
      { zip: "90063", name: "East LA" },
      { zip: "90064", name: "Rancho Park" },
      { zip: "90065", name: "Glassell Park" },
      { zip: "90066", name: "Mar Vista" },
      { zip: "90067", name: "Century City" },
      { zip: "90068", name: "Hollywood Hills West" },
      { zip: "90069", name: "West Hollywood" },
      { zip: "90077", name: "Bel Air" },
      { zip: "90210", name: "Beverly Hills" },
      { zip: "90230", name: "Culver City" },
      { zip: "90232", name: "Culver City South" },
      { zip: "90247", name: "Gardena" },
      { zip: "90248", name: "Gardena South" },
      { zip: "90249", name: "Gardena West" },
      { zip: "90250", name: "Hawthorne" },
      { zip: "90254", name: "Hermosa Beach" },
      { zip: "90260", name: "Lawndale" },
      { zip: "90266", name: "Manhattan Beach" },
      { zip: "90270", name: "Maywood" },
      { zip: "90274", name: "Palos Verdes" },
      { zip: "90275", name: "Rancho Palos Verdes" },
      { zip: "90277", name: "Redondo Beach North" },
      { zip: "90278", name: "Redondo Beach" },
      { zip: "90291", name: "Venice" },
      { zip: "90292", name: "Marina Del Rey" },
      { zip: "90293", name: "Playa Del Rey" },
      { zip: "90301", name: "Inglewood" },
      { zip: "90302", name: "Inglewood North" },
      { zip: "90303", name: "Inglewood East" },
      { zip: "90304", name: "Lennox" },
      { zip: "90305", name: "Inglewood West" },
      { zip: "90401", name: "Santa Monica" },
      { zip: "90402", name: "Santa Monica North" },
      { zip: "90403", name: "Santa Monica Mid" },
      { zip: "90404", name: "Santa Monica East" },
      { zip: "90405", name: "Santa Monica South" },
      { zip: "90501", name: "Torrance" },
      { zip: "90502", name: "Torrance South" },
      { zip: "90503", name: "Torrance West" },
      { zip: "90504", name: "Torrance North" },
      { zip: "90505", name: "Torrance East" },
    ],
  },
  "Redondo Beach, CA": {
    city: "Redondo Beach", state: "CA",
    zips: [
      { zip: "90277", name: "North Redondo" },
      { zip: "90278", name: "South Redondo" },
    ],
  },
  "Sacramento, CA": {
    city: "Sacramento", state: "CA",
    zips: [
      { zip: "95811", name: "Midtown" },
      { zip: "95814", name: "Downtown" },
      { zip: "95816", name: "East Sacramento" },
      { zip: "95817", name: "Oak Park" },
      { zip: "95818", name: "Land Park" },
      { zip: "95819", name: "East Sac Fab Forties" },
      { zip: "95820", name: "Colonial Heights" },
      { zip: "95822", name: "Meadowview" },
      { zip: "95823", name: "Parkway" },
      { zip: "95824", name: "Fruitridge" },
      { zip: "95825", name: "Arden" },
      { zip: "95826", name: "College Greens" },
      { zip: "95828", name: "Florin" },
      { zip: "95829", name: "Elk Grove North" },
      { zip: "95831", name: "Pocket" },
      { zip: "95832", name: "Delta Shores" },
      { zip: "95833", name: "Natomas" },
      { zip: "95834", name: "North Natomas" },
      { zip: "95835", name: "Natomas Park" },
      { zip: "95838", name: "Del Paso Heights" },
    ],
  },
};

const CITY_OPTIONS = Object.keys(CITY_ZIPS);

export default function TerritoryPage() {
  const router = useRouter();
  const { profile } = useUser();
  // ZIP entry is the PRIMARY mode — city search only covers a few pilot
  // metros, while direct ZIP entry works anywhere in the US.
  const [searchMode, setSearchMode] = useState<"city" | "zip">("zip");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [selectedZips, setSelectedZips] = useState<string[]>([]);
  const [plan, setPlan] = useState("starter");
  const [saving, setSaving] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  // ZIPs this session successfully claimed. Tracked separately from
  // `selectedZips` so a partial failure can't strand the contractor:
  // the claimed ones are removed from the selection (so a retry doesn't
  // re-POST them) but still count toward finishing onboarding.
  const [claimedZips, setClaimedZips] = useState<string[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  // availabilityMap: zip -> slots + loading — populated when a city is selected
  const [availabilityMap, setAvailabilityMap] = useState<
    Record<string, ZipSlots & { loading: boolean }>
  >({});
  // Direct ZIP entry
  const [zipInput, setZipInput] = useState("");
  const [zipCheckResult, setZipCheckResult] = useState<(ZipSlots & { zip: string }) | null>(null);
  const [zipCheckLoading, setZipCheckLoading] = useState(false);
  // Waitlist status per ZIP — "joining" | "joined" | "error"
  const [waitlistStatus, setWaitlistStatus] = useState<Record<string, "joining" | "joined" | "error">>({});

  // Load plan from user profile
  useEffect(() => {
    if (profile?.plan) setPlan(profile.plan);
  }, [profile]);

  const maxZips = PLAN_LIMITS[plan] ?? 3;
  const cityData = selectedCity ? CITY_ZIPS[selectedCity] : null;

  // Fetch live availability from /api/territories/[zip] whenever a city is selected
  useEffect(() => {
    if (!cityData) return;
    let cancelled = false;

    // Mark all as loading
    setAvailabilityMap((prev) => {
      const next = { ...prev };
      for (const z of cityData.zips) {
        if (!next[z.zip]) next[z.zip] = { ...UNKNOWN_SLOTS, loading: true };
      }
      return next;
    });

    (async () => {
      // Fetch in chunks of 8 to avoid hammering the API
      const chunkSize = 8;
      for (let i = 0; i < cityData.zips.length; i += chunkSize) {
        if (cancelled) return;
        const chunk = cityData.zips.slice(i, i + chunkSize);
        const results = await Promise.all(
          chunk.map(async (z) => {
            try {
              const r = await fetch(`/api/territories/${z.zip}`, { cache: "no-store" });
              // A failed probe is "unknown", not "available" — the old
              // code asserted availability on every error path.
              if (!r.ok) return { zip: z.zip, ...UNKNOWN_SLOTS };
              return { zip: z.zip, ...readSlots(await r.json()) };
            } catch {
              return { zip: z.zip, ...UNKNOWN_SLOTS };
            }
          }),
        );
        if (cancelled) return;
        setAvailabilityMap((prev) => {
          const next = { ...prev };
          for (const r of results) {
            const { zip, ...slots } = r;
            next[zip] = { ...slots, loading: false };
          }
          return next;
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cityData]);

  const zipsWithAvailability: ZipWithAvailability[] = cityData
    ? cityData.zips.map((z) => {
        const a = availabilityMap[z.zip];
        return {
          ...z,
          available: a?.available ?? true,
          slotsUsed: a?.slotsUsed ?? null,
          slotsTotal: a?.slotsTotal ?? null,
          unknown: a?.unknown ?? true,
          loading: a?.loading ?? true,
        };
      })
    : [];

  const filteredCities = CITY_OPTIONS.filter((c) =>
    c.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const toggleZip = useCallback((zip: string) => {
    setSelectedZips((prev) => {
      if (prev.includes(zip)) return prev.filter((z) => z !== zip);
      if (prev.length >= maxZips) return prev;
      return [...prev, zip];
    });
  }, [maxZips]);

  const checkZipDirect = useCallback(async () => {
    const z = zipInput.trim().replace(/\D/g, "").slice(0, 5);
    if (z.length !== 5) return;
    setZipCheckLoading(true);
    setZipCheckResult(null);
    try {
      const r = await fetch(`/api/territories/${z}`, { cache: "no-store" });
      // Same rule as the city grid: a failed probe reports "unknown",
      // never a green "available".
      if (!r.ok) { setZipCheckResult({ zip: z, ...UNKNOWN_SLOTS }); return; }
      setZipCheckResult({ zip: z, ...readSlots(await r.json()) });
    } catch {
      setZipCheckResult({ zip: z, ...UNKNOWN_SLOTS });
    } finally {
      setZipCheckLoading(false);
    }
  }, [zipInput]);

  // Join the waitlist for a taken ZIP via /api/territories/waitlist
  // (wraps joinWaitlist() in src/lib/territory/ziplock.ts).
  const handleJoinWaitlist = useCallback(async (zip: string) => {
    setWaitlistStatus((prev) => ({ ...prev, [zip]: "joining" }));
    try {
      const r = await fetch("/api/territories/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zip }),
      });
      const body = await r.json().catch(() => ({}));
      const alreadyOn =
        typeof body?.error === "string" && body.error.includes("Already on the waitlist");
      setWaitlistStatus((prev) => ({
        ...prev,
        [zip]: r.ok || alreadyOn ? "joined" : "error",
      }));
    } catch {
      setWaitlistStatus((prev) => ({ ...prev, [zip]: "error" }));
    }
  }, []);

  const handleConfirm = async () => {
    // Either there's something new to claim, or a previous partial run
    // already claimed at least one ZIP and the contractor just needs to
    // finish. Both paths must be reachable — otherwise a partial failure
    // leaves the Confirm button permanently disabled with territories
    // claimed but onboarding_completed still false (middleware then
    // bounces them straight back here, forever).
    if (selectedZips.length === 0 && claimedZips.length === 0) return;
    setSaving(true);
    setClaimError(null);
    try {
      // Validate prereqs FIRST (license + plan + payment) so a failure
      // here never leaves orphaned territory rows. Previously the claims
      // fired before this check, claiming ZIPs for accounts that then
      // got bounced back to an earlier onboarding step.
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setClaimError("Not signed in. Please log in again.");
        setSaving(false);
        return;
      }
      // Payment fact (2026-06-10 fix): check stripe_subscription_id, not
      // stripe_customer_id — the customer id is stamped when a checkout
      // SESSION is created (before any payment), so a user who cancelled
      // at Stripe passed the old check. The subscription id is written
      // only by the checkout.session.completed webhook. The server
      // enforces the same fact (402 from /api/territories + inside the
      // claim_territory RPC, migration 00106); this client check just
      // routes the user to the right step with a clear message.
      const { data: profileCheck } = await supabase
        .from("profiles")
        .select("stripe_subscription_id, plan, license_state")
        .eq("id", user.id)
        .single();
      const hasPrereqs =
        isGodModeEmail(user.email) ||
        (!!profileCheck?.stripe_subscription_id &&
          !!profileCheck?.plan &&
          !!profileCheck?.license_state);
      if (!hasPrereqs) {
        setClaimError(
          "Your account is missing required setup. Please complete license, plan, and payment first.",
        );
        setSaving(false);
        // Re-route to the earliest unmet step so the user can finish.
        if (!profileCheck?.license_state) router.push("/onboarding/license");
        else if (!profileCheck?.plan) router.push("/onboarding/plan");
        else router.push("/onboarding/payment");
        return;
      }

      // Claim each ZIP via the real API (enforces exclusivity via claim_territory RPC)
      const claimResults = await Promise.all(
        selectedZips.map(async (zip) => {
          const r = await fetch("/api/territories", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ zip }),
          });
          const body = await r.json().catch(() => ({}));
          return { zip, ok: r.ok, error: body?.error as string | undefined };
        }),
      );

      // `claim_territory` raises "Contractor already holds an active
      // territory in ZIP X" when the contractor owns it already. That is
      // a 409, but the desired end state is reached — treat it as
      // success. Without this, any retry after a partial failure failed
      // on MORE ZIPs than the first attempt (every ZIP claimed on run 1
      // now reports "already holds"), which made the state unescapable.
      const alreadyHeld = (msg: string | undefined) =>
        !!msg && /already holds an active territory/i.test(msg);
      const succeeded = claimResults.filter((r) => r.ok || alreadyHeld(r.error));
      const failures = claimResults.filter((r) => !r.ok && !alreadyHeld(r.error));

      const newlyClaimed = succeeded.map((r) => r.zip);
      const allClaimed = [...new Set([...claimedZips, ...newlyClaimed])];

      if (failures.length > 0) {
        // Prune the ZIPs that DID land from the selection so a retry only
        // re-attempts genuine failures, but keep them in `claimedZips` so
        // the contractor can still finish onboarding with what they hold.
        if (newlyClaimed.length > 0) {
          setSelectedZips((prev) => prev.filter((z) => !newlyClaimed.includes(z)));
          setClaimedZips(allClaimed);
        }

        // A contractor who has ALREADY BEEN CHARGED must never be left
        // with territories claimed and `onboarding_completed` false —
        // middleware would bounce them out of /dashboard indefinitely.
        // Flip the flag as soon as at least one territory is held.
        let completionFailed = false;
        if (allClaimed.length > 0) {
          const { error: completeErr } = await supabase
            .from("profiles")
            .update({ onboarding_completed: true })
            .eq("id", user.id);
          completionFailed = !!completeErr;
        }

        setClaimError(
          [
            newlyClaimed.length > 0 ? `Claimed ${newlyClaimed.join(", ")}.` : null,
            `Couldn't claim ${failures.length} ZIP(s): ${failures
              .map((f) => `${f.zip} (${f.error ?? "unknown"})`)
              .join(", ")}.`,
            allClaimed.length > 0 && !completionFailed
              ? "Your claimed ZIPs are active — pick replacements for the rest, or continue to the dashboard."
              : null,
            completionFailed
              ? "We couldn't finish setting up your account. Retry, or contact support@meethenri.com."
              : null,
          ]
            .filter(Boolean)
            .join(" "),
        );
        setSaving(false);
        return;
      }

      // Mark onboarding complete — prereqs were verified above, before
      // any territory was claimed. The error was previously discarded,
      // so a failed update sent the contractor to /dashboard only for
      // middleware to bounce them straight back here.
      const { error: completeErr } = await supabase
        .from("profiles")
        .update({ onboarding_completed: true })
        .eq("id", user.id);
      if (completeErr) {
        setClaimedZips(allClaimed);
        setClaimError(
          `Your territories (${allClaimed.join(", ")}) are claimed, but we couldn't finish setting up your account: ${completeErr.message}. Retry, or contact support@meethenri.com.`,
        );
        setSaving(false);
        return;
      }

      router.push("/dashboard");
    } catch (err) {
      console.error("Territory claim error:", err);
      setClaimError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-card px-6 py-4 shrink-0">
        <div className="mx-auto max-w-6xl flex items-center justify-between">
          <Link href="/contractors" className="font-heading text-xl font-medium text-primary">
            Henri.
          </Link>
          <OnboardingProgress currentStep={4} />
          <div className="text-sm text-muted-foreground">
            Step 4 of 4
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex flex-col lg:flex-row">
        {/* Left panel — search + ZIP list */}
        <div className="w-full lg:w-[400px] border-r border-border bg-card flex flex-col shrink-0">
          {/* Title */}
          <div className="px-6 py-5 border-b border-border">
            <h1 className="font-heading text-xl font-normal text-foreground">
              Select your territories
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Choose up to <span className="font-semibold text-primary">{maxZips} ZIP codes</span> in your service area.
              {/* Copy corrected 2026-08-04. This read "Each ZIP is exclusive
                  to one contractor per trade", which the backend does not
                  implement: get_zip_availability / claim_territory expose
                  slots_total = 3 per ZIP and never consider trade at all
                  (supabase/migrations/00008_ziplock_rpc.sql). Exclusivity in
                  Henri is enforced per PERMIT (the wedge lock), not per ZIP.
                  Restated to what the code actually guarantees — the
                  product question of which model is intended is flagged in
                  the audit report, not decided here. */}
              {" "}Each ZIP has a limited number of contractor slots, and every
              permit inside it is locked to one contractor at a time.
            </p>
          </div>

          {/* Search mode tabs */}
          <div className="px-6 pt-3 pb-0 border-b border-border">
            <div className="flex gap-1 mb-3">
              <button
                onClick={() => setSearchMode("zip")}
                aria-pressed={searchMode === "zip"}
                className={cn(
                  "flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors",
                  searchMode === "zip"
                    ? "bg-cta text-cta-foreground"
                    : "bg-muted text-muted-foreground hover:bg-accent"
                )}
              >
                Enter ZIP code
              </button>
              <button
                onClick={() => setSearchMode("city")}
                aria-pressed={searchMode === "city"}
                className={cn(
                  "flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors",
                  searchMode === "city"
                    ? "bg-cta text-cta-foreground"
                    : "bg-muted text-muted-foreground hover:bg-accent"
                )}
              >
                Search by city
              </button>
            </div>

            {searchMode === "city" ? (
              <div className="relative mb-3">
                <p className="text-[11px] text-muted-foreground mb-2">
                  City search covers a few pilot metros - enter your ZIP
                  directly for anywhere in the US.
                </p>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => { setSearchQuery(e.target.value); setShowDropdown(true); }}
                    onFocus={() => setShowDropdown(true)}
                    placeholder="Search for a city..."
                    aria-label="Search for a city"
                    className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-input bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                {showDropdown && searchQuery.length > 0 && (
                  <div className="absolute left-0 right-0 top-full mt-1 bg-card border border-border rounded-lg shadow-lg z-20 max-h-48 overflow-y-auto">
                    {filteredCities.length > 0 ? filteredCities.map((city) => (
                      <button
                        key={city}
                        onClick={() => { setSelectedCity(city); setSearchQuery(city); setShowDropdown(false); }}
                        className="w-full text-left px-4 py-2.5 text-sm hover:bg-accent transition-colors flex items-center gap-2"
                      >
                        <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                        {city}
                      </button>
                    )) : (
                      <div className="px-4 py-3 text-sm text-muted-foreground">
                        City not listed — try &ldquo;Enter ZIP code&rdquo; tab to add any US ZIP directly.
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="mb-3 space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={5}
                    value={zipInput}
                    onChange={(e) => { setZipInput(e.target.value.replace(/\D/g, "").slice(0, 5)); setZipCheckResult(null); }}
                    onKeyDown={(e) => e.key === "Enter" && checkZipDirect()}
                    placeholder="e.g. 80203"
                    aria-label="ZIP code"
                    className="flex-1 px-3 py-2.5 rounded-lg border border-input bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <button
                    onClick={checkZipDirect}
                    disabled={zipInput.length !== 5 || zipCheckLoading}
                    className="px-3 py-2.5 rounded-lg bg-cta text-cta-foreground text-sm font-semibold disabled:opacity-50 transition-opacity"
                  >
                    {zipCheckLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Check"}
                  </button>
                </div>
                {zipCheckResult && (
                  <div role="status" className={cn(
                    "flex items-center justify-between px-3 py-2.5 rounded-lg border text-sm",
                    zipCheckResult.unknown
                      ? "border-border bg-bg-subtle"
                      : zipCheckResult.available
                        ? "border-[#3D9970]/30 bg-[rgba(61,153,112,0.06)]"
                        : "border-destructive/30 bg-destructive/5"
                  )}>
                    <div className="flex items-center gap-2">
                      {zipCheckResult.unknown
                        ? <AlertCircle className="h-4 w-4 text-muted-foreground" />
                        : zipCheckResult.available
                          ? <Check className="h-4 w-4 text-[#3D9970]" />
                          : <X className="h-4 w-4 text-destructive" />}
                      <span className="font-medium text-foreground">ZIP {zipCheckResult.zip}</span>
                      <span className="text-muted-foreground">
                        {zipCheckResult.unknown
                          ? "— couldn't check right now"
                          : zipCheckResult.available
                            ? `— available (${zipCheckResult.slotsUsed ?? 0} of ${zipCheckResult.slotsTotal ?? 3} slots taken)`
                            : "— all slots taken"}
                      </span>
                    </div>
                    {zipCheckResult.available && !selectedZips.includes(zipCheckResult.zip) && selectedZips.length < maxZips && (
                      <button
                        onClick={() => { toggleZip(zipCheckResult.zip); setZipInput(""); setZipCheckResult(null); }}
                        className="text-xs font-semibold text-primary hover:underline ml-2"
                      >
                        Add
                      </button>
                    )}
                    {selectedZips.includes(zipCheckResult.zip) && (
                      <span className="text-xs text-primary font-semibold ml-2">Added</span>
                    )}
                    {!zipCheckResult.available && (
                      waitlistStatus[zipCheckResult.zip] === "joined" ? (
                        /* Copy fix 2026-08-04: joinWaitlist() only inserts a
                         * zip_waitlist row — nothing in the codebase reads
                         * that table or sends mail, so "we'll email you when
                         * it opens" promised a notification that does not
                         * exist. State what actually happened instead. */
                        <span className="text-xs font-semibold text-[#3D9970] ml-2 text-right">
                          On the waitlist for this ZIP
                        </span>
                      ) : (
                        <button
                          onClick={() => handleJoinWaitlist(zipCheckResult.zip)}
                          disabled={waitlistStatus[zipCheckResult.zip] === "joining"}
                          className="text-xs font-semibold text-primary hover:underline ml-2 disabled:opacity-50"
                        >
                          {waitlistStatus[zipCheckResult.zip] === "joining"
                            ? "Joining..."
                            : waitlistStatus[zipCheckResult.zip] === "error"
                              ? "Retry waitlist"
                              : "Join waitlist"}
                        </button>
                      )
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Selection counter */}
          <div className="px-6 py-2.5 border-b border-border bg-bg-subtle">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {selectedCity
                  ? `ZIPs in ${cityData?.city}`
                  : searchMode === "zip"
                    ? "Check a ZIP above to add it"
                    : "Select a city to see ZIPs"}
              </span>
              <span className={cn(
                "text-xs font-bold px-2 py-0.5 rounded-full",
                selectedZips.length >= maxZips
                  ? "bg-cta text-cta-foreground"
                  : "bg-primary-10 text-primary"
              )}>
                {selectedZips.length} / {maxZips}
              </span>
            </div>
            {/* The Add button just disappears once the cap is hit, and
                toggleZip silently refuses. Say why. */}
            {selectedZips.length >= maxZips && (
              <p className="mt-1 text-[11px] text-muted-foreground" role="status">
                You&apos;ve used all {maxZips} ZIPs on the {plan} plan. Remove one
                to swap, or pick a larger plan.
              </p>
            )}
          </div>

          {/* ZIP list */}
          <div className="flex-1 overflow-y-auto">
            {cityData ? (
              <div className="divide-y divide-border">
                {zipsWithAvailability.map((z) => {
                  const isSelected = selectedZips.includes(z.zip);
                  const isFull = selectedZips.length >= maxZips && !isSelected;
                  const disabled = z.loading || !z.available || isFull;
                  const isTaken = !z.available && !z.loading;
                  const wl = waitlistStatus[z.zip];
                  return (
                    <div
                      key={z.zip}
                      className={cn(
                        "w-full px-6 py-3 flex items-center justify-between gap-2 transition-colors",
                        isSelected && "bg-primary-04",
                        isFull && z.available && "opacity-40",
                        z.available && !isSelected && !isFull && !z.loading && "hover:bg-bg-subtle"
                      )}
                    >
                      <button
                        onClick={() => z.available && !z.loading && toggleZip(z.zip)}
                        disabled={disabled}
                        className={cn(
                          "flex-1 text-left flex items-center gap-3 min-w-0",
                          isTaken && "opacity-50 cursor-not-allowed"
                        )}
                      >
                        <div className={cn(
                          "w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors",
                          isSelected
                            ? "bg-primary border-primary"
                            : z.available
                              ? "border-border"
                              : "border-destructive/30 bg-destructive/5"
                        )}>
                          {isSelected && <Check className="h-3 w-3 text-white" />}
                          {isTaken && <X className="h-3 w-3 text-destructive/50" />}
                        </div>
                        <div className="min-w-0">
                          <span className="text-sm font-medium text-foreground">{z.zip}</span>
                          <span className="text-xs text-muted-foreground ml-2">{z.name}</span>
                        </div>
                      </button>
                      {isTaken ? (
                        wl === "joined" ? (
                          /* See the copy note on the direct-ZIP branch above:
                             the waitlist records interest, it does not notify. */
                          <span className="text-[10px] font-semibold text-[#3D9970] text-right leading-tight">
                            On the waitlist
                          </span>
                        ) : (
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-destructive/10 text-destructive">
                              Taken
                            </span>
                            <button
                              onClick={() => handleJoinWaitlist(z.zip)}
                              disabled={wl === "joining"}
                              className="text-[11px] font-semibold text-primary hover:underline disabled:opacity-50"
                            >
                              {wl === "joining"
                                ? "Joining..."
                                : wl === "error"
                                  ? "Retry waitlist"
                                  : "Join waitlist"}
                            </button>
                          </div>
                        )
                      ) : (
                        <span className={cn(
                          "shrink-0 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full",
                          isSelected && "bg-cta text-cta-foreground",
                          z.loading && "bg-muted text-muted-foreground",
                          !z.loading && z.unknown && !isSelected && "bg-muted text-muted-foreground",
                          !z.loading && !z.unknown && z.available && !isSelected && "bg-[rgba(61,153,112,0.1)] text-[#3D9970]"
                        )}>
                          {z.loading
                            ? "Checking..."
                            : isSelected
                              ? "Selected"
                              : z.unknown
                                ? "Unknown"
                                : `${z.slotsUsed ?? 0}/${z.slotsTotal ?? 3} taken`}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full py-16 text-center px-6">
                <MapPin className="h-10 w-10 text-muted-foreground/30 mb-3" />
                <p className="text-sm font-medium text-foreground">
                  {searchMode === "zip" ? "Enter your ZIP code above" : "Search for your city"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {searchMode === "zip"
                    ? "Direct ZIP entry works anywhere in the US."
                    : "City search covers a few pilot metros - enter your ZIP directly for anywhere in the US."}
                </p>
              </div>
            )}
          </div>

          {/* Confirm button */}
          <div className="px-6 py-4 border-t border-border shrink-0">
            {claimError && (
              <div
                role="alert"
                className="mb-3 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20 text-xs text-destructive"
              >
                {claimError}
              </div>
            )}
            <button
              onClick={handleConfirm}
              disabled={(selectedZips.length === 0 && claimedZips.length === 0) || saving}
              className={cn(
                "w-full py-3 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-2",
                selectedZips.length > 0 || claimedZips.length > 0
                  ? "bg-cta text-cta-foreground hover:opacity-90"
                  : "bg-muted text-muted-foreground cursor-not-allowed"
              )}
            >
              {saving ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Claiming territories...</>
              ) : selectedZips.length === 0 && claimedZips.length > 0 ? (
                `Finish with ${claimedZips.length} claimed territor${claimedZips.length === 1 ? "y" : "ies"}`
              ) : (
                `Confirm ${selectedZips.length} territor${selectedZips.length === 1 ? "y" : "ies"} & launch dashboard`
              )}
            </button>
          </div>
        </div>

        {/* Right panel — selection summary. Headed "Territory Map" until
            2026-08-04, which promised a map this step has never rendered
            (no Mapbox on the onboarding route). Renamed to describe what
            the panel actually shows. */}
        <div className="flex-1 bg-bg-subtle relative flex items-center justify-center">
          <div className="text-center space-y-4 p-8">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-primary-10 flex items-center justify-center">
              <MapPin className="h-8 w-8 text-primary" />
            </div>
            <h2 className="font-heading text-2xl font-normal text-foreground">
              Your selection
            </h2>
            <p className="text-sm text-muted-foreground max-w-sm">
              {selectedCity
                ? `Showing ${cityData?.zips.length} ZIP codes in ${cityData?.city}, ${cityData?.state}`
                : "Search for a city or enter any US ZIP code directly to check availability."}
            </p>
            {selectedZips.length > 0 && (
              <div className="flex flex-wrap gap-2 justify-center mt-4">
                {selectedZips.map((zip) => (
                  <span key={zip} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-cta text-cta-foreground text-xs font-semibold">
                    <MapPin className="h-3 w-3" />
                    {zip}
                    <button onClick={() => toggleZip(zip)} aria-label="Remove ZIP" className="ml-0.5 hover:opacity-70">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
