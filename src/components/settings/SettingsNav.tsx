"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";

/**
 * Settings section navigation (desktop sidebar + mobile pill row).
 *
 * Extracted from `(dashboard)/settings/layout.tsx` on 2026-08-04. The
 * layout rendered both navs with a single static className, so all seven
 * items looked identical and inactive on every settings page — and
 * DashboardTopBar's own `isActive` only matches `/dashboard*`, so the
 * top bar highlighted nothing on these routes either. Neither nav
 * indicated location, and no `aria-current` was set.
 *
 * Kept as a small client component rather than converting the whole
 * layout, which otherwise has no client dependencies.
 */

export interface SettingsNavItem {
  href: string;
  label: string;
}

export function SettingsNav({
  items,
  variant,
}: {
  items: readonly SettingsNavItem[];
  variant: "sidebar" | "pills";
}) {
  const pathname = usePathname();

  if (variant === "sidebar") {
    return (
      <nav className="space-y-0.5" aria-label="Settings navigation">
        {items.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "block px-3 py-2 text-sm font-medium rounded-lg transition-colors",
                active
                  ? "bg-primary-08 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <nav
      className="md:hidden shrink-0 flex items-center gap-2 px-4 py-2 border-b border-border bg-card overflow-x-auto scrollbar-none"
      aria-label="Settings navigation"
    >
      {items.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex h-11 shrink-0 items-center whitespace-nowrap px-4 rounded-full border text-sm font-medium transition-colors",
              active
                ? "border-primary bg-primary-08 text-primary"
                : "border-border text-muted-foreground hover:text-foreground hover:bg-accent",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
