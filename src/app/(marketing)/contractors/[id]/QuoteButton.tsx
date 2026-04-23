"use client";

import Link from "next/link";

export function QuoteButton({
  contractorId,
  trade,
}: {
  contractorId: string;
  trade: string;
}) {
  const href = `/portal?contractor=${encodeURIComponent(contractorId)}&trade=${encodeURIComponent(trade)}`;

  return (
    <Link
      href={href}
      className="inline-flex items-center justify-center rounded-lg bg-primary px-8 py-3.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90"
    >
      Request a Quote
    </Link>
  );
}
