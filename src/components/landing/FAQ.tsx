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
  /** Live count of active states for the parenthetical detail in the
   * coverage answer. We display the actual number alongside the
   * rounded-down headline label for honesty. */
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
      answer: `Henri's permit catalog spans major metropolitan areas in ${activeStatesLabel} US states (${activeStatesCount} states with new permits in the last 30 days, totaling ${permitsLabel} permits). New jurisdictions are added as we onboard their data sources.`,
    },
    {
      question: "How fast do I get leads?",
      answer:
        "The permit catalog refreshes daily (vercel.json /api/cron/scrape, 2 AM UTC). New permits filed during a given day appear in the dashboard the next refresh — typically within 24 hours of the source jurisdiction publishing them.",
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

function AccordionItem({
  item,
  isOpen,
  onToggle,
}: {
  item: FAQItem;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border-b border-border">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between py-5 text-left transition-colors hover:text-primary"
        aria-expanded={isOpen}
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
