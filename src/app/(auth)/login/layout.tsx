import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  // Root layout applies template "%s | Henri." — leave the bare title here
  // so it composes to "Sign in | Henri." without a duplicated suffix.
  title: "Sign in",
  description:
    "Sign in to Henri — permit intelligence and lead generation for contractors.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#D4886A",
};

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
