import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.21.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

async function resolveStripeKey(adminClient: any, clubId: string | null): Promise<string | null> {
  if (clubId) {
    const { data } = await adminClient
      .from("club_stripe_configs")
      .select("stripe_secret_key, is_enabled")
      .eq("club_id", clubId)
      .eq("is_enabled", true)
      .maybeSingle();
    if (data?.stripe_secret_key) return data.stripe_secret_key;
  }
  const { data: app } = await adminClient
    .from("app_stripe_config")
    .select("stripe_secret_key, is_enabled")
    .eq("is_enabled", true)
    .maybeSingle();
  return app?.stripe_secret_key ?? null;
}

async function cancelStripeSubscriptionsForEntity(
  adminClient: any,
  entityType: "club" | "team",
  entityId: string,
  clubId: string | null,
) {
  const subIds = new Set<string>();
  if (entityType === "club") {
    const { data } = await adminClient
      .from("club_subscriptions")
      .select("stripe_subscription_id")
      .eq("club_id", entityId);
    for (const r of data ?? []) if (r.stripe_subscription_id && !String(r.stripe_subscription_id).startsWith("iap_")) subIds.add(r.stripe_subscription_id);
    // Also cancel any team subs belonging to the club's teams.
    const { data: teams } = await adminClient.from("teams").select("id, stripe_subscription_id").eq("club_id", entityId);
    for (const t of teams ?? []) if (t.stripe_subscription_id && !String(t.stripe_subscription_id).startsWith("iap_")) subIds.add(t.stripe_subscription_id);
    if (teams && teams.length) {
      const { data: teamSubs } = await adminClient
        .from("team_subscriptions")
        .select("stripe_subscription_id")
        .in("team_id", teams.map((t: any) => t.id));
      for (const r of teamSubs ?? []) if (r.stripe_subscription_id && !String(r.stripe_subscription_id).startsWith("iap_")) subIds.add(r.stripe_subscription_id);
    }
  } else {
    const { data: team } = await adminClient.from("teams").select("stripe_subscription_id").eq("id", entityId).maybeSingle();
    if (team?.stripe_subscription_id && !String(team.stripe_subscription_id).startsWith("iap_")) subIds.add(team.stripe_subscription_id);
    const { data: sub } = await adminClient.from("team_subscriptions").select("stripe_subscription_id").eq("team_id", entityId).maybeSingle();
    if (sub?.stripe_subscription_id && !String(sub.stripe_subscription_id).startsWith("iap_")) subIds.add(sub.stripe_subscription_id);
  }

  if (subIds.size === 0) return;

  const key = await resolveStripeKey(adminClient, clubId);
  if (!key) {
    // Surface an alert so finance can chase the subscription manually.
    await adminClient.from("admin_alerts").insert({
      alert_type: "stripe_orphan_on_permanent_delete",
      details: {
        entityType, entityId, clubId,
        stripe_subscription_ids: Array.from(subIds),
        reason: "No Stripe secret key available — entity deleted without cancelling Stripe subscription(s).",
      },
    });
    return;
  }

  const stripe = new Stripe(key, { apiVersion: "2023-10-16" });
  for (const id of subIds) {
    try {
      await stripe.subscriptions.cancel(id);
      console.log("Cancelled Stripe subscription before permanent delete:", id);
    } catch (err: any) {
      if (err?.code === "resource_missing") {
        console.warn("Stripe subscription already gone:", id);
        continue;
      }
      console.error("Failed to cancel Stripe subscription before delete:", id, err);
      await adminClient.from("admin_alerts").insert({
        alert_type: "stripe_cancel_failed_on_permanent_delete",
        details: { entityType, entityId, clubId, stripe_subscription_id: id, error: String(err?.message ?? err) },
      });
      // Block delete to avoid losing the only reference to a live billing.
      throw new Error(`Cannot permanently delete: Stripe subscription ${id} could not be cancelled.`);
    }
  }
}


function extractStoragePath(url: string, bucket: string): string | null {
  const patterns = [
    `/storage/v1/object/public/${bucket}/`,
    `/storage/v1/object/sign/${bucket}/`,
    `/storage/v1/object/${bucket}/`,
  ];
  for (const pattern of patterns) {
    const idx = url.indexOf(pattern);
    if (idx !== -1) {
      return decodeURIComponent(url.substring(idx + pattern.length).split("?")[0]);
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify the requesting user via their JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create user client to verify identity
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { entityType, entityId } = await req.json();

    if (!entityType || !entityId) {
      return new Response(JSON.stringify({ error: "entityType and entityId are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!["club", "team"].includes(entityType)) {
      return new Response(JSON.stringify({ error: "Invalid entityType" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceKey);

    // Verify the user is an admin of this entity
    if (entityType === "club") {
      // Check club_admin or app_admin
      const { data: roles } = await adminClient
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .in("role", ["club_admin", "app_admin"]);

      const isClubAdmin = roles?.some(r => r.role === "app_admin") ||
        (await adminClient.from("user_roles").select("id").eq("user_id", user.id).eq("role", "club_admin").eq("club_id", entityId).maybeSingle()).data;

      if (!isClubAdmin) {
        return new Response(JSON.stringify({ error: "Only club admins can permanently delete clubs" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Verify the club is soft-deleted
      const { data: club } = await adminClient
        .from("clubs")
        .select("id, deleted_at, name")
        .eq("id", entityId)
        .maybeSingle();

      if (!club) {
        return new Response(JSON.stringify({ error: "Club not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!club.deleted_at) {
        return new Response(JSON.stringify({ error: "Club must be removed first before permanent deletion" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Clean up storage: photos, vault files, club logos
      await cleanupClubStorage(adminClient, entityId);

      // Delete the club (cascade will handle related records)
      const { error: deleteError } = await adminClient
        .from("clubs")
        .delete()
        .eq("id", entityId);

      if (deleteError) {
        console.error("Failed to delete club:", deleteError);
        return new Response(JSON.stringify({ error: "Failed to permanently delete club" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Log the action
      await adminClient.from("audit_logs").insert({
        action_type: "permanent_delete_club",
        actor_id: user.id,
        details: { club_id: entityId, club_name: club.name },
      });

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    } else if (entityType === "team") {
      // Get team to check club_id
      const { data: team } = await adminClient
        .from("teams")
        .select("id, deleted_at, name, club_id")
        .eq("id", entityId)
        .maybeSingle();

      if (!team) {
        return new Response(JSON.stringify({ error: "Team not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!team.deleted_at) {
        return new Response(JSON.stringify({ error: "Team must be removed first before permanent deletion" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Check team_admin, club_admin, or app_admin
      const { data: roles } = await adminClient
        .from("user_roles")
        .select("role, team_id, club_id")
        .eq("user_id", user.id);

      const isAuthorized = roles?.some(r =>
        r.role === "app_admin" ||
        (r.role === "club_admin" && r.club_id === team.club_id) ||
        (r.role === "team_admin" && r.team_id === entityId)
      );

      if (!isAuthorized) {
        return new Response(JSON.stringify({ error: "Only team or club admins can permanently delete teams" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Clean up storage for this team
      await cleanupTeamStorage(adminClient, entityId);

      // Delete the team (cascade will handle related records)
      const { error: deleteError } = await adminClient
        .from("teams")
        .delete()
        .eq("id", entityId);

      if (deleteError) {
        console.error("Failed to delete team:", deleteError);
        return new Response(JSON.stringify({ error: "Failed to permanently delete team" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Log the action
      await adminClient.from("audit_logs").insert({
        action_type: "permanent_delete_team",
        actor_id: user.id,
        details: { team_id: entityId, team_name: team.name, club_id: team.club_id },
      });

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function cleanupTeamStorage(adminClient: any, teamId: string) {
  // Delete team photos from storage
  const { data: photos } = await adminClient
    .from("photos")
    .select("id, image_url, file_url")
    .eq("team_id", teamId);

  if (photos) {
    for (const photo of photos) {
      const url = photo.file_url || photo.image_url;
      if (url) {
        const path = extractStoragePath(url, "photos");
        if (path) {
          await adminClient.storage.from("photos").remove([path]);
        }
      }
    }
  }

  // Delete team vault files from storage
  const { data: files } = await adminClient
    .from("vault_files")
    .select("id, file_url, is_external_link")
    .eq("team_id", teamId);

  if (files) {
    for (const file of files) {
      if (!file.is_external_link && file.file_url) {
        for (const bucket of ["photos", "vault-files"]) {
          const path = extractStoragePath(file.file_url, bucket);
          if (path) {
            await adminClient.storage.from(bucket).remove([path]);
            break;
          }
        }
      }
    }
  }
}

async function cleanupClubStorage(adminClient: any, clubId: string) {
  // Get all teams in this club
  const { data: teams } = await adminClient
    .from("teams")
    .select("id")
    .eq("club_id", clubId);

  // Clean up each team's storage
  if (teams) {
    for (const team of teams) {
      await cleanupTeamStorage(adminClient, team.id);
    }
  }

  // Clean up club-level photos
  const { data: clubPhotos } = await adminClient
    .from("photos")
    .select("id, image_url, file_url")
    .eq("club_id", clubId)
    .is("team_id", null);

  if (clubPhotos) {
    for (const photo of clubPhotos) {
      const url = photo.file_url || photo.image_url;
      if (url) {
        const path = extractStoragePath(url, "photos");
        if (path) {
          await adminClient.storage.from("photos").remove([path]);
        }
      }
    }
  }

  // Clean up club logo
  const prefix = `clubs/${clubId}/`;
  await adminClient.storage.from("club-logos").remove([`${prefix}logo.jpg`, `${prefix}logo.png`]);
}
