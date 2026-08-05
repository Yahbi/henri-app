import { Footer } from "@/components/marketing/Footer";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen flex-col bg-background">
      {/* Subtle gradient background */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background: [
            "radial-gradient(ellipse 50% 50% at 50% 0%, hsl(var(--primary) / 0.05) 0%, transparent 60%)",
            "radial-gradient(ellipse 40% 40% at 80% 100%, hsl(var(--accent) / 0.04) 0%, transparent 60%)",
          ].join(", "),
        }}
      />
      {/* Centered auth card. A <main> rather than a <div>: this is the page's
        * main landmark, and the auth layout previously had none at all, so
        * the global skip-to-content link had nothing to target on /login and
        * /signup (see the note in (dashboard)/layout.tsx). */}
      <main
        id="main-content"
        tabIndex={-1}
        className="flex flex-1 items-center justify-center px-4 py-12"
      >
        {children}
      </main>
      {/* Footer — legal links must be reachable on /login + /signup per
          Stripe/Google OAuth policy. */}
      <Footer />
    </div>
  );
}
