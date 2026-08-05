"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";

/**
 * Universal marketing nav — mounted by `src/app/(marketing)/layout.tsx` so
 * every pre-auth page (`/`, `/pricing`, `/contractors`, `/portal`, `/terms`,
 * `/privacy`, `/acceptable-use`) gets a consistent top bar with:
 *
 *   [Henri.]   How it works · Pricing · For contractors · For homeowners   [Sign in] [Primary CTA]
 *
 * Primary CTA adapts to the current path — on `/portal` it's "Get matched
 * free" (homeowner signup); everywhere else it's "Start free trial"
 * (contractor signup). Replaces the per-page `ContractorNav` + `PortalNav`
 * (both deleted as part of gap audit item G1).
 *
 * Mobile: below md the center link group is hidden and replaced with a
 * hamburger that opens a full-width drawer — plugs gap G7.
 */

const CENTER_LINKS = [
  { href: "/contractors#how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
  { href: "/contractors", label: "For contractors" },
  { href: "/portal", label: "For homeowners" },
] as const;

export function MarketingNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the drawer whenever the route changes.
  useEffect(() => {
    // Reset drawer state on route change; not derivable since it's user-controlled
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(false);
  }, [pathname]);

  // Lock body scroll while the mobile drawer is open.
  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [open]);

  // Escape closes the drawer. It renders with role="dialog" and locks body
  // scroll, so a keyboard user previously had no way out except tabbing to
  // the hamburger — Escape is the expected exit for anything dialog-shaped.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const isHomeownerSurface =
    pathname?.startsWith("/portal") || pathname?.startsWith("/homeowner");

  const primaryCta = isHomeownerSurface
    ? { href: "/signup?role=homeowner", label: "Get matched free" }
    : { href: "/signup?role=contractor", label: "Start free trial" };

  return (
    <>
      <nav
        className="fixed inset-x-0 top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-md"
        aria-label="Primary"
      >
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
          <Link
            href="/"
            className="font-heading text-xl font-medium tracking-tight text-primary"
          >
            Henri.
          </Link>

          <div className="hidden items-center gap-6 md:flex">
            {CENTER_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {link.label}
              </Link>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden md:block">
              <ThemeSwitcher />
            </div>
            <Link
              href="/login"
              className="hidden text-sm font-medium text-muted-foreground transition-colors hover:text-foreground md:inline"
            >
              Sign in
            </Link>
            {/* Primary CTA. Height bumped from py-2 (36px) → h-11 (44px)
             * on 2026-04-23 to meet WCAG 2.5.5 / iOS HIG minimum touch
             * target. inline-flex + items-center keeps the text vertically
             * centred at the taller height; the nav bar itself is h-14
             * (56px) so there's still 6px of clearance top + bottom. */}
            <Link
              href={primaryCta.href}
              className="hidden h-11 items-center justify-center rounded-lg bg-cta px-5 text-sm font-semibold text-cta-foreground transition-opacity hover:opacity-90 md:inline-flex"
            >
              {primaryCta.label}
            </Link>

            {/* Hamburger — bumped h-9 → h-11 for the same touch-target
             * reason. Primary mobile affordance for the nav; if it's hard
             * to hit the whole mobile nav is gated behind it. */}
            <button
              type="button"
              aria-label={open ? "Close navigation menu" : "Open navigation menu"}
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
            >
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile drawer */}
      {open && (
        <div
          className="fixed inset-x-0 top-14 z-40 flex flex-col gap-2 border-b border-border/40 bg-background px-6 py-4 md:hidden"
          role="dialog"
          aria-label="Mobile navigation"
        >
          {CENTER_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-2 py-2 text-base font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
          <div className="my-2 h-px bg-border" />
          <Link
            href="/login"
            className="rounded-md px-2 py-2 text-base font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Sign in
          </Link>
          <Link
            href={primaryCta.href}
            className="flex h-11 items-center justify-center rounded-lg bg-cta px-4 text-center text-base font-semibold text-cta-foreground transition-opacity hover:opacity-90"
          >
            {primaryCta.label}
          </Link>
          <div className="mt-2 flex justify-end">
            <ThemeSwitcher />
          </div>
        </div>
      )}
    </>
  );
}
