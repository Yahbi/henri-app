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
      {/* Centered auth card */}
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        {children}
      </div>
      {/* Footer — legal links must be reachable on /login + /signup per
          Stripe/Google OAuth policy. */}
      <Footer />
    </div>
  );
}
