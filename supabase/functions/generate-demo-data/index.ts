import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface GenerateOptions {
  clubs?: boolean;
  teams?: boolean;
  events?: boolean;
  photos?: boolean;
  users?: boolean;
  formations?: boolean;
  messages?: boolean;
  photoEngagement?: boolean;
  vaultFiles?: boolean;
  action?: "generate" | "delete" | "list";
}

const DEMO_CLUB_NAMES = ["Riverside FC", "Northern United", "Eastside Athletic"];

const DEMO_USER_NAMES = [
  // Original 53 names
  "Alex Johnson", "Sam Williams", "Jordan Taylor", "Casey Brown", "Riley Davis",
  "Morgan Smith", "Quinn Wilson", "Avery Martinez", "Charlie Anderson", "Jamie Garcia",
  "Taylor Thomas", "Drew Jackson", "Cameron White", "Skyler Harris", "Reese Clark",
  "Parker Lee", "Blake Moore", "Hayden King", "Dakota Scott", "Finley Green",
  "Rowan Adams", "Emery Hall", "Phoenix Young", "River Allen", "Sage Wright",
  "Kendall Hill", "Peyton Baker", "Jesse Turner", "Micah Campbell", "Kai Mitchell",
  "Logan Roberts", "Bailey Phillips", "Sydney Evans", "Jordan Collins", "Casey Stewart",
  "Morgan Reed", "Riley Murphy", "Alex Cooper", "Taylor Bell", "Jordan Howard",
  "Casey Ward", "Morgan Brooks", "Riley Price", "Alex Ross", "Taylor Gray",
  "Jordan Hayes", "Casey Long", "Morgan Foster", "Riley Sanders", "Alex Perry",
  "Taylor Powell", "Jordan Butler", "Casey Barnes",
  // Additional 50 names to support 9 players per team (9 teams × 9 players = 81 minimum)
  "Ashton Cole", "Devon Fisher", "Ellis Grant", "Harper Diaz", "Jaden Fox",
  "Kelsey Hart", "Landon Moss", "Marley Nash", "Nico Stone", "Oakley West",
  "Presley Black", "Reagan Cruz", "Shane Dean", "Tatum Frost", "Vale Hunt",
  "Wren James", "Zion Kent", "Aiden Lane", "Briar Mills", "Carson Nash",
  "Dallas Poe", "Eden Quinn", "Flynn Rose", "Greer Shaw", "Haven Storm",
  "Indigo Todd", "Jules Vale", "Kerry Webb", "Lane York", "Milan Zane",
  "Noel Park", "Olive Duke", "Piper Eyre", "Quinn Fern", "Rory Glen",
  "Sloane Hart", "Trace Ivy", "Unity Jade", "Vance Kade", "Winter Lake",
  "Xander Moon", "Yara Neve", "Zara Oak", "Arlo Pine", "Blake Reed",
  "Cruz Sage", "Dane Snow", "Echo Tate", "Faye Vale", "Gage Wolf",
];

const DEMO_USER_EMAILS_PREFIX = "demo_user_";
const DEMO_PASSWORD = "demo123456";

// Simple in-memory rate limiting for public endpoints
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10; // 10 requests per minute per IP

function getRateLimitKey(req: Request): string {
  // Get client IP from various headers (Supabase/Cloudflare)
  const forwardedFor = req.headers.get("x-forwarded-for");
  const realIp = req.headers.get("x-real-ip");
  const cfConnectingIp = req.headers.get("cf-connecting-ip");
  return cfConnectingIp || realIp || forwardedFor?.split(",")[0]?.trim() || "unknown";
}

function checkRateLimit(clientId: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const clientData = rateLimitMap.get(clientId);
  
  // Clean up old entries periodically
  if (rateLimitMap.size > 1000) {
    for (const [key, value] of rateLimitMap.entries()) {
      if (now > value.resetTime) {
        rateLimitMap.delete(key);
      }
    }
  }
  
  if (!clientData || now > clientData.resetTime) {
    // New window
    rateLimitMap.set(clientId, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true };
  }
  
  if (clientData.count >= RATE_LIMIT_MAX_REQUESTS) {
    const retryAfter = Math.ceil((clientData.resetTime - now) / 1000);
    return { allowed: false, retryAfter };
  }
  
  clientData.count++;
  return { allowed: true };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Parse body early to check for public actions
    const body = await req.json().catch(() => ({}));
    const action = body.action || "generate";

    // PUBLIC ACTION - list-public doesn't require auth (for login page)
    if (action === "list-public") {
      // Apply rate limiting to public endpoint
      const clientId = getRateLimitKey(req);
      const rateLimit = checkRateLimit(clientId);
      
      if (!rateLimit.allowed) {
        console.log(`Rate limit exceeded for client: ${clientId}`);
        return new Response(
          JSON.stringify({ error: "Too many requests. Please try again later." }),
          { 
            status: 429, 
            headers: { 
              ...corsHeaders, 
              "Content-Type": "application/json",
              "Retry-After": String(rateLimit.retryAfter || 60)
            } 
          }
        );
      }
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      
      // Unassociated user names (must match what's created in generate action)
      const UNASSOCIATED_USER_NAMES = [
        "New User Alex", "New User Sam", "New User Jordan", "New User Casey", "New User Riley"
      ];
      
      // Free-tier demo accounts (single-club, no Pro)
      const FREE_TIER_DEMO_NAMES = ["Free Tier Demo Admin"];
      
      // Combine all demo user names
      const ALL_DEMO_NAMES = [...DEMO_USER_NAMES, ...UNASSOCIATED_USER_NAMES, ...FREE_TIER_DEMO_NAMES];
      
      // Get ALL demo player profiles with their roles and club/team info
      const { data: demoProfiles } = await supabase
        .from("profiles")
        .select("id, display_name, ignite_points")
        .in("display_name", ALL_DEMO_NAMES);
      
      if (!demoProfiles || demoProfiles.length === 0) {
        return new Response(
          JSON.stringify({ success: true, users: [] }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      // Get roles for all demo users
      const demoUserIds = demoProfiles.map(p => p.id);
      const { data: userRoles } = await supabase
        .from("user_roles")
        .select(`
          user_id,
          role,
          club_id,
          team_id,
          clubs(name),
          teams(name, clubs(name))
        `)
        .in("user_id", demoUserIds);
      
      // Build a map of user_id to their roles and affiliations
      const userRolesMap = new Map<string, { roles: string[]; clubs: string[]; teams: string[] }>();
      
      for (const role of (userRoles || [])) {
        if (!userRolesMap.has(role.user_id)) {
          userRolesMap.set(role.user_id, { roles: [], clubs: [], teams: [] });
        }
        const userData = userRolesMap.get(role.user_id)!;
        
        const roleName = role.role.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
        
        let teamName = '';
        let clubName = '';
        
        if (role.teams && typeof role.teams === 'object' && 'name' in role.teams) {
          const team = role.teams as { name: string; clubs?: { name: string } };
          teamName = team.name;
          if (team.clubs) {
            clubName = team.clubs.name;
          }
        }
        
        if (!teamName && role.clubs && typeof role.clubs === 'object' && 'name' in role.clubs) {
          clubName = (role.clubs as { name: string }).name;
        }
        
        userData.roles.push(roleName);
        userData.teams.push(teamName);
        userData.clubs.push(clubName);
      }
      
      // Build the user list with role and club info
      const allUsers = demoProfiles.map((profile) => {
        const demoIndex = DEMO_USER_NAMES.indexOf(profile.display_name);
        const unassociatedIndex = UNASSOCIATED_USER_NAMES.indexOf(profile.display_name);
        const freeTierIndex = FREE_TIER_DEMO_NAMES.indexOf(profile.display_name);
        const roleData = userRolesMap.get(profile.id);
        
        // Determine email based on user type
        let email: string;
        if (demoIndex >= 0) {
          email = `${DEMO_USER_EMAILS_PREFIX}${demoIndex + 1}@demo.local`;
        } else if (unassociatedIndex >= 0) {
          email = `demo_unassociated_${unassociatedIndex + 1}@demo.local`;
        } else if (freeTierIndex >= 0) {
          email = `demo_free_${freeTierIndex + 1}@demo.local`;
        } else {
          email = `demo_unknown@demo.local`;
        }
        
        return {
          id: profile.id,
          name: profile.display_name,
          email,
          password: DEMO_PASSWORD,
          roles: roleData?.roles || [],
          clubs: roleData?.clubs || [],
          teams: roleData?.teams || [],
          ignite_points: profile.ignite_points || 0,
        };
      });
      
      // Sort: users with roles first, then by name
      allUsers.sort((a, b) => {
        const aHasRoles = a.roles.length > 0 ? 0 : 1;
        const bHasRoles = b.roles.length > 0 ? 0 : 1;
        if (aHasRoles !== bHasRoles) return aHasRoles - bHasRoles;
        return a.name.localeCompare(b.name);
      });
      
      return new Response(
        JSON.stringify({ success: true, users: allUsers }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get the user from the auth header for protected actions
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.error("No authorization header");
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Extract token and verify with service role client
    const token = authHeader.replace("Bearer ", "");
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Use admin API to get user by token - more reliable than getUser with token
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError) {
      console.error("Auth error:", authError.message);
      // Provide more specific error message
      return new Response(JSON.stringify({ 
        error: "Unauthorized", 
        message: "Session expired or invalid. Please refresh the page and try again." 
      }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    
    if (!user) {
      console.error("No user found for token");
      return new Response(JSON.stringify({ 
        error: "Unauthorized",
        message: "User not found. Please log in again." 
      }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Authenticated user:", user.id);

    // Check if user is app_admin (reusing supabase client from above)

    // Check if user is app_admin
    const { data: adminRole } = await supabase
      .from("user_roles")
      .select("id")
      .eq("user_id", user.id)
      .eq("role", "app_admin")
      .single();

    if (!adminRole) {
      return new Response(JSON.stringify({ error: "Forbidden - Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // LIST ACTION - Return demo users for login with role and club info (authenticated)

    // LIST ACTION - Return demo users for login with role and club info
    if (action === "list") {
      // Get ALL demo player profiles with their roles and club/team info
      const { data: demoProfiles } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("display_name", DEMO_USER_NAMES);
      
      if (!demoProfiles || demoProfiles.length === 0) {
        return new Response(
          JSON.stringify({ success: true, users: [] }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      // Get roles for all demo users
      const demoUserIds = demoProfiles.map(p => p.id);
      const { data: userRoles } = await supabase
        .from("user_roles")
        .select(`
          user_id,
          role,
          club_id,
          team_id,
          clubs(name),
          teams(name, clubs(name))
        `)
        .in("user_id", demoUserIds);
      
      // Build a map of user_id to their roles and affiliations (aligned arrays)
      const userRolesMap = new Map<string, { roles: string[]; clubs: string[]; teams: string[] }>();
      
      for (const role of (userRoles || [])) {
        if (!userRolesMap.has(role.user_id)) {
          userRolesMap.set(role.user_id, { roles: [], clubs: [], teams: [] });
        }
        const userData = userRolesMap.get(role.user_id)!;
        
        // Format role name
        const roleName = role.role.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
        
        // Get team name if available
        let teamName = '';
        let clubName = '';
        
        if (role.teams && typeof role.teams === 'object' && 'name' in role.teams) {
          const team = role.teams as { name: string; clubs?: { name: string } };
          teamName = team.name;
          if (team.clubs) {
            clubName = team.clubs.name;
          }
        }
        
        // Get club name if no team (club-level role)
        if (!teamName && role.clubs && typeof role.clubs === 'object' && 'name' in role.clubs) {
          clubName = (role.clubs as { name: string }).name;
        }
        
        // Add aligned entries - each role with its corresponding team/club
        userData.roles.push(roleName);
        userData.teams.push(teamName);
        userData.clubs.push(clubName);
      }
      
      // Build the user list with role and club info
      const allUsers = demoProfiles.map((profile) => {
        const demoIndex = DEMO_USER_NAMES.indexOf(profile.display_name);
        const roleData = userRolesMap.get(profile.id);
        
        return {
          id: profile.id,
          name: profile.display_name,
          email: `${DEMO_USER_EMAILS_PREFIX}${demoIndex + 1}@demo.local`,
          password: DEMO_PASSWORD,
          roles: roleData?.roles || [],
          clubs: roleData?.clubs || [],
          teams: roleData?.teams || [],
        };
      });
      
      // Sort: users with roles first, then by name
      allUsers.sort((a, b) => {
        const aHasRoles = a.roles.length > 0 ? 0 : 1;
        const bHasRoles = b.roles.length > 0 ? 0 : 1;
        if (aHasRoles !== bHasRoles) return aHasRoles - bHasRoles;
        return a.name.localeCompare(b.name);
      });
      
      return new Response(
        JSON.stringify({ success: true, users: allUsers }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const options: GenerateOptions = {
      clubs: body.clubs ?? false,
      teams: body.teams ?? false,
      events: body.events ?? false,
      photos: body.photos ?? false,
      users: body.users ?? false,
      formations: body.formations ?? false,
      messages: body.messages ?? false,
      photoEngagement: body.photoEngagement ?? false,
      vaultFiles: body.vaultFiles ?? false,
    };

    // If nothing selected, return error
    if (!options.clubs && !options.teams && !options.events && !options.photos && !options.users && !options.formations && !options.messages && !options.photoEngagement && !options.vaultFiles) {
      return new Response(JSON.stringify({ error: "Please select at least one type of data" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: string[] = [];

    // DELETE ACTION
    if (action === "delete") {
      // Delete in order: vaultFiles -> photoEngagement -> messages -> formations -> photos -> events -> users -> teams -> clubs (due to foreign keys)
      
      if (options.vaultFiles) {
        const { data: demoClubs } = await supabase
          .from("clubs")
          .select("id")
          .in("name", DEMO_CLUB_NAMES);
        
        if (demoClubs && demoClubs.length > 0) {
          const clubIds = demoClubs.map(c => c.id);
          
          // Delete vault files first
          const { data: deletedFiles } = await supabase
            .from("vault_files")
            .delete()
            .in("club_id", clubIds)
            .select("id");
          
          // Delete vault folders
          const { data: deletedFolders } = await supabase
            .from("vault_folders")
            .delete()
            .in("club_id", clubIds)
            .select("id");
          
          results.push(`🗑️ Deleted ${deletedFiles?.length || 0} vault files and ${deletedFolders?.length || 0} folders`);
        }
      }
      
      if (options.photoEngagement) {
        // Delete photo reactions and comments from demo photos
        const { data: demoPhotos } = await supabase
          .from("photos")
          .select("id")
          .like("file_url", "%unsplash.com%");
        
        if (demoPhotos && demoPhotos.length > 0) {
          const photoIds = demoPhotos.map(p => p.id);
          
          const { data: deletedReactions } = await supabase
            .from("photo_reactions")
            .delete()
            .in("photo_id", photoIds)
            .select("id");
          
          const { data: deletedComments } = await supabase
            .from("photo_comments")
            .delete()
            .in("photo_id", photoIds)
            .select("id");
          
          results.push(`🗑️ Deleted ${deletedReactions?.length || 0} photo reactions and ${deletedComments?.length || 0} comments`);
        }
      }

      if (options.messages) {
        const { data: demoClubs } = await supabase
          .from("clubs")
          .select("id")
          .in("name", DEMO_CLUB_NAMES);
        
        if (demoClubs && demoClubs.length > 0) {
          const clubIds = demoClubs.map(c => c.id);
          
          // Delete club messages
          const { data: deletedClubMsgs } = await supabase
            .from("club_messages")
            .delete()
            .in("club_id", clubIds)
            .select("id");
          
          // Delete team messages
          const { data: teams } = await supabase
            .from("teams")
            .select("id")
            .in("club_id", clubIds);
          
          let teamMsgsDeleted = 0;
          if (teams && teams.length > 0) {
            const teamIds = teams.map(t => t.id);
            const { data: deletedTeamMsgs } = await supabase
              .from("team_messages")
              .delete()
              .in("team_id", teamIds)
              .select("id");
            teamMsgsDeleted = deletedTeamMsgs?.length || 0;
          }
          
          results.push(`🗑️ Deleted ${deletedClubMsgs?.length || 0} club messages and ${teamMsgsDeleted} team messages`);
        }
      }
      
      if (options.formations) {
        const { data: demoClubs } = await supabase
          .from("clubs")
          .select("id")
          .in("name", DEMO_CLUB_NAMES);
        
        if (demoClubs && demoClubs.length > 0) {
          const clubIds = demoClubs.map(c => c.id);
          const { data: teams } = await supabase
            .from("teams")
            .select("id")
            .in("club_id", clubIds);
          
          if (teams && teams.length > 0) {
            const teamIds = teams.map(t => t.id);
            const { data: deleted, error } = await supabase
              .from("pitch_formations")
              .delete()
              .in("team_id", teamIds)
              .select("id");
            
            if (error) {
              results.push(`❌ Failed to delete formations: ${error.message}`);
            } else {
              results.push(`🗑️ Deleted ${deleted?.length || 0} demo formations`);
            }
          }
        }
      }

      if (options.photos) {
        const { data: deletedPhotos, error: photoErr } = await supabase
          .from("photos")
          .delete()
          .like("file_url", "%unsplash.com%")
          .select("id");
        
        if (photoErr) {
          results.push(`❌ Failed to delete photos: ${photoErr.message}`);
        } else {
          results.push(`🗑️ Deleted ${deletedPhotos?.length || 0} demo photos`);
        }
      }

      if (options.events) {
        const { data: demoClubs } = await supabase
          .from("clubs")
          .select("id")
          .in("name", DEMO_CLUB_NAMES);
        
        if (demoClubs && demoClubs.length > 0) {
          const clubIds = demoClubs.map(c => c.id);
          const { data: deletedEvents, error: eventErr } = await supabase
            .from("events")
            .delete()
            .in("club_id", clubIds)
            .select("id");
          
          if (eventErr) {
            results.push(`❌ Failed to delete events: ${eventErr.message}`);
          } else {
            results.push(`🗑️ Deleted ${deletedEvents?.length || 0} demo events`);
          }
        } else {
          results.push("⚠️ No demo clubs found to delete events from");
        }
      }

      if (options.users) {
        // Demo child names - must match what's created in generate action
        const DEMO_CHILD_NAMES = [
          "Max Johnson", "Lily Williams", "Jake Taylor", "Emma Brown", 
          "Noah Davis", "Olivia Smith", "Ethan Wilson", "Ava Martinez",
          "Lucas Anderson", "Mia Garcia", "Mason Thomas", "Sophie Jackson",
          "Henry Clark", "Chloe White", "Leo Harris", "Zoe Lewis", 
          "Jack Robinson", "Grace Walker", "Owen Hall", "Ella Young",
        ];
        
        // Unassociated user names
        const UNASSOCIATED_USER_NAMES = [
          "New User Alex", "New User Sam", "New User Jordan", "New User Casey", "New User Riley"
        ];
        
        // Delete demo children FIRST by name (more reliable than by parent_id)
        const { data: demoChildren } = await supabase
          .from("children")
          .select("id")
          .in("name", DEMO_CHILD_NAMES);
        
        if (demoChildren && demoChildren.length > 0) {
          const childIds = demoChildren.map(c => c.id);
          // Delete child team assignments first
          await supabase.from("child_team_assignments").delete().in("child_id", childIds);
          // Delete reward redemptions for children
          await supabase.from("reward_redemptions").delete().in("child_id", childIds);
          // Delete player of match for children
          await supabase.from("player_of_match").delete().in("child_id", childIds);
          // Delete RSVPs for children
          await supabase.from("rsvps").delete().in("child_id", childIds);
          // Delete children
          const { data: deletedChildren, error: childErr } = await supabase
            .from("children")
            .delete()
            .in("id", childIds)
            .select("id");
          
          if (childErr) {
            results.push(`❌ Failed to delete children: ${childErr.message}`);
          } else {
            results.push(`🗑️ Deleted ${deletedChildren?.length || 0} demo children`);
          }
        }
        
        // Delete demo users - find profiles that match demo pattern (including unassociated)
        const ALL_DEMO_USER_NAMES = [...DEMO_USER_NAMES, ...UNASSOCIATED_USER_NAMES];
        const { data: demoProfiles } = await supabase
          .from("profiles")
          .select("id, display_name")
          .in("display_name", ALL_DEMO_USER_NAMES);
        
        if (demoProfiles && demoProfiles.length > 0) {
          const profileIds = demoProfiles.map(p => p.id);
          
          // Delete any remaining children by parent_id (fallback)
          const { data: remainingChildren } = await supabase
            .from("children")
            .select("id")
            .in("parent_id", profileIds);
          
          if (remainingChildren && remainingChildren.length > 0) {
            const childIds = remainingChildren.map(c => c.id);
            await supabase.from("child_team_assignments").delete().in("child_id", childIds);
            await supabase.from("reward_redemptions").delete().in("child_id", childIds);
            await supabase.from("player_of_match").delete().in("child_id", childIds);
            await supabase.from("rsvps").delete().in("child_id", childIds);
            await supabase.from("children").delete().in("id", childIds);
          }
          
          // Delete user roles
          await supabase.from("user_roles").delete().in("user_id", profileIds);
          // Delete team player positions
          await supabase.from("team_player_positions").delete().in("user_id", profileIds);
          // Delete profiles
          const { data: deleted, error } = await supabase
            .from("profiles")
            .delete()
            .in("id", profileIds)
            .select("id");
          
          if (error) {
            results.push(`❌ Failed to delete demo users: ${error.message}`);
          } else {
            results.push(`🗑️ Deleted ${deleted?.length || 0} demo users`);
          }
          
          // Try to delete auth users (may fail due to permissions)
          for (const profileId of profileIds) {
            try {
              await supabase.auth.admin.deleteUser(profileId);
            } catch (e) {
              console.log(`Could not delete auth user ${profileId}`);
            }
          }
        } else {
          results.push("⚠️ No demo users found to delete");
        }
      }

      if (options.teams) {
        const { data: demoClubs } = await supabase
          .from("clubs")
          .select("id")
          .in("name", DEMO_CLUB_NAMES);
        
        if (demoClubs && demoClubs.length > 0) {
          const clubIds = demoClubs.map(c => c.id);
          
          const { data: teamsToDelete } = await supabase
            .from("teams")
            .select("id")
            .in("club_id", clubIds);
          
          if (teamsToDelete && teamsToDelete.length > 0) {
            const teamIds = teamsToDelete.map(t => t.id);
            
            await supabase.from("team_subscriptions").delete().in("team_id", teamIds);
            await supabase.from("user_roles").delete().in("team_id", teamIds);
            await supabase.from("team_player_positions").delete().in("team_id", teamIds);
            await supabase.from("pitch_formations").delete().in("team_id", teamIds);
            
            const { data: deletedTeams, error: teamErr } = await supabase
              .from("teams")
              .delete()
              .in("id", teamIds)
              .select("id");
            
            if (teamErr) {
              results.push(`❌ Failed to delete teams: ${teamErr.message}`);
            } else {
              results.push(`🗑️ Deleted ${deletedTeams?.length || 0} demo teams`);
            }
          }
        } else {
          results.push("⚠️ No demo clubs found to delete teams from");
        }
      }

      if (options.clubs) {
        const { data: demoClubs } = await supabase
          .from("clubs")
          .select("id")
          .in("name", DEMO_CLUB_NAMES);
        
        if (demoClubs && demoClubs.length > 0) {
          const clubIds = demoClubs.map(c => c.id);
          
          // Delete rewards first (has FK to sponsors and clubs)
          const { data: deletedRewards } = await supabase
            .from("club_rewards")
            .delete()
            .in("club_id", clubIds)
            .select("id");
          
          if (deletedRewards && deletedRewards.length > 0) {
            results.push(`🗑️ Deleted ${deletedRewards.length} demo rewards`);
          }
          
          // Delete sponsors (due to FK from clubs.primary_sponsor_id)
          // First clear primary_sponsor_id references
          await supabase.from("clubs").update({ primary_sponsor_id: null }).in("id", clubIds);
          
          // Delete sponsors
          const { data: deletedSponsors } = await supabase
            .from("sponsors")
            .delete()
            .in("club_id", clubIds)
            .select("id");
          
          if (deletedSponsors && deletedSponsors.length > 0) {
            results.push(`🗑️ Deleted ${deletedSponsors.length} demo sponsors`);
          }
          
          await supabase.from("club_subscriptions").delete().in("club_id", clubIds);
          await supabase.from("user_roles").delete().in("club_id", clubIds);
          
          const { data: deletedClubs, error: clubErr } = await supabase
            .from("clubs")
            .delete()
            .in("id", clubIds)
            .select("id");
          
          if (clubErr) {
            results.push(`❌ Failed to delete clubs: ${clubErr.message}`);
          } else {
            results.push(`🗑️ Deleted ${deletedClubs?.length || 0} demo clubs`);
          }
        } else {
          results.push("⚠️ No demo clubs found to delete");
        }
      }

      return new Response(
        JSON.stringify({ success: true, message: "Demo data deleted", details: results }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // GENERATE ACTION
    let createdClubs: { id: string; name: string }[] = [];
    let createdTeams: { id: string; name: string; club_id: string }[] = [];
    let createdUsers: { id: string; name: string }[] = [];

    const { data: existingClubs } = await supabase
      .from("clubs")
      .select("id, name")
      .in("name", DEMO_CLUB_NAMES);
    
    // Only get demo teams (teams belonging to demo clubs)
    const demoClubIds = (existingClubs || []).map(c => c.id);
    const { data: existingTeams } = await supabase
      .from("teams")
      .select("id, name, club_id")
      .in("club_id", demoClubIds.length > 0 ? demoClubIds : ['00000000-0000-0000-0000-000000000000'])

    // Demo logo URLs (placeholder sports logos from dicebear)
    const DEMO_CLUB_LOGOS = [
      "https://api.dicebear.com/7.x/shapes/svg?seed=riverside&backgroundColor=2563eb&shape1Color=ffffff",
      "https://api.dicebear.com/7.x/shapes/svg?seed=northern&backgroundColor=dc2626&shape1Color=ffffff",
      "https://api.dicebear.com/7.x/shapes/svg?seed=eastside&backgroundColor=16a34a&shape1Color=ffffff",
    ];
    
    const DEMO_TEAM_LOGOS = [
      "https://api.dicebear.com/7.x/shapes/svg?seed=u12boys&backgroundColor=3b82f6&shape1Color=fbbf24",
      "https://api.dicebear.com/7.x/shapes/svg?seed=u10girls&backgroundColor=ec4899&shape1Color=ffffff",
      "https://api.dicebear.com/7.x/shapes/svg?seed=u14mixed&backgroundColor=8b5cf6&shape1Color=ffffff",
      "https://api.dicebear.com/7.x/shapes/svg?seed=seniormen&backgroundColor=1f2937&shape1Color=f59e0b",
    ];

    // GENERATE CLUBS - with varied subscription levels and sports
    if (options.clubs) {
      // Club configurations with different subscription tiers:
      // - Riverside FC: Football club with Pro Football (full features)
      // - Northern United: Football club with mixed team subscriptions
      // - Eastside Athletic: Basketball club (NOT football) on free membership
      const demoClubs = [
        { 
          name: "Riverside FC", 
          description: "A community football club for all ages", 
          sport: "football", 
          logo_url: DEMO_CLUB_LOGOS[0],
          is_pro: true,
          subscription: { is_pro: true, is_pro_football: true, plan: "unlimited" as const }
        },
        { 
          name: "Northern United", 
          description: "Premier youth soccer development with varied team plans", 
          sport: "football", 
          logo_url: DEMO_CLUB_LOGOS[1],
          is_pro: true,
          subscription: { is_pro: true, is_pro_football: true, plan: "unlimited" as const }
        },
        { 
          name: "Eastside Athletic", 
          description: "Community basketball club for all skill levels", 
          sport: "basketball", 
          logo_url: DEMO_CLUB_LOGOS[2],
          is_pro: false,
          subscription: { is_pro: false, is_pro_football: false, plan: "starter" as const }
        },
      ];

      for (const club of demoClubs) {
        const { data: existingClub } = await supabase
          .from("clubs")
          .select("id")
          .eq("name", club.name)
          .single();

        if (existingClub) {
          results.push(`Club "${club.name}" already exists, skipping`);
          createdClubs.push({ id: existingClub.id, name: club.name });
          continue;
        }

        const { data: newClub, error: clubError } = await supabase
          .from("clubs")
          .insert({
            name: club.name,
            description: club.description,
            sport: club.sport,
            logo_url: club.logo_url,
            created_by: user.id,
            is_pro: club.is_pro,
          })
          .select()
          .single();

        if (clubError) {
          results.push(`Failed to create club "${club.name}": ${clubError.message}`);
          continue;
        }

        createdClubs.push({ id: newClub.id, name: club.name });
        const tier = club.subscription.is_pro_football ? "Pro Football" : 
                     club.subscription.is_pro ? "Pro" : "Free";
        results.push(`✓ Created club: ${club.name} (${tier})`);

        await supabase.from("user_roles").insert({
          user_id: user.id,
          role: "club_admin",
          club_id: newClub.id,
        });

        await supabase.from("club_subscriptions").insert({
          club_id: newClub.id,
          is_pro: club.subscription.is_pro,
          is_pro_football: club.subscription.is_pro_football,
          plan: club.subscription.plan,
        });
        // Create mock sponsors for Pro clubs
        if (club.subscription.is_pro) {
          const sponsorTemplates = [
            { 
              name: "SportsTech Pro", 
              description: "Premium sports technology solutions for modern athletes",
              website_url: "https://example.com/sportstech",
              logo_url: "https://api.dicebear.com/7.x/shapes/svg?seed=sportstech&backgroundColor=1e40af&shape1Color=60a5fa"
            },
            { 
              name: "LocalBrew Coffee", 
              description: "Fueling our community with the best local coffee",
              website_url: "https://example.com/localbrew",
              logo_url: "https://api.dicebear.com/7.x/shapes/svg?seed=localbrew&backgroundColor=92400e&shape1Color=fbbf24"
            },
            { 
              name: "FitGear Athletics", 
              description: "Quality sports equipment for every level",
              website_url: "https://example.com/fitgear",
              logo_url: "https://api.dicebear.com/7.x/shapes/svg?seed=fitgear&backgroundColor=166534&shape1Color=86efac"
            },
            { 
              name: "Community Bank", 
              description: "Proudly supporting local sports since 1985",
              website_url: "https://example.com/communitybank",
              logo_url: "https://api.dicebear.com/7.x/shapes/svg?seed=communitybank&backgroundColor=4338ca&shape1Color=c7d2fe"
            },
          ];
          
          let sponsorsCreated = 0;
          let primarySponsorId: string | null = null;
          
          for (let sIdx = 0; sIdx < sponsorTemplates.length; sIdx++) {
            const sponsor = sponsorTemplates[sIdx];
            
            // Check if sponsor already exists for this club
            const { data: existingSponsor } = await supabase
              .from("sponsors")
              .select("id")
              .eq("club_id", newClub.id)
              .eq("name", sponsor.name)
              .single();
            
            if (existingSponsor) {
              if (sIdx === 0) primarySponsorId = existingSponsor.id;
              continue;
            }
            
            const { data: newSponsor, error: sponsorError } = await supabase
              .from("sponsors")
              .insert({
                club_id: newClub.id,
                name: sponsor.name,
                description: sponsor.description,
                website_url: sponsor.website_url,
                logo_url: sponsor.logo_url,
                is_active: true,
                is_team_only: sIdx === 3, // Last sponsor is team-only
                display_order: sIdx,
              })
              .select()
              .single();
            
            if (!sponsorError && newSponsor) {
              sponsorsCreated++;
              if (sIdx === 0) primarySponsorId = newSponsor.id;
            }
          }
          
          // Set first sponsor as primary for the club
          if (primarySponsorId) {
            await supabase
              .from("clubs")
              .update({ primary_sponsor_id: primarySponsorId })
              .eq("id", newClub.id);
          }
          
          if (sponsorsCreated > 0) {
            results.push(`✓ Created ${sponsorsCreated} sponsors for ${club.name}`);
          }
          
          // Create rewards for Pro clubs
          const rewardTemplates = [
            {
              name: "Free Drink",
              description: "Redeem for a free soft drink at the canteen",
              points_required: 50,
              reward_type: "canteen",
            },
            {
              name: "Team Jersey Discount",
              description: "Get 20% off your next team jersey purchase",
              points_required: 100,
              reward_type: "merchandise",
            },
            {
              name: "Training Session",
              description: "Free one-on-one training session with a coach",
              points_required: 200,
              reward_type: "training",
            },
            {
              name: "Match Ball",
              description: "Win a signed match ball",
              points_required: 500,
              reward_type: "prize",
            },
          ];
          
          let rewardsCreated = 0;
          for (const reward of rewardTemplates) {
            const { data: existingReward } = await supabase
              .from("club_rewards")
              .select("id")
              .eq("club_id", newClub.id)
              .eq("name", reward.name)
              .single();
            
            if (existingReward) continue;
            
            const { error: rewardError } = await supabase
              .from("club_rewards")
              .insert({
                club_id: newClub.id,
                name: reward.name,
                description: reward.description,
                points_required: reward.points_required,
                reward_type: reward.reward_type,
                is_active: true,
                is_default: false,
              });
            
            if (!rewardError) rewardsCreated++;
          }
          
          if (rewardsCreated > 0) {
            results.push(`✓ Created ${rewardsCreated} rewards for ${club.name}`);
          }
        }
      }
    } else {
      createdClubs = existingClubs || [];
      
      // Also create sponsors for existing pro clubs that don't have sponsors
      for (const club of createdClubs) {
        // Check if this is a pro club
        const { data: clubSub } = await supabase
          .from("club_subscriptions")
          .select("is_pro")
          .eq("club_id", club.id)
          .single();
        
        if (!clubSub?.is_pro) continue;
        
        // Check if club already has sponsors
        const { data: existingSponsors } = await supabase
          .from("sponsors")
          .select("id")
          .eq("club_id", club.id)
          .limit(1);
        
        if (existingSponsors && existingSponsors.length > 0) continue;
        
        // Create sponsors for this pro club
        const sponsorTemplates = [
          { 
            name: "SportsTech Pro", 
            description: "Premium sports technology solutions for modern athletes",
            website_url: "https://example.com/sportstech",
            logo_url: "https://api.dicebear.com/7.x/shapes/svg?seed=sportstech&backgroundColor=1e40af&shape1Color=60a5fa"
          },
          { 
            name: "LocalBrew Coffee", 
            description: "Fueling our community with the best local coffee",
            website_url: "https://example.com/localbrew",
            logo_url: "https://api.dicebear.com/7.x/shapes/svg?seed=localbrew&backgroundColor=92400e&shape1Color=fbbf24"
          },
          { 
            name: "FitGear Athletics", 
            description: "Quality sports equipment for every level",
            website_url: "https://example.com/fitgear",
            logo_url: "https://api.dicebear.com/7.x/shapes/svg?seed=fitgear&backgroundColor=166534&shape1Color=86efac"
          },
        ];
        
        let sponsorsCreated = 0;
        let primarySponsorId: string | null = null;
        
        for (let sIdx = 0; sIdx < sponsorTemplates.length; sIdx++) {
          const sponsor = sponsorTemplates[sIdx];
          
          const { data: newSponsor, error: sponsorError } = await supabase
            .from("sponsors")
            .insert({
              club_id: club.id,
              name: sponsor.name,
              description: sponsor.description,
              website_url: sponsor.website_url,
              logo_url: sponsor.logo_url,
              is_active: true,
              is_team_only: false,
              display_order: sIdx,
            })
            .select()
            .single();
          
          if (!sponsorError && newSponsor) {
            sponsorsCreated++;
            if (sIdx === 0) primarySponsorId = newSponsor.id;
          }
        }
        
        if (primarySponsorId) {
          await supabase
            .from("clubs")
            .update({ primary_sponsor_id: primarySponsorId })
            .eq("id", club.id);
        }
        
        if (sponsorsCreated > 0) {
          results.push(`✓ Created ${sponsorsCreated} sponsors for ${club.name}`);
        }
        
        // Create rewards for existing Pro clubs that don't have rewards
        const { data: existingRewards } = await supabase
          .from("club_rewards")
          .select("id")
          .eq("club_id", club.id)
          .limit(1);
        
        if (!existingRewards || existingRewards.length === 0) {
          const rewardTemplates = [
            {
              name: "Free Drink",
              description: "Redeem for a free soft drink at the canteen",
              points_required: 50,
              reward_type: "canteen",
            },
            {
              name: "Team Jersey Discount",
              description: "Get 20% off your next team jersey purchase",
              points_required: 100,
              reward_type: "merchandise",
            },
            {
              name: "Training Session",
              description: "Free one-on-one training session with a coach",
              points_required: 200,
              reward_type: "training",
            },
            {
              name: "Match Ball",
              description: "Win a signed match ball",
              points_required: 500,
              reward_type: "prize",
            },
          ];
          
          let rewardsCreated = 0;
          for (const reward of rewardTemplates) {
            const { error: rewardError } = await supabase
              .from("club_rewards")
              .insert({
                club_id: club.id,
                name: reward.name,
                description: reward.description,
                points_required: reward.points_required,
                reward_type: reward.reward_type,
                is_active: true,
                is_default: false,
              });
            
            if (!rewardError) rewardsCreated++;
          }
          
          if (rewardsCreated > 0) {
            results.push(`✓ Created ${rewardsCreated} rewards for ${club.name}`);
          }
        }
      }
    }

    // GENERATE TEAMS - with varied subscriptions within clubs
    if (options.teams) {
      // Team configurations - vary subscriptions even within same club
      // Football teams for soccer clubs
      const footballTeams = [
        { name: "Under 12 Boys", level_age: "U12", description: "Competitive youth team", logo_url: DEMO_TEAM_LOGOS[0] },
        { name: "Under 10 Girls", level_age: "U10", description: "Development squad", logo_url: DEMO_TEAM_LOGOS[1] },
        { name: "Under 14 Mixed", level_age: "U14", description: "Advanced competitive team", logo_url: DEMO_TEAM_LOGOS[2] },
        { name: "Senior Men", level_age: "Senior", description: "Adult competitive team", logo_url: DEMO_TEAM_LOGOS[3] },
      ];
      
      // Basketball teams for non-football clubs
      const basketballTeams = [
        { name: "Junior Varsity", level_age: "JV", description: "Youth basketball development", logo_url: DEMO_TEAM_LOGOS[0] },
        { name: "Varsity Boys", level_age: "Varsity", description: "Competitive boys basketball", logo_url: DEMO_TEAM_LOGOS[1] },
        { name: "Varsity Girls", level_age: "Varsity", description: "Competitive girls basketball", logo_url: DEMO_TEAM_LOGOS[2] },
      ];
      
      // Team subscription configs based on club and team index
      const teamSubscriptionOverrides: Record<string, { is_pro: boolean; is_pro_football: boolean }> = {
        // Riverside FC (Pro Football club) - all teams get full Pro Football access
        "Riverside FC:0": { is_pro: true, is_pro_football: true },
        "Riverside FC:1": { is_pro: true, is_pro_football: true },
        "Riverside FC:2": { is_pro: true, is_pro_football: true },
        // Northern United (Football club with mixed teams) - mix of Pro Football, Pro, and Free
        "Northern United:0": { is_pro: true, is_pro_football: true },  // Pro Football
        "Northern United:1": { is_pro: true, is_pro_football: false }, // Pro only
        "Northern United:2": { is_pro: false, is_pro_football: false }, // Free
        // Eastside Athletic (Basketball club - free) - all teams are free, no football option
        "Eastside Athletic:0": { is_pro: false, is_pro_football: false },
        "Eastside Athletic:1": { is_pro: false, is_pro_football: false },
        "Eastside Athletic:2": { is_pro: false, is_pro_football: false },
      };

      const clubsToUse = createdClubs.length > 0 ? createdClubs : (existingClubs || []);
      
      // Get club sports for selecting appropriate team templates
      const clubSports: Record<string, string> = {
        "Riverside FC": "football",
        "Northern United": "football",
        "Eastside Athletic": "basketball",
      };
      
      if (clubsToUse.length === 0) {
        results.push("⚠ No clubs available - create clubs first or select 'Clubs' option");
      } else {
        for (const club of clubsToUse.slice(0, 3)) {
          // Select appropriate teams based on club sport
          const clubSport = clubSports[club.name] || "football";
          const teamsForClub = clubSport === "basketball" ? basketballTeams : footballTeams;
          
          // Create 3 teams per club for more varied testing
          for (let teamIdx = 0; teamIdx < Math.min(3, teamsForClub.length); teamIdx++) {
            const team = teamsForClub[teamIdx];
            const fullTeamName = `${club.name} - ${team.name}`;
            
            const { data: existingTeam } = await supabase
              .from("teams")
              .select("id")
              .eq("club_id", club.id)
              .eq("name", team.name)
              .single();

            if (existingTeam) {
              results.push(`Team "${fullTeamName}" already exists, skipping`);
              createdTeams.push({ id: existingTeam.id, name: team.name, club_id: club.id });
              continue;
            }

            const { data: newTeam, error: teamError } = await supabase
              .from("teams")
              .insert({
                name: team.name,
                level_age: team.level_age,
                description: team.description,
                logo_url: team.logo_url,
                club_id: club.id,
                created_by: user.id,
              })
              .select()
              .single();

            if (teamError) {
              results.push(`Failed to create team "${fullTeamName}": ${teamError.message}`);
              continue;
            }

            createdTeams.push({ id: newTeam.id, name: team.name, club_id: club.id });
            
            // Get team subscription config
            const subKey = `${club.name}:${teamIdx}`;
            const subConfig = teamSubscriptionOverrides[subKey] || { is_pro: false, is_pro_football: false };
            const tier = subConfig.is_pro_football ? "Pro Football" : 
                         subConfig.is_pro ? "Pro" : "Free";
            results.push(`✓ Created team: ${fullTeamName} (${tier})`);

            await supabase.from("user_roles").insert({
              user_id: user.id,
              role: "team_admin",
              team_id: newTeam.id,
              club_id: club.id,
            });

            await supabase.from("team_subscriptions").insert({
              team_id: newTeam.id,
              is_pro: subConfig.is_pro,
              is_pro_football: subConfig.is_pro_football,
              team_size: 11,
              minutes_per_half: 20,
            });
          }
        }
      }
    } else {
      // If not creating teams, still ensure admin has team_admin role on existing demo teams
      const { data: demoClubs } = await supabase
        .from("clubs")
        .select("id")
        .in("name", DEMO_CLUB_NAMES);
      
      if (demoClubs && demoClubs.length > 0) {
        const clubIds = demoClubs.map(c => c.id);
        const { data: demoTeams } = await supabase
          .from("teams")
          .select("id, club_id")
          .in("club_id", clubIds);
        
        if (demoTeams) {
          for (const team of demoTeams) {
            // Check if admin already has team_admin role
            const { data: existingRole } = await supabase
              .from("user_roles")
              .select("id")
              .eq("user_id", user.id)
              .eq("team_id", team.id)
              .eq("role", "team_admin")
              .single();
            
            if (!existingRole) {
              await supabase.from("user_roles").insert({
                user_id: user.id,
                role: "team_admin",
                team_id: team.id,
                club_id: team.club_id,
              });
            }
          }
          results.push(`✓ Ensured admin has team_admin role on ${demoTeams.length} demo teams`);
        }
      }
      
      createdTeams = (existingTeams || []).map(t => ({ id: t.id, name: t.name, club_id: t.club_id }));
    }

    // GENERATE USERS
    if (options.users) {
      const teamsToUse = createdTeams.length > 0 ? createdTeams : (existingTeams || []).map(t => ({ id: t.id, name: t.name, club_id: t.club_id }));
      
      if (teamsToUse.length === 0) {
        results.push("⚠ No teams available - create teams first or select 'Teams' option");
      } else {
        // Position preference patterns for variety:
        // Some have no preferences, some have 1, some have 2, some have 3+
        const POSITION_PREFERENCE_PATTERNS: string[][] = [
          [], // No preference
          [], // No preference  
          ["GK"], // Single - goalkeeper only
          ["DEF"], // Single - defender only
          ["MID"], // Single - midfielder only
          ["FWD"], // Single - forward only
          ["DEF", "MID"], // Dual - can play defense or midfield
          ["MID", "FWD"], // Dual - can play midfield or forward
          ["DEF", "FWD"], // Dual - versatile
          ["GK", "DEF"], // Dual - keeper who can play defense
          ["DEF", "MID", "FWD"], // Triple - outfield all-rounder
          ["MID", "FWD", "DEF"], // Triple - outfield versatile
          ["GK", "DEF", "MID"], // Triple - defensive minded
          [], // No preference
          ["FWD"], // Single - forward
          ["DEF", "MID"], // Dual
          ["MID"], // Single - midfielder
          ["GK", "DEF", "MID", "FWD"], // All positions
        ];
        
        // Default positions for players with no preference (typical team distribution)
        const DEFAULT_POSITIONS = ["GK", "DEF", "DEF", "DEF", "MID", "MID", "MID", "FWD", "FWD"];
        
        let usersCreated = 0;

        // Iterate over ALL teams to ensure all clubs get users
        // Each team needs at least 9 players + coach, parent, team_admin roles
        for (let teamIdx = 0; teamIdx < teamsToUse.length; teamIdx++) {
          const team = teamsToUse[teamIdx];
          const usersPerTeam = 9; // Minimum 9 players per team as required
          
          // Calculate starting user index for this team (wrap around if needed)
          const teamStartUserIndex = (teamIdx * usersPerTeam) % DEMO_USER_NAMES.length;
          
          for (let i = 0; i < usersPerTeam; i++) {
            const userIndex = (teamStartUserIndex + i) % DEMO_USER_NAMES.length;
            const userName = DEMO_USER_NAMES[userIndex];
            const userEmail = `${DEMO_USER_EMAILS_PREFIX}${userIndex + 1}@demo.local`;
            
            let userId: string | null = null;
            
            // Check if user already exists by display name in profiles
            const { data: existingProfile } = await supabase
              .from("profiles")
              .select("id")
              .eq("display_name", userName)
              .single();
            
            if (existingProfile) {
              // User exists, use their ID
              userId = existingProfile.id;
            } else {
              // Try to create auth user
              const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
                email: userEmail,
                password: DEMO_PASSWORD,
                email_confirm: true,
                user_metadata: { display_name: userName },
              });
              
              if (authError) {
                // If email exists, try to get the user by listing users
                if (authError.code === 'email_exists') {
                  const { data: { users } } = await supabase.auth.admin.listUsers();
                  const existingUser = users?.find(u => u.email === userEmail);
                  if (existingUser) {
                    userId = existingUser.id;
                    // Ensure profile exists
                    await supabase
                      .from("profiles")
                      .upsert({
                        id: existingUser.id,
                        display_name: userName,
                      }, { onConflict: 'id' });
                  }
                }
                
                if (!userId) {
                  console.error(`Failed to create/find auth user ${userName}:`, authError);
                  continue;
                }
              } else if (authUser?.user) {
                userId = authUser.user.id;
                
                // Create profile (use upsert to handle race conditions)
                const { error: profileError } = await supabase
                  .from("profiles")
                  .upsert({
                    id: authUser.user.id,
                    display_name: userName,
                  }, { onConflict: 'id' });
                
                if (profileError) {
                  console.error(`Failed to create profile for ${userName}:`, profileError);
                }
              }
            }
            
            if (!userId) {
              continue;
            }
            
            createdUsers.push({ id: userId, name: userName });
            
            // Assign player role to team (upsert to handle existing)
            const { error: roleError } = await supabase.from("user_roles").upsert({
              user_id: userId,
              role: "player",
              team_id: team.id,
              club_id: team.club_id,
            }, { onConflict: 'user_id,role,club_id,team_id' });
            
            if (roleError) {
              console.error(`Failed to assign player role for ${userName} to team ${team.id}:`, roleError);
            } else {
              console.log(`Assigned player role for ${userName} to team ${team.id}`);
            }
            
            // Create team player position with jersey number (upsert to handle existing)
            const jerseyNumber = (i + 1) + (teamIdx * usersPerTeam);
            
            // Get varied position preferences using the pattern array
            const patternIndex = (i + teamIdx * 5) % POSITION_PREFERENCE_PATTERNS.length;
            const preferredPositions = POSITION_PREFERENCE_PATTERNS[patternIndex];
            
            const { error: posError } = await supabase.from("team_player_positions").upsert({
              user_id: userId,
              team_id: team.id,
              jersey_number: jerseyNumber,
              preferred_positions: preferredPositions,
            }, { onConflict: 'team_id,user_id' });
            
            if (posError) {
              console.error(`Failed to create position for ${userName}:`, posError);
            }
            
            usersCreated++;
          }
        }
        
        if (usersCreated > 0) {
          results.push(`✓ Created ${usersCreated} demo players with team assignments`);
        }
        
        // CRITICAL: Ensure EVERY team has coach, parent, and team_admin (not the app admin)
        // Also ensure EVERY club has a club_admin that is NOT an app admin
        let coachesAssigned = 0;
        let parentsAssigned = 0;
        let teamAdminsAssigned = 0;
        
        // First pass: Ensure every team has coach, parent, team_admin
        for (let teamIdx = 0; teamIdx < teamsToUse.length; teamIdx++) {
          const team = teamsToUse[teamIdx];
          
          // Get team players (demo users assigned to this team)
          const { data: teamPlayers } = await supabase
            .from("user_roles")
            .select("user_id")
            .eq("team_id", team.id)
            .eq("role", "player");
          
          if (!teamPlayers || teamPlayers.length < 3) continue;
          
          // Assign first available player as coach (if not already a coach on this team)
          const coachCandidate = teamPlayers[0];
          const { data: existingCoachRole } = await supabase
            .from("user_roles")
            .select("id")
            .eq("user_id", coachCandidate.user_id)
            .eq("team_id", team.id)
            .eq("role", "coach")
            .single();
          
          if (!existingCoachRole) {
            const { error: coachError } = await supabase.from("user_roles").insert({
              user_id: coachCandidate.user_id,
              role: "coach",
              team_id: team.id,
              club_id: team.club_id,
            });
            if (!coachError) coachesAssigned++;
          }
          
          // Assign second available player as parent (if not already a parent on this team)
          const parentCandidate = teamPlayers[1];
          const { data: existingParentRole } = await supabase
            .from("user_roles")
            .select("id")
            .eq("user_id", parentCandidate.user_id)
            .eq("team_id", team.id)
            .eq("role", "parent")
            .single();
          
          if (!existingParentRole) {
            const { error: parentError } = await supabase.from("user_roles").insert({
              user_id: parentCandidate.user_id,
              role: "parent",
              team_id: team.id,
              club_id: team.club_id,
            });
            if (!parentError) parentsAssigned++;
          }
          
          // Assign third available player as team_admin (if not already a team_admin on this team)
          const teamAdminCandidate = teamPlayers[2];
          const { data: existingTeamAdminRole } = await supabase
            .from("user_roles")
            .select("id")
            .eq("user_id", teamAdminCandidate.user_id)
            .eq("team_id", team.id)
            .eq("role", "team_admin")
            .single();
          
          if (!existingTeamAdminRole) {
            const { error: teamAdminError } = await supabase.from("user_roles").insert({
              user_id: teamAdminCandidate.user_id,
              role: "team_admin",
              team_id: team.id,
              club_id: team.club_id,
            });
            if (!teamAdminError) teamAdminsAssigned++;
          }
        }
        
        if (coachesAssigned > 0 || parentsAssigned > 0 || teamAdminsAssigned > 0) {
          results.push(`✓ Ensured ${coachesAssigned} coaches, ${parentsAssigned} parents, ${teamAdminsAssigned} team_admins across all teams`);
        }
        
        // Second pass: Ensure every club has a club_admin that is NOT an app admin
        // Use different names for each club to avoid having all admins named "Paul" or the same
        // Group teams by club_id
        const clubTeamsMap = new Map<string, typeof teamsToUse>();
        for (const team of teamsToUse) {
          if (!clubTeamsMap.has(team.club_id)) {
            clubTeamsMap.set(team.club_id, []);
          }
          clubTeamsMap.get(team.club_id)!.push(team);
        }
        
        // Names to use for club admins (diverse first names)
        const CLUB_ADMIN_PREFERRED_NAMES = [
          "Morgan Smith", "Jamie Garcia", "Taylor Thomas", "Cameron White", "Skyler Harris"
        ];
        
        let clubAdminsAssigned = 0;
        let clubIndex = 0;
        const usedAdminUserIds = new Set<string>();
        
        for (const [clubId, clubTeams] of clubTeamsMap) {
          // Check if club already has a club_admin who is NOT an app_admin
          const { data: existingClubAdmins } = await supabase
            .from("user_roles")
            .select("user_id")
            .eq("club_id", clubId)
            .eq("role", "club_admin");
          
          // Check if any existing club_admin is NOT an app_admin
          let hasNonAppAdminClubAdmin = false;
          if (existingClubAdmins && existingClubAdmins.length > 0) {
            for (const admin of existingClubAdmins) {
              const { data: isAppAdmin } = await supabase
                .from("user_roles")
                .select("id")
                .eq("user_id", admin.user_id)
                .eq("role", "app_admin")
                .single();
              
              if (!isAppAdmin) {
                hasNonAppAdminClubAdmin = true;
                usedAdminUserIds.add(admin.user_id);
                break;
              }
            }
          }
          
          // If no non-app-admin club_admin, find a demo user to assign
          if (!hasNonAppAdminClubAdmin && clubTeams.length > 0) {
            // Try to find the preferred admin name first for this club
            const preferredName = CLUB_ADMIN_PREFERRED_NAMES[clubIndex % CLUB_ADMIN_PREFERRED_NAMES.length];
            
            // Look for a player with this preferred name in this club
            const { data: preferredPlayer } = await supabase
              .from("user_roles")
              .select("user_id, profiles!inner(display_name)")
              .eq("club_id", clubId)
              .eq("role", "player")
              .eq("profiles.display_name", preferredName)
              .limit(1);
            
            let assignedUserId: string | null = null;
            
            // Check if preferred player can be used
            if (preferredPlayer && preferredPlayer.length > 0) {
              const player = preferredPlayer[0];
              if (!usedAdminUserIds.has(player.user_id)) {
                const { data: isAppAdmin } = await supabase
                  .from("user_roles")
                  .select("id")
                  .eq("user_id", player.user_id)
                  .eq("role", "app_admin")
                  .single();
                
                if (!isAppAdmin) {
                  assignedUserId = player.user_id;
                }
              }
            }
            
            // Fallback: Get any player from the club who hasn't been used as admin
            if (!assignedUserId) {
              const { data: clubPlayers } = await supabase
                .from("user_roles")
                .select("user_id, profiles!inner(display_name)")
                .eq("club_id", clubId)
                .eq("role", "player")
                .limit(20);
              
              if (clubPlayers && clubPlayers.length > 0) {
                for (const player of clubPlayers) {
                  if (usedAdminUserIds.has(player.user_id)) continue;
                  
                  const { data: isAppAdmin } = await supabase
                    .from("user_roles")
                    .select("id")
                    .eq("user_id", player.user_id)
                    .eq("role", "app_admin")
                    .single();
                  
                  if (isAppAdmin) continue;
                  
                  const { data: isAlreadyClubAdmin } = await supabase
                    .from("user_roles")
                    .select("id")
                    .eq("user_id", player.user_id)
                    .eq("club_id", clubId)
                    .eq("role", "club_admin")
                    .single();
                  
                  if (isAlreadyClubAdmin) continue;
                  
                  assignedUserId = player.user_id;
                  break;
                }
              }
            }
            
            // Assign the found user as club_admin
            if (assignedUserId) {
              const { error: clubAdminError } = await supabase.from("user_roles").upsert({
                user_id: assignedUserId,
                role: "club_admin",
                club_id: clubId,
              }, { onConflict: 'user_id,role,club_id,team_id', ignoreDuplicates: true });
              
              if (!clubAdminError) {
                clubAdminsAssigned++;
                usedAdminUserIds.add(assignedUserId);
              }
            }
          }
          
          clubIndex++;
        }
        
        if (clubAdminsAssigned > 0) {
          results.push(`✓ Assigned ${clubAdminsAssigned} club_admins (non-app-admin) across clubs`);
        }
        
        // CREATE UNASSOCIATED USERS - users with accounts but no team/club membership
        // These are useful for testing scenarios like new users who haven't joined any clubs yet
        const UNASSOCIATED_USER_NAMES = [
          "New User Alex", "New User Sam", "New User Jordan", "New User Casey", "New User Riley"
        ];
        
        let unassociatedCreated = 0;
        for (let i = 0; i < UNASSOCIATED_USER_NAMES.length; i++) {
          const userName = UNASSOCIATED_USER_NAMES[i];
          const userEmail = `demo_unassociated_${i + 1}@demo.local`;
          
          // Check if user already exists
          const { data: existingProfile } = await supabase
            .from("profiles")
            .select("id")
            .eq("display_name", userName)
            .single();
          
          if (existingProfile) {
            continue; // Already exists
          }
          
          // Create auth user
          const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
            email: userEmail,
            password: DEMO_PASSWORD,
            email_confirm: true,
            user_metadata: { display_name: userName },
          });
          
          if (authError && authError.code !== 'email_exists') {
            console.error(`Failed to create unassociated user ${userName}:`, authError);
            continue;
          }
          
          if (authUser?.user) {
            // Create profile (use upsert to handle race conditions)
            await supabase
              .from("profiles")
              .upsert({
                id: authUser.user.id,
                display_name: userName,
              }, { onConflict: 'id' });
            
            unassociatedCreated++;
          }
        }
        
        if (unassociatedCreated > 0) {
          results.push(`✓ Created ${unassociatedCreated} unassociated users (not members of any club/team)`);
        }
        
        // First, get all app_admin user IDs to exclude them from points
        const { data: appAdmins } = await supabase
          .from("user_roles")
          .select("user_id")
          .eq("role", "app_admin");
        
        const appAdminIds = new Set((appAdmins || []).map(a => a.user_id));
        
        // Wipe points from any app_admins (they shouldn't have demo data points)
        if (appAdminIds.size > 0) {
          await supabase
            .from("profiles")
            .update({ ignite_points: 0 })
            .in("id", Array.from(appAdminIds));
          
          // Delete any duties assigned to app_admins
          await supabase
            .from("duties")
            .delete()
            .in("assigned_to", Array.from(appAdminIds));
          
          console.log(`Wiped points and duties from ${appAdminIds.size} app_admin(s)`);
        }
        
        // Filter out app_admins from createdUsers for points assignment
        const nonAdminUsers = createdUsers.filter(u => !appAdminIds.has(u.id));
        
        // Assign ignite points to some parents and coaches (NOT app_admins)
        // Rewards: Free Drink (50), Jersey Discount (100), Training (200), Match Ball (500)
        // Give users enough points to redeem various rewards
        const pointsAssignments = [
          { idx: 1, points: 125 },
          { idx: 5, points: 210 },
          { idx: 9, points: 75 },
          { idx: 0, points: 520 },
          { idx: 4, points: 45 },
          { idx: 8, points: 105 },
        ];
        
        // Duty names for generating history
        const completedDutyNames = [
          "Oranges", "Goal Setup", "First Aid Kit", "Canteen Duty", 
          "Line Marking", "Team Photos", "Water Bottles", "Equipment Manager",
          "Match Day Setup", "Ground Marshal", "BBQ Duty", "Parking Attendant"
        ];
        
        let pointsAssigned = 0;
        let dutiesCreated = 0;
        
        for (const assignment of pointsAssignments) {
          if (assignment.idx < nonAdminUsers.length) {
            const userId = nonAdminUsers[assignment.idx].id;
            
            const { error } = await supabase
              .from("profiles")
              .update({ 
                ignite_points: assignment.points,
              })
              .eq("id", userId);
            
            if (!error) {
              pointsAssigned++;
              
              // Create completed duties to explain the points
              // Each duty typically awards 1-3 points, so create enough duties
              const numDuties = Math.ceil(assignment.points / 2); // ~2 points per duty on average
              
              // Get a team for this user to create events for duties
              const { data: userTeamRole } = await supabase
                .from("user_roles")
                .select("team_id, club_id")
                .eq("user_id", userId)
                .not("team_id", "is", null)
                .limit(1)
                .single();
              
              if (userTeamRole?.team_id && userTeamRole?.club_id) {
                // Create past events and completed duties for this user
                for (let d = 0; d < numDuties; d++) {
                  const dutyName = completedDutyNames[d % completedDutyNames.length];
                  const daysAgo = 7 + (d * 7) + Math.floor(Math.random() * 3); // Spread over past weeks
                  const eventDate = new Date();
                  eventDate.setDate(eventDate.getDate() - daysAgo);
                  
                  const completedAt = new Date(eventDate);
                  completedAt.setHours(completedAt.getHours() + 2); // Completed 2 hours after event
                  
                  // Create a past game event for this duty
                  const { data: pastEvent, error: eventError } = await supabase
                    .from("events")
                    .insert({
                      title: `Past Match - Round ${numDuties - d}`,
                      type: "game",
                      event_date: eventDate.toISOString(),
                      club_id: userTeamRole.club_id,
                      team_id: userTeamRole.team_id,
                      created_by: user.id,
                      address: "123 Sports Ground",
                      suburb: "Richmond",
                      state: "VIC",
                      postcode: "3121",
                    })
                    .select()
                    .single();
                  
                  if (!eventError && pastEvent) {
                    // Create completed duty for this user
                    const { error: dutyError } = await supabase
                      .from("duties")
                      .insert({
                        event_id: pastEvent.id,
                        name: dutyName,
                        assigned_to: userId,
                        status: "completed",
                        completed_at: completedAt.toISOString(),
                        points_awarded: true,
                      });
                    
                    if (!dutyError) dutiesCreated++;
                  }
                }
              }
            }
          }
        }
        
        if (pointsAssigned > 0) {
          results.push(`✓ Assigned ignite points to ${pointsAssigned} users with ${dutiesCreated} completed duties in history`);
        }
        
        // CREATE REWARD REDEMPTION HISTORY
        // Add some completed redemptions for users with points
        let redemptionsCreated = 0;
        
        // Get demo users - either from this run or existing
        let usersForRedemptions = createdUsers.length > 0 ? createdUsers : [];
        if (usersForRedemptions.length === 0) {
          const { data: existingDemoUsers } = await supabase
            .from("profiles")
            .select("id, display_name")
            .in("display_name", DEMO_USER_NAMES)
            .limit(20);
          
          if (existingDemoUsers && existingDemoUsers.length > 0) {
            usersForRedemptions = existingDemoUsers.map(u => ({ id: u.id, name: u.display_name || "" }));
          }
        }
        
        // Get rewards for this club to create redemption records
        const { data: clubRewards } = await supabase
          .from("club_rewards")
          .select("id, name, points_required, club_id")
          .eq("is_active", true)
          .order("points_required", { ascending: true });
        
        if (clubRewards && clubRewards.length > 0 && usersForRedemptions.length > 0) {
          // Define redemption history for users - they redeemed these in the past
          // Users' current points are AFTER these redemptions, so their total earned was higher
          const redemptionHistory = [
            { idx: 1, redemptions: [{ rewardIdx: 0, daysAgo: 14, status: 'fulfilled' }] }, // Redeemed Free Drink 2 weeks ago
            { idx: 5, redemptions: [
              { rewardIdx: 0, daysAgo: 21, status: 'fulfilled' }, // Free Drink 3 weeks ago
              { rewardIdx: 1, daysAgo: 7, status: 'pending' },   // Jersey Discount pending
            ]},
            { idx: 0, redemptions: [
              { rewardIdx: 0, daysAgo: 30, status: 'fulfilled' }, // Free Drink a month ago
              { rewardIdx: 1, daysAgo: 14, status: 'fulfilled' }, // Jersey Discount 2 weeks ago
              { rewardIdx: 2, daysAgo: 3, status: 'fulfilled' },  // Training Session 3 days ago
            ]},
            { idx: 8, redemptions: [{ rewardIdx: 0, daysAgo: 10, status: 'fulfilled' }] }, // Free Drink 10 days ago
          ];
          
          for (const userRedemptions of redemptionHistory) {
            if (userRedemptions.idx < usersForRedemptions.length) {
              const userId = usersForRedemptions[userRedemptions.idx].id;
              
              for (const redemption of userRedemptions.redemptions) {
                if (redemption.rewardIdx < clubRewards.length) {
                  const reward = clubRewards[redemption.rewardIdx];
                  const redeemedAt = new Date();
                  redeemedAt.setDate(redeemedAt.getDate() - redemption.daysAgo);
                  
                  const fulfilledAt = redemption.status === 'fulfilled' 
                    ? new Date(redeemedAt.getTime() + (Math.random() * 48 * 60 * 60 * 1000)) // Fulfilled within 48 hours
                    : null;
                  
                  // Get a club admin to mark as fulfilled_by
                  const { data: clubAdmin } = await supabase
                    .from("user_roles")
                    .select("user_id")
                    .eq("club_id", reward.club_id)
                    .eq("role", "club_admin")
                    .limit(1)
                    .single();
                  
                  const { error: redemptionError } = await supabase
                    .from("reward_redemptions")
                    .insert({
                      user_id: userId,
                      reward_id: reward.id,
                      club_id: reward.club_id,
                      points_spent: reward.points_required,
                      status: redemption.status,
                      redeemed_at: redeemedAt.toISOString(),
                      fulfilled_at: fulfilledAt?.toISOString() || null,
                      fulfilled_by: redemption.status === 'fulfilled' ? (clubAdmin?.user_id || null) : null,
                      notes: redemption.status === 'fulfilled' 
                        ? `Collected at canteen after ${reward.name.toLowerCase()}` 
                        : null,
                    });
                  
                  if (!redemptionError) redemptionsCreated++;
                }
              }
            }
          }
        }
        
        if (redemptionsCreated > 0) {
          results.push(`✓ Created ${redemptionsCreated} reward redemption history records`);
        }
      }
    }

    // GENERATE CHILDREN FOR PARENT USERS
    // Find users with parent role and create children for them
    const teamsToUse = createdTeams.length > 0 ? createdTeams : (existingTeams || []).map(t => ({ id: t.id, name: t.name, club_id: t.club_id }));
    
    if (options.users && teamsToUse.length > 0) {
      const DEMO_CHILD_NAMES = [
        "Max Johnson", "Lily Williams", "Jake Taylor", "Emma Brown", 
        "Noah Davis", "Olivia Smith", "Ethan Wilson", "Ava Martinez",
        "Lucas Anderson", "Mia Garcia", "Mason Thomas", "Sophie Jackson",
        "Henry Clark", "Chloe White", "Leo Harris", "Zoe Lewis", 
        "Jack Robinson", "Grace Walker", "Owen Hall", "Ella Young",
      ];
      
      // Get parent users - check both createdUsers AND existing demo users with parent role
      // First, get all demo user IDs
      const { data: demoProfiles } = await supabase
        .from("profiles")
        .select("id")
        .in("display_name", DEMO_USER_NAMES);
      
      const demoUserIds = demoProfiles?.map(p => p.id) || [];
      
      // Now get parent roles for any demo user (not just createdUsers)
      const { data: parentRoles } = await supabase
        .from("user_roles")
        .select("user_id, team_id")
        .eq("role", "parent")
        .in("user_id", demoUserIds.length > 0 ? demoUserIds : ['00000000-0000-0000-0000-000000000000']);
      
      if (parentRoles && parentRoles.length > 0) {
        let childrenCreated = 0;
        let assignmentsCreated = 0;
        let childIndex = 0;
        
        for (const parentRole of parentRoles) {
          // Check if this parent already has children
          const { data: existingChildren } = await supabase
            .from("children")
            .select("id")
            .eq("parent_id", parentRole.user_id);
          
          // Skip if parent already has children
          if (existingChildren && existingChildren.length > 0) {
            console.log(`Parent ${parentRole.user_id} already has ${existingChildren.length} children, skipping`);
            continue;
          }
          
          // Create 1-2 children per parent
          const numChildren = (childIndex % 2) + 1;
          
          for (let j = 0; j < numChildren && childIndex < DEMO_CHILD_NAMES.length; j++) {
            const childName = DEMO_CHILD_NAMES[childIndex];
            const yearOfBirth = 2012 + (childIndex % 6); // Ages roughly 6-12
            const ignitePoints = Math.floor(Math.random() * 30) + 5;
            
            const { data: newChild, error: childError } = await supabase
              .from("children")
              .insert({
                parent_id: parentRole.user_id,
                name: childName,
                year_of_birth: yearOfBirth,
                ignite_points: ignitePoints,
              })
              .select()
              .single();
            
            if (childError) {
              console.error(`Failed to create child ${childName}:`, childError);
            } else if (newChild && parentRole.team_id) {
              childrenCreated++;
              
              // Assign child to parent's team
              const { error: assignError } = await supabase
                .from("child_team_assignments")
                .insert({
                  child_id: newChild.id,
                  team_id: parentRole.team_id,
                });
              
              if (!assignError) {
                assignmentsCreated++;
              }
            }
            
            childIndex++;
          }
        }
        
        if (childrenCreated > 0) {
          results.push(`✓ Created ${childrenCreated} demo children with ${assignmentsCreated} team assignments`);
        }
      }
    }

    // GENERATE EVENTS
    if (options.events) {
      const eventTypes = ["training", "game", "social"] as const;
      const eventTitles = {
        training: ["Weekly Training", "Skills Session", "Fitness Practice", "Tactical Training"],
        game: ["League Match", "Cup Game", "Friendly Match", "Tournament Game"],
        social: ["Team BBQ", "End of Season Party", "Awards Night", "Team Bonding"],
      };
      const locations = [
        { address: "123 Sports Ground", suburb: "Richmond", state: "VIC", postcode: "3121" },
        { address: "45 Athletic Park", suburb: "Carlton", state: "VIC", postcode: "3053" },
        { address: "78 Community Oval", suburb: "Fitzroy", state: "VIC", postcode: "3065" },
      ];
      const dutyNames = ["Oranges", "Goal Setup", "First Aid Kit", "Canteen Duty", "Line Marking", "Team Photos"];
      const opponents = ["Valley FC", "Metro United", "City Stars", "Harbor Town", "Summit Athletic", "Central Lions"];

      const teamsToUse = createdTeams.length > 0 ? createdTeams : (existingTeams || []).map(t => ({ id: t.id, name: t.name, club_id: t.club_id }));
      const usersForDuties = createdUsers.length > 0 ? createdUsers : [];
      
      // RSVP statuses and notes for realistic data
      const rsvpStatuses = ["going", "maybe", "not_going"] as const;
      const rsvpNotes = [
        "Looking forward to it!",
        "Will be there with bells on",
        "Can't wait!",
        "Might be a few minutes late",
        "Family commitment, sorry!",
        "Work conflict unfortunately",
        "Will try my best to make it",
        "",
        "",
        "", // Empty notes are common
      ];
      
      if (teamsToUse.length === 0) {
        results.push("⚠ No teams available - create teams first or select 'Teams' option");
      } else {
        let eventsCreated = 0;
        let dutiesCreated = 0;
        let gameEventCounter = 0;
        let paymentsCreated = 0;
        let rsvpsCreated = 0;
        
        for (const team of teamsToUse.slice(0, 6)) {
          // Get team members for RSVPs
          const { data: teamMembers } = await supabase
            .from("user_roles")
            .select("user_id")
            .eq("team_id", team.id)
            .in("role", ["player", "coach", "parent", "team_admin"]);
          
          const teamMemberIds = [...new Set((teamMembers || []).map(m => m.user_id))];
          
          // Create 5 events per team: mix of types across upcoming weeks
          for (let i = 0; i < 5; i++) {
            const eventType = eventTypes[i % eventTypes.length];
            const titleOptions = eventTitles[eventType];
            const title = titleOptions[Math.floor(Math.random() * titleOptions.length)];
            const location = locations[Math.floor(Math.random() * locations.length)];
            
            // Spread events across the next 5 weeks (days 1-35 in future)
            const eventDate = new Date();
            const daysInFuture = (i * 7) + 1 + Math.floor(Math.random() * 5); // 1-5, 8-12, 15-19, 22-26, 29-33 days
            eventDate.setDate(eventDate.getDate() + daysInFuture);

            // Add opponent for game events
            const opponent = eventType === "game" ? opponents[Math.floor(Math.random() * opponents.length)] : null;
            
            // Add price for Awards Night events
            const isAwardsNight = title === "Awards Night";
            const price = isAwardsNight ? 25.00 : null;

            const { data: newEvent, error: eventError } = await supabase
              .from("events")
              .insert({
                title,
                type: eventType,
                event_date: eventDate.toISOString(),
                club_id: team.club_id,
                team_id: team.id,
                created_by: user.id,
                opponent,
                price,
                ...location,
              })
              .select()
              .single();

            if (!eventError && newEvent) {
              eventsCreated++;
              
              // Create RSVPs for team members (~80% respond)
              for (const memberId of teamMemberIds) {
                if (Math.random() < 0.8) { // 80% response rate
                  // Weight towards "going": 60% going, 25% maybe, 15% not_going
                  const rand = Math.random();
                  const status = rand < 0.60 ? "going" : rand < 0.85 ? "maybe" : "not_going";
                  const note = rsvpNotes[Math.floor(Math.random() * rsvpNotes.length)];
                  // Add guest count for social events (0-2 guests)
                  const guestCount = eventType === "social" && status === "going" 
                    ? Math.floor(Math.random() * 3) 
                    : null;
                  
                  const { error: rsvpError } = await supabase
                    .from("rsvps")
                    .insert({
                      event_id: newEvent.id,
                      user_id: memberId,
                      status,
                      notes: note || null,
                      guest_count: guestCount,
                    });
                  
                  if (!rsvpError) rsvpsCreated++;
                }
              }
              
              // Add payments for some users on Awards Night events
              if (isAwardsNight && usersForDuties.length > 0) {
                // Mark ~60% of users as paid
                const usersToMark = usersForDuties.filter(() => Math.random() < 0.6);
                for (const payingUser of usersToMark) {
                  const { error: paymentError } = await supabase
                    .from("event_payments")
                    .insert({
                      event_id: newEvent.id,
                      user_id: payingUser.id,
                      marked_by: user.id,
                    });
                  if (!paymentError) paymentsCreated++;
                }
              }
              
              // Add duties to ~60% of game events
              if (eventType === "game" && gameEventCounter % 5 < 3) {
                const numDuties = 2 + Math.floor(Math.random() * 2); // 2-3 duties per game
                
                for (let d = 0; d < numDuties; d++) {
                  const dutyName = dutyNames[(gameEventCounter + d) % dutyNames.length];
                  // Assign ~70% of duties to a user
                  const shouldAssign = Math.random() < 0.7 && usersForDuties.length > 0;
                  const assignedTo = shouldAssign 
                    ? usersForDuties[Math.floor(Math.random() * usersForDuties.length)].id 
                    : null;
                  
                  const { error: dutyError } = await supabase
                    .from("duties")
                    .insert({
                      event_id: newEvent.id,
                      name: dutyName,
                      assigned_to: assignedTo,
                      status: assignedTo ? "assigned" : "open",
                    });
                  
                  if (!dutyError) dutiesCreated++;
                }
              }
              if (eventType === "game") gameEventCounter++;
            }
          }
        }
        results.push(`✓ Created ${eventsCreated} events with ${rsvpsCreated} RSVPs, ${dutiesCreated} duties, and ${paymentsCreated} payments`);
      }
    }

    // GENERATE PITCH FORMATIONS
    if (options.formations) {
      const teamsToUse = createdTeams.length > 0 ? createdTeams : (existingTeams || []).map(t => ({ id: t.id, name: t.name, club_id: t.club_id }));
      
      if (teamsToUse.length === 0) {
        results.push("⚠ No teams available - create teams first or select 'Teams' option");
      } else {
        const formationTemplates = [
          {
            name: "4-3-3 Attack",
            team_size: 11,
            formation_data: {
              positions: [
                { x: 50, y: 90, role: "GK" },
                { x: 15, y: 70, role: "LB" },
                { x: 35, y: 75, role: "CB" },
                { x: 65, y: 75, role: "CB" },
                { x: 85, y: 70, role: "RB" },
                { x: 25, y: 50, role: "CM" },
                { x: 50, y: 55, role: "CM" },
                { x: 75, y: 50, role: "CM" },
                { x: 20, y: 25, role: "LW" },
                { x: 50, y: 20, role: "ST" },
                { x: 80, y: 25, role: "RW" },
              ],
            },
          },
          {
            name: "4-4-2 Classic",
            team_size: 11,
            formation_data: {
              positions: [
                { x: 50, y: 90, role: "GK" },
                { x: 15, y: 70, role: "LB" },
                { x: 35, y: 75, role: "CB" },
                { x: 65, y: 75, role: "CB" },
                { x: 85, y: 70, role: "RB" },
                { x: 15, y: 45, role: "LM" },
                { x: 35, y: 50, role: "CM" },
                { x: 65, y: 50, role: "CM" },
                { x: 85, y: 45, role: "RM" },
                { x: 35, y: 20, role: "ST" },
                { x: 65, y: 20, role: "ST" },
              ],
            },
          },
          {
            name: "3-5-2 Midfield",
            team_size: 11,
            formation_data: {
              positions: [
                { x: 50, y: 90, role: "GK" },
                { x: 25, y: 75, role: "CB" },
                { x: 50, y: 78, role: "CB" },
                { x: 75, y: 75, role: "CB" },
                { x: 10, y: 50, role: "LWB" },
                { x: 30, y: 50, role: "CM" },
                { x: 50, y: 45, role: "CAM" },
                { x: 70, y: 50, role: "CM" },
                { x: 90, y: 50, role: "RWB" },
                { x: 35, y: 20, role: "ST" },
                { x: 65, y: 20, role: "ST" },
              ],
            },
          },
        ];

        let formationsCreated = 0;
        for (const team of teamsToUse.slice(0, 6)) {
          for (const template of formationTemplates) {
            // Check if formation already exists
            const { data: existing } = await supabase
              .from("pitch_formations")
              .select("id")
              .eq("team_id", team.id)
              .eq("name", template.name)
              .single();
            
            if (existing) continue;
            
            const { error } = await supabase
              .from("pitch_formations")
              .insert({
                team_id: team.id,
                name: template.name,
                team_size: template.team_size,
                formation_data: template.formation_data,
                created_by: user.id,
              });
            
            if (!error) {
              formationsCreated++;
            }
          }
        }
        
        if (formationsCreated > 0) {
          results.push(`✓ Created ${formationsCreated} pitch formations`);
        }
      }
    }

    // GENERATE PHOTOS
    if (options.photos) {
      console.log("[PHOTOS] Starting photo generation...");
      
      // Photo URLs with matching realistic captions
      const demoPhotos = [
        { 
          url: "https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=800",
          title: "Goalkeeper making a diving save during Saturday's match"
        },
        { 
          url: "https://images.unsplash.com/photo-1431324155629-1a6deb1dec8d?w=800",
          title: "The team celebrating after the winning goal"
        },
        { 
          url: "https://images.unsplash.com/photo-1551958219-acbc608c6377?w=800",
          title: "Corner kick in the final minutes"
        },
        { 
          url: "https://images.unsplash.com/photo-1579952363873-27f3bade9f55?w=800",
          title: "Close-up of the match ball on the pitch"
        },
        { 
          url: "https://images.unsplash.com/photo-1517466787929-bc90951d0974?w=800",
          title: "Players warming up before kickoff"
        },
        { 
          url: "https://images.unsplash.com/photo-1526232761682-d26e03ac148e?w=800",
          title: "Team huddle before the second half"
        },
      ];
      const demoPhotoUrls = demoPhotos.map(p => p.url);
      const photoTitles = demoPhotos.map(p => p.title);

      const teamsToUse = createdTeams.length > 0 ? createdTeams : (existingTeams || []).map(t => ({ id: t.id, name: t.name, club_id: t.club_id }));
      console.log(`[PHOTOS] Teams to use: ${teamsToUse.length}, createdTeams: ${createdTeams.length}, existingTeams: ${(existingTeams || []).length}`);
      
      // Get demo users for photo uploaders
      const usersForPhotos = createdUsers.length > 0 ? createdUsers : [];
      
      // If no demo users created in this run, try to find existing demo users
      let photoUploaders = usersForPhotos;
      if (photoUploaders.length === 0) {
        console.log("[PHOTOS] No users from this run, fetching existing demo users...");
        const { data: existingDemoUsers, error: fetchError } = await supabase
          .from("profiles")
          .select("id, display_name")
          .in("display_name", DEMO_USER_NAMES)
          .limit(10);
        
        if (fetchError) {
          console.error("[PHOTOS] Error fetching demo users:", fetchError);
        }
        
        if (existingDemoUsers && existingDemoUsers.length > 0) {
          photoUploaders = existingDemoUsers.map(u => ({ id: u.id, name: u.display_name || "" }));
          console.log(`[PHOTOS] Found ${photoUploaders.length} existing demo users`);
        }
      }
      
      if (teamsToUse.length === 0) {
        console.log("[PHOTOS] No teams available");
        results.push("⚠ No teams available for photos");
      } else if (photoUploaders.length === 0) {
        console.log("[PHOTOS] No photo uploaders available");
        results.push("⚠ No demo users available for photos - create users first or select 'Users' option");
      } else {
        const { data: proClubs, error: proClubsError } = await supabase
          .from("clubs")
          .select("id")
          .eq("is_pro", true);
        
        if (proClubsError) {
          console.error("[PHOTOS] Error fetching pro clubs:", proClubsError);
        }
        console.log(`[PHOTOS] Pro clubs found: ${(proClubs || []).length}`);
        
        const { data: proTeamSubs, error: proTeamSubsError } = await supabase
          .from("team_subscriptions")
          .select("team_id")
          .eq("is_pro", true);

        if (proTeamSubsError) {
          console.error("[PHOTOS] Error fetching pro team subs:", proTeamSubsError);
        }
        console.log(`[PHOTOS] Pro team subs found: ${(proTeamSubs || []).length}`);

        const proClubIds = new Set((proClubs || []).map(c => c.id));
        const proTeamIds = new Set((proTeamSubs || []).map(t => t.team_id));

        const proTeams = teamsToUse.filter(t => 
          proClubIds.has(t.club_id) || proTeamIds.has(t.id)
        );
        console.log(`[PHOTOS] Pro teams available: ${proTeams.length}`);

        if (proTeams.length === 0) {
          results.push("⚠ No Pro teams available - photos require Pro subscription (club or team level)");
        } else {
          let photosCreated = 0;
          for (const team of proTeams.slice(0, 4)) {
            console.log(`[PHOTOS] Creating photos for team: ${team.name} (${team.id})`);
            for (let i = 0; i < 3; i++) {
              const photoIndex = (photosCreated + i) % demoPhotoUrls.length;
              // Use a variety of demo users as uploaders
              const uploaderIndex = (photosCreated + i) % photoUploaders.length;
              const uploaderId = photoUploaders[uploaderIndex].id;
              
              const { error: photoError } = await supabase
                .from("photos")
                .insert({
                  file_url: demoPhotoUrls[photoIndex],
                  title: photoTitles[photoIndex],
                  team_id: team.id,
                  club_id: team.club_id,
                  uploader_id: uploaderId,
                  show_in_feed: true,
                });

              if (!photoError) {
                photosCreated++;
              } else {
                console.error("[PHOTOS] Photo insert error:", photoError);
              }
            }
          }
          console.log(`[PHOTOS] Total photos created: ${photosCreated}`);
          results.push(`✓ Created ${photosCreated} demo photos (uploaded by demo users)`);
        }
      }
    }

    // GENERATE MESSAGES
    if (options.messages) {
      // Realistic conversation threads where messages get replies
      const teamConversations = [
        [
          { text: "Who's bringing oranges for Saturday? 🍊", delay: 120 },
          { text: "I can bring them!", delay: 119 },
          { text: "Thanks! That's a huge help 🙏", delay: 118 },
          { text: "I'll bring some water bottles too", delay: 117 },
        ],
        [
          { text: "Great practice today everyone! 🏃‍♂️", delay: 110 },
          { text: "The passing drills were really good today", delay: 109 },
          { text: "Agreed! Felt like we really clicked as a team", delay: 108 },
          { text: "Coach wants us to keep working on those through the week", delay: 107 },
        ],
        [
          { text: "What time is warmup on Saturday?", delay: 100 },
          { text: "Coach said 9:30am, kickoff at 10", delay: 99 },
          { text: "Perfect, see you all there!", delay: 98 },
          { text: "Don't forget your blue kit!", delay: 97 },
          { text: "Thanks for the reminder 👍", delay: 96 },
        ],
        [
          { text: "Does anyone have a spare shin pad? My son lost his", delay: 90 },
          { text: "We have an extra pair you can borrow", delay: 89 },
          { text: "Amazing, thank you so much!", delay: 88 },
        ],
        [
          { text: "Training cancelled due to rain ☔", delay: 80 },
          { text: "Oh no! Hopefully next week is better", delay: 79 },
          { text: "Any chance of an indoor session?", delay: 78 },
          { text: "I'll check with the sports centre and let you know", delay: 77 },
        ],
        [
          { text: "Well played today team! 👏 What a game!", delay: 70 },
          { text: "That second goal was incredible!", delay: 69 },
          { text: "Thanks everyone for the support from the sidelines", delay: 68 },
          { text: "Best game of the season so far 🔥", delay: 67 },
          { text: "The defence was solid today", delay: 66 },
        ],
        [
          { text: "Anyone free for a friendly match next Sunday?", delay: 60 },
          { text: "Count us in! What time?", delay: 59 },
          { text: "Thinking 2pm at the main pitch", delay: 58 },
          { text: "Works for us 👍", delay: 57 },
          { text: "I'll bring the bibs", delay: 56 },
          { text: "Perfect, I'll confirm numbers by Thursday", delay: 55 },
        ],
        [
          { text: "Photos from Saturday's match are up! 📸", delay: 50 },
          { text: "Great shots! Love the one of the celebration", delay: 49 },
          { text: "Can you send me the team photo?", delay: 48 },
          { text: "Sure, I'll share it in a bit", delay: 47 },
        ],
        [
          { text: "Reminder: Subs are due by end of the month 💷", delay: 40 },
          { text: "Paid mine yesterday", delay: 39 },
          { text: "How much is it this term?", delay: 38 },
          { text: "£40 for the quarter", delay: 37 },
          { text: "Thanks, I'll get it sorted today", delay: 36 },
        ],
        [
          { text: "New training schedule for next term is ready", delay: 30 },
          { text: "Will training still be Tuesdays and Thursdays?", delay: 29 },
          { text: "Yes, same days but moving to 6pm start", delay: 28 },
          { text: "That works better for us actually!", delay: 27 },
          { text: "Same here, the later time is much easier", delay: 26 },
          { text: "Great feedback, I'll confirm it then 👍", delay: 25 },
        ],
        [
          { text: "Lost property: Anyone missing a black water bottle?", delay: 20 },
          { text: "That might be ours! Has it got a sticker on it?", delay: 19 },
          { text: "Yes! A dinosaur sticker", delay: 18 },
          { text: "That's definitely ours 😂 I'll grab it next session", delay: 17 },
        ],
        [
          { text: "End of season presentation ideas? 🏆", delay: 14 },
          { text: "How about a BBQ at the club?", delay: 13 },
          { text: "Love that idea! We could do awards too", delay: 12 },
          { text: "I can organise the food if someone does trophies", delay: 11 },
          { text: "I'll handle the trophies 🏅", delay: 10 },
          { text: "Amazing teamwork as always!", delay: 9 },
        ],
        [
          { text: "Just a heads up - pitch 3 is waterlogged this week", delay: 7 },
          { text: "We've been moved to pitch 1 instead", delay: 6 },
          { text: "Thanks for letting us know!", delay: 5 },
        ],
        [
          { text: "Can we do some goalkeeping drills next session?", delay: 4 },
          { text: "Great idea, I'll work some into the plan", delay: 3 },
          { text: "My son would love that, he's been practising at home!", delay: 2 },
          { text: "Love the enthusiasm! We'll definitely cover it 💪", delay: 1 },
        ],
      ];

      const clubConversations = [
        [
          { text: "Volunteer helpers needed for the tournament next month", delay: 144 },
          { text: "I can help set up on Friday evening", delay: 142 },
          { text: "Put me down for the BBQ on Saturday", delay: 140 },
          { text: "Thanks so much! Really appreciate the support 🙌", delay: 138 },
          { text: "I can help with parking if needed", delay: 136 },
        ],
        [
          { text: "Club AGM next Thursday at 7pm - all welcome!", delay: 130 },
          { text: "Will there be an online option?", delay: 128 },
          { text: "Yes, we'll send the Zoom link closer to the date", delay: 126 },
          { text: "Can we discuss the new kit supplier?", delay: 124 },
          { text: "That's on the agenda already 👍", delay: 122 },
        ],
        [
          { text: "Congratulations to our U12s on their win! 🏆", delay: 115 },
          { text: "Amazing result! The kids played so well", delay: 113 },
          { text: "Well done to the coaches too!", delay: 111 },
          { text: "What a way to end the season!", delay: 109 },
        ],
        [
          { text: "New merchandise available in the club shop", delay: 100 },
          { text: "Are the new training tops in yet?", delay: 98 },
          { text: "Yes! All sizes available now", delay: 96 },
          { text: "Do they come in kids sizes too?", delay: 94 },
          { text: "Yes, from age 5 upwards", delay: 92 },
          { text: "Brilliant, I'll pop by this weekend", delay: 90 },
        ],
        [
          { text: "Pitch maintenance update: new goals being installed! ⚽", delay: 85 },
          { text: "Finally! The old ones were in a state", delay: 83 },
          { text: "They look great, seen them being put in today", delay: 81 },
          { text: "Nets too?", delay: 79 },
          { text: "Yes, brand new nets as well 🎉", delay: 77 },
        ],
        [
          { text: "Fundraiser update: We've raised £2,500 so far! 🎉", delay: 70 },
          { text: "Wow that's brilliant! Well done everyone", delay: 68 },
          { text: "The raffle alone brought in £800", delay: 66 },
          { text: "Should we do another one next month?", delay: 64 },
          { text: "Definitely! I'll start organising prizes", delay: 62 },
          { text: "I can get some donations from local businesses", delay: 60 },
        ],
        [
          { text: "Welcome to our new coaches who joined this week! 👋", delay: 55 },
          { text: "Great to have you on board!", delay: 53 },
          { text: "Thanks! Really excited to get started", delay: 51 },
          { text: "The club has a fantastic setup", delay: 49 },
        ],
        [
          { text: "Safeguarding training reminder - all coaches need to complete by month end", delay: 42 },
          { text: "Is it the online course or in-person?", delay: 40 },
          { text: "Online this time, I'll send the link", delay: 38 },
          { text: "Done mine last night, only takes about an hour", delay: 36 },
          { text: "Thanks for the heads up, I'll do it this week", delay: 34 },
        ],
        [
          { text: "Club Christmas party date - Saturday 14th December 🎄", delay: 28 },
          { text: "Can't wait! Will there be a Santa again?", delay: 26 },
          { text: "Of course! 🎅 Already booked", delay: 24 },
          { text: "The kids loved it last year", delay: 22 },
          { text: "Is it at the clubhouse?", delay: 20 },
          { text: "Yes, 2pm-5pm. Food and drinks included", delay: 18 },
          { text: "Perfect, we'll be there!", delay: 16 },
        ],
        [
          { text: "Anyone know a good pitch line marker?", delay: 12 },
          { text: "We used SportLine last season, they were great", delay: 10 },
          { text: "How much roughly?", delay: 8 },
          { text: "About £150 per marking. Worth every penny", delay: 6 },
          { text: "Thanks, I'll give them a call", delay: 4 },
        ],
        [
          { text: "Don't forget clocks go back this weekend! ⏰", delay: 3 },
          { text: "Extra hour in bed! 😴", delay: 2.5 },
          { text: "Means it'll be dark earlier for training though", delay: 2 },
          { text: "We've got the floodlights sorted 💡", delay: 1.5 },
          { text: "Great planning as always 👏", delay: 1 },
        ],
      ];

      const teamsToUse = createdTeams.length > 0 ? createdTeams : (existingTeams || []).map(t => ({ id: t.id, name: t.name, club_id: t.club_id }));
      
      // Get demo users - either from this run or existing
      let usersForMessages = createdUsers.length > 0 ? createdUsers : [];
      if (usersForMessages.length === 0) {
        const { data: existingDemoUsers } = await supabase
          .from("profiles")
          .select("id, display_name")
          .in("display_name", DEMO_USER_NAMES)
          .limit(20);
        
        if (existingDemoUsers && existingDemoUsers.length > 0) {
          usersForMessages = existingDemoUsers.map(u => ({ id: u.id, name: u.display_name || "" }));
        }
      }
      
      console.log(`[MESSAGES] Teams to use: ${teamsToUse.length}, Users for messages: ${usersForMessages.length}`);
      
      if (teamsToUse.length === 0 || usersForMessages.length === 0) {
        console.log("[MESSAGES] Missing teams or users");
        results.push("⚠ Need teams and users for messages - generate those first");
      } else {
        let messagesCreated = 0;
        
        // Team messages - using conversation threads
        for (const team of teamsToUse.slice(0, 4)) {
          // Pick 6-8 random conversations for each team for lots of scroll content
          const shuffledConvos = [...teamConversations].sort(() => Math.random() - 0.5);
          const selectedConvos = shuffledConvos.slice(0, Math.min(8, shuffledConvos.length));
          
          for (const conversation of selectedConvos) {
            // Assign different users to each message in the thread
            const shuffledUsers = [...usersForMessages].sort(() => Math.random() - 0.5);
            
            for (let i = 0; i < conversation.length; i++) {
              const msg = conversation[i];
              const user = shuffledUsers[i % shuffledUsers.length];
              const msgDate = new Date();
              msgDate.setHours(msgDate.getHours() - msg.delay);
              
              const { error } = await supabase
                .from("team_messages")
                .insert({
                  team_id: team.id,
                  author_id: user.id,
                  text: msg.text,
                  created_at: msgDate.toISOString(),
                });
              
              if (!error) messagesCreated++;
            }
          }
        }
        
        // Club messages - using conversation threads
        const clubIds = [...new Set(teamsToUse.map(t => t.club_id))];
        for (const clubId of clubIds.slice(0, 3)) {
          // Pick 6-8 conversations for each club for lots of scroll content
          const shuffledConvos = [...clubConversations].sort(() => Math.random() - 0.5);
          const selectedConvos = shuffledConvos.slice(0, Math.min(8, shuffledConvos.length));
          
          for (const conversation of selectedConvos) {
            const shuffledUsers = [...usersForMessages].sort(() => Math.random() - 0.5);
            
            for (let i = 0; i < conversation.length; i++) {
              const msg = conversation[i];
              const user = shuffledUsers[i % shuffledUsers.length];
              const msgDate = new Date();
              msgDate.setHours(msgDate.getHours() - msg.delay);
              
              const { error } = await supabase
                .from("club_messages")
                .insert({
                  club_id: clubId,
                  author_id: user.id,
                  text: msg.text,
                  created_at: msgDate.toISOString(),
                });
              
              if (!error) messagesCreated++;
            }
          }
        }
        
        results.push(`✓ Created ${messagesCreated} demo chat messages`);
      }
    }

    // GENERATE PHOTO ENGAGEMENT (reactions and comments)
    if (options.photoEngagement) {
      const { data: demoPhotos } = await supabase
        .from("photos")
        .select("id")
        .like("file_url", "%unsplash.com%")
        .limit(20);
      
      // Get demo users - either from this run or existing
      let usersForEngagement = createdUsers.length > 0 ? createdUsers : [];
      if (usersForEngagement.length === 0) {
        const { data: existingDemoUsers } = await supabase
          .from("profiles")
          .select("id, display_name")
          .in("display_name", DEMO_USER_NAMES)
          .limit(20);
        
        if (existingDemoUsers && existingDemoUsers.length > 0) {
          usersForEngagement = existingDemoUsers.map(u => ({ id: u.id, name: u.display_name || "" }));
        }
      }
      
      if (!demoPhotos || demoPhotos.length === 0) {
        results.push("⚠ No demo photos found - generate photos first");
      } else if (usersForEngagement.length === 0) {
        results.push("⚠ No demo users found - generate users first");
      } else {
        const reactionTypes = ["👍", "❤️", "🔥", "👏", "⚽"];
        const commentTemplates = [
          "Great shot! 📸",
          "What a moment!",
          "Love this!",
          "Amazing action shot 🔥",
          "Who took this? It's brilliant!",
          "Frame worthy!",
          "Best photo of the season",
          "Look at that form! 💪",
        ];
        
        let reactionsCreated = 0;
        let commentsCreated = 0;
        
        for (const photo of demoPhotos) {
          // Add 2-5 reactions per photo
          const numReactions = 2 + Math.floor(Math.random() * 4);
          const usedUsers = new Set<string>();
          
          for (let i = 0; i < numReactions && i < usersForEngagement.length; i++) {
            let randomUser;
            do {
              randomUser = usersForEngagement[Math.floor(Math.random() * usersForEngagement.length)];
            } while (usedUsers.has(randomUser.id) && usedUsers.size < usersForEngagement.length);
            
            usedUsers.add(randomUser.id);
            const randomReaction = reactionTypes[Math.floor(Math.random() * reactionTypes.length)];
            
            const { error } = await supabase
              .from("photo_reactions")
              .upsert({
                photo_id: photo.id,
                user_id: randomUser.id,
                reaction_type: randomReaction,
              }, { onConflict: 'photo_id,user_id' });
            
            if (!error) reactionsCreated++;
          }
          
          // Add 1-3 comments per photo
          const numComments = 1 + Math.floor(Math.random() * 3);
          for (let i = 0; i < numComments; i++) {
            const randomUser = usersForEngagement[Math.floor(Math.random() * usersForEngagement.length)];
            const randomComment = commentTemplates[Math.floor(Math.random() * commentTemplates.length)];
            const randomDate = new Date();
            randomDate.setHours(randomDate.getHours() - Math.floor(Math.random() * 48));
            
            const { error } = await supabase
              .from("photo_comments")
              .insert({
                photo_id: photo.id,
                user_id: randomUser.id,
                text: randomComment,
                created_at: randomDate.toISOString(),
              });
            
            if (!error) commentsCreated++;
          }
        }
        
        results.push(`✓ Created ${reactionsCreated} photo reactions and ${commentsCreated} comments`);
      }
    }

    // GENERATE VAULT FILES
    if (options.vaultFiles) {
      console.log("[VAULT] Starting vault file generation...");
      
      const teamsToUse = createdTeams.length > 0 ? createdTeams : (existingTeams || []).map(t => ({ id: t.id, name: t.name, club_id: t.club_id }));
      console.log(`[VAULT] Teams to use: ${teamsToUse.length}`);
      
      // Get demo users - either from this run or existing
      let usersForVault = createdUsers.length > 0 ? createdUsers : [];
      if (usersForVault.length === 0) {
        console.log("[VAULT] No users from this run, fetching existing demo users...");
        const { data: existingDemoUsers, error: fetchError } = await supabase
          .from("profiles")
          .select("id, display_name")
          .in("display_name", DEMO_USER_NAMES)
          .limit(20);
        
        if (fetchError) {
          console.error("[VAULT] Error fetching demo users:", fetchError);
        }
        
        if (existingDemoUsers && existingDemoUsers.length > 0) {
          usersForVault = existingDemoUsers.map(u => ({ id: u.id, name: u.display_name || "" }));
          console.log(`[VAULT] Found ${usersForVault.length} existing demo users`);
        }
      }
      
      if (teamsToUse.length === 0) {
        console.log("[VAULT] No teams available");
        results.push("⚠ No teams available for vault files");
      } else if (usersForVault.length === 0) {
        console.log("[VAULT] No users available for vault files");
        results.push("⚠ No demo users available for vault files - create users first");
      } else {
        // Check which clubs have Pro access
        const { data: proClubs, error: proClubsErr } = await supabase
          .from("clubs")
          .select("id")
          .eq("is_pro", true);
        
        if (proClubsErr) {
          console.error("[VAULT] Error fetching pro clubs:", proClubsErr);
        }
        
        const { data: clubSubs, error: clubSubsErr } = await supabase
          .from("club_subscriptions")
          .select("club_id, is_pro, admin_pro_override");
        
        if (clubSubsErr) {
          console.error("[VAULT] Error fetching club subs:", clubSubsErr);
        }
        
        console.log(`[VAULT] Pro clubs: ${(proClubs || []).length}, Club subs: ${(clubSubs || []).length}`);
        
        const proClubIds = new Set([
          ...(proClubs || []).map(c => c.id),
          ...(clubSubs || []).filter(s => s.is_pro || s.admin_pro_override).map(s => s.club_id)
        ]);
        console.log(`[VAULT] Total pro club IDs: ${proClubIds.size}`);
        
        // Get unique clubs from teams that have Pro access
        const clubIds = [...new Set(teamsToUse.map(t => t.club_id))].filter(id => proClubIds.has(id));
        console.log(`[VAULT] Clubs from teams with Pro access: ${clubIds.length}`);
        
        if (clubIds.length === 0) {
          console.log("[VAULT] No Pro clubs available from teams");
          results.push("⚠ No Pro clubs available - vault files require Pro subscription");
        } else {
          // Define folder structure for demo files
          const folderStructure = [
            { name: "Governance", files: [
              { name: "Club Constitution.pdf", type: "constitution" },
              { name: "Club Bylaws.pdf", type: "bylaws" },
              { name: "Code of Conduct.pdf", type: "code_of_conduct" },
            ]},
            { name: "Strategic Planning", files: [
              { name: "Strategic Plan 2024-2027.pdf", type: "strategic_plan" },
              { name: "Annual Goals 2024.pdf", type: "goals" },
            ]},
            { name: "Meeting Minutes", files: [
              { name: "AGM Minutes - November 2024.pdf", type: "agm_minutes" },
              { name: "Committee Meeting - October 2024.pdf", type: "committee_minutes" },
              { name: "Committee Meeting - September 2024.pdf", type: "committee_minutes" },
              { name: "Committee Meeting - August 2024.pdf", type: "committee_minutes" },
            ]},
            { name: "Match Rules & Policies", files: [
              { name: "Match Day Rules.pdf", type: "match_rules" },
              { name: "Player Eligibility Policy.pdf", type: "eligibility" },
              { name: "Wet Weather Policy.pdf", type: "weather_policy" },
              { name: "Ground Rules.pdf", type: "ground_rules" },
            ]},
            { name: "Financial Reports", files: [
              { name: "Annual Report 2023-24.pdf", type: "annual_report" },
              { name: "Budget 2024-25.pdf", type: "budget" },
            ]},
          ];
          
          let foldersCreated = 0;
          let filesCreated = 0;
          
          for (const clubId of clubIds) {
            // Get a demo user as uploader for this club
            const uploaderIndex = Math.floor(Math.random() * usersForVault.length);
            const uploaderId = usersForVault[uploaderIndex].id;
            
            for (const folder of folderStructure) {
              // Create folder
              const { data: createdFolder, error: folderError } = await supabase
                .from("vault_folders")
                .insert({
                  name: folder.name,
                  club_id: clubId,
                  created_by: uploaderId,
                })
                .select("id")
                .single();
              
              if (folderError) {
                console.error("Folder creation error:", folderError);
                continue;
              }
              
              foldersCreated++;
              
              // Create files in folder
              for (const file of folder.files) {
                // Use a placeholder URL that indicates demo content
                const demoFileUrl = `https://demo-files.example.com/${file.type}/${encodeURIComponent(file.name)}`;
                
                const { error: fileError } = await supabase
                  .from("vault_files")
                  .insert({
                    name: file.name,
                    file_url: demoFileUrl,
                    club_id: clubId,
                    folder_id: createdFolder.id,
                    uploader_id: uploaderId,
                    file_size: Math.floor(Math.random() * 500000) + 50000, // Random 50KB - 550KB
                  });
                
                if (!fileError) {
                  filesCreated++;
                } else {
                  console.error("File creation error:", fileError);
                }
              }
            }
          }
          
          results.push(`✓ Created ${foldersCreated} vault folders and ${filesCreated} files`);
        }
      }
    }

    // Update admin's profile name if not set
    await supabase
      .from("profiles")
      .update({ display_name: "Demo Admin" })
      .eq("id", user.id)
      .is("display_name", null);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Demo data generated successfully",
        details: results,
        summary: {
          clubs: options.clubs ? createdClubs.length : 0,
          teams: options.teams ? createdTeams.length : 0,
          users: options.users ? createdUsers.length : 0,
          events: options.events ? "created" : "skipped",
          formations: options.formations ? "created" : "skipped",
          photos: options.photos ? "created" : "skipped",
          messages: options.messages ? "created" : "skipped",
          photoEngagement: options.photoEngagement ? "created" : "skipped",
          vaultFiles: options.vaultFiles ? "created" : "skipped",
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in generate-demo-data:", error);
    const message = error instanceof Error ? error.message : "An unexpected error occurred";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
