import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  // Root layout applies template "%s | Henri." so the bare title here
  // composes to "Acceptable Use Policy | Henri." (no duplicated suffix).
  title: "Acceptable Use Policy",
  description:
    "The behaviors Henri. prohibits on the platform, and the enforcement process when they occur.",
};

/**
 * Acceptable Use Policy.
 *
 * Required for Stripe subscription approval and Google OAuth consent
 * screen review. Plain, enforceable copy — enumerates the short list
 * of behaviors that get an account suspended, and the escalation path.
 */
export default function AcceptableUsePage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <div className="mb-8">
        <Link
          href="/"
          className="font-heading text-2xl font-normal tracking-tight text-primary"
        >
          Henri.
        </Link>
      </div>

      <h1 className="font-heading text-3xl font-normal tracking-tight text-foreground">
        Acceptable Use Policy
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Last updated: April 20, 2026
      </p>

      <section className="prose prose-sm mt-8 max-w-none text-foreground">
        <p>
          Henri. (&ldquo;we,&rdquo; &ldquo;the Service&rdquo;) is used by
          licensed contractors and homeowners to connect on home-service
          projects. This policy describes what you may and may not do on the
          platform. It applies to everyone with a Henri. account regardless
          of plan tier.
        </p>

        <h2 className="mt-8 text-xl font-semibold">Prohibited uses</h2>
        <p>You may not use Henri. to:</p>
        <ul className="list-disc pl-6">
          <li>
            Perform contracting work without a valid license in the
            jurisdiction where the work is done. Licensure is verified
            daily; leads pause automatically if your license lapses.
          </li>
          <li>
            Contact homeowners outside the Henri. platform using data you
            obtained through Henri. after they have asked you to stop, or
            for purposes unrelated to the project associated with the lead.
          </li>
          <li>
            Resell, redistribute, or republish lead data, permit data, or
            homeowner contact information to any third party. Your
            subscription gives you access for your own business only.
          </li>
          <li>
            Scrape, bulk-download, or reverse-engineer the Service, its
            APIs, or its data feeds. Automated requests must go through
            documented endpoints.
          </li>
          <li>
            Send unsolicited bulk SMS or email outside the platform using
            contact data obtained here. All platform-originated outreach
            must comply with TCPA, CAN-SPAM, and state-level equivalents.
          </li>
          <li>
            Misrepresent your identity, license status, company name, or
            service area to homeowners or other contractors.
          </li>
          <li>
            Use the Service in any way that violates applicable law,
            including but not limited to consumer protection, licensing,
            fair housing, or anti-discrimination statutes.
          </li>
          <li>
            Interfere with or disrupt the Service&rsquo;s infrastructure,
            probe for security vulnerabilities without prior written
            permission, or attempt to access accounts you do not own.
          </li>
        </ul>

        <h2 className="mt-8 text-xl font-semibold">Data handling</h2>
        <p>
          Permit data is public record. Homeowner contact information
          (phone, email) is not — it is collected under a limited-use
          license from the homeowner themselves for the purpose of
          connecting them with a qualified contractor on a specific
          project. Treat it accordingly.
        </p>

        <h2 className="mt-8 text-xl font-semibold">Enforcement</h2>
        <p>
          We may, at our discretion, pause lead generation, suspend
          account access, terminate your subscription, or take any other
          action reasonably necessary to protect the Service and its
          users, including referring conduct to law enforcement where
          warranted. For most violations we will notify you first and give
          you a reasonable window to cure. For severe or repeated
          violations we may act without notice.
        </p>
        <p>
          If your account is terminated for cause, no refund is issued
          (consistent with our general no-refund policy — see the{" "}
          <Link href="/terms" className="text-primary hover:underline">
            Terms of Service
          </Link>
          ).
        </p>

        <h2 className="mt-8 text-xl font-semibold">Reporting abuse</h2>
        <p>
          If you believe another user is violating this policy, email
          abuse at this domain with the account name and a description of
          the behavior. We review every report.
        </p>

        <h2 className="mt-8 text-xl font-semibold">Changes</h2>
        <p>
          We may update this policy as the platform evolves. Material
          changes take effect 30 days after we post them on this page.
        </p>
      </section>

      <div className="mt-12 flex gap-4 text-sm text-muted-foreground">
        <Link href="/terms" className="hover:text-foreground">
          Terms
        </Link>
        <Link href="/privacy" className="hover:text-foreground">
          Privacy
        </Link>
      </div>
    </main>
  );
}
