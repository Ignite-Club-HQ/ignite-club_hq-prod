import { ArrowLeft, Mail, Flame } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

export default function PrivacyPolicyPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-10 bg-background border-b border-border p-4 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-semibold">Privacy Policy</h1>
      </div>

      <div className="max-w-3xl mx-auto p-6 space-y-8">
        <div className="flex flex-col items-center gap-3">
          <div className="p-3 rounded-2xl bg-primary">
            <Flame className="h-8 w-8 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold">Ignite Club HQ — Privacy Policy</h1>
        </div>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">1. Overview</h2>
          <p className="text-muted-foreground">
            This Privacy Policy explains how Ignite Club HQ ("we", "us", "our") collects, uses, stores, and discloses personal information when you use our Service.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">2. What we collect</h2>
          <p className="text-muted-foreground">We may collect the following types of information:</p>

          <div className="space-y-2">
            <h3 className="text-lg font-medium">2.1 Account and profile information</h3>
            <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-4">
              <li>Name, display name, email, phone number (if provided)</li>
              <li>Profile photo/avatar</li>
              <li>Role(s) (e.g., coach, parent, player, admin)</li>
              <li>Club/team membership and permissions</li>
            </ul>
          </div>

          <div className="space-y-2">
            <h3 className="text-lg font-medium">2.2 Organisation and team information</h3>
            <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-4">
              <li>Club/team details (name, logo, contacts)</li>
              <li>Team lists, fixtures, lineups, positions, attendance</li>
              <li>Communications settings and preferences</li>
            </ul>
          </div>

          <div className="space-y-2">
            <h3 className="text-lg font-medium">2.3 Content you provide</h3>
            <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-4">
              <li>Photos, videos, posts, comments</li>
              <li>Files uploaded to vault/storage</li>
              <li>Messages/chats you send within the Service</li>
            </ul>
          </div>

          <div className="space-y-2">
            <h3 className="text-lg font-medium">2.4 Child-related information (if used)</h3>
            <p className="text-muted-foreground">
              Where enabled by an Organisation, the Service may store information about children such as:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-4">
              <li>Child name/nickname, team association, age group (if provided)</li>
              <li>Attendance, positions, participation notes</li>
              <li>Photos/videos and messages involving children</li>
            </ul>
          </div>

          <div className="space-y-2">
            <h3 className="text-lg font-medium">2.5 Usage and device information</h3>
            <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-4">
              <li>App activity logs (features used, timestamps)</li>
              <li>Device/browser type, IP address, approximate location (derived from IP), identifiers/cookies</li>
              <li>Crash reports and performance metrics</li>
            </ul>
          </div>

          <div className="space-y-2">
            <h3 className="text-lg font-medium">2.6 Payment information</h3>
            <p className="text-muted-foreground">
              Payments are processed by a third-party payment provider (e.g., Stripe). We typically receive:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-4">
              <li>subscription status, plan, billing dates, and limited payment metadata</li>
            </ul>
            <p className="text-muted-foreground">
              We do not store full credit card details on our servers.
            </p>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">3. How we collect information</h2>
          <p className="text-muted-foreground">We collect information:</p>
          <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-4">
            <li>directly from you (forms, uploads, messages)</li>
            <li>from Organisation admins who invite/manage members</li>
            <li>automatically through your use of the Service (logs, cookies)</li>
            <li>from service providers (e.g., payment and identity providers)</li>
          </ul>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">4. How we use personal information</h2>
          <p className="text-muted-foreground">We use personal information to:</p>
          <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-4">
            <li>provide and operate the Service (accounts, clubs, teams, roles)</li>
            <li>enable features like messaging, posts, file storage, and scheduling</li>
            <li>process subscriptions and manage billing</li>
            <li>maintain security, prevent abuse, and enforce Terms</li>
            <li>provide customer support</li>
            <li>improve and develop the Service (analytics, troubleshooting)</li>
            <li>comply with legal obligations</li>
          </ul>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">5. Consent for images and personal information</h2>
          <p className="text-muted-foreground">
            By using the Service, you acknowledge and consent to the storage and processing of your personal information, including:
          </p>
          <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-4">
            <li>Profile photos and avatar images you upload</li>
            <li>Photos, videos, and media you share within clubs and teams</li>
            <li>Personal details such as your name, email address, and contact information</li>
            <li>Activity data, attendance records, and team participation information</li>
          </ul>
          <p className="text-muted-foreground mt-3">
            <strong>Image storage:</strong> All images and media you upload are stored securely on our servers and may be visible to other members of your Organisation based on your sharing settings and role permissions. You consent to this storage and understand that images may remain stored until you or an admin deletes them, or until your account is terminated.
          </p>
          <p className="text-muted-foreground mt-3">
            <strong>Children's information:</strong> Where required, we rely on additional consent for:
          </p>
          <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-4">
            <li>sharing/uploading photos or videos of children</li>
            <li>creating child profiles or storing child-related information</li>
          </ul>
          <p className="text-muted-foreground mt-3">
            Organisation admins are responsible for ensuring they have appropriate authority and consent to create/manage child profiles and share child-related content. Parents/guardians must provide consent for their children's images and personal information to be stored on the platform. We may provide in-app consent tools and takedown processes.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">6. Sharing and disclosure</h2>
          <p className="text-muted-foreground">We may share personal information with:</p>
          <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-4">
            <li>Other users in your Organisation according to roles/permissions (e.g., coaches can see team lists)</li>
            <li>Service providers that help us operate the Service (hosting, storage, analytics, email, customer support, payments)</li>
            <li>Legal/regulated disclosures (law enforcement, court orders, to protect rights/safety)</li>
            <li>Business transfers (if we merge, sell, or restructure)</li>
          </ul>
          <p className="text-muted-foreground font-medium">We do not sell personal information.</p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">7. International data transfers</h2>
          <p className="text-muted-foreground">
            Our service providers may store or process information outside Australia (e.g., in the US or EU). Where this occurs, we take reasonable steps to ensure appropriate safeguards are in place.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">8. Security</h2>
          <p className="text-muted-foreground">
            We take reasonable steps to protect personal information from misuse, loss, unauthorised access, modification, or disclosure, including access controls and secure hosting practices.
          </p>
          <p className="text-muted-foreground">
            No system is 100% secure. You should keep your login secure and notify us if you suspect unauthorised access.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">9. Data retention</h2>
          <p className="text-muted-foreground">
            We retain personal information for as long as needed to provide the Service and for legitimate business or legal purposes.
          </p>
          <p className="text-muted-foreground">
            Organisation admins may be able to delete certain content or accounts. Some records may be retained for backups, audit logs, dispute resolution, or legal compliance.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">10. Your choices and rights</h2>
          <p className="text-muted-foreground">Depending on your circumstances, you may request to:</p>
          <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-4">
            <li>access the personal information we hold about you</li>
            <li>correct inaccurate information</li>
            <li>delete your account or certain content (subject to limits above)</li>
            <li>withdraw consent where processing is based on consent</li>
            <li>opt out of marketing communications (if any)</li>
          </ul>
          <p className="text-muted-foreground">
            To make a request, contact{" "}
            <a href="mailto:contact@igniteclubhq.app" className="text-primary hover:underline">contact@igniteclubhq.app</a>.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">11. Cookies and analytics</h2>
          <p className="text-muted-foreground">We may use cookies/local storage and analytics to:</p>
          <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-4">
            <li>keep you logged in</li>
            <li>remember preferences</li>
            <li>understand usage and improve performance</li>
          </ul>
          <p className="text-muted-foreground">
            You can control cookies through your browser settings, though some features may not work correctly.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">12. Complaints</h2>
          <p className="text-muted-foreground">
            If you have concerns, contact us first at{" "}
            <a href="mailto:contact@igniteclubhq.app" className="text-primary hover:underline">contact@igniteclubhq.app</a>{" "}
            and we'll try to resolve it. You may also contact the Office of the Australian Information Commissioner (OAIC) if you're not satisfied.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">13. Changes to this policy</h2>
          <p className="text-muted-foreground">
            We may update this Privacy Policy from time to time. We'll post updates in-app or on our website.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">14. Contact</h2>
          <p className="text-muted-foreground">
            Privacy enquiries:{" "}
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
