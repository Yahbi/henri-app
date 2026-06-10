import type { Metadata } from "next";
import { PricingSection } from "@/components/landing/PricingSection";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Simple, transparent pricing for contractors. Start with a 24-hour free trial. Founder plan from $149/mo — lock in your territory before someone else does.",
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: "Pricing — Henri",
    description:
      "Founder $149/mo · Starter $749/mo · Pro $1,499/mo · Enterprise $2,555/mo. 24-hour free trial included.",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Henri. pricing — plans from $149/mo",
      },
    ],
  },
};

export default function PricingPage() {
  return (
    <div className="py-12">
      <div className="mx-auto max-w-2xl px-6 text-center">
        <h1 className="font-heading text-4xl font-normal tracking-tight text-foreground sm:text-5xl">
          Pricing
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Find the plan that fits your business. Start free, upgrade anytime.
        </p>
      </div>
      <PricingSection />
    </div>
  );
}
