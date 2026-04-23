import "server-only";
import type { Metadata } from "next";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { ReviewForm } from "./ReviewForm";

/* ================================================================== */
/*  METADATA                                                           */
/* ================================================================== */

export const metadata: Metadata = {
  title: "Leave a Review | Henri",
  description:
    "Share your experience with your contractor. Your feedback helps other homeowners find quality professionals.",
  robots: { index: false, follow: false },
};

/* ================================================================== */
/*  TYPES                                                              */
/* ================================================================== */

interface ReviewRequest {
  id: string;
  contractor_id: string;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  status: string;
  expires_at: string | null;
  lead_id: string | null;
}

interface ContractorProfile {
  company_name: string | null;
  full_name: string | null;
  trade: string | null;
}

/* ================================================================== */
/*  DATA FETCHING                                                      */
/* ================================================================== */

async function getReviewRequestData(token: string) {
  const supabase = createAdminClient();

  const { data: reviewRequest, error } = await supabase
    .from("review_requests")
    .select(
      "id, contractor_id, customer_name, customer_email, customer_phone, status, expires_at, lead_id"
    )
    .eq("token", token)
    .single();

  if (error || !reviewRequest) return { status: "invalid" as const };

  const rr = reviewRequest as ReviewRequest;

  if (rr.status === "completed") {
    return { status: "completed" as const };
  }

  if (rr.expires_at && new Date(rr.expires_at) < new Date()) {
    return { status: "expired" as const };
  }

  /* Fetch contractor info */
  const { data: profile } = await supabase
    .from("profiles")
    .select("company_name, full_name, trade")
    .eq("id", rr.contractor_id)
    .single();

  const contractorProfile = profile as ContractorProfile | null;

  return {
    status: "valid" as const,
    reviewRequest: rr,
    contractorName:
      contractorProfile?.company_name ??
      contractorProfile?.full_name ??
      "your contractor",
    trade: contractorProfile?.trade ?? null,
  };
}

/* ================================================================== */
/*  PAGE                                                               */
/* ================================================================== */

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const data = await getReviewRequestData(token);

  return (
    <>
      {/* ── Minimal nav ── */}
      <nav className="fixed inset-x-0 top-0 z-50 flex h-14 items-center justify-center border-b border-border bg-background/80 backdrop-blur-md">
        <Link href="/portal" className="font-heading text-xl font-normal text-primary">
          Henri.
        </Link>
      </nav>

      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 pb-16 pt-20">
        {data.status === "invalid" && (
          <ErrorState
            title="Invalid Review Link"
            message="This review link is not valid. It may have been entered incorrectly. Please check the link and try again."
          />
        )}

        {data.status === "expired" && (
          <ErrorState
            title="Link Expired"
            message="This review link has expired. Review links are valid for 30 days after they are sent."
          />
        )}

        {data.status === "completed" && (
          <ErrorState
            title="Review Already Submitted"
            message="A review has already been submitted using this link. Thank you for your feedback!"
          />
        )}

        {data.status === "valid" && (
          <ReviewForm
            token={token}
            contractorId={data.reviewRequest.contractor_id}
            contractorName={data.contractorName}
            customerName={data.reviewRequest.customer_name}
            customerEmail={data.reviewRequest.customer_email}
            trade={data.trade}
          />
        )}
      </div>

      {/* ── Footer ── */}
      <footer className="border-t border-border bg-background py-8">
        <div className="mx-auto flex max-w-7xl flex-col items-center gap-2 px-6 text-center">
          <span className="font-heading text-lg font-normal text-primary">
            Henri.
          </span>
          <p className="text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} Henri. All rights reserved.
          </p>
        </div>
      </footer>
    </>
  );
}

/* ================================================================== */
/*  ERROR STATE                                                        */
/* ================================================================== */

function ErrorState({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <div className="w-full max-w-md text-center">
      <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
        <svg
          className="h-8 w-8 text-muted-foreground"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
          />
        </svg>
      </div>
      <h1 className="font-heading text-2xl font-normal tracking-tight text-foreground">
        {title}
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        {message}
      </p>
      <Link
        href="/portal"
        className="mt-6 inline-block text-sm font-medium text-primary hover:underline"
      >
        Go to Henri
      </Link>
    </div>
  );
}
