import Link from "next/link";
import type { ReactNode } from "react";

const NAV_ITEMS = [
  { href: "/settings/account", label: "Account" },
  { href: "/settings/territories", label: "Territories" },
  { href: "/settings/capacity", label: "Capacity" },
  { href: "/settings/notifications", label: "Notifications" },
  { href: "/settings/billing", label: "Billing" },
  { href: "/settings/referrals", label: "Referrals" },
  { href: "/settings/interviews", label: "Interviews" },
];

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
      {/* Sidebar — desktop only; mobile gets the pill row below. */}
      <aside className="hidden md:block w-48 shrink-0 border-r border-border bg-card">
        <div className="px-4 py-5">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Settings
          </p>
          <nav className="space-y-0.5" aria-label="Settings navigation">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="block px-3 py-2 text-sm font-medium rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </aside>

      {/* Mobile section nav — horizontal scrollable pill row above the
       * content, replacing the sidebar below md. */}
      <nav
        className="md:hidden shrink-0 flex items-center gap-2 px-4 py-2 border-b border-border bg-card overflow-x-auto scrollbar-none"
        aria-label="Settings navigation"
      >
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="inline-flex h-11 shrink-0 items-center whitespace-nowrap px-4 rounded-full border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
