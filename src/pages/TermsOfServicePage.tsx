import { ArrowLeft, Mail, Flame } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

export default function TermsOfServicePage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-10 bg-background border-b border-border p-4 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-semibold">Terms of Service</h1>
      </div>

      <div className="max-w-3xl mx-auto p-6 space-y-8">
        <div className="flex flex-col items-center gap-3">
          <div className="p-3 rounded-2xl bg-primary">
            <Flame className="h-8 w-8 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold">Ignite Club HQ — Terms of Service</h1>
        </div>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">1. About these Terms</h2>
          <p className="text-muted-foreground">
            These Terms of Service ("Terms") govern your access to and use of the Ignite Club HQ application, website, and related services ("Service", "we", "us", "our"). By accessing or using the Service, you agree to these Terms.
          </p>
          <p className="text-muted-foreground">If you do not agree, do not use the Service.</p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">2. Who can use the Service</h2>
          <p className="text-muted-foreground">
            You must be able to form a legally binding contract under Australian law to use the Service.
          </p>
          <p className="text-muted-foreground">
            If you are under 18, you may only use the Service with the consent and supervision of a parent/guardian and/or as authorised by your club/team.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">3. Accounts, roles, and organisations</h2>
          
          <div className="space-y-2">
            <h3 className="text-lg font-medium">3.1 Accounts</h3>
            <p className="text-muted-foreground">
              You may need an account to use parts of the Service. You agree to provide accurate information and keep it up to date.
            </p>
            <p className="text-muted-foreground">
              You are responsible for maintaining the confidentiality of your login and for all activity under your account.
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="text-lg font-medium">3.2 Clubs and teams ("Organisations")</h3>
            <p className="text-muted-foreground">
              The Service supports clubs, teams, and other sporting organisations ("Organisations"). An Organisation may have administrators (e.g., Club Admins, Team Admins, Coaches) who can manage members, roles, content, and settings.
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="text-lg font-medium">3.3 Admin responsibilities</h3>
            <p className="text-muted-foreground">If you are an Organisation admin, you agree to:</p>
            <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-4">
              <li>only invite and manage members you are authorised to manage</li>
              <li>obtain any required consents (including from parents/guardians for children)</li>
              <li>ensure content you upload or share is lawful and appropriate</li>
              <li>respond to member requests and issues where relevant (e.g., roster changes, role changes)</li>
            </ul>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">4. Subscriptions, trials, and payments</h2>
          
          <div className="space-y-2">
            <h3 className="text-lg font-medium">4.1 Plans</h3>
            <p className="text-muted-foreground">
              Some features may require a paid subscription. Plan details (pricing, included features, limits) are shown in-app or on our website and may change over time.
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="text-lg font-medium">4.2 Billing and renewals</h3>
            <p className="text-muted-foreground">
              If you purchase a subscription, you authorise us (and our payment provider) to charge the applicable fees on a recurring basis until cancelled.
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="text-lg font-medium">4.3 Cancellation</h3>
            <p className="text-muted-foreground">
              You can cancel at any time through your account settings or by contacting us. Unless required by law, cancellations take effect at the end of the current billing period.
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="text-lg font-medium">4.4 Refunds</h3>
            <p className="text-muted-foreground">
              Except where required under the Australian Consumer Law, fees are non-refundable. If you believe you were charged incorrectly, contact us at{" "}
              <a href="mailto:contact@igniteclubhq.app" className="text-primary hover:underline">contact@igniteclubhq.app</a>.
            </p>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">5. User content (photos, posts, files, messages)</h2>
          
          <div className="space-y-2">
            <h3 className="text-lg font-medium">5.1 Your content</h3>
            <p className="text-muted-foreground">
              You may be able to upload or post content such as photos, videos, comments, documents, team lists, and messages ("User Content").
            </p>
            <p className="text-muted-foreground">
              You retain ownership of your User Content. You grant us a worldwide, non-exclusive, royalty-free licence to host, store, reproduce, modify (for formatting/technical purposes), display, and distribute your User Content solely to operate, provide, and improve the Service and as directed by your settings and sharing choices.
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="text-lg font-medium">5.2 Consent to image and data storage</h3>
            <p className="text-muted-foreground">
              By uploading images, photos, videos, or other media to the Service, you expressly consent to:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-4">
              <li>The storage of such content on our servers and third-party hosting providers</li>
              <li>The display of such content to other members of your Organisation based on sharing settings</li>
              <li>The retention of such content until you delete it or your account is terminated</li>
            </ul>
            <p className="text-muted-foreground mt-2">
              By providing personal information (including your name, email, profile photo, and other identifiable information), you consent to the collection, storage, and processing of this personally identifiable information (PII) as described in our Privacy Policy.
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="text-lg font-medium">5.3 Permissions and consents for others</h3>
            <p className="text-muted-foreground">
              You confirm you have the rights and permissions to upload and share User Content, including any required consents from parents/guardians for children. When uploading images that include other individuals, you confirm you have obtained their consent (or parental consent for minors) for their image to be stored and shared on the platform.
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="text-lg font-medium">5.4 Content moderation</h3>
            <p className="text-muted-foreground">
              We may (but are not required to) monitor, remove, or restrict User Content that violates these Terms or is otherwise harmful, unlawful, or inappropriate.
            </p>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">6. Acceptable use</h2>
          <p className="text-muted-foreground">You agree not to:</p>
          <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-4">
            <li>break any law or infringe rights (privacy, copyright, etc.)</li>
            <li>upload or share content that is abusive, harassing, hateful, pornographic, or exploitative</li>
            <li>share personal information of others without permission</li>
            <li>attempt to gain unauthorised access to accounts or systems</li>
            <li>interfere with the Service, introduce malware, scrape data, or reverse engineer where prohibited by law</li>
            <li>use the Service to send spam or unsolicited promotions</li>
          </ul>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">7. Children and safeguarding</h2>
          <p className="text-muted-foreground">
            Ignite Club HQ may support child profiles, attendance, team communications, and photos. You agree to use these features responsibly and in compliance with club policies and applicable laws.
          </p>
          <p className="text-muted-foreground">
            We may require additional safeguards (e.g., consent flows, restricted visibility, takedown processes) and may change these safeguards at any time.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">8. Third-party services</h2>
          <p className="text-muted-foreground">
            The Service may integrate with third parties (e.g., payment processors, hosting, analytics, identity providers). Your use of third-party services may be subject to their terms and privacy policies.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">9. Availability and changes</h2>
          <p className="text-muted-foreground">
            We aim to provide a reliable Service but do not guarantee uninterrupted availability. We may modify, suspend, or discontinue parts of the Service at any time.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">10. Disclaimer</h2>
          <p className="text-muted-foreground">
            The Service is provided "as is" and "as available". To the extent permitted by law, we disclaim warranties of merchantability, fitness for a particular purpose, and non-infringement.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">11. Limitation of liability</h2>
          <p className="text-muted-foreground">
            To the extent permitted by law, we are not liable for indirect, incidental, special, consequential, or punitive damages, or any loss of profits, revenue, data, or goodwill.
          </p>
          <p className="text-muted-foreground">
            Where liability cannot be excluded under Australian law, our liability is limited (at our option) to resupplying the Service or paying the cost of having the Service supplied again.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">12. Indemnity</h2>
          <p className="text-muted-foreground">
            You agree to indemnify us for losses, claims, and expenses arising out of your use of the Service, your User Content, or your breach of these Terms.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">13. Termination</h2>
          <p className="text-muted-foreground">
            You may stop using the Service at any time. We may suspend or terminate your access if you breach these Terms or if we reasonably believe it's necessary to protect the Service, users, or third parties.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">14. Privacy</h2>
          <p className="text-muted-foreground">
            Your use of the Service is also governed by our{" "}
            <a href="/privacy" className="text-primary hover:underline">Privacy Policy</a>.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">15. Governing law</h2>
          <p className="text-muted-foreground">
            These Terms are governed by the laws of South Australia, Australia (or Australia generally). Courts in that jurisdiction have exclusive jurisdiction.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">16. Contact</h2>
          <p className="text-muted-foreground">
            Questions or notices:{" "}
            <a href="mailto:contact@igniteclubhq.app" className="text-primary hover:underline inline-flex items-center gap-1">
              <Mail className="h-4 w-4" />
              contact@igniteclubhq.app
            </a>
          </p>
          <p className="text-muted-foreground">
            Support:{" "}
            <a href="mailto:support@igniteclubhq.app" className="text-primary hover:underline inline-flex items-center gap-1">
              <Mail className="h-4 w-4" />
              support@igniteclubhq.app
            </a>
          </p>
        </section>

        <div className="pt-8 border-t border-border text-center text-sm text-muted-foreground">
          <p>Last updated: December 2025</p>
        </div>
      </div>
    </div>
  );
}
