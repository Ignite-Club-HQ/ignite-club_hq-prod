import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const APP_URL = "https://igniteclubhq.app";
const DEFAULT_IMAGE = `${APP_URL}/ignite-logo.png`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const type = url.searchParams.get("type"); // photo, event, folder
  const id = url.searchParams.get("id");

  if (!type || !id) {
    return new Response("Missing type or id", { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let title = "Ignite Club HQ";
  let description = "Manage your sports club with ease — events, teams, chat, and more.";
  let image = DEFAULT_IMAGE;
  let redirectUrl = APP_URL;

  try {
    if (type === "photo") {
      const { data: photo } = await supabase
        .from("photos")
        .select("title, image_url, file_url, team_id, club_id, teams(name), clubs(name)")
        .eq("id", id)
        .maybeSingle();

      if (photo) {
        const teamName = (photo as any).teams?.name;
        const clubName = (photo as any).clubs?.name;
        title = photo.title || "Photo shared on Ignite Club HQ";
        description = [clubName, teamName].filter(Boolean).join(" · ") || "Check out this photo on Ignite Club HQ";
        const photoUrl = photo.file_url || photo.image_url;
        if (photoUrl) {
          // Try to generate a signed URL for the photo
          const path = photoUrl.replace(/^.*\/storage\/v1\/object\/(?:public|sign)\//, "").split("?")[0];
          if (path) {
            const bucket = path.startsWith("photos/") ? "photos" : "team-photos";
            const filePath = path.replace(/^(photos|team-photos)\//, "");
            const { data: signedData } = await supabase.storage
              .from(bucket)
              .createSignedUrl(filePath, 3600);
            if (signedData?.signedUrl) {
              image = signedData.signedUrl;
            }
          }
        }
      }
      redirectUrl = `${APP_URL}/media/${id}`;

    } else if (type === "event") {
      const { data: event } = await supabase
        .from("events")
        .select("title, event_date, type, teams(name), clubs(name)")
        .eq("id", id)
        .maybeSingle();

      if (event) {
        title = event.title || "Event on Ignite Club HQ";
        const parts: string[] = [];
        if ((event as any).clubs?.name) parts.push((event as any).clubs.name);
        if ((event as any).teams?.name) parts.push((event as any).teams.name);
        if (event.event_date) {
          try {
            const d = new Date(event.event_date);
            parts.push(d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" }));
          } catch {}
        }
        description = parts.length > 0
          ? `You're invited! ${parts.join(" · ")}`
          : "You've been invited to an event on Ignite Club HQ";
      }
      redirectUrl = `${APP_URL}/events/${id}`;

    } else if (type === "folder") {
      const { data: folder } = await supabase
        .from("vault_folders")
        .select("name")
        .eq("id", id)
        .maybeSingle();

      if (folder) {
        title = `${folder.name} — Ignite Club HQ`;
        description = "A folder has been shared with you on Ignite Club HQ";
      }
      redirectUrl = `${APP_URL}/vault/folder/${id}`;
    }
  } catch (err) {
    console.error("Error fetching share data:", err);
  }

  // Serve HTML with OG tags + instant redirect
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:image" content="${escapeHtml(image)}" />
  <meta property="og:url" content="${escapeHtml(redirectUrl)}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Ignite Club HQ" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${escapeHtml(image)}" />
  <meta http-equiv="refresh" content="0;url=${escapeHtml(redirectUrl)}" />
</head>
<body>
  <p>Redirecting to <a href="${escapeHtml(redirectUrl)}">Ignite Club HQ</a>...</p>
</body>
</html>`;

  return new Response(html, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
});

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
