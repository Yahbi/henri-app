import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { QuoteButton } from "./QuoteButton";

/* ================================================================== */
/*  TYPES                                                              */
/* ================================================================== */

interface ContractorProfile {
  id: string;
  company_name: string | null;
  full_name: string | null;
  bio: string | null;
  trade: string | null;
  service_area: string | null;
  specialties: string[] | null;
  years_experience: number | null;
  portfolio_photos: string[] | null;
  avg_rating: number | null;
  review_count: number | null;
  response_time_h: number | null;
  jobs_completed: number | null;
  profile_public: boolean | null;
}

/* The one licensing signal Henri actually produces: a match against
 * `state_license_rosters`, recorded by /api/onboarding/verify-license on
 * the service-role client and locked against contractor self-writes by
 * migration 00127.
 *
 * What this page used to render instead — "Licensed" / "Insured" /
 * "Background Checked" from `profiles.badge_licensed` / `badge_insured` /
 * `badge_background`, plus "Verified on <verified_at>" — was three claims
 * Henri never checked. No code path in src/ writes any of those four
 * columns (00117 hard-locks them for exactly that reason), so they were
 * false for every contractor; the section only ever rendered if someone
 * flipped them by hand in the SQL editor, and then it would have asserted
 * an insurance and a background check that do not exist. Henri collects
 * neither, so there is no honest field to replace them with. */
interface VerifiedLicense {
  license_state: string | null;
  last_checked_at: string | null;
}

interface Review {
  id: string;
  rating: number | null;
  title: string | null;
  body: string | null;
  reviewer_name: string | null;
  sentiment: string | null;
  created_at: string;
}

/* ================================================================== */
/*  HELPERS                                                            */
/* ================================================================== */

function StarIcon({ filled = true }: { filled?: boolean }) {
  return (
    <svg
      className={`h-4 w-4 ${filled ? "text-warm" : "text-border"}`}
      viewBox="0 0 20 20"
      fill="currentColor"
    >
      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
    </svg>
  );
}

function Stars({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <StarIcon key={i} filled={i < Math.round(rating)} />
      ))}
    </div>
  );
}

function ShieldCheck() {
  return (
    <svg
      className="h-5 w-5 text-primary"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
      />
    </svg>
  );
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function computeStarDistribution(reviews: Review[]) {
  const counts: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  for (const r of reviews) {
    const star = Math.max(1, Math.min(5, Math.round(r.rating ?? 0)));
    counts[star] = (counts[star] ?? 0) + 1;
  }
  return counts;
}

/* ================================================================== */
/*  DATA FETCHING                                                      */
/* ================================================================== */

async function getContractorData(id: string) {
  const supabase = await createClient();

  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select(
      `
      id,
      company_name,
      full_name,
      bio,
      trade,
      service_area,
      specialties,
      years_experience,
      portfolio_photos,
      avg_rating,
      review_count,
      response_time_h,
      jobs_completed,
      profile_public
    `
    )
    .eq("id", id)
    .eq("role", "contractor")
    .eq("profile_public", true)
    .single();

  if (profileErr || !profile) return null;

  /* Licence trust block. Service-role because `contractor_licenses` is
   * row-scoped to its owner (licenses_select_own, 00010:44) — a homeowner
   * browsing this public page would otherwise always read zero rows and
   * see a permanently absent badge, which is its own quiet lie. Same query
   * as /api/contractors/[id]:70-78: an expired licence is not a licence,
   * and a NULL expiry means the roster publishes none, which is not the
   * same as expired. Degrades to "no badge" on error. */
  const today = new Date().toISOString().slice(0, 10);
  const { data: license } = await createAdminClient()
    .from("contractor_licenses")
    .select("license_state, last_checked_at")
    .eq("contractor_id", id)
    .eq("verified", true)
    .or(`expiry_date.is.null,expiry_date.gte.${today}`)
    .order("last_checked_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  const { data: reviews } = await supabase
    .from("reviews")
    .select(
      `
      id,
      rating,
      title,
      body,
      reviewer_name,
      sentiment,
      created_at
    `
    )
    .eq("contractor_id", id)
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .limit(20);

  const { data: territories } = await supabase
    .from("territories")
    .select("zip")
    .eq("contractor_id", id)
    .eq("status", "active");

  return {
    profile: profile as ContractorProfile,
    license: (license as VerifiedLicense | null) ?? null,
    reviews: (reviews ?? []) as Review[],
    zips: (territories ?? []).map((t: { zip: string }) => t.zip),
  };
}

/* ================================================================== */
/*  METADATA                                                           */
/* ================================================================== */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const data = await getContractorData(id);

  if (!data) {
    return { title: "Contractor Not Found | Henri" };
  }

  const name = data.profile.company_name || data.profile.full_name || "Contractor";
  const desc = data.profile.bio
    ? data.profile.bio.slice(0, 160)
    : `View ${name}'s profile, reviews, and request a quote on Henri.`;

  return {
    title: `${name} | Henri`,
    description: desc,
    openGraph: {
      title: `${name} | Henri`,
      description: desc,
      type: "profile",
    },
  };
}

/* ================================================================== */
/*  PAGE                                                               */
/* ================================================================== */

export default async function ContractorProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getContractorData(id);

  if (!data) notFound();

  const { profile, license, reviews, zips } = data;

  const displayName = profile.company_name || profile.full_name || "Contractor";
  const avgRating = profile.avg_rating ?? 0;
  const reviewCount = profile.review_count ?? reviews.length;
  const starDist = computeStarDistribution(reviews);
  const totalDistReviews = Object.values(starDist).reduce((a, b) => a + b, 0);
  const specialties = profile.specialties ?? [];
  const portfolioPhotos = profile.portfolio_photos ?? [];

  return (
    <>
      {/* Shared <MarketingNav /> is mounted by src/app/(marketing)/layout.tsx.
          Per-page <PortalNav /> removed as part of gap-audit G1. */}

      {/* ============================================================ */}
      {/*  HERO                                                        */}
      {/* ============================================================ */}
      <section className="relative overflow-hidden bg-background pt-12 pb-16 lg:pt-20 lg:pb-24">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              "radial-gradient(ellipse 60% 50% at 50% 0%, hsl(var(--primary) / 0.06) 0%, transparent 70%)",
          }}
        />

        <div className="mx-auto max-w-4xl px-6">
          {/* Breadcrumb */}
          <nav className="mb-8 flex items-center gap-2 text-sm text-muted-foreground">
            <Link
              href="/portal"
              className="transition-colors hover:text-foreground"
            >
              Home
            </Link>
            <span>/</span>
            <Link
              href="/contractors"
              className="transition-colors hover:text-foreground"
            >
              Contractors
            </Link>
            <span>/</span>
            <span className="text-foreground">{displayName}</span>
          </nav>

          {/* Company name + rating */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="font-heading text-3xl font-normal tracking-tight text-foreground sm:text-4xl lg:text-5xl">
                {displayName}
              </h1>
              {profile.trade && (
                <p className="mt-2 text-lg text-muted-foreground">
                  {profile.trade}
                </p>
              )}
            </div>

            {avgRating > 0 && (
              <div className="flex items-center gap-2">
                <Stars rating={avgRating} />
                <span className="text-sm font-semibold text-foreground">
                  {avgRating.toFixed(1)}
                </span>
                <span className="text-sm text-muted-foreground">
                  ({reviewCount} review{reviewCount !== 1 ? "s" : ""})
                </span>
              </div>
            )}
          </div>

          {/* CTA */}
          <div className="mt-8">
            <QuoteButton
              contractorId={profile.id}
              trade={profile.trade ?? ""}
            />
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  STATS BAR                                                   */}
      {/* ============================================================ */}
      <section className="border-y border-border bg-card py-10">
        <div className="mx-auto grid max-w-4xl grid-cols-2 gap-6 px-6 sm:grid-cols-4">
          {profile.years_experience != null && (
            <div className="text-center">
              <p className="text-2xl font-semibold text-primary">
                {profile.years_experience}+
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Years in Business
              </p>
            </div>
          )}
          {profile.jobs_completed != null && profile.jobs_completed > 0 && (
            <div className="text-center">
              <p className="text-2xl font-semibold text-primary">
                {profile.jobs_completed}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Jobs Completed
              </p>
            </div>
          )}
          {profile.response_time_h != null && (
            <div className="text-center">
              <p className="text-2xl font-semibold text-primary">
                {profile.response_time_h}h
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Avg. Response Time
              </p>
            </div>
          )}
          {avgRating > 0 && (
            <div className="text-center">
              <p className="text-2xl font-semibold text-primary">
                {avgRating.toFixed(1)}/5
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Average Rating
              </p>
            </div>
          )}
        </div>
      </section>

      {/* ============================================================ */}
      {/*  ABOUT / BIO                                                 */}
      {/* ============================================================ */}
      {profile.bio && (
        <section className="bg-background py-16 lg:py-20">
          <div className="mx-auto max-w-4xl px-6">
            <h2 className="font-heading text-2xl font-normal tracking-tight text-foreground sm:text-3xl">
              About {displayName}
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              {profile.bio}
            </p>
          </div>
        </section>
      )}

      {/* ============================================================ */}
      {/*  LICENSE VERIFICATION                                        */}
      {/*  One badge, one source: a live match against the state       */}
      {/*  licensing roster. No "Insured" and no "Background checked"  */}
      {/*  — Henri collects neither, so neither can be claimed.        */}
      {/* ============================================================ */}
      {license && (
        <section className="border-y border-border bg-card py-12">
          <div className="mx-auto max-w-4xl px-6">
            <h2 className="font-heading text-2xl font-normal tracking-tight text-foreground sm:text-3xl">
              Verification
            </h2>
            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex items-start gap-3 rounded-xl border border-border bg-background p-5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-10">
                  <ShieldCheck />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    Licensed
                    {license.license_state && <> ({license.license_state})</>}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Matched against the
                    {license.license_state ? ` ${license.license_state}` : ""}{" "}
                    state licensing roster
                    {license.last_checked_at && (
                      <> on {formatDate(license.last_checked_at)}</>
                    )}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ============================================================ */}
      {/*  SPECIALTIES                                                 */}
      {/* ============================================================ */}
      {specialties.length > 0 && (
        <section className="bg-background py-16 lg:py-20">
          <div className="mx-auto max-w-4xl px-6">
            <h2 className="font-heading text-2xl font-normal tracking-tight text-foreground sm:text-3xl">
              Specialties
            </h2>
            <div className="mt-6 flex flex-wrap gap-2">
              {specialties.map((s) => (
                <span
                  key={s}
                  className="rounded-full border border-border bg-card px-4 py-1.5 text-sm text-foreground"
                >
                  {s}
                </span>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ============================================================ */}
      {/*  SERVICE AREA                                                */}
      {/* ============================================================ */}
      {zips.length > 0 && (
        <section className="border-y border-border bg-card py-12">
          <div className="mx-auto max-w-4xl px-6">
            <h2 className="font-heading text-2xl font-normal tracking-tight text-foreground sm:text-3xl">
              Service Area
            </h2>
            {profile.service_area && (
              <p className="mt-2 text-sm text-muted-foreground">
                {profile.service_area}
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {zips.map((zip) => (
                <span
                  key={zip}
                  className="rounded-md border border-border bg-background px-3 py-1 text-sm font-medium text-foreground tabular-nums"
                >
                  {zip}
                </span>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ============================================================ */}
      {/*  PORTFOLIO                                                   */}
      {/* ============================================================ */}
      {portfolioPhotos.length > 0 && (
        <section className="bg-background py-16 lg:py-20">
          <div className="mx-auto max-w-4xl px-6">
            <h2 className="font-heading text-2xl font-normal tracking-tight text-foreground sm:text-3xl">
              Portfolio
            </h2>
            <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
              {portfolioPhotos.map((url, i) => (
                <div
                  key={i}
                  className="aspect-[4/3] overflow-hidden rounded-xl border border-border"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={`${displayName} project ${i + 1}`}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ============================================================ */}
      {/*  REVIEWS                                                     */}
      {/* ============================================================ */}
      {reviews.length > 0 && (
        <section className="border-y border-border bg-card py-16 lg:py-20">
          <div className="mx-auto max-w-4xl px-6">
            <h2 className="font-heading text-2xl font-normal tracking-tight text-foreground sm:text-3xl">
              Reviews
            </h2>

            {/* Star distribution */}
            <div className="mt-6 space-y-2">
              {[5, 4, 3, 2, 1].map((star) => {
                const count = starDist[star] ?? 0;
                const pct =
                  totalDistReviews > 0
                    ? Math.round((count / totalDistReviews) * 100)
                    : 0;
                return (
                  <div key={star} className="flex items-center gap-3">
                    <span className="w-8 text-right text-sm font-medium text-foreground">
                      {star}
                    </span>
                    <StarIcon filled />
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-border">
                      <div
                        className="h-full rounded-full bg-warm transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-10 text-right text-xs text-muted-foreground">
                      {count}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Individual reviews */}
            <div className="mt-10 space-y-6">
              {reviews.map((review) => (
                <div
                  key={review.id}
                  className="rounded-xl border border-border bg-background p-6"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Stars rating={review.rating ?? 0} />
                      <span className="text-sm font-semibold text-foreground">
                        {review.rating?.toFixed(1) ?? "0.0"}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(review.created_at)}
                    </span>
                  </div>
                  {review.title && (
                    <h3 className="mt-3 text-sm font-semibold text-foreground">
                      {review.title}
                    </h3>
                  )}
                  {review.body && (
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {review.body}
                    </p>
                  )}
                  {review.reviewer_name && (
                    <p className="mt-3 text-xs font-medium text-muted-foreground">
                      -- {review.reviewer_name}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ============================================================ */}
      {/*  CTA BANNER                                                  */}
      {/* ============================================================ */}
      <section className="bg-primary py-16">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="font-heading text-3xl font-normal tracking-tight text-white sm:text-4xl">
            Ready to get started with {displayName}?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base text-white/80">
            Request a free quote. No spam, no commitment. Henri matches you
            directly.
          </p>
          <div className="mt-8">
            <Link
              href={`/portal?contractor=${encodeURIComponent(profile.id)}&trade=${encodeURIComponent(profile.trade ?? "")}`}
              className="inline-block rounded-lg bg-white px-8 py-3.5 text-sm font-semibold text-primary shadow-lg transition-colors hover:bg-white/90"
            >
              Request a Quote
            </Link>
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  FOOTER                                                      */}
      {/* ============================================================ */}
      <footer className="border-t border-border bg-background py-10">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-6 sm:flex-row">
          <div className="flex items-center gap-2">
            <span className="font-heading text-lg font-medium text-primary">
              Henri.
            </span>
            <span className="text-sm text-muted-foreground">
              &copy; {new Date().getFullYear()} Henri. All rights reserved.
            </span>
          </div>
          <div className="flex gap-6">
            <Link
              href="/portal"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Find a contractor
            </Link>
            <Link
              href="/contractors"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              For contractors
            </Link>
            <Link
              href="mailto:support@meethenri.com"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Contact
            </Link>
          </div>
        </div>
      </footer>
    </>
  );
}
