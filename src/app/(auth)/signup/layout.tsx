import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  // Root layout applies template "%s | Henri." — leave the bare title here
  // so it composes to "Create your account | Henri." without duplication.
  title: "Create your account",
  description:
    "Create your Henri account. Contractors get permit-scored leads; homeowners get matched with verified pros.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#D4886A",
};

export default function SignupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
