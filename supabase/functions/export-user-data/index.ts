import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as zip from "https://deno.land/x/zipjs@v2.7.32/index.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Rate limiting - stricter for data export (expensive operation)
const RATE_LIMIT_WINDOW_SECONDS = 3600; // 1 hour window
const RATE_LIMIT_MAX_REQUESTS = 3; // Only 3 exports per hour

async function checkRateLimit(
  supabase: any,
  identifier: string,
  endpoint: string
): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - RATE_LIMIT_WINDOW_SECONDS * 1000);

  const { data: existing } = await supabase
    .from('rate_limits')
    .select('*')
    .eq('identifier', identifier)
    .eq('endpoint', endpoint)
    .single();

  if (existing) {
    const recordWindowStart = new Date(existing.window_start);
    
    if (recordWindowStart < windowStart) {
      await supabase.from('rate_limits').update({
        request_count: 1,
        window_start: now.toISOString(),
        updated_at: now.toISOString()
      }).eq('id', existing.id);
      
      return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - 1, resetAt: new Date(now.getTime() + RATE_LIMIT_WINDOW_SECONDS * 1000) };
    }

    if (existing.request_count >= RATE_LIMIT_MAX_REQUESTS) {
      return { allowed: false, remaining: 0, resetAt: new Date(recordWindowStart.getTime() + RATE_LIMIT_WINDOW_SECONDS * 1000) };
    }

    await supabase.from('rate_limits').update({
      request_count: existing.request_count + 1,
      updated_at: now.toISOString()
    }).eq('id', existing.id);

    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - existing.request_count - 1, resetAt: new Date(recordWindowStart.getTime() + RATE_LIMIT_WINDOW_SECONDS * 1000) };
  }

  await supabase.from('rate_limits').insert({ identifier, endpoint, request_count: 1, window_start: now.toISOString() });
  return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - 1, resetAt: new Date(now.getTime() + RATE_LIMIT_WINDOW_SECONDS * 1000) };
}

// Convert array of objects to CSV string
function toCSV(data: any[], columns?: string[]): string {
  if (!data || data.length === 0) return "";
  
  const cols = columns || Object.keys(data[0]);
  const header = cols.join(",");
  
  const rows = data.map(row => {
    return cols.map(col => {
      const value = row[col];
      if (value === null || value === undefined) return "";
      if (typeof value === "object") return `"${JSON.stringify(value).replace(/"/g, '""')}"`;
      if (typeof value === "string" && (value.includes(",") || value.includes('"') || value.includes("\n"))) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return String(value);
    }).join(",");
  });
  
  return [header, ...rows].join("\n");
}

// Extract storage path from URL
function extractStoragePath(url: string, bucket: string): string | null {
  if (!url) return null;
  
  // Handle various URL formats
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

// Download file from storage bucket
async function downloadFile(
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

// Get file extension from path or default
function getExtension(path: string, defaultExt: string = ".jpg"): string {
  const lastDot = path.lastIndexOf(".");
  if (lastDot > -1) {
    return path.substring(lastDot);
  }
  return defaultExt;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "No authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Use anon key for user auth
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    
    if (userError || !user) {
      console.error("Auth error:", userError);
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use service role for downloading files from private buckets
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Rate limiting check - limit data exports (expensive operation)
    const rateLimitResult = await checkRateLimit(supabase, user.id, 'export-user-data');
    if (!rateLimitResult.allowed) {
      console.warn(`Rate limit exceeded for user ${user.id} on export-user-data`);
      return new Response(
        JSON.stringify({ 
          error: "Too many export requests. Please try again later.",
          retryAfter: Math.ceil((rateLimitResult.resetAt.getTime() - Date.now()) / 1000)
        }),
        { 
          status: 429, 
          headers: { 
            ...corsHeaders, 
            "Content-Type": "application/json",
            "Retry-After": String(Math.ceil((rateLimitResult.resetAt.getTime() - Date.now()) / 1000))
          } 
        }
      );
    }

    console.log(`Exporting data for user: ${user.id}`);

    // Gather all user data in parallel
    const [
      profileResult,
      rolesResult,
      childrenResult,
      rsvpsResult,
      notificationsResult,
      preferencesResult,
      photosResult,
      photoCommentsResult,
      photoReactionsResult,
      dutiesResult,
      feedbackResult,
      redemptionsResult,
      teamMessagesResult,
      clubMessagesResult,
      groupMessagesResult,
    ] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).single(),
      supabase.from("user_roles").select("*, clubs!club_id(name), teams(name)").eq("user_id", user.id),
      supabase.from("children").select("*, child_team_assignments(team_id, teams(name))").eq("parent_id", user.id),
      supabase.from("rsvps").select("*, events(title, event_date, type)").eq("user_id", user.id),
      supabase.from("notifications").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(100),
      supabase.from("notification_preferences").select("*").eq("user_id", user.id).single(),
      supabase.from("photos").select("id, title, image_url, file_url, created_at, clubs!club_id(name), teams(name)").eq("uploader_id", user.id).is("deleted_at", null),
      supabase.from("photo_comments").select("id, text, created_at, photos(title)").eq("user_id", user.id).is("deleted_at", null),
      supabase.from("photo_reactions").select("id, reaction_type, created_at, photos(title)").eq("user_id", user.id),
      supabase.from("duties").select("*, events(title, event_date)").eq("assigned_to", user.id),
      supabase.from("feedback").select("*").eq("user_id", user.id),
      supabase.from("reward_redemptions").select("*, club_rewards(name, points_required), clubs!club_id(name)").eq("user_id", user.id),
      supabase.from("team_messages").select("id, image_url, created_at").eq("author_id", user.id).is("deleted_at", null).not("image_url", "is", null),
      supabase.from("club_messages").select("id, image_url, created_at").eq("author_id", user.id).is("deleted_at", null).not("image_url", "is", null),
      supabase.from("group_messages").select("id, image_url, created_at").eq("author_id", user.id).is("deleted_at", null).not("image_url", "is", null),
    ]);

    // Create ZIP file
    const blobWriter = new zip.BlobWriter("application/zip");
    const zipWriter = new zip.ZipWriter(blobWriter);

    const exportDate = new Date().toISOString().split('T')[0];

    // Add README
    const readme = `Ignite Club HQ Data Export
========================
Export Date: ${new Date().toISOString()}
User Email: ${user.email}

This ZIP contains your personal data from Ignite Club HQ:

- profile.csv - Your profile information
- roles.csv - Your club and team memberships
- children.csv - Your registered children
- rsvps.csv - Your event RSVPs
- notifications.csv - Your recent notifications
- preferences.json - Your notification preferences
- photos.csv - Photos you've uploaded
- comments.csv - Comments you've made on photos
- reactions.csv - Your photo reactions
- duties.csv - Duties assigned to you
- feedback.csv - Feedback you've submitted
- rewards.csv - Your reward redemptions
- complete_data.json - All data in JSON format

Folders:
- photos/ - Your uploaded photos
- chat-images/ - Images you've sent in chats
- avatars/ - Your profile avatars

For any questions, contact support.
`;
    await zipWriter.add("README.txt", new zip.TextReader(readme));

    // Profile - reference local avatar file, not URL
    if (profileResult.data) {
      const avatarUrl = profileResult.data.avatar_url;
      const avatarPath = avatarUrl ? extractStoragePath(avatarUrl, "avatars") : null;
      const avatarExt = avatarPath ? getExtension(avatarPath) : ".jpg";
      const profileCSV = toCSV([{
        display_name: profileResult.data.display_name,
        email: user.email,
        avatar: avatarUrl ? `avatars/avatar${avatarExt}` : "",
        ignite_points: profileResult.data.ignite_points,
        profile_visibility: profileResult.data.profile_visibility,
        created_at: profileResult.data.created_at,
      }]);
      await zipWriter.add("profile.csv", new zip.TextReader(profileCSV));
    }

    // Roles
    if (rolesResult.data && rolesResult.data.length > 0) {
      const rolesCSV = toCSV(rolesResult.data.map(r => ({
        role: r.role,
        club_name: r.clubs?.name || "",
        team_name: r.teams?.name || "",
        created_at: r.created_at,
      })));
      await zipWriter.add("roles.csv", new zip.TextReader(rolesCSV));
    }

    // Children
    if (childrenResult.data && childrenResult.data.length > 0) {
      const childrenCSV = toCSV(childrenResult.data.map(c => ({
        name: c.name,
        year_of_birth: c.year_of_birth || "",
        teams: c.child_team_assignments?.map((a: any) => a.teams?.name).filter(Boolean).join("; ") || "",
        created_at: c.created_at,
      })));
      await zipWriter.add("children.csv", new zip.TextReader(childrenCSV));
    }

    // RSVPs
    if (rsvpsResult.data && rsvpsResult.data.length > 0) {
      const rsvpsCSV = toCSV(rsvpsResult.data.map(r => ({
        event_title: r.events?.title || "",
        event_date: r.events?.event_date || "",
        event_type: r.events?.type || "",
        status: r.status,
        guest_count: r.guest_count || 0,
        notes: r.notes || "",
        created_at: r.created_at,
      })));
      await zipWriter.add("rsvps.csv", new zip.TextReader(rsvpsCSV));
    }

    // Notifications
    if (notificationsResult.data && notificationsResult.data.length > 0) {
      const notificationsCSV = toCSV(notificationsResult.data.map(n => ({
        type: n.type,
        message: n.message,
        read: n.read,
        created_at: n.created_at,
      })));
      await zipWriter.add("notifications.csv", new zip.TextReader(notificationsCSV));
    }

    // Preferences
    if (preferencesResult.data) {
      await zipWriter.add("preferences.json", new zip.TextReader(JSON.stringify(preferencesResult.data, null, 2)));
    }

    // Photos CSV - reference local files, not URLs
    if (photosResult.data && photosResult.data.length > 0) {
      const photosCSV = toCSV(photosResult.data.map((p: any, index: number) => {
        const url = p.image_url || p.file_url;
        const storagePath = url ? extractStoragePath(url, "photos") : null;
        const ext = storagePath ? getExtension(storagePath) : ".jpg";
        const localFile = p.title 
          ? `photos/${p.title.replace(/[^a-zA-Z0-9]/g, "_")}${ext}`
          : `photos/photo_${index + 1}${ext}`;
        return {
          title: p.title || "",
          file: localFile,
          club_name: p.clubs?.name || "",
          team_name: p.teams?.name || "",
          created_at: p.created_at,
        };
      }));
      await zipWriter.add("photos.csv", new zip.TextReader(photosCSV));
    }

    // Photo comments
    if (photoCommentsResult.data && photoCommentsResult.data.length > 0) {
      const commentsCSV = toCSV(photoCommentsResult.data.map((c: any) => ({
        photo_title: c.photos?.title || "",
        text: c.text,
        created_at: c.created_at,
      })));
      await zipWriter.add("comments.csv", new zip.TextReader(commentsCSV));
    }

    // Photo reactions
    if (photoReactionsResult.data && photoReactionsResult.data.length > 0) {
      const reactionsCSV = toCSV(photoReactionsResult.data.map((r: any) => ({
        photo_title: r.photos?.title || "",
        reaction_type: r.reaction_type,
        created_at: r.created_at,
      })));
      await zipWriter.add("reactions.csv", new zip.TextReader(reactionsCSV));
    }

    // Duties
    if (dutiesResult.data && dutiesResult.data.length > 0) {
      const dutiesCSV = toCSV(dutiesResult.data.map(d => ({
        name: d.name,
        event_title: d.events?.title || "",
        event_date: d.events?.event_date || "",
        status: d.status,
        completed_at: d.completed_at || "",
        created_at: d.created_at,
      })));
      await zipWriter.add("duties.csv", new zip.TextReader(dutiesCSV));
    }

    // Feedback
    if (feedbackResult.data && feedbackResult.data.length > 0) {
      const feedbackCSV = toCSV(feedbackResult.data.map(f => ({
        type: f.type,
        title: f.title,
        description: f.description || "",
        status: f.status,
        created_at: f.created_at,
      })));
      await zipWriter.add("feedback.csv", new zip.TextReader(feedbackCSV));
    }

    // Reward redemptions
    if (redemptionsResult.data && redemptionsResult.data.length > 0) {
      const redemptionsCSV = toCSV(redemptionsResult.data.map(r => ({
        reward_name: r.club_rewards?.name || "",
        points_spent: r.points_spent,
        club_name: r.clubs?.name || "",
        status: r.status,
        redeemed_at: r.redeemed_at,
        fulfilled_at: r.fulfilled_at || "",
      })));
      await zipWriter.add("rewards.csv", new zip.TextReader(redemptionsCSV));
    }

    // Download and add actual files
    console.log("Downloading user files...");

    // Download photos
    if (photosResult.data && photosResult.data.length > 0) {
      let photoIndex = 1;
      for (const photo of photosResult.data) {
        const url = photo.image_url || photo.file_url;
        if (!url) continue;
        
        const storagePath = extractStoragePath(url, "photos");
        if (storagePath) {
          const fileData = await downloadFile(supabase, "photos", storagePath);
          if (fileData) {
            const ext = getExtension(storagePath);
            const fileName = photo.title 
              ? `photos/${photo.title.replace(/[^a-zA-Z0-9]/g, "_")}${ext}`
              : `photos/photo_${photoIndex}${ext}`;
            await zipWriter.add(fileName, new zip.Uint8ArrayReader(new Uint8Array(fileData)));
            photoIndex++;
          }
        }
      }
    }

    // Download chat images
    const allChatMessages = [
      ...(teamMessagesResult.data || []),
      ...(clubMessagesResult.data || []),
      ...(groupMessagesResult.data || []),
    ];
    
    if (allChatMessages.length > 0) {
      let chatImageIndex = 1;
      for (const msg of allChatMessages) {
        if (!msg.image_url) continue;
        
        const storagePath = extractStoragePath(msg.image_url, "chat-attachments");
        if (storagePath) {
          const fileData = await downloadFile(supabase, "chat-attachments", storagePath);
          if (fileData) {
            const ext = getExtension(storagePath);
            const dateStr = new Date(msg.created_at).toISOString().split('T')[0];
            await zipWriter.add(`chat-images/${dateStr}_${chatImageIndex}${ext}`, new zip.Uint8ArrayReader(new Uint8Array(fileData)));
            chatImageIndex++;
          }
        }
      }
    }

    // Download avatar
    if (profileResult.data?.avatar_url) {
      const storagePath = extractStoragePath(profileResult.data.avatar_url, "avatars");
      if (storagePath) {
        const fileData = await downloadFile(supabase, "avatars", storagePath);
        if (fileData) {
          const ext = getExtension(storagePath);
          await zipWriter.add(`avatars/avatar${ext}`, new zip.Uint8ArrayReader(new Uint8Array(fileData)));
        }
      }
    }

    // Complete JSON for technical users - strip storage URLs
    const sanitizedProfile = profileResult.data ? {
      ...profileResult.data,
      avatar_url: profileResult.data.avatar_url ? "avatars/avatar" + getExtension(extractStoragePath(profileResult.data.avatar_url, "avatars") || ".jpg") : null,
    } : null;
    
    const sanitizedPhotos = (photosResult.data || []).map((p: any, index: number) => {
      const url = p.image_url || p.file_url;
      const storagePath = url ? extractStoragePath(url, "photos") : null;
      const ext = storagePath ? getExtension(storagePath) : ".jpg";
      const localFile = p.title 
        ? `photos/${p.title.replace(/[^a-zA-Z0-9]/g, "_")}${ext}`
        : `photos/photo_${index + 1}${ext}`;
      return {
        ...p,
        image_url: localFile,
        file_url: undefined,
      };
    });

    const completeData = {
      exportDate: new Date().toISOString(),
      userId: user.id,
      email: user.email,
      profile: sanitizedProfile,
      roles: rolesResult.data || [],
      children: childrenResult.data || [],
      rsvps: rsvpsResult.data || [],
      recentNotifications: notificationsResult.data || [],
      notificationPreferences: preferencesResult.data,
      uploadedPhotos: sanitizedPhotos,
      photoComments: photoCommentsResult.data || [],
      photoReactions: photoReactionsResult.data || [],
      assignedDuties: dutiesResult.data || [],
      feedback: feedbackResult.data || [],
      rewardRedemptions: redemptionsResult.data || [],
    };
    await zipWriter.add("complete_data.json", new zip.TextReader(JSON.stringify(completeData, null, 2)));

    await zipWriter.close();
    const zipBlob = await blobWriter.getData();
    const zipArrayBuffer = await zipBlob.arrayBuffer();

    console.log(`Export complete for user: ${user.id}`);

    return new Response(
      zipArrayBuffer,
      { 
        status: 200, 
        headers: { 
          ...corsHeaders, 
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="ignite-data-export-${exportDate}.zip"`,
        } 
      }
    );
  } catch (error) {
    console.error("Export error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to export data" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
