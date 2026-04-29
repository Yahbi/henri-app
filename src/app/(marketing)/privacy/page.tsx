import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "Privacy Policy for Henri, the AI-powered contractor lead generation marketplace. Learn how we collect, use, and protect your data.",
  openGraph: {
    title: "Privacy Policy — Henri",
    description:
      "Learn how Henri collects, uses, and protects your personal information.",
  },
};

export default function PrivacyPolicyPage() {
  return (
    <div className="py-16">
      <div className="mx-auto max-w-3xl px-6">
        <h1 className="font-heading font-normal text-4xl tracking-tight text-foreground sm:text-5xl">
          Privacy Policy
        </h1>
        <p className="mt-4 text-sm text-muted-foreground">
          Last updated: April 15, 2026
        </p>

        <div className="mt-12 space-y-10 text-foreground/90 leading-relaxed">
          {/* 1. Introduction */}
          <section>
            <h2 className="font-heading font-normal text-2xl text-foreground">
              1. Introduction
            </h2>
            <p className="mt-3">
              Henri. (&quot;Henri,&quot; &quot;we,&quot; &quot;our,&quot; or &quot;us&quot;) operates an AI-powered
              contractor lead generation marketplace. This Privacy Policy
              explains how we collect, use, disclose, and safeguard your
              information when you use our website and services (collectively,
              the &quot;Service&quot;). By using the Service, you consent to the practices
              described in this policy.
            </p>
          </section>

          {/* 2. Information We Collect */}
          <section>
            <h2 className="font-heading font-normal text-2xl text-foreground">
              2. Information We Collect
            </h2>
            <div className="mt-3 space-y-4">
              <div>
                <h3 className="font-semibold text-foreground">
                  2.1 Account Information
                </h3>
                <p className="mt-2">
                  When you create an account, we collect your name, email address,
                  phone number, and Google account information used for
                  authentication. Contractors additionally provide business name,
                  contractor license number, and billing information (processed
                  securely through our payment provider, Stripe).
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-foreground">
                  2.2 Property and Permit Data
                </h3>
                <p className="mt-2">
                  Henri aggregates property data and building permit information
                  from publicly available government records. This data is used to
                  identify potential construction projects and match homeowners
                  with relevant contractors. This information is sourced from
                  public records and is not considered private or confidential.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-foreground">
                  2.3 Usage Data
                </h3>
                <p className="mt-2">
                  We automatically collect information about how you interact with
                  the Service, including pages visited, features used, time spent
                  on the platform, device information, browser type, IP address,
                  and referring URLs. This data helps us improve the Service and
                  understand usage patterns.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-foreground">
                  2.4 Cookies and Tracking Technologies
                </h3>
                <p className="mt-2">
                  We use cookies, web beacons, and similar technologies to
                  maintain your session, remember your preferences, analyze
                  traffic, and personalize your experience. You can control cookie
                  preferences through your browser settings, though disabling
                  cookies may limit certain functionality.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-foreground">
                  2.5 Communications
                </h3>
                <p className="mt-2">
                  If you contact us directly, we may collect your name, email
                  address, the content of your message, and any attachments you
                  provide. We also retain records of correspondence sent to you,
                  including lead notifications, digest emails, and service
                  announcements.
                </p>
              </div>
            </div>
          </section>

          {/* 3. How We Use Your Information */}
          <section>
            <h2 className="font-heading font-normal text-2xl text-foreground">
              3. How We Use Your Information
            </h2>
            <div className="mt-3 space-y-2">
              <p>We use the information we collect to:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Provide, operate, and maintain the Service</li>
                <li>
                  Match contractors with leads in their selected ZIP code
                  territories
                </li>
                <li>
                  Score and prioritize leads using AI-powered algorithms
                </li>
                <li>
                  Verify and monitor contractor licensing status on a daily basis
                </li>
                <li>Process payments and manage subscriptions</li>
                <li>
                  Send transactional communications such as lead alerts, daily
                  digests, and weekly summaries
                </li>
                <li>
                  Improve and personalize the Service, including AI chat
                  functionality for homeowners
                </li>
                <li>
                  Detect, prevent, and address fraud, abuse, and technical issues
                </li>
                <li>Comply with legal obligations</li>
              </ul>
            </div>
          </section>

          {/* 4. How We Share Your Information */}
          <section>
            <h2 className="font-heading font-normal text-2xl text-foreground">
              4. How We Share Your Information
            </h2>
            <div className="mt-3 space-y-4">
              <div>
                <h3 className="font-semibold text-foreground">
                  4.1 With Contractors (Lead Data)
                </h3>
                <p className="mt-2">
                  Contractors receive lead information only for properties within
                  their selected ZIP code territories. Contractors cannot access
                  lead data outside their assigned territories. Shared information
                  may include property address, project type, permit details, and
                  homeowner contact information where applicable.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-foreground">
                  4.2 Service Providers
                </h3>
                <p className="mt-2">
                  We share information with third-party service providers who
                  perform services on our behalf, including payment processing
                  (Stripe), hosting, analytics, and email delivery. These
                  providers are contractually obligated to use your information
                  only as necessary to provide their services to us.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-foreground">
                  4.3 Legal Requirements
                </h3>
                <p className="mt-2">
                  We may disclose your information if required by law, regulation,
                  legal process, or governmental request, or when we believe
                  disclosure is necessary to protect our rights, your safety, or
                  the safety of others.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-foreground">
                  4.4 Business Transfers
                </h3>
                <p className="mt-2">
                  In the event of a merger, acquisition, reorganization, or sale
                  of assets, your information may be transferred as part of that
                  transaction. We will notify you of any such change in ownership
                  or control of your personal information.
                </p>
              </div>

              <p>
                Henri does not sell your personal information to third parties.
              </p>
            </div>
          </section>

          {/* 5. Data Retention */}
          <section>
            <h2 className="font-heading font-normal text-2xl text-foreground">
              5. Data Retention
            </h2>
            <p className="mt-3">
              We retain your personal information for as long as your account is
              active or as needed to provide the Service. If you cancel your
              subscription or delete your account, we will retain your data for a
              reasonable period to comply with legal obligations, resolve
              disputes, and enforce our agreements. Aggregated and anonymized data
              that cannot be used to identify you may be retained indefinitely for
              analytical purposes.
            </p>
          </section>

          {/* 6. Data Security */}
          <section>
            <h2 className="font-heading font-normal text-2xl text-foreground">
              6. Data Security
            </h2>
            <p className="mt-3">
              We implement industry-standard technical and organizational
              measures to protect your information against unauthorized access,
              alteration, disclosure, or destruction. These include encryption in
              transit and at rest, access controls, and regular security
              assessments. However, no method of electronic transmission or
              storage is 100% secure, and we cannot guarantee absolute security.
            </p>
          </section>

          {/* 7. Your Rights */}
          <section>
            <h2 className="font-heading font-normal text-2xl text-foreground">
              7. Your Rights
            </h2>
            <div className="mt-3 space-y-2">
              <p>
                Depending on your jurisdiction, you may have the following rights
                regarding your personal information:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li>
                  <strong className="text-foreground">Access</strong> &mdash;
                  Request a copy of the personal information we hold about you
                </li>
                <li>
                  <strong className="text-foreground">Correction</strong> &mdash;
                  Request correction of inaccurate or incomplete information
                </li>
                <li>
                  <strong className="text-foreground">Deletion</strong> &mdash;
                  Request deletion of your personal information, subject to
                  legal retention requirements
                </li>
                <li>
                  <strong className="text-foreground">Portability</strong> &mdash;
                  Request your data in a structured, machine-readable format
                </li>
                <li>
                  <strong className="text-foreground">Opt-out</strong> &mdash;
                  Opt out of non-essential communications at any time
                </li>
              </ul>
              <p className="mt-3">
                To exercise any of these rights, contact us at{" "}
                <a
                  href="mailto:privacy@meethenri.com"
                  className="text-[#D4886A] underline underline-offset-2"
                >
                  privacy@meethenri.com
                </a>
                . We will respond to your request within 30 days.
              </p>
            </div>
          </section>

          {/* 8. California Privacy Rights */}
          <section>
            <h2 className="font-heading font-normal text-2xl text-foreground">
              8. California Privacy Rights (CCPA)
            </h2>
            <div className="mt-3 space-y-3">
              <p>
                If you are a California resident, you have additional rights
                under the California Consumer Privacy Act (CCPA):
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li>
                  <strong className="text-foreground">Right to Know</strong>{" "}
                  &mdash; You may request that we disclose the categories and
                  specific pieces of personal information we have collected about
                  you, the sources of that information, our business purpose for
                  collecting it, and the categories of third parties with whom we
                  share it.
                </li>
                <li>
                  <strong className="text-foreground">Right to Delete</strong>{" "}
                  &mdash; You may request that we delete the personal information
                  we have collected from you, subject to certain exceptions.
                </li>
                <li>
                  <strong className="text-foreground">
                    Right to Non-Discrimination
                  </strong>{" "}
                  &mdash; We will not discriminate against you for exercising
                  your CCPA rights. You will not receive different pricing or
                  quality of service for making a request.
                </li>
                <li>
                  <strong className="text-foreground">
                    No Sale of Personal Information
                  </strong>{" "}
                  &mdash; Henri does not sell personal information as defined
                  under the CCPA.
                </li>
              </ul>
              <p>
                To submit a CCPA request, email us at{" "}
                <a
                  href="mailto:privacy@meethenri.com"
                  className="text-[#D4886A] underline underline-offset-2"
                >
                  privacy@meethenri.com
                </a>{" "}
                with the subject line &quot;CCPA Request.&quot;
              </p>
            </div>
          </section>

          {/* 9. Children's Privacy */}
          <section>
            <h2 className="font-heading font-normal text-2xl text-foreground">
              9. Children&apos;s Privacy
            </h2>
            <p className="mt-3">
              The Service is not intended for individuals under the age of 18. We
              do not knowingly collect personal information from children. If we
              become aware that we have collected information from a child under
              18, we will take steps to delete that information promptly.
            </p>
          </section>

          {/* 10. Third-Party Links */}
          <section>
            <h2 className="font-heading font-normal text-2xl text-foreground">
              10. Third-Party Links
            </h2>
            <p className="mt-3">
              The Service may contain links to third-party websites or services
              that are not operated by Henri. We are not responsible for the
              privacy practices of these third parties. We encourage you to
              review the privacy policies of any third-party site you visit.
            </p>
          </section>

          {/* 11. Changes */}
          <section>
            <h2 className="font-heading font-normal text-2xl text-foreground">
              11. Changes to This Policy
            </h2>
            <p className="mt-3">
              We may update this Privacy Policy from time to time. When we make
              material changes, we will notify you by posting the updated policy
              on the Service with a revised &quot;Last updated&quot; date. Your continued
              use of the Service after any changes indicates your acceptance of
              the updated policy.
            </p>
          </section>

          {/* 12. Contact */}
          <section>
            <h2 className="font-heading font-normal text-2xl text-foreground">
              12. Contact Us
            </h2>
            <p className="mt-3">
              If you have questions or concerns about this Privacy Policy or our
              data practices, please contact us at{" "}
              <a
                href="mailto:privacy@meethenri.com"
                className="text-[#D4886A] underline underline-offset-2"
              >
                privacy@meethenri.com
              </a>
              .
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
