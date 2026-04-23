"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useToast } from "@/components/ui/toast";

/**
 * Reads ?reason=... from the URL (populated by the middleware when it
 * performs a role/onboarding redirect) and surfaces a user-facing toast
 * so the redirect is never silent. After showing the toast, the query
 * param is stripped from the URL to keep shareable links clean.
 */

const REASON_COPY: Record<
  string,
  { type: "info" | "warning"; title: string; description: string }
> = {
  contractor_area: {
    type: "info",
    title: "Contractors have their own dashboard",
    description:
      "That page is for homeowners. We brought you back to the contractor dashboard.",
  },
  homeowner_area: {
    type: "info",
    title: "That page is for contractors",
    description:
      "We brought you back to your homeowner dashboard instead.",
  },
  onboarding_required: {
    type: "warning",
    title: "Finish setting up your account",
    description:
      "Complete a few quick steps before your contractor dashboard unlocks.",
  },
  step_license_required: {
    type: "warning",
    title: "Verify your license first",
    description:
      "We need your state and license number before you pick a plan.",
  },
  step_plan_required: {
    type: "warning",
    title: "Pick a plan first",
    description:
      "Choose your plan before we collect payment details.",
  },
  step_payment_required: {
    type: "warning",
    title: "Payment method needed",
    description:
      "Add a payment method before selecting your territory.",
  },
};

export function RedirectReasonToast() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { addToast } = useToast();

  useEffect(() => {
    const reason = searchParams.get("reason");
    if (!reason) return;

    const copy = REASON_COPY[reason];
    if (copy) {
      addToast({
        type: copy.type,
        title: copy.title,
        description: copy.description,
        duration: 6000,
      });
    }

    // Strip the query param so refresh / share doesn't retrigger the toast.
    const params = new URLSearchParams(searchParams.toString());
    params.delete("reason");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [searchParams, router, pathname, addToast]);

  return null;
}
