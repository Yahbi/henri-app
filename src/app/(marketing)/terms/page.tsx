import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "Terms of Service for Henri, the AI-powered contractor lead generation marketplace.",
  openGraph: {
    title: "Terms of Service — Henri",
    description:
      "Read the Terms of Service governing your use of Henri.",
  },
};

export default function TermsOfServicePage() {
  return (
    <div className="py-16">
      <div className="mx-auto max-w-3xl px-6">
        <h1 className="font-heading font-normal text-4xl tracking-tight text-foreground sm:text-5xl">
          Terms of Service
        </h1>
        <p className="mt-4 text-sm text-muted-foreground">
          Last updated: April 15, 2026
        </p>

        <div className="mt-12 space-y-10 text-foreground/90 leading-relaxed">
          {/* 1. Acceptance */}
          <section>
            <h2 className="font-heading font-normal text-2xl text-foreground">
              1. Acceptance of Terms
            </h2>
            <p className="mt-3">
              By accessing or using the Henri. platform (&quot;Service&quot;), you agree
              to be bound by these Terms of Service (&quot;Terms&quot;). If you do not
              agree, you may not use the Service. Henri reserves the right to
              update these Terms at any time. Continued use of the Service after
              changes constitutes acceptance of the revised Terms.
            </p>
          </section>

          {/* 2. Service Description */}
          <section>
            <h2 className="font-heading font-normal text-2xl text-foreground">
              2. Service Description
            </h2>
            <p className="mt-3">
              Henri is an AI-powered contractor lead generation marketplace. The
              Service connects licensed contractors with homeowners who have
              active or upcoming construction projects, using publicly available
              permit and property data. Henri provides lead delivery,
              territory-based matching, lead scoring, and related tools to help
              contractors grow their businesses.
            </p>
          </section>

          {/* 3. User Types */}
          <section>
            <h2 className="font-heading font-normal text-2xl text-foreground">
              3. User Types and Accounts
            </h2>
            <div className="mt-3 space-y-3">
              <p>
                <strong className="text-foreground">Homeowners</strong> may
                create a free account to access property information, receive
                contractor recommendations, and interact with Henri AI. Homeowner
                accounts do not require a paid subscription.
              </p>
              <p>
                <strong className="text-foreground">Contractors</strong> must
                create a paid subscription account. Contractor accounts require a
                valid contractor license, selection of a subscription plan, valid
                payment information, and selection of one or more ZIP code
                territories.
              </p>
              <p>
                You are responsible for maintaining the confidentiality of your
                account credentials and for all activity under your account.
              </p>
            </div>
          </section>

          {/* 4. Subscription Plans & Pricing */}
          <section>
            <h2 className="font-heading font-normal text-2xl text-foreground">
              4. Subscription Plans and Pricing
            </h2>
            <div className="mt-3 space-y-3">
              <p>Henri offers the following contractor subscription plans:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li>
                  <strong className="text-foreground">Founder</strong> &mdash;
                  $149/month, up to 3 ZIP code territories (Beta, limited to 100
                  subscribers, price locked for the lifetime of the subscription)
                </li>
                <li>
                  <strong className="text-foreground">Starter</strong> &mdash;
                  $749/month, up to 5 ZIP code territories
                </li>
                <li>
                  <strong className="text-foreground">Pro</strong> &mdash;
                  $1,499/month, up to 12 ZIP code territories
                </li>
                <li>
                  <strong className="text-foreground">Enterprise</strong> &mdash;
                  $2,555/month, up to 20 ZIP code territories
                </li>
              </ul>
              <p>
                All plans are billed monthly. Henri reserves the right to change
                pricing for new subscribers at any time. Existing subscribers on
                the Founder plan retain their locked pricing as long as their
                subscription remains active.
              </p>
            </div>
          </section>

          {/* 5. Free Trial */}
          <section>
            <h2 className="font-heading font-normal text-2xl text-foreground">
              5. Free Trial
            </h2>
            <p className="mt-3">
              Henri offers a 24-hour free trial for new contractor accounts. A
              valid credit card is required to start the trial. If you do not
              cancel before the trial period ends, your subscription will
              automatically convert to a paid plan and your card will be charged
              at the applicable monthly rate.
            </p>
          </section>

          {/* 6. No Refunds */}
          <section>
            <h2 className="font-heading font-normal text-2xl text-foreground">
              6. Refund Policy
            </h2>
            <p className="mt-3">
              All subscription fees are non-refundable. Henri is a digital
              product and services are delivered immediately upon subscription
              activation. No partial or prorated refunds will be issued for any
              reason, including unused portions of a billing cycle.
            </p>
          </section>

          {/* 7. Territory */}
          <section>
            <h2 className="font-heading font-normal text-2xl text-foreground">
              7. Territory Selection and Changes
            </h2>
            <div className="mt-3 space-y-3">
              <p>
                Contractors select ZIP code territories during onboarding.
                Territory availability is limited and assigned on a
                first-come, first-served basis.
              </p>
              <p>
                Territory changes take effect at the start of the next billing
                cycle only, and are subject to availability. Henri does not
                guarantee that a requested territory will be available at the
                time of the change request.
              </p>
            </div>
          </section>

          {/* 8. Licensing */}
          <section>
            <h2 className="font-heading font-normal text-2xl text-foreground">
              8. Contractor Licensing Requirements
            </h2>
            <div className="mt-3 space-y-3">
              <p>
                All contractor accounts must maintain a valid, active contractor
                license. License status is verified daily by Henri. If your
                license is found to be expired, revoked, or otherwise invalid,
                lead delivery to your account will be paused immediately until a
                valid license is restored.
              </p>
              <p>
                Henri is not responsible for any business losses resulting from
                paused leads due to invalid licensing.
              </p>
            </div>
          </section>

          {/* 9. Cancellation */}
          <section>
            <h2 className="font-heading font-normal text-2xl text-foreground">
              9. Cancellation
            </h2>
            <p className="mt-3">
              You may cancel your subscription at any time through your account
              dashboard. Cancellation takes effect at the end of the current
              billing cycle. You will continue to have access to the Service
              until the end of your paid period. No refunds or credits will be
              issued for the remaining time in the billing cycle.
            </p>
          </section>

          {/* 10. Data Export */}
          <section>
            <h2 className="font-heading font-normal text-2xl text-foreground">
              10. Data Export Restrictions
            </h2>
            <p className="mt-3">
              CSV export and bulk data download functionality are not available
              on any plan. Lead data and account information are accessible only
              through the Henri dashboard interface. This restriction applies to
              all current and future subscription tiers.
            </p>
          </section>

          {/* 11. Data Usage */}
          <section>
            <h2 className="font-heading font-normal text-2xl text-foreground">
              11. Data Usage
            </h2>
            <div className="mt-3 space-y-3">
              <p>
                Henri collects and processes data to provide and improve the
                Service. This includes account information, usage data, and
                publicly available property and permit records. By using the
                Service, you consent to this data collection and processing.
              </p>
              <p>
                For full details on how your data is collected, used, and
                protected, please refer to our{" "}
                <a href="/privacy" className="text-primary underline underline-offset-2">
                  Privacy Policy
                </a>
                .
              </p>
            </div>
          </section>

          {/* 12. Prohibited Use */}
          <section>
            <h2 className="font-heading font-normal text-2xl text-foreground">
              12. Prohibited Use
            </h2>
            <div className="mt-3 space-y-3">
              <p>You agree not to:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li>
                  Use the Service for any unlawful purpose or in violation of
                  any applicable law or regulation
                </li>
                <li>
                  Attempt to scrape, crawl, or extract data from the Service
                  through automated means
                </li>
                <li>
                  Resell, redistribute, or sublicense lead data or any other
                  information obtained through the Service
                </li>
                <li>
                  Impersonate another person or misrepresent your licensing
                  status
                </li>
                <li>
                  Interfere with or disrupt the integrity or performance of the
                  Service
                </li>
                <li>
                  Attempt to gain unauthorized access to other user accounts or
                  Henri systems
                </li>
              </ul>
            </div>
          </section>

          {/* 13. Intellectual Property */}
          <section>
            <h2 className="font-heading font-normal text-2xl text-foreground">
              13. Intellectual Property
            </h2>
            <p className="mt-3">
              All content, features, and functionality of the Service &mdash;
              including but not limited to text, graphics, logos, algorithms,
              scoring models, and software &mdash; are the exclusive property of
              Henri and are protected by copyright, trademark, and other
              intellectual property laws. You may not copy, modify, or distribute
              any part of the Service without prior written consent.
            </p>
          </section>

          {/* 14. Limitation of Liability */}
          <section>
            <h2 className="font-heading font-normal text-2xl text-foreground">
              14. Limitation of Liability
            </h2>
            <div className="mt-3 space-y-3">
              <p>
                To the maximum extent permitted by law, Henri and its officers,
                directors, employees, and agents shall not be liable for any
                indirect, incidental, special, consequential, or punitive damages
                arising from or related to your use of the Service, including but
                not limited to loss of profits, revenue, data, or business
                opportunities.
              </p>
              <p>
                Henri&apos;s total aggregate liability for any claims arising under
                these Terms shall not exceed the amount you paid to Henri in the
                twelve (12) months preceding the claim.
              </p>
              <p>
                Henri does not guarantee the accuracy, completeness, or
                timeliness of any lead data, property information, or permit
                records provided through the Service. The Service is provided
                &quot;as is&quot; and &quot;as available&quot; without warranties of any kind, whether
                express or implied.
              </p>
            </div>
          </section>

          {/* 15. Indemnification */}
          <section>
            <h2 className="font-heading font-normal text-2xl text-foreground">
              15. Indemnification
            </h2>
            <p className="mt-3">
              You agree to indemnify, defend, and hold harmless Henri and its
              affiliates from any claims, damages, losses, liabilities, costs,
              and expenses (including reasonable attorneys&apos; fees) arising from
              your use of the Service, your violation of these Terms, or your
              violation of any rights of a third party.
            </p>
          </section>

          {/* 16. Dispute Resolution */}
          <section>
            <h2 className="font-heading font-normal text-2xl text-foreground">
              16. Dispute Resolution
            </h2>
            <div className="mt-3 space-y-3">
              <p>
                Any dispute arising from or relating to these Terms or the
                Service shall first be resolved through good-faith negotiation
                between the parties. If the dispute cannot be resolved within
                thirty (30) days, it shall be submitted to binding arbitration
                under the rules of the American Arbitration Association, conducted
                in Los Angeles County, California.
              </p>
              <p>
                You agree to resolve disputes on an individual basis and waive
                any right to participate in a class action lawsuit or class-wide
                arbitration.
              </p>
            </div>
          </section>

          {/* 17. Governing Law */}
          <section>
            <h2 className="font-heading font-normal text-2xl text-foreground">
              17. Governing Law
            </h2>
            <p className="mt-3">
              These Terms shall be governed by and construed in accordance with
              the laws of the State of California, without regard to its conflict
              of law provisions.
            </p>
          </section>

          {/* 18. Termination */}
          <section>
            <h2 className="font-heading font-normal text-2xl text-foreground">
              18. Termination
            </h2>
            <p className="mt-3">
              Henri may suspend or terminate your account at any time, with or
              without cause, and with or without notice. Upon termination, your
              right to access the Service ceases immediately. Sections regarding
              intellectual property, limitation of liability, indemnification,
              dispute resolution, and governing law survive termination.
            </p>
          </section>

          {/* 19. Contact */}
          <section>
            <h2 className="font-heading font-normal text-2xl text-foreground">
              19. Contact
            </h2>
            <p className="mt-3">
              If you have questions about these Terms, please contact us at{" "}
              <a
                href="mailto:legal@meethenri.com"
                className="text-primary underline underline-offset-2"
              >
                legal@meethenri.com
              </a>
              .
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
