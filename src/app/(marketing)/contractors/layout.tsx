import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Henri. for Contractors — Own Your ZIP, Get Exclusive Leads",
  description:
    "Henri delivers AI-scored building permit leads exclusively to you. One contractor per trade per ZIP. Start your 24-hour free trial.",
  openGraph: {
    title: "Henri. — Own your ZIP. Get the lead before anyone else calls.",
    description:
      "AI-scored permit leads delivered exclusively to you. One contractor per trade per ZIP code. Plans from $149/mo.",
    type: "website",
    url: "https://henri.app/contractors",
  },
};

export default function ContractorsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
