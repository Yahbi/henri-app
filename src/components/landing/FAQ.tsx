"use client";

import { useState, useCallback } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface FAQItem {
  question: string;
  answer: string;
}

interface FAQProps {
  permitsLabel: string;
  activeStatesLabel: string;
  /** Exact count of states Henri holds permit coverage for, shown
   * alongside the rounded-down headline label so the precise number is
   * visible too.
   *
   * 2026-08-04 truthfulness pass: this was documented and rendered as
   * "states with new permits in the last 30 days". No 30-day query
   * exists anywhere in the codebase — the underlying `activeStates`
   * value was a hand-curated constant, so the recency qualifier
   * described a measurement that was never taken. The qualifier is
   * gone; the answer now claims only coverage, which is what the value
   * actually represents regardless of how it is sourced. */
  activeStatesCount: number;
}

function buildFaqs({
  permitsLabel,
  activeStatesLabel,
  activeStatesCount,
}: FAQProps): FAQItem[] {
  return [
    {
      question: "What cities do you cover?",
      answer: `Henri's permit catalog spans major metropolitan areas in ${activeStatesLabel} US states (${activeStatesCount} states with permit coverage, totaling ${permitsLabel} permits). The catalog refreshes daily, and new jurisdictions are added as we onboard them.`,
    },
    {
      question: "How fast do I get leads?",
      answer:
        "The permit catalog refreshes daily. New permits filed during a given day appear in the dashboard the next refresh — typically within 24 hours of the source jurisdiction publishing them.",
    },
    {
      question: "Can I change my territories?",
      answer:
        "Territory changes take effect at the start of your next billing cycle, provided the requested ZIP is available.",
    },
    {
      question: "What trades do you support?",
      answer:
        "We support roofing, HVAC, solar, electrical, plumbing, addition, ADU, windows, painting, landscaping, general remodel, and foundation.",
    },
    {
      question: "Is there a contract?",
      answer:
        "No long-term contracts. You can cancel anytime and cancellation takes effect at the end of your current billing cycle. We offer a 24-hour free trial with credit card required.",
    },
  ];
}

/* Accordion a11y (2026-08-04): trigger had aria-expanded but no explicit
 * type, no aria-controls, and no focus-visible ring; the collapsed panel
 * stayed in the accessibility tree (grid-rows-[0fr] only removes it
 * visually) so screen readers read every answer at once. */
function AccordionItem({
  id,
  item,
  isOpen,
  onToggle,
}: {
  id: string;
  item: FAQItem;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border-b border-border">
      <button
        type="button"
        id={`${id}-trigger`}
        onClick={onToggle}
        className="flex w-full items-center justify-between py-5 text-left transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={isOpen}
        aria-controls={`${id}-panel`}
      >
        <span className="text-base font-medium text-foreground">
          {item.question}
        </span>
        <ChevronDown
          className={cn(
            "h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200",
            isOpen && "rotate-180"
          )}
        />
      </button>
      <div
        id={`${id}-panel`}
        role="region"
        aria-labelledby={`${id}-trigger`}
        aria-hidden={!isOpen}
        className={cn(
          "grid transition-all duration-200 ease-in-out",
          isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        )}
      >
        <div className="overflow-hidden">
          <p className="pb-5 text-sm leading-relaxed text-muted-foreground">
            {item.answer}
          </p>
        </div>
      </div>
    </div>
  );
}

export function FAQ(props: FAQProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const faqs = buildFaqs(props);

  const toggle = useCallback((index: number) => {
    setOpenIndex((prev) => (prev === index ? null : index));
  }, []);

  return (
    <section id="faq" className="bg-background py-24 lg:py-32">
      <div className="mx-auto max-w-3xl px-6">
        {/* Section header */}
        <div className="text-center">
          <h2 className="font-heading text-3xl font-normal tracking-tight text-foreground sm:text-4xl">
            Frequently Asked Questions
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Everything you need to know about Henri.
          </p>
        </div>

        {/* Accordion */}
        <div className="mt-12">
          {faqs.map((faq, i) => (
            <AccordionItem
              key={i}
              id={`landing-faq-${i}`}
              item={faq}
              isOpen={openIndex === i}
              onToggle={() => toggle(i)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
