"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { ChatIntakeModal } from "@/components/portal/ChatIntakeModal";
import { cn } from "@/lib/utils/cn";

/* ================================================================== */
/*  DATA                                                               */
/* ================================================================== */

const TRADES = [
  { label: "Roofing" },
  { label: "HVAC" },
  { label: "Solar" },
  { label: "Electrical" },
  { label: "Plumbing" },
  { label: "Addition" },
  { label: "ADU" },
  { label: "Windows" },
  { label: "Painting" },
  { label: "Landscaping" },
  { label: "General Remodel" },
  { label: "Foundation" },
] as const;

const HOW_IT_WORKS_STEPS = [
  {
    num: "01",
    title: "Enter your ZIP",
    desc: "Tell us where the project is. We only match contractors licensed in your area.",
  },
  {
    num: "02",
    title: "AI intake chat",
    desc: "Our AI assistant learns about your project scope, timeline, and budget in under 2 minutes.",
  },
  {
    num: "03",
    title: "Project scored",
    desc: "Henri scores your project for complexity, urgency, and budget to find the ideal match.",
  },
  {
    num: "04",
    title: "One matched contractor",
    desc: "You get exactly one vetted contractor - not a flood of sales calls from strangers.",
  },
  {
    num: "05",
    title: "Direct connection",
    desc: "Your contractor receives your project details and reaches out directly. No middlemen, no spam, no nonsense.",
  },
] as const;

// Illustrative examples of what homeowners can expect from the Henri process.
// Replace with verified quotes from real users before broader launch.
const HOW_IT_FEELS = [
  {
    scenario: "No flood of sales calls",
    description:
      "You describe your project once. We match you with exactly one vetted, licensed contractor — not a list of five companies all racing to call you first.",
  },
  {
    scenario: "Someone who knows your project",
    description:
      "Your contractor receives your scope, timeline, and budget before the first call. They show up prepared, not cold.",
  },
  {
    scenario: "Verified, licensed pros",
    description:
      "Every contractor on Henri holds an active license we verify daily. If a license lapses, they're removed immediately.",
  },
] as const;

const FAQS = [
  {
    q: "Is Henri really free for homeowners?",
    a: "Yes, completely free. Contractors pay to be on our platform. You will never be charged. No hidden fees, no credit card required.",
  },
  {
    q: "How is Henri different from other platforms?",
    a: "Other platforms sell your information to multiple contractors who all call you at once. Henri matches you with exactly one vetted, licensed contractor. Your information is never sold or shared beyond that single match.",
  },
  {
    q: "How are contractors vetted?",
    a: "Every contractor on Henri holds a valid, active contractor license that we verify daily. They must carry liability insurance and meet our quality standards. If a license lapses, they are immediately removed from the platform.",
  },
  {
    q: "What if I don't like the contractor I'm matched with?",
    a: "Let us know and we will re-match you with a different contractor at no cost. You are never stuck with a match that does not feel right.",
  },
  {
    q: "How quickly will the contractor contact me?",
    a: "Most contractors respond within a few hours during business hours. You will receive a notification as soon as your contractor is assigned.",
  },
] as const;


/* ================================================================== */
/*  SMALL COMPONENTS                                                   */
/* ================================================================== */

function ShieldIcon() {
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

/* ================================================================== */
/*  FAQ Accordion                                                      */
/* ================================================================== */

function FAQItem({
  question,
  answer,
  isOpen,
  onToggle,
}: {
  question: string;
  answer: string;
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
          {question}
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
            {answer}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  PAGE                                                               */
/* ================================================================== */

export default function PortalPage() {
  const [chatOpen, setChatOpen] = useState(false);
  const [chatZip, setChatZip] = useState("");
  const [chatTrade, setChatTrade] = useState("");
  const [zipInput, setZipInput] = useState("");
  const [faqOpen, setFaqOpen] = useState<number | null>(null);

  const openChat = useCallback(
    (zip?: string, trade?: string) => {
      setChatZip(zip ?? "");
      setChatTrade(trade ?? "");
      setChatOpen(true);
    },
    []
  );

  const handleHeroSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      openChat(zipInput);
    },
    [zipInput, openChat]
  );

  const handleTradeClick = useCallback(
    (trade: string) => {
      /* Pass through whatever ZIP the user already typed in the hero
       * form so the chat doesn't ask for it again. If they clicked a
       * trade card before entering a ZIP, zipInput is "" and the chat
       * opens at Step1 (Address). If they typed a ZIP AND clicked a
       * trade, both initialZip + initialTrade are set and the chat
       * skips ahead to Step2 (Timeline). Pre-04-30 this passed "" and
       * forced a double-ask. */
      openChat(zipInput.trim(), trade);
    },
    [openChat, zipInput]
  );

  return (
    <>
      {/* Shared <MarketingNav /> is mounted by src/app/(marketing)/layout.tsx.
          Per-page <PortalNav /> removed as part of gap-audit G1. */}

      {/* ============================================================ */}
      {/*  HERO                                                        */}
      {/* ============================================================ */}
      <section className="relative overflow-hidden bg-background pt-12 pb-20 lg:pt-20 lg:pb-28">
        {/* Background gradient */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background: [
              "radial-gradient(ellipse 60% 50% at 50% 0%, hsl(var(--primary) / 0.06) 0%, transparent 70%)",
              "radial-gradient(ellipse 40% 40% at 80% 60%, hsl(var(--primary) / 0.04) 0%, transparent 70%)",
            ].join(", "),
          }}
        />

        <div className="mx-auto max-w-4xl px-6 text-center">
          <h1 className="font-heading text-4xl font-normal tracking-tight text-foreground sm:text-5xl lg:text-6xl">
            The right contractor,{" "}
            <em className="text-primary">
              not a sales call avalanche
            </em>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            Henri matches you with exactly one vetted, licensed contractor for
            your project. No bidding wars, no spam calls, no selling your info.
            Just the right pro, fast.
          </p>

          {/* ZIP form */}
          <form
            onSubmit={handleHeroSubmit}
            className="mx-auto mt-10 flex max-w-md gap-3"
          >
            <input
              type="text"
              value={zipInput}
              onChange={(e) => setZipInput(e.target.value)}
              placeholder="Enter your ZIP code"
              className="flex-1 rounded-lg border border-input bg-card px-4 py-3 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              type="submit"
              className="whitespace-nowrap rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90"
            >
              Find my contractor &rarr;
            </button>
          </form>

          {/* Trust dots */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[#3D9970]" />
              Free for homeowners
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[#3D9970]" />
              No spam calls
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[#3D9970]" />
              Licensed &amp; insured only
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[#3D9970]" />
              1 contractor, not 5
            </span>
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  STATS BAR                                                   */}
      {/* ============================================================ */}
      <section className="border-y border-border bg-card py-12">
        <div className="mx-auto max-w-6xl px-6">
          {/* Removed the "4,200+ homeowners matched" line and the
               94% / 4.9/5 metric cards \u2014 Beta platform, no cohort
               exists to derive those numbers honestly. Replaced with
               a trust row (all verifiable claims) plus three cards
               describing the model itself, not outcomes we haven't
               earned yet. */}
          <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <ShieldIcon />
              Every contractor license-verified
            </span>
            <span className="flex items-center gap-2">
              <ShieldIcon />
              Your info never sold
            </span>
            <span className="flex items-center gap-2">
              <ShieldIcon />
              One-to-one match
            </span>
          </div>

          {/* Model-describing cards, not outcome claims */}
          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-border bg-background p-6 text-center">
              <p className="text-3xl font-semibold text-primary">1</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Contractor per match. That&apos;s it.
              </p>
            </div>
            <div className="rounded-xl border border-border bg-background p-6 text-center">
              <p className="text-3xl font-semibold text-primary">$0</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Using Henri as a homeowner is free, always.
              </p>
            </div>
            <div className="rounded-xl border border-border bg-background p-6 text-center">
              <p className="text-3xl font-semibold text-primary">30+</p>
              <p className="mt-1 text-sm text-muted-foreground">
                US states covered by our permit catalog
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  HOW IT WORKS                                                */}
      {/* ============================================================ */}
      <section id="how-it-works" className="bg-background py-24 lg:py-32">
        <div className="mx-auto max-w-4xl px-6">
          <div className="text-center">
            <h2 className="font-heading text-3xl font-normal tracking-tight text-foreground sm:text-4xl">
              How Henri works
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              From ZIP code to contractor call in under 5 minutes.
            </p>
          </div>

          <div className="mt-16 space-y-0">
            {HOW_IT_WORKS_STEPS.map((step, i) => (
              <div key={step.num} className="relative flex gap-6 pb-12 last:pb-0">
                {/* Vertical line */}
                {i < HOW_IT_WORKS_STEPS.length - 1 && (
                  <div className="absolute left-5 top-12 bottom-0 w-px bg-border" />
                )}
                {/* Number badge */}
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-white">
                  {step.num}
                </div>
                <div className="pt-1.5">
                  <h3 className="text-lg font-semibold text-foreground">
                    {step.title}
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {step.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  TRADE GRID                                                  */}
      {/* ============================================================ */}
      <section className="border-y border-border bg-card py-24 lg:py-32">
        <div className="mx-auto max-w-4xl px-6">
          <div className="text-center">
            <h2 className="font-heading text-3xl font-normal tracking-tight text-foreground sm:text-4xl">
              What is your project?
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Select a trade to get started with your contractor match.
            </p>
          </div>

          <div className="mt-12 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {TRADES.map((trade) => (
              <button
                key={trade.label}
                onClick={() => handleTradeClick(trade.label)}
                className="flex flex-col items-center gap-2 rounded-xl border border-border bg-background p-5 text-sm font-medium text-foreground transition-all duration-150 hover:border-primary/40 hover:bg-primary-04 hover:shadow-sm"
              >
                <span>{trade.label}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  SATISFACTION GUARANTEE                                      */}
      {/* ============================================================ */}
      <section className="bg-background py-16">
        <div className="mx-auto max-w-3xl px-6">
          <div className="rounded-2xl border border-border bg-primary-04 p-8 text-center sm:p-12">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary-10">
              <ShieldIcon />
            </div>
            <h3 className="font-heading text-2xl font-normal text-foreground">
              Satisfaction Guarantee
            </h3>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
              If you&apos;re not happy with your matched contractor for any
              reason, we&apos;ll re-match you with a different one at absolutely
              no cost. Your satisfaction is the only metric that matters to us.
            </p>
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  HOW IT FEELS                                               */}
      {/* ============================================================ */}
      <section className="border-y border-border bg-card py-24 lg:py-32">
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center">
            <h2 className="font-heading text-3xl font-normal tracking-tight text-foreground sm:text-4xl">
              A different kind of contractor search
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Here&apos;s what sets Henri apart.
            </p>
          </div>

          <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
            {HOW_IT_FEELS.map((item) => (
              <div
                key={item.scenario}
                className="flex flex-col rounded-xl border border-border bg-background p-6"
              >
                <p className="text-sm font-semibold text-primary">{item.scenario}</p>
                <p className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  FAQ                                                         */}
      {/* ============================================================ */}
      <section id="faq" className="bg-background py-24 lg:py-32">
        <div className="mx-auto max-w-3xl px-6">
          <div className="text-center">
            <h2 className="font-heading text-3xl font-normal tracking-tight text-foreground sm:text-4xl">
              Frequently Asked Questions
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Everything you need to know about finding a contractor with Henri.
            </p>
          </div>

          <div className="mt-12">
            {FAQS.map((faq, i) => (
              <FAQItem
                key={i}
                question={faq.q}
                answer={faq.a}
                isOpen={faqOpen === i}
                onToggle={() =>
                  setFaqOpen((prev) => (prev === i ? null : i))
                }
              />
            ))}
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  CONTRACTOR CTA (link to contractor page)                    */}
      {/* ============================================================ */}
      <section className="border-y border-border bg-card py-16">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-primary">
            Are you a contractor?
          </p>
          <h2 className="font-heading mt-3 text-2xl font-normal tracking-tight text-foreground sm:text-3xl">
            AI-scored permit leads in your territory
          </h2>
          <p className="mt-3 text-base text-muted-foreground">
            Henri turns public building-permit filings into scored, contact-enriched leads. Plans from $149/mo, 24-hour free trial.
          </p>
          <Link
            href="/contractors"
            className="mt-6 inline-block rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            Learn more for contractors &rarr;
          </Link>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  CTA BANNER                                                  */}
      {/* ============================================================ */}
      <section className="bg-primary py-16">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="font-heading text-3xl font-normal tracking-tight text-white sm:text-4xl">
            Ready to find your contractor?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base text-white/80">
            It takes 2 minutes. No spam, no commitment, completely free.
          </p>
          <button
            onClick={() => openChat()}
            className="mt-8 rounded-lg bg-white px-8 py-3.5 text-sm font-semibold text-primary shadow-lg transition-colors hover:bg-white/90"
          >
            Get matched free &rarr;
          </button>
        </div>
      </section>

      {/* Footer removed — the shared <Footer /> mounted by
          src/app/(marketing)/layout.tsx renders the canonical footer on every
          marketing page with Terms / Privacy / Acceptable Use reachable
          (required for Stripe + Google OAuth review). See plan gap G3. */}

      {/* ============================================================ */}
      {/*  CHAT MODAL                                                  */}
      {/* ============================================================ */}
      <ChatIntakeModal
        isOpen={chatOpen}
        onClose={() => setChatOpen(false)}
        initialZip={chatZip}
        initialTrade={chatTrade}
      />
    </>
  );
}
