import { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cacheRoles, getCachedRoles } from "@/lib/rolesCache";
import { cacheClubs, cacheTeams, getCachedClubs, getCachedTeams } from "@/lib/clubTeamCache";

const MESSAGES_PER_PAGE = 15;

export async function prefetchUserData(queryClient: QueryClient, userId: string) {
  // Run prefetch in background - never block UI
  doPrefetch(queryClient, userId).catch(console.error);
}

async function doPrefetch(queryClient: QueryClient, userId: string) {
  try {
    // Check for cached roles first
    const cachedRoles = getCachedRoles();
    
    // Fetch all initial data in parallel - including media access check
    const [rolesResult, chatGroupsResult, broadcastResult] = await Promise.all([
      supabase
        .from("user_roles")
        .select("id, role, club_id, team_id")
        .eq("user_id", userId),
      supabase
        .from("chat_groups")
        .select("id, name, club_id, team_id, allowed_roles"),
      supabase
        .from("broadcast_messages")
        .select("id, text, image_url, created_at, author_id, reply_to_id")
        .order("created_at", { ascending: false })
        .limit(MESSAGES_PER_PAGE + 1),
    ]);

    const roles = rolesResult.data || [];
    const chatGroups = chatGroupsResult.data || [];
    
    // Cache roles in localStorage for quick access
    cacheRoles(roles);
    
    // Cache roles in React Query
    queryClient.setQueryData(["userRoles", userId], roles);

    const clubIds = [...new Set(roles.map(r => r.club_id).filter(Boolean))] as string[];
    const teamIds = [...new Set(roles.map(r => r.team_id).filter(Boolean))] as string[];
    
    // Fetch and cache club/team metadata
    await prefetchClubTeamMetadata(clubIds, teamIds);
    
    // Prefetch media access data in parallel with other fetches
    const isAppAdmin = roles.some(r => r.role === "app_admin");
    prefetchMediaAccess(queryClient, userId, roles, isAppAdmin, clubIds, teamIds);

    // Determine accessible groups
    const accessibleGroups = chatGroups.filter(group => {
      const userRolesForGroup = roles.filter(r =>
        (group.club_id && r.club_id === group.club_id) ||
        (group.team_id && r.team_id === group.team_id)
      );
      return userRolesForGroup.some(r => (group.allowed_roles as string[]).includes(r.role));
    });

    // Cache broadcast messages (simplified - no nested fetches)
    if (broadcastResult.data) {
      const messagesToCache = broadcastResult.data.slice(0, MESSAGES_PER_PAGE);
      const broadcastMessages = messagesToCache.map((msg: any) => ({
        ...msg,
        reactions: [],
        reply_to: null, // Will be fetched on demand
      }));
      queryClient.setQueryData(["broadcast-messages"], {
        messages: broadcastMessages,
        hasOlderMessages: (broadcastResult.data?.length || 0) > MESSAGES_PER_PAGE,
      });
    }

    // Fetch all messages in parallel - simple queries without joins for speed
    const messagePromises: Promise<void>[] = [];

    // Team messages - fetch WITHOUT profiles join (avoids timeout from large avatar_url)
    teamIds.forEach(teamId => {
      const promise = async (): Promise<void> => {
        const { data } = await supabase
          .from("team_messages")
          .select("id, text, image_url, created_at, author_id, team_id, reply_to_id")
          .eq("team_id", teamId)
          .order("created_at", { ascending: false })
          .limit(MESSAGES_PER_PAGE + 1);
        
        if (data) {
          const messagesToCache = data.slice(0, MESSAGES_PER_PAGE);
          const messages = messagesToCache.map((msg: any) => ({
            ...msg,
            profiles: null, // Profiles fetched on-demand in chat page
            reactions: [],
            reply_to: null,
          }));
          
          queryClient.setQueryData(["team-messages", teamId], {
            messages,
            hasOlderMessages: data.length > MESSAGES_PER_PAGE,
          });
        }
      };
      messagePromises.push(promise());
    });

    // Club messages - fetch WITHOUT profiles join
    clubIds.forEach(clubId => {
      const promise = async (): Promise<void> => {
        const { data } = await supabase
          .from("club_messages")
          .select("id, text, image_url, created_at, author_id, club_id, reply_to_id")
          .eq("club_id", clubId)
          .order("created_at", { ascending: false })
          .limit(MESSAGES_PER_PAGE + 1);
        
        if (data) {
          const messagesToCache = data.slice(0, MESSAGES_PER_PAGE);
          const messages = messagesToCache.map((msg: any) => ({
            ...msg,
            profiles: null, // Profiles fetched on-demand in chat page
            reactions: [],
            reply_to: null,
          }));
          
          queryClient.setQueryData(["club-messages", clubId], {
            messages,
            hasOlderMessages: data.length > MESSAGES_PER_PAGE,
          });
        }
      };
      messagePromises.push(promise());
    });

    // Group messages - fetch WITHOUT profiles join
    accessibleGroups.forEach(group => {
      const promise = async (): Promise<void> => {
        const { data } = await supabase
          .from("group_messages")
          .select("id, text, image_url, created_at, author_id, group_id, reply_to_id")
          .eq("group_id", group.id)
          .order("created_at", { ascending: false })
          .limit(MESSAGES_PER_PAGE + 1);
        
        if (data) {
          const messagesToCache = data.slice(0, MESSAGES_PER_PAGE);
          const messages = messagesToCache.map((msg: any) => ({
            ...msg,
            author: null, // Profiles fetched on-demand in chat page
            reactions: [],
            reply_to: null,
          }));
          
          queryClient.setQueryData(["group-messages", group.id], {
            messages,
            hasOlderMessages: data.length > MESSAGES_PER_PAGE,
          });
        }
      };
      messagePromises.push(promise());
    });

    // Fire and forget - don't await message fetches
    Promise.allSettled(messagePromises).catch(console.error);
  } catch (error) {
    console.error("Prefetch error:", error);
    // Don't throw - let login continue even if prefetch fails
  }
}

// Prefetch media access data for faster MediaPage load
async function prefetchMediaAccess(
  queryClient: QueryClient, 
  userId: string, 
  roles: Array<{ id: string; role: string; club_id: string | null; team_id: string | null }>,
  isAppAdmin: boolean,
  clubIds: string[],
  teamIds: string[]
) {
  try {
    // Get profile in parallel with Pro check
    const profilePromise = supabase
      .from("profiles")
      .select("display_name, avatar_url")
      .eq("id", userId)
      .maybeSingle();

    // App admins have full access
    if (isAppAdmin) {
      const profileResult = await profilePromise;
      queryClient.setQueryData(["media-access-data", userId], {
        profile: profileResult.data,
        roles,
        isAppAdmin: true,
        hasProClub: true,
      });
      return;
    }

    // Check Pro access in parallel with profile fetch
    // Pro Access Logic: Club Pro → all teams inherit; Free club → check team subscription
    const [profileResult, teamsResult, clubSubsResult] = await Promise.all([
      profilePromise,
      teamIds.length > 0 
        ? supabase.from("teams").select("id, club_id").in("id", teamIds)
        : Promise.resolve({ data: null }),
      clubIds.length > 0
        ? supabase.from("club_subscriptions").select("club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override").in("club_id", clubIds)
        : Promise.resolve({ data: null }),
    ]);

    let hasProClub = false;
    
    // First check direct club subscriptions
    if (clubSubsResult.data && clubSubsResult.data.some(s => 
      s.is_pro || s.is_pro_football || s.admin_pro_override || s.admin_pro_football_override
    )) {
      hasProClub = true;
    }
    
    // Check parent clubs of teams
    if (!hasProClub && teamsResult.data) {
      const teamClubIds = [...new Set(teamsResult.data.map(t => t.club_id).filter(Boolean))] as string[];
      if (teamClubIds.length > 0) {
        const { data: teamClubSubs } = await supabase
          .from("club_subscriptions")
          .select("club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
          .in("club_id", teamClubIds);
        
        const parentClubHasPro = teamClubSubs && teamClubSubs.some(s => 
          s.is_pro || s.is_pro_football || s.admin_pro_override || s.admin_pro_football_override
        );
        
        if (parentClubHasPro) {
          hasProClub = true;
        }
      }
    }
    
    // If no club has Pro, check team-level subscriptions (for teams in free clubs)
    if (!hasProClub && teamIds.length > 0) {
      const { data: teamSubsResult } = await supabase
        .from("team_subscriptions")
        .select("team_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
        .in("team_id", teamIds);
      
      hasProClub = teamSubsResult && teamSubsResult.some(s => 
        s.is_pro || s.is_pro_football || s.admin_pro_override || s.admin_pro_football_override
      );
    }

    queryClient.setQueryData(["media-access-data", userId], {
      profile: profileResult.data,
      roles,
      isAppAdmin: false,
      hasProClub,
    });
  } catch (error) {
    console.error("Media access prefetch error:", error);
    // Non-critical - MediaPage will fetch this if needed
  }
}

// Prefetch and cache club/team metadata for faster access
async function prefetchClubTeamMetadata(clubIds: string[], teamIds: string[]) {
  try {
    // Check cache first
    const { missing: missingClubIds } = getCachedClubs(clubIds);
    const { missing: missingTeamIds } = getCachedTeams(teamIds);
    
    // Fetch missing clubs
    const clubsPromise = missingClubIds.length > 0
      ? (async () => {
          const { data } = await supabase
            .from("clubs")
            .select("id, name, logo_url, sport, is_pro")
            .in("id", missingClubIds);
          if (data) cacheClubs(data);
        })()
      : Promise.resolve();
    
    // Fetch missing teams
    const teamsPromise = missingTeamIds.length > 0
      ? (async () => {
          const { data } = await supabase
            .from("teams")
            .select("id, name, logo_url, club_id, level_age")
            .in("id", missingTeamIds);
          if (data) cacheTeams(data);
        })()
      : Promise.resolve();
    
    await Promise.all([clubsPromise, teamsPromise]);
  } catch (error) {
    console.error("Club/team metadata prefetch error:", error);
    // Non-critical - data will be fetched on demand
  }
}
