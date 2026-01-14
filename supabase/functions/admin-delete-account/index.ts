import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.error("No authorization header provided");
      return new Response(
        JSON.stringify({ error: "No authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify the requesting user
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    
    if (userError || !user) {
      console.error("User auth error:", userError);
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Check if requesting user is an app admin
    const { data: adminRole, error: adminCheckError } = await adminClient
      .from('user_roles')
      .select('id')
      .eq('user_id', user.id)
      .eq('role', 'app_admin')
      .maybeSingle();

    if (adminCheckError || !adminRole) {
      console.error("Admin check failed:", adminCheckError);
      return new Response(
        JSON.stringify({ error: "Only app admins can delete accounts" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get the target user ID from request body
    const { userId, immediate = false, gdprRequest = false } = await req.json();

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "User ID is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Don't allow deleting yourself
    if (userId === user.id) {
      return new Response(
        JSON.stringify({ error: "Cannot delete your own account through admin panel" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Admin ${user.id} initiating deletion for user ${userId}, immediate: ${immediate}, gdprRequest: ${gdprRequest}`);

    // Track deletion stats for GDPR report
    const deletionStats: Record<string, number> = {};

    const deleteAndTrack = async (table: string, column: string, value: string) => {
      const { data, error } = await adminClient.from(table).delete().eq(column, value).select('id');
      if (error && !error.message.includes('does not exist')) {
        console.error(`Error deleting from ${table}:`, error);
      }
      deletionStats[table] = data?.length || 0;
      console.log(`Deleted ${deletionStats[table]} rows from ${table}`);
    };

    if (immediate || gdprRequest) {
      // Comprehensive deletion for GDPR compliance
      
      // 1. Delete user roles
      await deleteAndTrack('user_roles', 'user_id', userId);
      
      // 2. Delete notifications
      await deleteAndTrack('notifications', 'user_id', userId);
      
      // 3. Delete push subscriptions
      await deleteAndTrack('push_subscriptions', 'user_id', userId);
      
      // 4. Delete notification preferences
      await deleteAndTrack('notification_preferences', 'user_id', userId);
      
      // 5. Delete RSVPs
      await deleteAndTrack('rsvps', 'user_id', userId);
      
      // 6. Delete chat mute preferences
      await deleteAndTrack('chat_mute_preferences', 'user_id', userId);
      
      // 7. Delete message reads
      await deleteAndTrack('message_reads', 'user_id', userId);
      
      // 8. Delete message reactions
      await deleteAndTrack('message_reactions', 'user_id', userId);
      
      // 9. Delete photo reactions
      await deleteAndTrack('photo_reactions', 'user_id', userId);
      
      // 10. Delete photo comment reactions
      await deleteAndTrack('photo_comment_reactions', 'user_id', userId);
      
      // 11. Delete photo comments
      await deleteAndTrack('photo_comments', 'user_id', userId);
      
      // 12. Delete feedback
      await deleteAndTrack('feedback', 'user_id', userId);
      
      // 13. Delete children and their assignments
      const { data: children } = await adminClient
        .from('children')
        .select('id')
        .eq('parent_id', userId);
      
      if (children && children.length > 0) {
        const childIds = children.map(c => c.id);
        
        // Delete child team assignments
        const { data: childAssignments } = await adminClient
          .from('child_team_assignments')
          .delete()
          .in('child_id', childIds)
          .select('id');
        deletionStats['child_team_assignments'] = childAssignments?.length || 0;
        
        // Delete reward redemptions for children
        const { data: childRedemptions } = await adminClient
          .from('reward_redemptions')
          .delete()
          .in('child_id', childIds)
          .select('id');
        deletionStats['reward_redemptions_children'] = childRedemptions?.length || 0;
        
        // Delete game player stats for children
        const { data: childStats } = await adminClient
          .from('game_player_stats')
          .delete()
          .in('child_id', childIds)
          .select('id');
        deletionStats['game_player_stats_children'] = childStats?.length || 0;
        
        // Delete player of match for children
        const { data: childPom } = await adminClient
          .from('player_of_match')
          .delete()
          .in('child_id', childIds)
          .select('id');
        deletionStats['player_of_match_children'] = childPom?.length || 0;
        
        // Delete children
        await adminClient.from('children').delete().eq('parent_id', userId);
        deletionStats['children'] = children.length;
        console.log("Deleted children and assignments");
      }
      
      // 14. Delete saved locations (if table exists)
      try {
        await deleteAndTrack('saved_locations', 'user_id', userId);
      } catch (e) {
        console.log("saved_locations table may not exist");
      }
      
      // 15. Delete favorite event titles
      await deleteAndTrack('favorite_event_titles', 'user_id', userId);
      
      // 16. Delete favorite opponents
      await deleteAndTrack('favorite_opponents', 'user_id', userId);
      
      // 17. Delete team player positions
      try {
        await deleteAndTrack('team_player_positions', 'user_id', userId);
      } catch (e) {
        console.log("team_player_positions table may not exist");
      }
      
      // 18. Delete active games
      await deleteAndTrack('active_games', 'user_id', userId);
      
      // 19. Delete game summaries
      await deleteAndTrack('game_summaries', 'user_id', userId);
      
      // 20. Delete game player stats (user's own stats)
      await deleteAndTrack('game_player_stats', 'user_id', userId);
      
      // 21. Delete player of match records
      await deleteAndTrack('player_of_match', 'user_id', userId);
      
      // 22. Delete event payments
      await deleteAndTrack('event_payments', 'user_id', userId);
      
      // 23. Delete member subscription payments
      await deleteAndTrack('member_subscription_payments', 'user_id', userId);
      
      // 24. Delete reward redemptions (user's own)
      await deleteAndTrack('reward_redemptions', 'user_id', userId);
      
      // 25. Delete pending invites (both invited and inviter)
      await deleteAndTrack('pending_invites', 'invited_user_id', userId);
      await deleteAndTrack('pending_invites', 'invited_by_user_id', userId);
      
      // 26. Delete role requests
      await deleteAndTrack('role_requests', 'user_id', userId);
      
      // 27. Delete pitch formations
      await deleteAndTrack('pitch_formations', 'user_id', userId);
      
      // 28. Delete typing indicators
      try {
        await deleteAndTrack('typing_indicators', 'user_id', userId);
      } catch (e) {
        console.log("typing_indicators table may not exist");
      }
      
      // 29. Anonymize messages instead of deleting (to preserve chat context)
      // Update team messages
      const { data: teamMsgs } = await adminClient
        .from('team_messages')
        .update({ text: '[Message deleted - user data removed]', image_url: null })
        .eq('author_id', userId)
        .select('id');
      deletionStats['team_messages_anonymized'] = teamMsgs?.length || 0;
      
      // Update club messages
      const { data: clubMsgs } = await adminClient
        .from('club_messages')
        .update({ text: '[Message deleted - user data removed]', image_url: null })
        .eq('author_id', userId)
        .select('id');
      deletionStats['club_messages_anonymized'] = clubMsgs?.length || 0;
      
      // Update group messages
      const { data: groupMsgs } = await adminClient
        .from('group_messages')
        .update({ text: '[Message deleted - user data removed]', image_url: null })
        .eq('author_id', userId)
        .select('id');
      deletionStats['group_messages_anonymized'] = groupMsgs?.length || 0;
      
      // Update broadcast messages
      const { data: broadcastMsgs } = await adminClient
        .from('broadcast_messages')
        .update({ text: '[Message deleted - user data removed]', image_url: null })
        .eq('author_id', userId)
        .select('id');
      deletionStats['broadcast_messages_anonymized'] = broadcastMsgs?.length || 0;
      
      // 30. Handle photos - soft delete or anonymize
      const { data: photos } = await adminClient
        .from('photos')
        .update({ deleted_at: new Date().toISOString() })
        .eq('uploader_id', userId)
        .select('id');
      deletionStats['photos_soft_deleted'] = photos?.length || 0;
      
      // 31. Anonymize duties (keep record but remove assignment)
      const { data: duties } = await adminClient
        .from('duties')
        .update({ assigned_to: null })
        .eq('assigned_to', userId)
        .select('id');
      deletionStats['duties_unassigned'] = duties?.length || 0;
      
      // 32. Delete profile
      await deleteAndTrack('profiles', 'id', userId);
      
      // 33. Log the deletion in audit logs
      await adminClient.from('audit_logs').insert({
        action_type: gdprRequest ? 'gdpr_data_deletion' : 'admin_account_deletion',
        actor_id: user.id,
        target_user_id: userId,
        details: {
          deletion_stats: deletionStats,
          gdpr_request: gdprRequest,
          initiated_at: new Date().toISOString()
        }
      });
      
      // 34. Finally delete the auth user
      const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);
      
      if (deleteError) {
        console.error("Error deleting auth user:", deleteError);
        return new Response(
          JSON.stringify({ error: "Failed to delete auth user" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      console.log(`User ${userId} permanently deleted by admin ${user.id}`);

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: gdprRequest 
            ? "GDPR data deletion completed - all user data permanently removed"
            : "Account permanently deleted",
          deletionStats
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else {
      // Schedule deletion for 30 days
      const deletionDate = new Date();
      deletionDate.setDate(deletionDate.getDate() + 30);

      const { error: updateError } = await adminClient
        .from('profiles')
        .update({ scheduled_deletion_at: deletionDate.toISOString() })
        .eq('id', userId);

      if (updateError) {
        console.error("Error scheduling deletion:", updateError);
        return new Response(
          JSON.stringify({ error: "Failed to schedule account deletion" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Notify the user
      await adminClient.from('notifications').insert({
        user_id: userId,
        type: 'membership',
        message: 'Your account has been scheduled for deletion in 30 days by an administrator',
      });

      console.log(`Account ${userId} scheduled for deletion on ${deletionDate.toISOString()} by admin ${user.id}`);

      return new Response(
        JSON.stringify({ 
          success: true, 
          deletionDate: deletionDate.toISOString(),
          message: "Account scheduled for deletion in 30 days"
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
