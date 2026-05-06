/**
 * Internal brand preview — twelve wordmark iterations set in Fraunces,
 * the platform's heading face.
 *
 * Visit: /brand-preview
 *
 * Each variant shows:
 *   1. The wordmark on a cream surface (the marketing site's default
 *      background) so you see how it reads in its primary context.
 *   2. The wordmark on a near-black surface (the dashboard's inverted
 *      top-bar context) so you see how it inverts.
 *   3. A small-size rendition (24px) so you see how it survives the
 *      nav-bar context where most brand exposure happens.
 *   4. A short rationale and a one-line tradeoff.
 *
 * After picking, copy the chosen variant's component body into the
 * canonical `HenriLogo` component and the rest of the brand surface
 * picks it up automatically. (For favicon / OG / iOS icon, the chosen
 * wordmark gets traced to outlines so it doesn't depend on the webfont
 * loading.)
 *
 * This page is dev-only — it isn't linked from anywhere in the public
 * nav, and metadata.robots blocks indexing.
 */

import type { Metadata } from "next";
import {
  WordmarkK,
  WordmarkL,
  WordmarkM,
  WordmarkN,
  WordmarkO,
  WordmarkP,
  WordmarkQ,
  WordmarkR,
  WordmarkS,
  WordmarkT,
  WordmarkU,
  WordmarkV,
  WordmarkW,
  WordmarkY,
  WordmarkZ,
} from "@/components/brand/HenriWordmarkVariants";

export const metadata: Metadata = {
  title: "Brand preview · Henri",
  description: "Internal logo iteration preview.",
  robots: { index: false, follow: false },
};

const VARIANTS = [
  {
    key: "K",
    Component: WordmarkK,
    name: "Stripped",
    move: "No embellishment.",
    blurb:
      "The wordmark, no enclosure, no tricks. The control. Every other variant has to earn its complexity against this baseline.",
    tradeoff:
      "Hardest to make distinctive — depends entirely on the typography of the period.",
  },
  {
    key: "L",
    Component: WordmarkL,
    name: "Disc Period",
    move: "Period replaced with a filled brand-color disc.",
    blurb:
      "The typographic period becomes a graphic mark. The disc reads as the brand stamp while the wordmark stays as type. A move many premium brands use because it survives small sizes.",
    tradeoff: "Common pattern; ownability lives in the disc proportions.",
  },
  {
    key: "M",
    Component: WordmarkM,
    name: "Hairline Ring",
    move: "Period replaced with a thin open ring.",
    blurb:
      "More editorial than the filled disc. Reads as refined, magazine-masthead, considered. The ring is more memorable than a dot but less heavy than a stamp.",
    tradeoff: "Hairline can vanish at favicon size — needs careful weight tuning.",
  },
  {
    key: "N",
    Component: WordmarkN,
    name: "Two-tone i.",
    move: "‘Henr’ in foreground; ‘i.’ flips to terracotta.",
    blurb:
      "The terminal ‘i.’ becomes the ownable brand element. Carries even when the rest of the word is set in body type. The split tells you where the brand begins and ends.",
    tradeoff: "Requires two-tone capability — degrades to plain wordmark on monochrome surfaces.",
  },
  {
    key: "O",
    Component: WordmarkO,
    name: "Italic",
    move: "Entire wordmark set in Fraunces italic.",
    blurb:
      "Fraunces' italic is unusually expressive — soft terminals, almost calligraphic. Reads as ‘spoken,’ personal, signature-style. The italic is what makes the typeface special; this variant lets it lead.",
    tradeoff: "Italic loses the stately register of the upright; less institutional.",
  },
  {
    key: "P",
    Component: WordmarkP,
    name: "Wide Caps",
    move: "All-caps with architectural letter-spacing.",
    blurb:
      "Trades the friendly lowercase for masthead gravitas. Reads as serious, credentialed, document-stamped. The wide tracking lets each letter breathe like a stone-cut inscription.",
    tradeoff: "Less warm than lowercase — the hospitality angle softens.",
  },
  {
    key: "Q",
    Component: WordmarkQ,
    name: "Masthead Lockup",
    move: "Wordmark stacked over a tracked-caps positioning line.",
    blurb:
      "Magazine masthead aesthetic. The serif wordmark plus the small tracked tagline reads like the cover of a premium publication. The tagline is swappable at lockdown.",
    tradeoff: "Locks the brand to whatever the tagline says — fragile if positioning shifts.",
  },
  {
    key: "R",
    Component: WordmarkR,
    name: "H. Monogram",
    move: "Drop ‘enri’ entirely. Just H.",
    blurb:
      "Aman / Apple / IBM territory — a single-glyph mark that depends on enough surface area elsewhere to spell out the full name. Bold, restrained, unmistakable at any size.",
    tradeoff: "New visitors won't get the name from the mark — needs the wordmark nearby.",
  },
  {
    key: "S",
    Component: WordmarkS,
    name: "Em-dash Lockup",
    move: "Henri — for contractors.",
    blurb:
      "Anchors a positioning line as part of the mark itself. Reads as both name and statement of intent. Carries the wedge into every place the logo appears.",
    tradeoff: "Locks the brand to a specific audience phrase — hard to shift without a rebrand.",
  },
  {
    key: "T",
    Component: WordmarkT,
    name: "Vertical Totem",
    move: "Letters stacked into a single column.",
    blurb:
      "Most unconventional of the twelve. The horizontal wordmark stays for body copy; the totem becomes the iconic mark. Architectural, monumental, distinct.",
    tradeoff: "Doesn't read as ‘Henri’ at a glance — needs context to decode.",
  },
  {
    key: "U",
    Component: WordmarkU,
    name: "Bracketed",
    move: "[Henri.]",
    blurb:
      "Square brackets reference the AI prompt and code-template aesthetic. Reads as modern, sharp, technical. The brackets are part of the mark, not a container, which keeps it distinct from common marketplace logos.",
    tradeoff: "Code-feel may feel too engineering-forward for the contractor audience.",
  },
  {
    key: "V",
    Component: WordmarkV,
    name: "Curly Quoted",
    move: "Curly typographic quotes wrap the wordmark.",
    blurb:
      "Reads as ‘the named thing’ — pull-quote, brand-as-person. The quotes turn the wordmark into a referenced subject, like a magazine cover quote.",
    tradeoff: "Could read as sarcastic or ironic depending on context — risk of tonal mismatch.",
  },
] as const;

export default function BrandPreviewPage() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-24">
      <header className="mb-20">
        <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
          Internal · Wordmark iterations
        </p>
        <h1 className="mt-3 font-heading text-5xl font-medium tracking-tight text-foreground">
          Wordmarks for Henri.
        </h1>
        <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground">
          Type-led directions set in Fraunces, the platform's heading
          face, in the brand terracotta. Each variant is one disciplined
          typographic move applied to the wordmark — no icons, no
          enclosures, no decoration (with the exception of W, the stamp
          ring). The constraint mirrors how most premium brands in
          adjacent categories ship: a wordmark, not a mark plus lockup.
          Pick the move that earns its complexity.
        </p>
      </header>

      {/* Latest — stamp + "meet Henri." lockup */}
      <section className="mb-24 overflow-hidden rounded-3xl border border-border/60">
        <div className="flex items-baseline justify-between gap-6 border-b border-border/40 bg-card px-10 py-6">
          <div className="flex items-baseline gap-5">
            <span className="font-heading text-3xl text-muted-foreground/70">
              Z
            </span>
            <h2 className="font-heading text-2xl font-medium tracking-tight text-foreground">
              Stamp + "meet Henri." lockup
            </h2>
            <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
              Latest
            </span>
          </div>
          <p className="hidden text-xs uppercase tracking-[0.2em] text-muted-foreground md:block">
            W stamp + Y wordmark, vertically aligned.
          </p>
        </div>

        {/* Hero — full lockup on cream */}
        <div className="flex min-h-[420px] items-center justify-center bg-background px-10 py-20">
          <WordmarkZ size={200} />
        </div>

        {/* Inverted — full lockup on near-black */}
        <div
          className="flex min-h-[300px] items-center justify-center px-10 py-12"
          style={{ backgroundColor: "#0A0A0A" }}
        >
          <span style={{ color: "#FFFAF5" }} className="inline-flex">
            <WordmarkZ size={140} />
          </span>
        </div>

        {/* Size sweep */}
        <div className="grid grid-cols-3 gap-6 border-t border-border/40 bg-muted/30 px-10 py-12">
          <div className="flex flex-col items-center justify-end gap-3">
            <WordmarkZ size={64} />
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              64 px (small)
            </p>
          </div>
          <div className="flex flex-col items-center justify-end gap-3">
            <WordmarkZ size={120} />
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              120 px (medium)
            </p>
          </div>
          <div className="flex flex-col items-center justify-end gap-3">
            <WordmarkZ size={200} />
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              200 px (hero)
            </p>
          </div>
        </div>

        {/* Rationale */}
        <div className="space-y-4 border-t border-border/40 bg-muted/30 px-10 py-8">
          <p className="text-sm leading-relaxed text-foreground">
            Stamp + tagline, the gold-standard premium-brand pattern. The
            W stamp carries the iconic mark; the Y wordmark below carries
            the brand voice. Both share the brand terracotta and Fraunces
            serif, both centered on the same vertical axis. The lockup
            reads as one composition — the stamp says "this is Henri,"
            the wordmark says "meet him."
          </p>
          <p className="text-xs italic leading-relaxed text-muted-foreground">
            Tradeoff: needs vertical real estate. For horizontal nav
            contexts, fall back to W (stamp alone). The lockup is the
            primary brand asset for hero areas, OG cards, business
            cards, sign-on screens — anywhere height isn't constrained.
          </p>
        </div>
      </section>

      {/* Latest test — pure wordmark with "meet Henri." */}
      <section className="mb-24 overflow-hidden rounded-3xl border border-border/60">
        <div className="flex items-baseline justify-between gap-6 border-b border-border/40 bg-card px-10 py-6">
          <div className="flex items-baseline gap-5">
            <span className="font-heading text-3xl text-muted-foreground/70">
              Y
            </span>
            <h2 className="font-heading text-2xl font-medium tracking-tight text-foreground">
              "meet Henri." wordmark
            </h2>
            <span className="rounded-full border border-foreground/30 bg-foreground/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-foreground">
              Latest
            </span>
          </div>
          <p className="hidden text-xs uppercase tracking-[0.2em] text-muted-foreground md:block">
            Italic "meet" + upright "Henri."
          </p>
        </div>

        {/* Hero — the wordmark on cream */}
        <div className="flex min-h-[260px] items-center justify-center bg-background px-10 py-16">
          <WordmarkY size={88} />
        </div>

        {/* Inverted — cream wordmark on near-black */}
        <div
          className="flex min-h-[160px] items-center justify-center px-10 py-12"
          style={{ backgroundColor: "#0A0A0A" }}
        >
          <span style={{ color: "#FFFAF5" }} className="inline-flex">
            <WordmarkY size={56} />
          </span>
        </div>

        {/* Size sweep */}
        <div className="grid grid-cols-3 gap-6 border-t border-border/40 bg-muted/30 px-10 py-10">
          <div className="flex flex-col items-center justify-center gap-3">
            <WordmarkY size={20} />
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              20 px (favicon)
            </p>
          </div>
          <div className="flex flex-col items-center justify-center gap-3">
            <WordmarkY size={32} />
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              32 px (nav)
            </p>
          </div>
          <div className="flex flex-col items-center justify-center gap-3">
            <WordmarkY size={64} />
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              64 px (hero)
            </p>
          </div>
        </div>

        {/* Rationale */}
        <div className="space-y-4 border-t border-border/40 bg-muted/30 px-10 py-8">
          <p className="text-sm leading-relaxed text-foreground">
            Pure wordmark — no enclosure, no ring. The italic-then-upright
            move is a classic editorial typographic device (NYT section
            heads, FT pull-quotes): the italic "meet" reads as a soft
            preamble, the upright "Henri." carries the brand weight. The
            full wordmark IS the call-to-action — it encodes the domain
            into the mark itself.
          </p>
          <p className="text-xs italic leading-relaxed text-muted-foreground">
            Tradeoff: longer than "Henri." alone, so it doesn't survive
            at favicon scale. Locks the brand to "meet Henri" phrasing —
            future copy that uses "Henri" alone will read inconsistent
            against this lockup.
          </p>
        </div>
      </section>

      {/* Featured — the latest direction (Aphex-style stamp ring) */}
      <section className="mb-24 overflow-hidden rounded-3xl border border-border/60">
        <div className="flex items-baseline justify-between gap-6 border-b border-border/40 bg-card px-10 py-6">
          <div className="flex items-baseline gap-5">
            <span className="font-heading text-3xl text-muted-foreground/70">
              W
            </span>
            <h2 className="font-heading text-2xl font-medium tracking-tight text-foreground">
              Stamp Ring
            </h2>
            <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
              Featured
            </span>
          </div>
          <p className="hidden text-xs uppercase tracking-[0.2em] text-muted-foreground md:block">
            H centered in a heavy ring; period inside, right of H.
          </p>
        </div>

        {/* Hero — the stamp on cream, large enough to feel like a record label */}
        <div className="flex min-h-[420px] items-center justify-center bg-background px-10 py-20">
          <WordmarkW size={260} />
        </div>

        {/* Lockup — the stamp paired with the full wordmark, mark+name pattern */}
        <div className="flex min-h-[180px] items-center justify-center gap-6 border-t border-border/40 bg-background px-10 py-12">
          <WordmarkW size={88} />
          <span
            className="font-heading font-medium tracking-tight text-primary"
            style={{ fontSize: 64, lineHeight: 1 }}
          >
            Henri.
          </span>
        </div>

        {/* Inverted — cream stamp on near-black, dashboard top-bar context */}
        <div
          className="flex min-h-[200px] items-center justify-center gap-6 px-10 py-12"
          style={{ backgroundColor: "#0A0A0A" }}
        >
          <span style={{ color: "#FFFAF5" }} className="inline-flex">
            <WordmarkW size={88} />
          </span>
          <span
            className="font-heading font-medium tracking-tight"
            style={{ fontSize: 64, lineHeight: 1, color: "#FFFAF5" }}
          >
            Henri.
          </span>
        </div>

        {/* Size sweep — favicon / nav / hero on a single strip */}
        <div className="grid grid-cols-3 gap-6 border-t border-border/40 bg-muted/30 px-10 py-10">
          <div className="flex flex-col items-center gap-3">
            <WordmarkW size={20} />
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              20 px (favicon)
            </p>
          </div>
          <div className="flex flex-col items-center gap-3">
            <WordmarkW size={44} />
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              44 px (nav)
            </p>
          </div>
          <div className="flex flex-col items-center gap-3">
            <WordmarkW size={120} />
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              120 px (hero)
            </p>
          </div>
        </div>

        {/* Rationale */}
        <div className="space-y-4 border-t border-border/40 bg-muted/30 px-10 py-8">
          <p className="text-sm leading-relaxed text-foreground">
            The reference is the Aphex Twin record-label mark — a single
            typographic glyph centered in the negative space of a heavy
            ring. For Henri, the H sits perfectly centered at the ring's
            geometric center; the period lives inside the same ring,
            anchored to the right of the H at the H's baseline. The H
            is the stamp's anchor, the period its signature accent —
            both inside one mark. The full wordmark "Henri." pairs
            alongside in compositions.
          </p>
          <p className="text-xs italic leading-relaxed text-muted-foreground">
            Tradeoff: letter-in-circle is a common pattern; ownability
            lives in the ring weight, the centering discipline of the
            H, and the period's relationship to the H rather than the
            ring. Choose this if "claimed and stamped" is the brand
            metaphor.
          </p>
        </div>
      </section>

      <header className="mb-12">
        <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
          Alternates
        </p>
        <h2 className="mt-2 font-heading text-3xl font-medium tracking-tight text-foreground">
          Twelve wordmark moves
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Each variant below is a single typographic move applied to the
          full wordmark. Use these to A/B against the stamp.
        </p>
      </header>

      <div className="space-y-16">
        {VARIANTS.map(({ key, Component, name, move, blurb, tradeoff }) => (
          <section
            key={key}
            className="overflow-hidden rounded-2xl border border-border/60"
          >
            {/* Header strip */}
            <div className="flex items-baseline justify-between gap-6 border-b border-border/40 bg-card px-10 py-6">
              <div className="flex items-baseline gap-5">
                <span className="font-heading text-3xl text-muted-foreground/70">
                  {key}
                </span>
                <h2 className="font-heading text-2xl font-medium tracking-tight text-foreground">
                  {name}
                </h2>
              </div>
              <p className="hidden text-xs uppercase tracking-[0.2em] text-muted-foreground md:block">
                {move}
              </p>
            </div>

            {/* Hero — wordmark on cream */}
            <div className="flex min-h-[220px] items-center justify-center bg-background px-10 py-16">
              <Component />
            </div>

            {/* Inverted — wordmark on near-black */}
            <div
              className="flex min-h-[120px] items-center justify-center px-10 py-10"
              style={{ backgroundColor: "#0A0A0A" }}
            >
              <span style={{ color: "#FFFAF5" }} className="inline-flex">
                <Component size={36} />
              </span>
            </div>

            {/* Nav-size + rationale */}
            <div className="grid grid-cols-1 gap-8 bg-muted/30 px-10 py-8 md:grid-cols-[200px_1fr]">
              <div className="flex items-center justify-center rounded-lg border border-border/40 bg-background py-6">
                <Component size={20} />
              </div>
              <div className="space-y-3">
                <p className="text-sm leading-relaxed text-foreground">
                  {blurb}
                </p>
                <p className="text-xs italic leading-relaxed text-muted-foreground">
                  Tradeoff: {tradeoff}
                </p>
              </div>
            </div>
          </section>
        ))}
      </div>

      <footer className="mt-20 rounded-xl border border-border/40 bg-muted/40 p-8">
        <p className="text-sm leading-relaxed text-muted-foreground">
          To lock a variant: tell me the letter and I'll wire it into{" "}
          <code className="rounded bg-background px-1.5 py-0.5 text-xs">
            HenriLogo.tsx
          </code>
          , then trace the wordmark to outlines for the favicon,
          apple-icon, and OG image so the renders don't depend on the
          webfont loading.
        </p>
      </footer>
    </div>
  );
}
