import { ArrowLeft, Mail, Flame } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

export default function CancellationPolicyPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-10 bg-background border-b border-border p-4 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-semibold">Refund & Cancellation Policy</h1>
      </div>

      <div className="max-w-3xl mx-auto p-6 space-y-8">
        <div className="flex flex-col items-center gap-3">
          <div className="p-3 rounded-2xl bg-primary">
            <Flame className="h-8 w-8 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold">Ignite Club HQ — Refund & Cancellation Policy</h1>
        </div>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">1. Overview</h2>
          <p className="text-muted-foreground">
            This Refund & Cancellation Policy explains how subscriptions and payments work for Ignite Club HQ ("Service", "we", "us", "our"). By subscribing to a paid plan, you agree to the terms outlined below.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">2. Subscription Plans</h2>
          <p className="text-muted-foreground">
            Ignite Club HQ offers monthly and annual subscription plans. Plan details, pricing, and included features are displayed in-app and on our website. We reserve the right to modify pricing or features with reasonable notice.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">3. Free Trials</h2>
          <p className="text-muted-foreground">
            We may offer free trials for new subscribers. During the trial period, you can access premium features at no cost. If you do not cancel before the trial ends, your subscription will automatically convert to a paid plan and you will be charged the applicable fee.
          </p>
          <p className="text-muted-foreground">
            You can cancel your trial at any time through your account settings before the trial period ends to avoid being charged.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">4. Cancellation Policy</h2>
          
          <div className="space-y-2">
            <h3 className="text-lg font-medium">4.1 How to Cancel</h3>
            <p className="text-muted-foreground">You can cancel your subscription at any time by:</p>
            <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-4">
              <li>Accessing your account settings within the app</li>
              <li>Contacting us at{" "}
                <a href="mailto:support@igniteclubhq.app" className="text-primary hover:underline">support@igniteclubhq.app</a>
              </li>
            </ul>
          </div>

          <div className="space-y-2">
            <h3 className="text-lg font-medium">4.2 Effect of Cancellation</h3>
            <p className="text-muted-foreground">When you cancel your subscription:</p>
            <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-4">
              <li>Your subscription remains active until the end of the current billing period</li>
              <li>You will continue to have access to premium features until that date</li>
              <li>No further charges will be made after the current period ends</li>
              <li>Your account will revert to the free plan (if available) or become inactive</li>
            </ul>
          </div>

          <div className="space-y-2">
            <h3 className="text-lg font-medium">4.3 Data Retention</h3>
            <p className="text-muted-foreground">
              After cancellation, your data will be retained in accordance with our{" "}
              <a href="/privacy" className="text-primary hover:underline">Privacy Policy</a>. 
              You may request deletion of your data by contacting us.
            </p>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">5. Refund Policy</h2>
          
          <div className="space-y-2">
            <h3 className="text-lg font-medium">5.1 General Policy</h3>
            <p className="text-muted-foreground">
              Except where required under the Australian Consumer Law, subscription fees are generally non-refundable. This is because digital services are provided immediately upon payment.
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="text-lg font-medium">5.2 Refund Eligibility</h3>
            <p className="text-muted-foreground">We may consider refund requests in the following circumstances:</p>
            <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-4">
              <li>Duplicate or accidental charges</li>
              <li>Technical issues preventing access to paid features for an extended period</li>
              <li>Billing errors on our part</li>
              <li>As required under the Australian Consumer Law</li>
            </ul>
          </div>

          <div className="space-y-2">
            <h3 className="text-lg font-medium">5.3 How to Request a Refund</h3>
            <p className="text-muted-foreground">
              To request a refund, please contact us at{" "}
              <a href="mailto:support@igniteclubhq.app" className="text-primary hover:underline">support@igniteclubhq.app</a> with:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-4">
              <li>Your account email address</li>
              <li>Date of the charge in question</li>
              <li>Reason for the refund request</li>
              <li>Any relevant supporting information</li>
            </ul>
            <p className="text-muted-foreground">
              We aim to respond to refund requests within 5 business days. Approved refunds will be processed to the original payment method within 10 business days.
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="text-lg font-medium">5.4 Pro-Rata Refunds</h3>
            <p className="text-muted-foreground">
              We do not offer pro-rata refunds for partial months or unused portions of subscription periods. When you cancel, you retain access until the end of your current billing cycle.
            </p>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">6. Australian Consumer Law</h2>
          <p className="text-muted-foreground">
            Nothing in this policy excludes, restricts, or modifies any consumer rights under the Australian Consumer Law (ACL) in the Competition and Consumer Act 2010 (Cth).
          </p>
          <p className="text-muted-foreground">Under the ACL, you are entitled to a refund or replacement if the service:</p>
          <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-4">
            <li>Has a major problem that cannot be fixed</li>
            <li>Is substantially unfit for its intended purpose</li>
            <li>Does not match its description</li>
          </ul>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">7. Changes to Subscriptions</h2>
          
          <div className="space-y-2">
            <h3 className="text-lg font-medium">7.1 Upgrading</h3>
            <p className="text-muted-foreground">
              If you upgrade your subscription plan, the new rate will apply immediately or from your next billing cycle, depending on the plan structure. Any price difference may be charged immediately or pro-rated.
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="text-lg font-medium">7.2 Downgrading</h3>
            <p className="text-muted-foreground">
              If you downgrade your subscription, the change will take effect at the start of your next billing cycle. You will retain access to your current plan features until then.
            </p>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">8. Failed Payments</h2>
          <p className="text-muted-foreground">If a payment fails, we may:</p>
          <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-4">
            <li>Retry the payment within a reasonable period</li>
            <li>Notify you via email and request updated payment information</li>
            <li>Suspend or downgrade your account if payment is not received</li>
          </ul>
          <p className="text-muted-foreground">
            We will make reasonable efforts to contact you before taking any action that affects your access to the Service.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">9. Contact Us</h2>
          <p className="text-muted-foreground">For questions about this policy or to request a refund:</p>
          <p className="text-muted-foreground">
            Email:{" "}
            <a href="mailto:support@igniteclubhq.app" className="text-primary hover:underline inline-flex items-center gap-1">
              <Mail className="h-4 w-4" />
              support@igniteclubhq.app
            </a>
          </p>
          <p className="text-muted-foreground">
            General inquiries:{" "}
            <a href="mailto:contact@igniteclubhq.app" className="text-primary hover:underline inline-flex items-center gap-1">
              <Mail className="h-4 w-4" />
              contact@igniteclubhq.app
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