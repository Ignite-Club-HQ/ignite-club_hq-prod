import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import JSZip from "https://esm.sh/jszip@3.10.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function sanitizePath(name: string): string {
  return (name || "unnamed").replace(/[/\\:*?"<>|]/g, "_").trim() || "unnamed";
}

// Extract storage path from URL for private buckets
function extractStoragePath(url: string, bucket: string): string | null {
  if (!url) return null;
  
  const patterns = [
    new RegExp(`/storage/v1/object/public/${bucket}/(.+)$`),
    new RegExp(`/storage/v1/object/sign/${bucket}/(.+?)\\?`),
    new RegExp(`/storage/v1/object/${bucket}/(.+)$`),
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return decodeURIComponent(match[1]);
  }
  
  // If it's just a path without full URL
  if (!url.startsWith("http")) {
    return url;
  }
  
  return null;
}

// Download from storage bucket (works with private buckets)
// deno-lint-ignore no-explicit-any
async function downloadFromStorage(
  supabase: any,
  bucket: string,
  path: string
): Promise<ArrayBuffer | null> {
  try {
    const { data, error } = await supabase.storage.from(bucket).download(path);
    if (error || !data) {
      console.error(`Failed to download ${bucket}/${path}:`, error);
      return null;
    }
    return await data.arrayBuffer();
  } catch (e) {
    console.error(`Error downloading ${bucket}/${path}:`, e);
    return null;
  }
}

// Fallback for public URLs (sponsor logos, etc.)
async function fetchFileAsArrayBuffer(url: string): Promise<ArrayBuffer | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return await response.arrayBuffer();
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Authentication: require either service role key or app_admin user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const isServiceRole = token === serviceRoleKey;

    if (!isServiceRole) {
      // Validate as authenticated user with app_admin role
      const userClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      });

      const { data: { user }, error: authError } = await userClient.auth.getUser(token);
      if (authError || !user) {
        return new Response(JSON.stringify({ error: "Invalid authentication" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: adminRole } = await userClient
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "app_admin")
        .maybeSingle();

      if (!adminRole) {
        return new Response(JSON.stringify({ error: "Forbidden - app_admin role required" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    console.log("Starting comprehensive backup job...");
    
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false }
    });

    const zip = new JSZip();
    let fileCount = 0;
    let errorCount = 0;

    // ===== FETCH ALL DATA =====
    console.log("Fetching all data...");

    // Clubs
    const { data: clubs } = await supabase.from("clubs").select("*");
    const clubMap = new Map((clubs || []).map(c => [c.id, c]));
    console.log(`Found ${clubs?.length || 0} clubs`);

    // Teams
    const { data: teams } = await supabase.from("teams").select("*");
    const teamMap = new Map((teams || []).map(t => [t.id, t]));
    console.log(`Found ${teams?.length || 0} teams`);

    // Club subscriptions
    const { data: clubSubscriptions } = await supabase.from("club_subscriptions").select("*");
    const clubSubMap = new Map((clubSubscriptions || []).map(s => [s.club_id, s]));

    // Team subscriptions
    const { data: teamSubscriptions } = await supabase.from("team_subscriptions").select("*");
    const teamSubMap = new Map((teamSubscriptions || []).map(s => [s.team_id, s]));

    // Sponsors
    const { data: sponsors } = await supabase.from("sponsors").select("*");
    const sponsorsByClub = new Map<string, typeof sponsors>();
    (sponsors || []).forEach(s => {
      if (!sponsorsByClub.has(s.club_id)) sponsorsByClub.set(s.club_id, []);
      sponsorsByClub.get(s.club_id)!.push(s);
    });

    // Team sponsors
    const { data: teamSponsors } = await supabase.from("team_sponsors").select("*");

    // Club rewards
    const { data: clubRewards } = await supabase.from("club_rewards").select("*");
    const rewardsByClub = new Map<string, typeof clubRewards>();
    (clubRewards || []).forEach(r => {
      if (!rewardsByClub.has(r.club_id)) rewardsByClub.set(r.club_id, []);
      rewardsByClub.get(r.club_id)!.push(r);
    });

    // Club invites
    const { data: clubInvites } = await supabase.from("club_invites").select("*");
    const invitesByClub = new Map<string, typeof clubInvites>();
    (clubInvites || []).forEach(i => {
      if (!invitesByClub.has(i.club_id)) invitesByClub.set(i.club_id, []);
      invitesByClub.get(i.club_id)!.push(i);
    });

    // Team invites
    const { data: teamInvites } = await supabase.from("team_invites").select("*");
    const invitesByTeam = new Map<string, typeof teamInvites>();
    (teamInvites || []).forEach(i => {
      if (!invitesByTeam.has(i.team_id)) invitesByTeam.set(i.team_id, []);
      invitesByTeam.get(i.team_id)!.push(i);
    });

    // User roles
    const { data: userRoles } = await supabase.from("user_roles").select("*");
    const rolesByClub = new Map<string, typeof userRoles>();
    const rolesByTeam = new Map<string, typeof userRoles>();
    (userRoles || []).forEach(r => {
      if (r.club_id && !r.team_id) {
        if (!rolesByClub.has(r.club_id)) rolesByClub.set(r.club_id, []);
        rolesByClub.get(r.club_id)!.push(r);
      }
      if (r.team_id) {
        if (!rolesByTeam.has(r.team_id)) rolesByTeam.set(r.team_id, []);
        rolesByTeam.get(r.team_id)!.push(r);
      }
    });

    // Events
    const { data: events } = await supabase.from("events").select("*");
    const eventsByTeam = new Map<string, typeof events>();
    const eventsByClub = new Map<string, typeof events>();
    (events || []).forEach(e => {
      if (e.team_id) {
        if (!eventsByTeam.has(e.team_id)) eventsByTeam.set(e.team_id, []);
        eventsByTeam.get(e.team_id)!.push(e);
      } else if (e.club_id) {
        if (!eventsByClub.has(e.club_id)) eventsByClub.set(e.club_id, []);
        eventsByClub.get(e.club_id)!.push(e);
      }
    });

    // RSVPs
    const { data: rsvps } = await supabase.from("rsvps").select("*");
    const rsvpsByEvent = new Map<string, typeof rsvps>();
    (rsvps || []).forEach(r => {
      if (!rsvpsByEvent.has(r.event_id)) rsvpsByEvent.set(r.event_id, []);
      rsvpsByEvent.get(r.event_id)!.push(r);
    });

    // Duties
    const { data: duties } = await supabase.from("duties").select("*");
    const dutiesByEvent = new Map<string, typeof duties>();
    (duties || []).forEach(d => {
      if (!dutiesByEvent.has(d.event_id)) dutiesByEvent.set(d.event_id, []);
      dutiesByEvent.get(d.event_id)!.push(d);
    });

    // Event sponsors
    const { data: eventSponsors } = await supabase.from("event_sponsors").select("*");
    const sponsorsByEvent = new Map<string, typeof eventSponsors>();
    (eventSponsors || []).forEach(s => {
      if (!sponsorsByEvent.has(s.event_id)) sponsorsByEvent.set(s.event_id, []);
      sponsorsByEvent.get(s.event_id)!.push(s);
    });

    // Event payments
    const { data: eventPayments } = await supabase.from("event_payments").select("*");
    const paymentsByEvent = new Map<string, typeof eventPayments>();
    (eventPayments || []).forEach(p => {
      if (!paymentsByEvent.has(p.event_id)) paymentsByEvent.set(p.event_id, []);
      paymentsByEvent.get(p.event_id)!.push(p);
    });

    // Chat messages
    const { data: clubMessages } = await supabase.from("club_messages").select("*");
    const msgsByClub = new Map<string, typeof clubMessages>();
    (clubMessages || []).forEach(m => {
      if (!msgsByClub.has(m.club_id)) msgsByClub.set(m.club_id, []);
      msgsByClub.get(m.club_id)!.push(m);
    });

    const { data: teamMessages } = await supabase.from("team_messages").select("*");
    const msgsByTeam = new Map<string, typeof teamMessages>();
    (teamMessages || []).forEach(m => {
      if (!msgsByTeam.has(m.team_id)) msgsByTeam.set(m.team_id, []);
      msgsByTeam.get(m.team_id)!.push(m);
    });

    // Chat groups
    const { data: chatGroups } = await supabase.from("chat_groups").select("*");
    const groupsByClub = new Map<string, typeof chatGroups>();
    const groupsByTeam = new Map<string, typeof chatGroups>();
    (chatGroups || []).forEach(g => {
      if (g.club_id) {
        if (!groupsByClub.has(g.club_id)) groupsByClub.set(g.club_id, []);
        groupsByClub.get(g.club_id)!.push(g);
      }
      if (g.team_id) {
        if (!groupsByTeam.has(g.team_id)) groupsByTeam.set(g.team_id, []);
        groupsByTeam.get(g.team_id)!.push(g);
      }
    });

    // Group messages
    const { data: groupMessages } = await supabase.from("group_messages").select("*");
    const msgsByGroup = new Map<string, typeof groupMessages>();
    (groupMessages || []).forEach(m => {
      if (!msgsByGroup.has(m.group_id)) msgsByGroup.set(m.group_id, []);
      msgsByGroup.get(m.group_id)!.push(m);
    });

    // Photos
    const { data: photos } = await supabase.from("photos").select("*").is("deleted_at", null);
    const photosByClub = new Map<string, typeof photos>();
    const photosByTeam = new Map<string, typeof photos>();
    (photos || []).forEach(p => {
      if (p.team_id) {
        if (!photosByTeam.has(p.team_id)) photosByTeam.set(p.team_id, []);
        photosByTeam.get(p.team_id)!.push(p);
      } else if (p.club_id) {
        if (!photosByClub.has(p.club_id)) photosByClub.set(p.club_id, []);
        photosByClub.get(p.club_id)!.push(p);
      }
    });

    // Vault files
    const { data: vaultFiles } = await supabase.from("vault_files").select("*").is("deleted_at", null);
    const filesByClub = new Map<string, typeof vaultFiles>();
    const filesByTeam = new Map<string, typeof vaultFiles>();
    (vaultFiles || []).forEach(f => {
      if (f.team_id) {
        if (!filesByTeam.has(f.team_id)) filesByTeam.set(f.team_id, []);
        filesByTeam.get(f.team_id)!.push(f);
      } else if (f.club_id) {
        if (!filesByClub.has(f.club_id)) filesByClub.set(f.club_id, []);
        filesByClub.get(f.club_id)!.push(f);
      }
    });

    // Vault folders
    const { data: vaultFolders } = await supabase.from("vault_folders").select("*");
    const foldersByClub = new Map<string, typeof vaultFolders>();
    const foldersByTeam = new Map<string, typeof vaultFolders>();
    (vaultFolders || []).forEach(f => {
      if (f.team_id) {
        if (!foldersByTeam.has(f.team_id)) foldersByTeam.set(f.team_id, []);
        foldersByTeam.get(f.team_id)!.push(f);
      } else if (f.club_id) {
        if (!foldersByClub.has(f.club_id)) foldersByClub.set(f.club_id, []);
        foldersByClub.get(f.club_id)!.push(f);
      }
    });

    // Team folders
    const { data: teamFolders } = await supabase.from("team_folders").select("*");
    const teamFoldersByClub = new Map<string, typeof teamFolders>();
    (teamFolders || []).forEach(f => {
      if (!teamFoldersByClub.has(f.club_id)) teamFoldersByClub.set(f.club_id, []);
      teamFoldersByClub.get(f.club_id)!.push(f);
    });

    // Game stats
    const { data: gameStats } = await supabase.from("game_player_stats").select("*");
    const statsByTeam = new Map<string, typeof gameStats>();
    (gameStats || []).forEach(s => {
      if (!statsByTeam.has(s.team_id)) statsByTeam.set(s.team_id, []);
      statsByTeam.get(s.team_id)!.push(s);
    });

    // Game summaries
    const { data: gameSummaries } = await supabase.from("game_summaries").select("*");
    const summariesByTeam = new Map<string, typeof gameSummaries>();
    (gameSummaries || []).forEach(s => {
      if (!summariesByTeam.has(s.team_id)) summariesByTeam.set(s.team_id, []);
      summariesByTeam.get(s.team_id)!.push(s);
    });

    // Active games
    const { data: activeGames } = await supabase.from("active_games").select("*");
    const gamesByTeam = new Map<string, typeof activeGames>();
    (activeGames || []).forEach(g => {
      if (g.team_id) {
        if (!gamesByTeam.has(g.team_id)) gamesByTeam.set(g.team_id, []);
        gamesByTeam.get(g.team_id)!.push(g);
      }
    });

    // Children and assignments
    const { data: children } = await supabase.from("children").select("*");
    const { data: childAssignments } = await supabase.from("child_team_assignments").select("*");
    const assignmentsByTeam = new Map<string, typeof childAssignments>();
    (childAssignments || []).forEach(a => {
      if (!assignmentsByTeam.has(a.team_id)) assignmentsByTeam.set(a.team_id, []);
      assignmentsByTeam.get(a.team_id)!.push(a);
    });

    // Member subscription payments
    const { data: memberPayments } = await supabase.from("member_subscription_payments").select("*");
    const memberPaymentsByClub = new Map<string, typeof memberPayments>();
    (memberPayments || []).forEach(p => {
      if (!memberPaymentsByClub.has(p.club_id)) memberPaymentsByClub.set(p.club_id, []);
      memberPaymentsByClub.get(p.club_id)!.push(p);
    });

    // Reward redemptions
    const { data: redemptions } = await supabase.from("reward_redemptions").select("*");

    // ===== BUILD ZIP STRUCTURE =====
    console.log("Building backup structure...");

    for (const club of (clubs || [])) {
      const clubPath = `clubs/${sanitizePath(club.name)}`;
      
      // Club info
      zip.file(`${clubPath}/_club_info.json`, JSON.stringify({
        ...club,
        subscription: clubSubMap.get(club.id) || null,
      }, null, 2));

      // Sponsors
      const clubSponsors = sponsorsByClub.get(club.id) || [];
      if (clubSponsors.length > 0) {
        zip.file(`${clubPath}/sponsors/sponsors.json`, JSON.stringify(clubSponsors, null, 2));
        for (const sponsor of clubSponsors) {
          if (sponsor.logo_url) {
            const content = await fetchFileAsArrayBuffer(sponsor.logo_url);
            if (content) {
              const ext = sponsor.logo_url.split('.').pop() || 'png';
              zip.file(`${clubPath}/sponsors/${sanitizePath(sponsor.name)}.${ext}`, content);
              fileCount++;
            }
          }
        }
      }

      // Rewards
      const rewards = rewardsByClub.get(club.id) || [];
      if (rewards.length > 0) {
        zip.file(`${clubPath}/rewards/rewards.json`, JSON.stringify(rewards, null, 2));
        // Include redemptions for this club's rewards
        const rewardIds = rewards.map(r => r.id);
        const clubRedemptions = (redemptions || []).filter(r => rewardIds.includes(r.reward_id));
        if (clubRedemptions.length > 0) {
          zip.file(`${clubPath}/rewards/redemptions.json`, JSON.stringify(clubRedemptions, null, 2));
        }
      }

      // Club invites
      const invites = invitesByClub.get(club.id) || [];
      if (invites.length > 0) {
        zip.file(`${clubPath}/invites/club_invites.json`, JSON.stringify(invites, null, 2));
      }

      // Club roles
      const clubRoles = rolesByClub.get(club.id) || [];
      if (clubRoles.length > 0) {
        zip.file(`${clubPath}/roles/club_roles.json`, JSON.stringify(clubRoles, null, 2));
      }

      // Club messages
      const clubMsgs = msgsByClub.get(club.id) || [];
      if (clubMsgs.length > 0) {
        zip.file(`${clubPath}/messages/club_messages.json`, JSON.stringify(clubMsgs, null, 2));
      }

      // Club chat groups
      const clubGroups = groupsByClub.get(club.id) || [];
      for (const group of clubGroups) {
        const groupMsgs = msgsByGroup.get(group.id) || [];
        zip.file(`${clubPath}/chat_groups/${sanitizePath(group.name)}.json`, JSON.stringify({
          group,
          messages: groupMsgs,
        }, null, 2));
      }

      // Club-level events
      const clubEvents = eventsByClub.get(club.id) || [];
      for (const event of clubEvents) {
        zip.file(`${clubPath}/events/${sanitizePath(event.title)}_${event.id.slice(0,8)}.json`, JSON.stringify({
          event,
          rsvps: rsvpsByEvent.get(event.id) || [],
          duties: dutiesByEvent.get(event.id) || [],
          sponsors: sponsorsByEvent.get(event.id) || [],
          payments: paymentsByEvent.get(event.id) || [],
        }, null, 2));
      }

      // Club photos - download from private storage bucket
      const clubPhotos = photosByClub.get(club.id) || [];
      if (clubPhotos.length > 0) {
        zip.file(`${clubPath}/photos/_photos.json`, JSON.stringify(clubPhotos, null, 2));
        for (const photo of clubPhotos) {
          const url = photo.image_url || photo.file_url;
          const storagePath = extractStoragePath(url, "photos");
          let content: ArrayBuffer | null = null;
          
          if (storagePath) {
            content = await downloadFromStorage(supabase, "photos", storagePath);
          }
          
          if (content) {
            const ext = (storagePath || url || "").split('.').pop() || 'jpg';
            const name = photo.title || `photo_${photo.id.slice(0,8)}`;
            zip.file(`${clubPath}/photos/${sanitizePath(name)}.${ext}`, content);
            fileCount++;
          } else {
            console.error(`Failed to backup club photo: ${photo.id}`);
            errorCount++;
          }
        }
      }

      // Club vault files - download from private storage bucket
      const clubFiles = filesByClub.get(club.id) || [];
      if (clubFiles.length > 0) {
        zip.file(`${clubPath}/files/_files.json`, JSON.stringify(clubFiles, null, 2));
        for (const file of clubFiles) {
          const storagePath = extractStoragePath(file.file_url, "chat-attachments");
          let content: ArrayBuffer | null = null;
          
          if (storagePath) {
            content = await downloadFromStorage(supabase, "chat-attachments", storagePath);
          } else {
            // Fallback to public URL fetch
            content = await fetchFileAsArrayBuffer(file.file_url);
          }
          
          if (content) {
            zip.file(`${clubPath}/files/${sanitizePath(file.name)}`, content);
            fileCount++;
          } else {
            console.error(`Failed to backup club file: ${file.id}`);
            errorCount++;
          }
        }
      }

      // Club vault folders
      const clubVaultFolders = foldersByClub.get(club.id) || [];
      if (clubVaultFolders.length > 0) {
        zip.file(`${clubPath}/vault_folders.json`, JSON.stringify(clubVaultFolders, null, 2));
      }

      // Team folders config
      const clubTeamFolders = teamFoldersByClub.get(club.id) || [];
      if (clubTeamFolders.length > 0) {
        zip.file(`${clubPath}/team_folders_config.json`, JSON.stringify(clubTeamFolders, null, 2));
      }

      // Member payments
      const payments = memberPaymentsByClub.get(club.id) || [];
      if (payments.length > 0) {
        zip.file(`${clubPath}/member_payments.json`, JSON.stringify(payments, null, 2));
      }

      // Teams
      const clubTeams = (teams || []).filter(t => t.club_id === club.id);
      for (const team of clubTeams) {
        const teamPath = `${clubPath}/teams/${sanitizePath(team.name)}`;
        
        // Team info
        zip.file(`${teamPath}/_team_info.json`, JSON.stringify({
          ...team,
          subscription: teamSubMap.get(team.id) || null,
        }, null, 2));

        // Team roles
        const teamRoles = rolesByTeam.get(team.id) || [];
        if (teamRoles.length > 0) {
          zip.file(`${teamPath}/roles/team_roles.json`, JSON.stringify(teamRoles, null, 2));
        }

        // Team invites
        const tInvites = invitesByTeam.get(team.id) || [];
        if (tInvites.length > 0) {
          zip.file(`${teamPath}/invites/team_invites.json`, JSON.stringify(tInvites, null, 2));
        }

        // Team messages
        const teamMsgs = msgsByTeam.get(team.id) || [];
        if (teamMsgs.length > 0) {
          zip.file(`${teamPath}/messages/team_messages.json`, JSON.stringify(teamMsgs, null, 2));
        }

        // Team chat groups
        const tGroups = groupsByTeam.get(team.id) || [];
        for (const group of tGroups) {
          const groupMsgs = msgsByGroup.get(group.id) || [];
          zip.file(`${teamPath}/chat_groups/${sanitizePath(group.name)}.json`, JSON.stringify({
            group,
            messages: groupMsgs,
          }, null, 2));
        }

        // Team events
        const teamEvents = eventsByTeam.get(team.id) || [];
        for (const event of teamEvents) {
          zip.file(`${teamPath}/events/${sanitizePath(event.title)}_${event.id.slice(0,8)}.json`, JSON.stringify({
            event,
            rsvps: rsvpsByEvent.get(event.id) || [],
            duties: dutiesByEvent.get(event.id) || [],
            sponsors: sponsorsByEvent.get(event.id) || [],
            payments: paymentsByEvent.get(event.id) || [],
          }, null, 2));
        }

        // Team photos - download from private storage bucket
        const teamPhotos = photosByTeam.get(team.id) || [];
        if (teamPhotos.length > 0) {
          zip.file(`${teamPath}/photos/_photos.json`, JSON.stringify(teamPhotos, null, 2));
          for (const photo of teamPhotos) {
            const url = photo.image_url || photo.file_url;
            const storagePath = extractStoragePath(url, "photos");
            let content: ArrayBuffer | null = null;
            
            if (storagePath) {
              content = await downloadFromStorage(supabase, "photos", storagePath);
            }
            
            if (content) {
              const ext = (storagePath || url || "").split('.').pop() || 'jpg';
              const name = photo.title || `photo_${photo.id.slice(0,8)}`;
              zip.file(`${teamPath}/photos/${sanitizePath(name)}.${ext}`, content);
              fileCount++;
            } else {
              console.error(`Failed to backup team photo: ${photo.id}`);
              errorCount++;
            }
          }
        }

        // Team vault files - download from private storage bucket
        const teamFiles = filesByTeam.get(team.id) || [];
        if (teamFiles.length > 0) {
          zip.file(`${teamPath}/files/_files.json`, JSON.stringify(teamFiles, null, 2));
          for (const file of teamFiles) {
            const storagePath = extractStoragePath(file.file_url, "chat-attachments");
            let content: ArrayBuffer | null = null;
            
            if (storagePath) {
              content = await downloadFromStorage(supabase, "chat-attachments", storagePath);
            } else {
              content = await fetchFileAsArrayBuffer(file.file_url);
            }
            
            if (content) {
              zip.file(`${teamPath}/files/${sanitizePath(file.name)}`, content);
              fileCount++;
            } else {
              console.error(`Failed to backup team file: ${file.id}`);
              errorCount++;
            }
          }
        }

        // Team vault folders
        const teamVaultFolders = foldersByTeam.get(team.id) || [];
        if (teamVaultFolders.length > 0) {
          zip.file(`${teamPath}/vault_folders.json`, JSON.stringify(teamVaultFolders, null, 2));
        }

        // Game stats
        const stats = statsByTeam.get(team.id) || [];
        if (stats.length > 0) {
          zip.file(`${teamPath}/game_stats/player_stats.json`, JSON.stringify(stats, null, 2));
        }

        // Game summaries
        const summaries = summariesByTeam.get(team.id) || [];
        if (summaries.length > 0) {
          zip.file(`${teamPath}/game_stats/game_summaries.json`, JSON.stringify(summaries, null, 2));
        }

        // Active games
        const games = gamesByTeam.get(team.id) || [];
        if (games.length > 0) {
          zip.file(`${teamPath}/active_games.json`, JSON.stringify(games, null, 2));
        }

        // Child assignments
        const assignments = assignmentsByTeam.get(team.id) || [];
        if (assignments.length > 0) {
          const childIds = assignments.map(a => a.child_id);
          const teamChildren = (children || []).filter(c => childIds.includes(c.id));
          zip.file(`${teamPath}/children.json`, JSON.stringify({
            assignments,
            children: teamChildren,
          }, null, 2));
        }

        // Team sponsors
        const tSponsors = (teamSponsors || []).filter(ts => ts.team_id === team.id);
        if (tSponsors.length > 0) {
          zip.file(`${teamPath}/team_sponsors.json`, JSON.stringify(tSponsors, null, 2));
        }
      }
    }

    // Manifest
    const manifest = {
      created_at: new Date().toISOString(),
      version: "2.0",
      summary: {
        clubs: clubs?.length || 0,
        teams: teams?.length || 0,
        events: events?.length || 0,
        photos: photos?.length || 0,
        files: vaultFiles?.length || 0,
        messages: {
          club: clubMessages?.length || 0,
          team: teamMessages?.length || 0,
          group: groupMessages?.length || 0,
        },
        files_backed_up: fileCount,
        errors: errorCount,
      },
      clubs: (clubs || []).map(c => ({ id: c.id, name: c.name })),
      teams: (teams || []).map(t => ({ id: t.id, name: t.name, club_id: t.club_id })),
    };
    
    zip.file("_manifest.json", JSON.stringify(manifest, null, 2));

    console.log(`Backup complete: ${fileCount} files, ${errorCount} errors`);

    // Generate and upload
    const zipContent = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    
    const backupDate = new Date().toISOString().split("T")[0];
    const backupFilename = `vault-backup-${backupDate}.zip`;

    // Ensure bucket exists
    const { data: buckets } = await supabase.storage.listBuckets();
    if (!buckets?.some(b => b.name === "backups")) {
      await supabase.storage.createBucket("backups", { public: false, fileSizeLimit: 5368709120 });
    }

    const { error: uploadError } = await supabase.storage
      .from("backups")
      .upload(backupFilename, zipContent, { contentType: "application/zip", upsert: true });
    
    if (uploadError) throw uploadError;

    console.log(`Backup uploaded: ${backupFilename}`);

    // Cleanup old backups (keep last 30)
    const { data: existingBackups } = await supabase.storage.from("backups").list();
    if (existingBackups && existingBackups.length > 30) {
      const sorted = existingBackups.filter(f => f.name.startsWith("vault-backup-")).sort((a, b) => a.name.localeCompare(b.name));
      const toDelete = sorted.slice(0, sorted.length - 30);
      for (const backup of toDelete) {
        await supabase.storage.from("backups").remove([backup.name]);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Comprehensive backup completed",
        backup_file: backupFilename,
        files_backed_up: fileCount,
        errors: errorCount,
        summary: manifest.summary,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Backup error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
