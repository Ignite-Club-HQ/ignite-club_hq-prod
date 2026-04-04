import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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
