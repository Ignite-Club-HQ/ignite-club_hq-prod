import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { verifyStripeSignature } from "../_shared/stripeSignature.ts";


// Auto-cancel + refund a Stripe subscription that has no matching DB row.
// This is the safety net that guarantees a club never gets charged again
// after a downgrade/delete, even if the original cancel path failed.
async function autoCancelOrphanSubscription(
  supabase: any,
  subscriptionId: string,
  invoice: any,
) {
  try {
    // Resolve a Stripe secret key. We don't know which club the orphan
    // belonged to, so fall back to app-level config.
    const { data: appCfg } = await supabase
      .from("app_stripe_config")
      .select("stripe_secret_key, is_enabled")
      .eq("is_enabled", true)
      .maybeSingle();

    let key: string | null = appCfg?.stripe_secret_key ?? null;
    if (!key) {
      // Last resort — try any enabled club_stripe_configs row. Connect accounts
      // are scoped per-club so this won't always work, which is why we still
      // raise the admin_alert below.
      const { data: anyClubCfg } = await supabase
        .from("club_stripe_configs")
        .select("stripe_secret_key")
        .eq("is_enabled", true)
        .limit(1)
        .maybeSingle();
      key = anyClubCfg?.stripe_secret_key ?? null;
    }

    if (!key) {
      console.warn("Orphan auto-cancel skipped — no Stripe secret key available");
      return { cancelled: false, refunded: false, reason: "no_stripe_key" };
    }

    const stripe = new Stripe(key, { apiVersion: "2023-10-16" });

    let cancelled = false;
    try {
      await stripe.subscriptions.cancel(subscriptionId);
      cancelled = true;
      console.log("Orphan Stripe subscription auto-cancelled:", subscriptionId);
    } catch (err: any) {
      if (err?.code === "resource_missing") {
        cancelled = true; // already gone
      } else {
        console.error("Orphan auto-cancel failed:", subscriptionId, err);
      }
    }

    // Refund the just-charged invoice so the customer is made whole.
    let refunded = false;
    if (invoice?.charge) {
      try {
        await stripe.refunds.create({ charge: invoice.charge, reason: "duplicate" });
        refunded = true;
        console.log("Orphan invoice auto-refunded:", invoice.id);
      } catch (err: any) {
        console.error("Orphan refund failed:", invoice.id, err);
      }
    }

    return { cancelled, refunded };
  } catch (err) {
    console.error("autoCancelOrphanSubscription unexpected error:", err);
    return { cancelled: false, refunded: false, reason: "exception" };
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
};

/** Best-effort extraction of the Stripe object id for support diagnostics. */
function stripeObjectId(event: any): string | null {
  const obj = event?.data?.object;
  return typeof obj?.id === "string" ? obj.id : null;
}

/** Stripe event creation time (seconds) → ISO string, for out-of-order safety. */
function stripeEventAt(event: any): string | null {
  const created = event?.created;
  if (typeof created !== "number" || !Number.isFinite(created)) return null;
  return new Date(created * 1000).toISOString();
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // ---------------------------------------------------------------------
  // SECURITY GATE — everything below must happen BEFORE we create a
  // service-role Supabase client or touch the database in any way.
  // ---------------------------------------------------------------------
  const signature = req.headers.get("stripe-signature");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const body = await req.text();

  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET not configured — rejecting all webhook requests");
    return new Response(
      JSON.stringify({ error: "Webhook not configured" }),
      { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  if (!signature) {
    console.error("Missing stripe-signature header - rejecting request");
    return new Response(
      JSON.stringify({ error: "Missing stripe-signature header" }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const verification = await verifyStripeSignature(body, signature, webhookSecret);
  if (!verification.valid) {
    // Reason is a fixed enum — never contains the secret, signature or payload.
    console.error("Rejecting Stripe webhook:", verification.reason);
    return new Response(
      JSON.stringify({ error: "Invalid webhook signature" }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Signed, but possibly malformed JSON.
  let event: any;
  try {
    event = JSON.parse(body);
  } catch {
    console.error("Signed Stripe webhook body was not valid JSON");
    return new Response(
      JSON.stringify({ error: "Invalid payload" }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const eventId: string | null = typeof event?.id === "string" ? event.id : null;
  const eventType: string = typeof event?.type === "string" ? event.type : "unknown";
  console.log('Received Stripe webhook event:', eventType);

  // Create Supabase client with service role (only after verification).
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  // ---------------------------------------------------------------------
  // IDEMPOTENCY — claim the event before any business mutation.
  // ---------------------------------------------------------------------
  let claimed = false;
  if (eventId) {
    const { data: claimResult, error: claimError } = await supabase.rpc(
      'claim_stripe_webhook_event',
      {
        p_event_id: eventId,
        p_event_type: eventType,
        p_object_id: stripeObjectId(event),
      },
    );

    if (claimError) {
      console.error('Failed to claim Stripe webhook event — asking Stripe to retry');
      return new Response(
        JSON.stringify({ error: 'Webhook claim failed' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (claimResult === 'duplicate_completed') {
      // Already fully processed: acknowledge without repeating any work.
      return new Response(JSON.stringify({ received: true, duplicate: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (claimResult === 'in_progress') {
      // Another processor holds the claim. Do not double-apply; let Stripe
      // retry later so the event is never silently dropped.
      return new Response(
        JSON.stringify({ error: 'Event already being processed' }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    claimed = true;
  }

  const eventAt = stripeEventAt(event);
  let storageAddonSelfCompleted = false;

  try {
    // Handle different event types
    switch (eventType) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const metadata = session.metadata || {};
        
        // Check if this is a storage addon purchase
        if (metadata.type === 'storage_addon') {
          // Atomic: increment + notification + ledger completion in one txn.
          await handleStorageAddonPurchase(supabase, session, metadata, eventId);
          storageAddonSelfCompleted = Boolean(eventId);
        } else if (metadata.type === 'member_subscription') {
          await handleMemberSubscriptionPayment(supabase, metadata);
        } else if (session.mode === 'subscription') {
          await handleSubscriptionCreated(supabase, session, metadata, eventId, eventAt);
        } else {
          // Handle one-time event payments (existing logic)
          await handleEventPayment(supabase, metadata);
        }
        break;
      }

      case 'invoice.paid': {
        // Handle subscription renewal
        const invoice = event.data.object;
        if (invoice.subscription) {
          await handleSubscriptionRenewal(supabase, invoice, eventId, eventAt);
        }
        break;
      }

      case 'invoice.payment_failed': {
        // Handle failed payment
        const invoice = event.data.object;
        if (invoice.subscription) {
          await handlePaymentFailed(supabase, invoice);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        // Handle subscription cancellation
        const subscription = event.data.object;
        await handleSubscriptionCancelled(supabase, subscription, eventId, eventAt);
        break;
      }

      case 'customer.subscription.updated': {
        // Handle subscription updates (e.g., plan changes)
        const subscription = event.data.object;
        await handleSubscriptionUpdated(supabase, subscription, eventId, eventAt);
        break;
      }

      default:
        // Unknown but validly signed events are acknowledged with no mutations.
        console.log('Unhandled event type:', eventType);
    }

    if (claimed && !storageAddonSelfCompleted) {
      await supabase.rpc('complete_stripe_webhook_event', { p_event_id: eventId });
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    // Never expose internal error details, credentials or Stripe secrets.
    console.error('Error in stripe-webhook while processing', eventType);
    if (claimed) {
      // Mark failed so a Stripe retry can safely re-claim and re-run.
      try {
        await supabase.rpc('fail_stripe_webhook_event', {
          p_event_id: eventId,
          p_error: String((error as any)?.message ?? 'processing error').slice(0, 200),
        });
      } catch {
        // Ledger update failure must not change the response contract.
      }
    }
    return new Response(
      JSON.stringify({ error: 'Webhook processing failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' } }
    );
  }
});


async function handleSubscriptionCreated(supabase: any, session: any, metadata: any) {
  const subscriptionType = metadata.subscription_type;
  const entityId = metadata.entity_id;
  const tier = metadata.tier;
  const plan = metadata.plan;
  const teamLimit = metadata.team_limit === 'null' ? null : parseInt(metadata.team_limit);
  const userId = metadata.user_id;
  const isAnnual = metadata.is_annual === 'true';
  const stripeSubscriptionId = session.subscription;

  console.log('Processing subscription creation:', { subscriptionType, entityId, tier, plan });

  // Calculate expiry date
  const now = new Date();
  const expiresAt = isAnnual 
    ? new Date(now.setFullYear(now.getFullYear() + 1))
    : new Date(now.setMonth(now.getMonth() + 1));

  if (subscriptionType === 'team') {
    // Update team subscription table
    const { error: subError } = await supabase
      .from('team_subscriptions')
      .upsert({
        team_id: entityId,
        is_pro: true,
        is_pro_football: tier === 'pro_football',
        stripe_subscription_id: stripeSubscriptionId,
        activated_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString(),
        is_trial: metadata.with_trial === 'true',
        trial_ends_at: metadata.with_trial === 'true' ? expiresAt.toISOString() : null,
      }, { onConflict: 'team_id' });

    if (subError) {
      console.error('Error updating team subscription:', subError);
      throw subError;
    }

    // Also update the teams table directly for backward compatibility
    await supabase
      .from('teams')
      .update({
        is_pro: true,
        pro_expires_at: expiresAt.toISOString(),
        stripe_subscription_id: stripeSubscriptionId,
      })
      .eq('id', entityId);

    // Notify user
    await supabase.from('notifications').insert({
      user_id: userId,
      type: 'subscription_activated',
      message: `Your ${tier === 'pro' ? 'Pro' : 'Pro Football'} subscription has been activated!`,
      related_id: entityId,
    });

    console.log('Team subscription activated:', entityId);
  } else {
    // Update club subscription
    const { error: subError } = await supabase
      .from('club_subscriptions')
      .upsert({
        club_id: entityId,
        is_pro: true,
        is_pro_football: tier === 'pro_football',
        plan: plan,
        team_limit: teamLimit,
        stripe_subscription_id: stripeSubscriptionId,
        activated_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString(),
      }, { onConflict: 'club_id' });

    if (subError) {
      console.error('Error updating club subscription:', subError);
      throw subError;
    }

    // Update club is_pro flag
    await supabase
      .from('clubs')
      .update({ is_pro: true })
      .eq('id', entityId);

    // Notify user
    await supabase.from('notifications').insert({
      user_id: userId,
      type: 'subscription_activated',
      message: `Your Club ${tier === 'pro' ? 'Pro' : 'Pro Football'} subscription has been activated!`,
      related_id: entityId,
    });

    console.log('Club subscription activated:', entityId);
  }
}

async function handleSubscriptionRenewal(supabase: any, invoice: any) {
  const subscriptionId = invoice.subscription;
  console.log('Processing subscription renewal for:', subscriptionId);

  // Calculate new expiry date based on current period end
  const periodEnd = new Date(invoice.lines.data[0]?.period?.end * 1000);
  const renewalDate = new Date().toLocaleDateString('en-AU', { dateStyle: 'long' });
  const nextBillingDate = periodEnd.toLocaleDateString('en-AU', { dateStyle: 'long' });

  // Try to find team subscription
  const { data: teamSub } = await supabase
    .from('team_subscriptions')
    .select('team_id, is_pro_football, teams(name, created_by, club_id)')
    .eq('stripe_subscription_id', subscriptionId)
    .maybeSingle();

  if (teamSub) {
    await supabase
      .from('team_subscriptions')
      .update({ expires_at: periodEnd.toISOString(), is_trial: false, trial_ends_at: null })
      .eq('stripe_subscription_id', subscriptionId);
    
    // Also update teams table
    await supabase
      .from('teams')
      .update({ pro_expires_at: periodEnd.toISOString() })
      .eq('id', teamSub.team_id);
    
    console.log('Team subscription renewed:', teamSub.team_id);

    // Send email notification to team admins
    const tierName = teamSub.is_pro_football ? 'Pro Football' : 'Pro';
    const teamName = teamSub.teams?.name || 'Your Team';
    
    // Get team admins
    const { data: teamAdmins } = await supabase
      .from('user_roles')
      .select('user_id')
      .eq('team_id', teamSub.team_id)
      .in('role', ['team_admin', 'coach']);

    if (teamAdmins && teamAdmins.length > 0) {
      const adminUserIds = teamAdmins.map((a: any) => a.user_id);
      const { data: emails } = await supabase.rpc('get_user_emails_by_ids', { user_ids: adminUserIds });
      const { data: profiles } = await supabase.from('profiles').select('id, display_name').in('id', adminUserIds);

      for (const admin of teamAdmins) {
        const email = emails?.find((e: any) => e.id === admin.user_id)?.email;
        const profile = profiles?.find((p: any) => p.id === admin.user_id);
        
        if (email) {
          try {
            await supabase.functions.invoke('send-email', {
              body: {
                to: email,
                subject: `✅ Your ${teamName} subscription has been renewed`,
                template: 'subscription-renewed',
                templateData: {
                  recipientName: profile?.display_name,
                  entityName: teamName,
                  entityType: 'team',
                  tierName,
                  renewalDate,
                  nextBillingDate,
                  manageLink: `https://igniteclubhq.app/team/${teamSub.team_id}/upgrade`,
                },
              },
            });
            console.log(`Renewal email sent to team admin: ${email}`);
          } catch (err) {
            console.error('Error sending renewal email:', err);
          }
        }
      }
    }

    // Create notification
    if (teamSub.teams?.created_by) {
      await supabase.from('notifications').insert({
        user_id: teamSub.teams.created_by,
        type: 'subscription_renewed',
        message: `Your ${tierName} subscription for ${teamName} has been renewed!`,
        related_id: teamSub.team_id,
      });
    }
    return;
  }

  // Try to find club subscription
  const { data: clubSub } = await supabase
    .from('club_subscriptions')
    .select('club_id, is_pro_football, plan, clubs!club_id(name, created_by)')
    .eq('stripe_subscription_id', subscriptionId)
    .maybeSingle();

  if (!clubSub) {
    // Orphan: Stripe billed a subscription we no longer track. Auto-cancel
    // it AND refund the just-charged invoice so the customer is never billed
    // again. Also raise an admin_alert with the outcome for visibility.
    console.error('Orphan invoice.paid — no DB row for subscription:', subscriptionId);
    const outcome = await autoCancelOrphanSubscription(supabase, subscriptionId, invoice);
    await supabase.from('admin_alerts').insert({
      alert_type: 'stripe_orphan_invoice_paid',
      details: {
        stripe_subscription_id: subscriptionId,
        stripe_customer_id: invoice.customer,
        invoice_id: invoice.id,
        amount_paid: invoice.amount_paid,
        currency: invoice.currency,
        auto_cancelled: outcome.cancelled,
        auto_refunded: outcome.refunded,
        note: 'Stripe charged a customer for a subscription with no matching club_subscriptions/team_subscriptions row. The webhook auto-cancelled the subscription and attempted a refund. Verify in Stripe.',
      },
    });
    return;
  }

  if (clubSub) {
    await supabase
      .from('club_subscriptions')
      .update({ expires_at: periodEnd.toISOString(), ...eventStamp(stripeEventId, eventAt) })
      .eq('stripe_subscription_id', subscriptionId);

    console.log('Club subscription renewed:', clubSub.club_id);

    // Send email notification to club admins
    const tierName = clubSub.is_pro_football ? 'Pro Football' : 'Pro';
    const clubName = clubSub.clubs?.name || 'Your Club';
    
    // Get club admins
    const { data: clubAdmins } = await supabase
      .from('user_roles')
      .select('user_id')
      .eq('club_id', clubSub.club_id)
      .eq('role', 'club_admin');

    if (clubAdmins && clubAdmins.length > 0) {
      const adminUserIds = clubAdmins.map((a: any) => a.user_id);
      const { data: emails } = await supabase.rpc('get_user_emails_by_ids', { user_ids: adminUserIds });
      const { data: profiles } = await supabase.from('profiles').select('id, display_name').in('id', adminUserIds);

      for (const admin of clubAdmins) {
        const email = emails?.find((e: any) => e.id === admin.user_id)?.email;
        const profile = profiles?.find((p: any) => p.id === admin.user_id);
        
        if (email) {
          try {
            await supabase.functions.invoke('send-email', {
              body: {
                to: email,
                subject: `✅ Your ${clubName} subscription has been renewed`,
                template: 'subscription-renewed',
                templateData: {
                  recipientName: profile?.display_name,
                  entityName: clubName,
                  entityType: 'club',
                  tierName,
                  renewalDate,
                  nextBillingDate,
                  manageLink: `https://igniteclubhq.app/club/${clubSub.club_id}/upgrade`,
                },
              },
            });
            console.log(`Renewal email sent to club admin: ${email}`);
          } catch (err) {
            console.error('Error sending renewal email:', err);
          }
        }
      }
    }

    // Create notification
    if (clubSub.clubs?.created_by) {
      await supabase.from('notifications').insert({
        user_id: clubSub.clubs.created_by,
        type: 'subscription_renewed',
        message: `Your Club ${tierName} subscription for ${clubName} has been renewed!`,
        related_id: clubSub.club_id,
      });
    }
  }
}

async function handlePaymentFailed(supabase: any, invoice: any) {
  const subscriptionId = invoice.subscription;
  console.log('Processing payment failure for:', subscriptionId);

  const failureDate = new Date().toLocaleDateString('en-AU', { dateStyle: 'long' });

  // Find the subscription and notify the owner
  const { data: teamSub } = await supabase
    .from('team_subscriptions')
    .select('team_id, is_pro_football, teams(name, created_by)')
    .eq('stripe_subscription_id', subscriptionId)
    .maybeSingle();

  if (teamSub?.teams?.created_by) {
    const tierName = teamSub.is_pro_football ? 'Pro Football' : 'Pro';
    const teamName = teamSub.teams?.name || 'Your Team';
    
    // Get team admins
    const { data: teamAdmins } = await supabase
      .from('user_roles')
      .select('user_id')
      .eq('team_id', teamSub.team_id)
      .in('role', ['team_admin', 'coach']);

    if (teamAdmins && teamAdmins.length > 0) {
      const adminUserIds = teamAdmins.map((a: any) => a.user_id);
      const { data: emails } = await supabase.rpc('get_user_emails_by_ids', { user_ids: adminUserIds });
      const { data: profiles } = await supabase.from('profiles').select('id, display_name').in('id', adminUserIds);

      for (const admin of teamAdmins) {
        const email = emails?.find((e: any) => e.id === admin.user_id)?.email;
        const profile = profiles?.find((p: any) => p.id === admin.user_id);
        
        if (email) {
          try {
            await supabase.functions.invoke('send-email', {
              body: {
                to: email,
                subject: `⚠️ Payment failed for ${teamName} subscription`,
                template: 'payment-failed',
                templateData: {
                  recipientName: profile?.display_name,
                  entityName: teamName,
                  entityType: 'team',
                  tierName,
                  failureDate,
                  updatePaymentLink: `https://igniteclubhq.app/team/${teamSub.team_id}/upgrade`,
                },
              },
            });
            console.log(`Payment failed email sent to team admin: ${email}`);
          } catch (err) {
            console.error('Error sending payment failed email:', err);
          }
        }
      }
    }

    await supabase.from('notifications').insert({
      user_id: teamSub.teams.created_by,
      type: 'payment_failed',
      message: 'Your subscription payment failed. Please update your payment method.',
      related_id: teamSub.team_id,
    });
    return;
  }

  const { data: clubSub } = await supabase
    .from('club_subscriptions')
    .select('club_id, is_pro_football, clubs!club_id(name, created_by)')
    .eq('stripe_subscription_id', subscriptionId)
    .maybeSingle();

  if (clubSub?.clubs?.created_by) {
    const tierName = clubSub.is_pro_football ? 'Pro Football' : 'Pro';
    const clubName = clubSub.clubs?.name || 'Your Club';
    
    // Get club admins
    const { data: clubAdmins } = await supabase
      .from('user_roles')
      .select('user_id')
      .eq('club_id', clubSub.club_id)
      .eq('role', 'club_admin');

    if (clubAdmins && clubAdmins.length > 0) {
      const adminUserIds = clubAdmins.map((a: any) => a.user_id);
      const { data: emails } = await supabase.rpc('get_user_emails_by_ids', { user_ids: adminUserIds });
      const { data: profiles } = await supabase.from('profiles').select('id, display_name').in('id', adminUserIds);

      for (const admin of clubAdmins) {
        const email = emails?.find((e: any) => e.id === admin.user_id)?.email;
        const profile = profiles?.find((p: any) => p.id === admin.user_id);
        
        if (email) {
          try {
            await supabase.functions.invoke('send-email', {
              body: {
                to: email,
                subject: `⚠️ Payment failed for ${clubName} subscription`,
                template: 'payment-failed',
                templateData: {
                  recipientName: profile?.display_name,
                  entityName: clubName,
                  entityType: 'club',
                  tierName,
                  failureDate,
                  updatePaymentLink: `https://igniteclubhq.app/club/${clubSub.club_id}/upgrade`,
                },
              },
            });
            console.log(`Payment failed email sent to club admin: ${email}`);
          } catch (err) {
            console.error('Error sending payment failed email:', err);
          }
        }
      }
    }

    await supabase.from('notifications').insert({
      user_id: clubSub.clubs.created_by,
      type: 'payment_failed',
      message: 'Your club subscription payment failed. Please update your payment method.',
      related_id: clubSub.club_id,
    });
  }
}

async function handleSubscriptionCancelled(
  supabase: any,
  subscription: any,
  _stripeEventId: string | null,
  eventAt: string | null,
) {
  const subscriptionId = subscription.id;
  console.log('Processing subscription cancellation for:', subscriptionId);

  // Out-of-order safety: a cancellation older than the last applied event
  // must not undo newer subscription state.
  if (await isStaleStripeEvent(supabase, subscriptionId, eventAt)) {
    console.log('Skipping out-of-order cancellation for:', subscriptionId);
    return;
  }


  // Deactivate team subscription
  const { data: teamSub } = await supabase
    .from('team_subscriptions')
    .update({ 
      is_pro: false, 
      is_pro_football: false,
      stripe_subscription_id: null,
      is_trial: false,
      trial_ends_at: null,
    })
    .eq('stripe_subscription_id', subscriptionId)
    .select('team_id, teams(created_by)')
    .maybeSingle();

  if (teamSub) {
    // Also update the teams table directly
    await supabase
      .from('teams')
      .update({
        is_pro: false,
        pro_expires_at: null,
        stripe_subscription_id: null,
      })
      .eq('id', teamSub.team_id);

    if (teamSub.teams?.created_by) {
      await supabase.from('notifications').insert({
        user_id: teamSub.teams.created_by,
        type: 'subscription_cancelled',
        message: 'Your subscription has been cancelled.',
        related_id: teamSub.team_id,
      });
    }
    return;
  }

  // Deactivate club subscription
  const { data: clubSub } = await supabase
    .from('club_subscriptions')
    .delete()
    .eq('stripe_subscription_id', subscriptionId)
    .select('club_id, clubs!club_id(created_by)')
    .maybeSingle();

  if (clubSub) {
    // Update club is_pro flag
    await supabase
      .from('clubs')
      .update({ is_pro: false, stripe_subscription_id: null })
      .eq('id', clubSub.club_id);

    if (clubSub.clubs?.created_by) {
      await supabase.from('notifications').insert({
        user_id: clubSub.clubs.created_by,
        type: 'subscription_cancelled',
        message: 'Your club subscription has been cancelled.',
        related_id: clubSub.club_id,
      });
    }
    return;
  }

  // Legacy fallback: no club_subscriptions row exists, but a club may still
  // hold this Stripe subscription id in the legacy clubs.stripe_subscription_id
  // column. Clear it so future audits and cancel paths don't see a stale live
  // sub id on a free club.
  const { data: legacyClub } = await supabase
    .from('clubs')
    .update({ is_pro: false, stripe_subscription_id: null })
    .eq('stripe_subscription_id', subscriptionId)
    .select('id, created_by')
    .maybeSingle();

  if (legacyClub) {
    console.log('Legacy clubs.stripe_subscription_id cleared on cancel:', subscriptionId, 'club:', legacyClub.id);
    await supabase.from('admin_alerts').insert({
      alert_type: 'legacy_club_subscription_cleared',
      details: {
        club_id: legacyClub.id,
        stripe_subscription_id: subscriptionId,
        note: 'Stripe reported this subscription as cancelled. It only lived on the legacy clubs.stripe_subscription_id column (no club_subscriptions row). Field has been cleared.',
      },
    });
    if (legacyClub.created_by) {
      await supabase.from('notifications').insert({
        user_id: legacyClub.created_by,
        type: 'subscription_cancelled',
        message: 'Your club subscription has been cancelled.',
        related_id: legacyClub.id,
      });
    }
  }
}

async function handleSubscriptionUpdated(
  supabase: any,
  subscription: any,
  stripeEventId: string | null,
  eventAt: string | null,
) {
  const subscriptionId = subscription.id;
  console.log('Processing subscription update for:', subscriptionId);

  if (await isStaleStripeEvent(supabase, subscriptionId, eventAt)) {
    console.log('Skipping out-of-order subscription update for:', subscriptionId);
    return;
  }

  // Update expiry based on current period end
  const periodEnd = new Date(subscription.current_period_end * 1000);
  const stamp = eventStamp(stripeEventId, eventAt);

  // Update team subscription if exists
  await supabase
    .from('team_subscriptions')
    .update({ expires_at: periodEnd.toISOString(), ...stamp })
    .eq('stripe_subscription_id', subscriptionId);

  // Update club subscription if exists
  await supabase
    .from('club_subscriptions')
    .update({ expires_at: periodEnd.toISOString(), ...stamp })
    .eq('stripe_subscription_id', subscriptionId);
}


async function handleEventPayment(supabase: any, metadata: any) {
  const eventId = metadata.event_id;
  const userId = metadata.user_id;

  console.log('Processing payment for event:', eventId, 'user:', userId);

  if (!eventId || !userId) {
    console.error('Missing metadata in session:', metadata);
    throw new Error('Missing required metadata');
  }

  // Check if payment already recorded
  const { data: existingPayment } = await supabase
    .from('event_payments')
    .select('id')
    .eq('event_id', eventId)
    .eq('user_id', userId)
    .maybeSingle();

  if (existingPayment) {
    console.log('Payment already recorded for event:', eventId, 'user:', userId);
    return;
  }

  // Record the payment
  const { error: paymentError } = await supabase
    .from('event_payments')
    .insert({
      event_id: eventId,
      user_id: userId,
      marked_by: userId,
    });

  if (paymentError) {
    console.error('Error recording payment:', paymentError);
    throw paymentError;
  }

  console.log('Payment recorded successfully for event:', eventId, 'user:', userId);

  // Create notification for the user
  const { data: eventData } = await supabase
    .from('events')
    .select('title')
    .eq('id', eventId)
    .single();

  if (eventData) {
    await supabase.from('notifications').insert({
      user_id: userId,
      type: 'payment_confirmed',
      message: `Your payment for ${eventData.title} has been confirmed!`,
      related_id: eventId,
    });
  }
}

async function handleStorageAddonPurchase(
  supabase: any,
  session: any,
  metadata: any,
  stripeEventId: string | null,
) {
  const clubId = metadata.club_id;
  const storageGb = parseInt(metadata.storage_gb);
  const userId = metadata.user_id;

  console.log('Processing storage addon purchase:', { clubId, storageGb, userId });

  if (!clubId || !storageGb || !userId) {
    console.error('Missing metadata for storage addon:', metadata);
    throw new Error('Missing required metadata for storage addon');
  }

  if (stripeEventId) {
    // Atomic path: storage increment + notification + ledger completion all
    // succeed or all roll back, so a Stripe retry can never double-increment.
    const { data, error } = await supabase.rpc('apply_stripe_storage_addon', {
      p_event_id: stripeEventId,
      p_club_id: clubId,
      p_storage_gb: storageGb,
      p_user_id: userId,
    });
    if (error) {
      console.error('Atomic storage addon application failed');
      throw new Error('storage_addon_apply_failed');
    }
    console.log('Storage addon result:', data, { clubId, storageGb });
    return;
  }

  // Legacy fallback (no Stripe event id available).
  const { data: subscription, error: subError } = await supabase
    .from('club_subscriptions')
    .select('storage_purchased_gb')
    .eq('club_id', clubId)
    .maybeSingle();

  if (subError) {
    console.error('Error fetching club subscription:', subError);
    throw subError;
  }

  const currentStorage = subscription?.storage_purchased_gb || 0;
  const newStorage = currentStorage + storageGb;

  // Update the club subscription with additional storage
  const { error: updateError } = await supabase
    .from('club_subscriptions')
    .update({ storage_purchased_gb: newStorage })
    .eq('club_id', clubId);

  if (updateError) {
    console.error('Error updating storage:', updateError);
    throw updateError;
  }



  // Get club name for notification
  const { data: club } = await supabase
    .from('clubs')
    .select('name')
    .eq('id', clubId)
    .single();

  // Create notification
  await supabase.from('notifications').insert({
    user_id: userId,
    type: 'storage_purchased',
    message: `Your ${storageGb}GB storage addon for ${club?.name || 'your club'} has been activated!`,
    related_id: clubId,
  });

  console.log('Storage addon activated:', { clubId, storageGb, totalStorage: newStorage });
}

async function handleMemberSubscriptionPayment(supabase: any, metadata: any) {
  const clubId = metadata.club_id;
  const userId = metadata.user_id;
  const paymentPeriod = metadata.payment_period;
  const amount = parseFloat(metadata.amount);

  console.log('Processing member subscription payment:', { clubId, userId, paymentPeriod, amount });

  if (!clubId || !userId || !paymentPeriod) {
    console.error('Missing metadata for member subscription:', metadata);
    throw new Error('Missing required metadata for member subscription payment');
  }

  // Check if payment already recorded
  const { data: existingPayment } = await supabase
    .from('member_subscription_payments')
    .select('id')
    .eq('user_id', userId)
    .eq('club_id', clubId)
    .eq('payment_period', paymentPeriod)
    .maybeSingle();

  if (existingPayment) {
    console.log('Payment already recorded for member subscription:', { clubId, userId, paymentPeriod });
    return;
  }

  // Record the payment
  const { error: paymentError } = await supabase
    .from('member_subscription_payments')
    .insert({
      user_id: userId,
      club_id: clubId,
      payment_period: paymentPeriod,
      amount: amount,
      marked_by: userId,
      notes: 'Paid online via Stripe',
    });

  if (paymentError) {
    console.error('Error recording member subscription payment:', paymentError);
    throw paymentError;
  }

  // Get club name for notification
  const { data: club } = await supabase
    .from('clubs')
    .select('name')
    .eq('id', clubId)
    .single();

  // Create notification
  await supabase.from('notifications').insert({
    user_id: userId,
    type: 'payment_confirmed',
    message: `Your ${club?.name || 'club'} subscription payment for ${paymentPeriod} has been confirmed!`,
    related_id: clubId,
  });

  console.log('Member subscription payment recorded:', { clubId, userId, paymentPeriod });
}
