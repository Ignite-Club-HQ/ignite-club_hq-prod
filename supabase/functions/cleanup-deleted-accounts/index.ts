import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isAuthorizedCronCaller } from "../_shared/cron-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

/**
 * Extracts the storage path from a full Supabase storage URL.
 */
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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!(await isAuthorizedCronCaller(req))) {
      console.error("Unauthorized: caller is not an authorized cron/internal caller");
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Find all accounts scheduled for deletion that have passed their deletion date
    const { data: accountsToDelete, error: fetchError } = await adminClient
      .from('profiles')
      .select('id')
      .not('scheduled_deletion_at', 'is', null)
      .lt('scheduled_deletion_at', new Date().toISOString());

    if (fetchError) {
      console.error("Error fetching accounts to delete:", fetchError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch accounts" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!accountsToDelete || accountsToDelete.length === 0) {
      console.log("No accounts to delete");
      return new Response(
        JSON.stringify({ success: true, deletedCount: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let deletedCount = 0;
    let storageFilesRemoved = 0;
    const errors: string[] = [];

    for (const account of accountsToDelete) {
      try {
        const uid = account.id;
        
        // Helper to delete and log
        const del = async (table: string, col: string) => {
          try {
            await adminClient.from(table).delete().eq(col, uid);
          } catch (e) {
            console.log(`Skipped ${table}: ${e}`);
          }
        };

        // --- Comprehensive DB cleanup (same as admin-delete-account) ---
        
        // User data tables
        await del('user_roles', 'user_id');
        await del('notifications', 'user_id');
        await del('push_subscriptions', 'user_id');
        await del('notification_preferences', 'user_id');
        await del('rsvps', 'user_id');
        await del('chat_mute_preferences', 'user_id');
        await del('message_reads', 'user_id');
        await del('message_reactions', 'user_id');
        await del('photo_reactions', 'user_id');
        await del('photo_comment_reactions', 'user_id');
        await del('photo_comments', 'user_id');
        await del('feedback', 'user_id');
        await del('saved_locations', 'user_id');
        await del('favorite_event_titles', 'user_id');
        await del('favorite_opponents', 'user_id');
        await del('team_player_positions', 'user_id');
        await del('active_games', 'user_id');
        await del('game_summaries', 'user_id');
        await del('game_player_stats', 'user_id');
        await del('player_of_match', 'user_id');
        await del('event_payments', 'user_id');
        await del('member_subscription_payments', 'user_id');
        await del('reward_redemptions', 'user_id');
        await del('pending_invites', 'invited_user_id');
        await del('pending_invites', 'invited_by_user_id');
        await del('role_requests', 'user_id');
        await del('pitch_formations', 'user_id');
        await del('typing_indicators', 'user_id');
        await del('blocked_users', 'blocker_id');
        await del('blocked_users', 'blocked_id');
        await del('business_profiles', 'user_id');
        await del('event_views', 'user_id');
        await del('fcm_tokens', 'user_id');
        await del('group_members', 'user_id');
        await del('hidden_dm_conversations', 'user_id');
        await del('iap_transactions', 'user_id');
        await del('match_message_reads', 'user_id');
        await del('points_history', 'user_id');
        await del('system_messages', 'user_id');
        await del('child_guardians', 'guardian_id');
        
        // Children and their related data
        const { data: children } = await adminClient
          .from('children')
          .select('id')
          .eq('parent_id', uid);
        
        if (children && children.length > 0) {
          const childIds = children.map((c: any) => c.id);
          await adminClient.from('child_team_assignments').delete().in('child_id', childIds);
          await adminClient.from('child_mini_league_assignments').delete().in('child_id', childIds);
          await adminClient.from('class_enrolments').delete().in('child_id', childIds);
          await adminClient.from('reward_redemptions').delete().in('child_id', childIds);
          await adminClient.from('game_player_stats').delete().in('child_id', childIds);
          await adminClient.from('player_of_match').delete().in('child_id', childIds);
          await adminClient.from('children').delete().eq('parent_id', uid);
        }
        
        // Nullify assigned duties
        await adminClient.from('duties').update({ assigned_to: null }).eq('assigned_to', uid);
        await adminClient.from('event_group_duties').update({ assigned_to: null }).eq('assigned_to', uid);
        await adminClient.from('mini_league_group_duties').update({ assigned_to: null }).eq('assigned_to', uid);
        
        // Anonymize reports
        await adminClient.from('comment_reports').update({ reporter_id: '00000000-0000-0000-0000-000000000000' }).eq('reporter_id', uid);
        await adminClient.from('photo_reports').update({ reporter_id: '00000000-0000-0000-0000-000000000000' }).eq('reporter_id', uid);
        await adminClient.from('message_reports').update({ reporter_id: '00000000-0000-0000-0000-000000000000' }).eq('reporter_id', uid);
        
        // Anonymize messages
        await adminClient.from('team_messages').update({ text: '[Message deleted - user data removed]', image_url: null }).eq('author_id', uid);
        await adminClient.from('club_messages').update({ text: '[Message deleted - user data removed]', image_url: null }).eq('author_id', uid);
        await adminClient.from('group_messages').update({ text: '[Message deleted - user data removed]', image_url: null }).eq('author_id', uid);
        await adminClient.from('broadcast_messages').update({ text: '[Message deleted - user data removed]', image_url: null }).eq('author_id', uid);
        await adminClient.from('direct_messages').update({ text: '[Message deleted - user data removed]', image_url: null }).eq('author_id', uid);
        await adminClient.from('match_messages').update({ message: '[Message deleted - user data removed]' }).eq('sender_id', uid);
        
        // Delete DM conversations
        await adminClient.from('direct_conversations').delete().eq('participant_1', uid);
        await adminClient.from('direct_conversations').delete().eq('participant_2', uid);
        
        // --- Storage cleanup ---
        
        // 1. Delete user's photos from storage
        const { data: userPhotos } = await adminClient
          .from("photos")
          .select("id, image_url, file_url")
          .eq("uploader_id", uid);

        if (userPhotos) {
          for (const photo of userPhotos) {
            const url = photo.file_url || photo.image_url;
            if (url) {
              const storagePath = extractStoragePath(url, "photos");
              if (storagePath) {
                const { error: storageError } = await adminClient.storage
                  .from("photos")
                  .remove([storagePath]);
                if (!storageError) storageFilesRemoved++;
              }
            }
          }
          // Hard delete photo records
          await adminClient.from("photos").delete().eq("uploader_id", uid);
        }

        // 2. Delete user's vault files from storage
        const { data: userFiles } = await adminClient
          .from("vault_files")
          .select("id, file_url, is_external_link")
          .eq("uploaded_by", uid);

        if (userFiles) {
          for (const file of userFiles) {
            if (!file.is_external_link && file.file_url) {
              for (const bucket of ["photos", "vault-files"]) {
                const storagePath = extractStoragePath(file.file_url, bucket);
                if (storagePath) {
                  const { error: storageError } = await adminClient.storage
                    .from(bucket)
                    .remove([storagePath]);
                  if (!storageError) {
                    storageFilesRemoved++;
                    break;
                  }
                }
              }
            }
          }
          await adminClient.from("vault_files").delete().eq("uploaded_by", uid);
        }

        // 3. Delete user's profile avatar from storage
        const { data: profile } = await adminClient
          .from("profiles")
          .select("avatar_url")
          .eq("id", uid)
          .maybeSingle();

        if (profile?.avatar_url) {
          const avatarPath = extractStoragePath(profile.avatar_url, "avatars");
          if (avatarPath) {
            await adminClient.storage.from("avatars").remove([avatarPath]);
          }
        }
        
        // Delete profile
        await adminClient.from("profiles").delete().eq("id", uid);

        // 4. Delete the auth user
        const { error: deleteError } = await adminClient.auth.admin.deleteUser(uid);
        
        if (deleteError) {
          console.error(`Error deleting user ${uid}:`, deleteError);
          errors.push(`${uid}: ${deleteError.message}`);
        } else {
          console.log(`Successfully deleted user ${uid} (${storageFilesRemoved} storage files cleaned)`);
          deletedCount++;
        }
      } catch (userError) {
        console.error(`Error processing user ${account.id}:`, userError);
        errors.push(`${account.id}: ${userError instanceof Error ? userError.message : 'Unknown error'}`);
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        deletedCount,
        storageFilesRemoved,
        totalScheduled: accountsToDelete.length,
        errors: errors.length > 0 ? errors : undefined
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
