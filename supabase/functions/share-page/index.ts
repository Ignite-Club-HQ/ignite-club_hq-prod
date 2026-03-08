import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const APP_URL = "https://igniteclubhq.app";
const DEFAULT_IMAGE = `${APP_URL}/ignite-logo.png`;
const CRAWLER_UA_REGEX = /(facebookexternalhit|facebot|twitterbot|linkedinbot|slackbot|discordbot|whatsapp|telegrambot|skypeuripreview|googlebot|bingbot|duckduckbot|yandexbot|applebot|pinterest|redditbot|vkshare|embedly|quora|outbrain|W3C_Validator)/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  const url = new URL(req.url);
  const type = url.searchParams.get("type");
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
        .select("title, image_url, file_url, team_id, club_id, teams(name), clubs(name, logo_url)")
        .eq("id", id)
        .maybeSingle();

      if (photo) {
        const teamName = (photo as any).teams?.name;
        const clubName = (photo as any).clubs?.name;
        title = photo.title || "Photo shared on Ignite Club HQ";
        description = [clubName, teamName].filter(Boolean).join(" · ") || "Check out this photo on Ignite Club HQ";

        // Try to resolve the actual photo image; fall back to club logo
        const photoImageUrl = photo.file_url || photo.image_url;
        const resolvedImage = await resolvePreviewImageUrl(supabase, photoImageUrl);
        if (resolvedImage) {
          image = resolvedImage;
        } else {
          // Fall back to club logo
          const clubLogo = (photo as any).clubs?.logo_url;
          if (clubLogo) {
            const resolvedLogo = await resolvePreviewImageUrl(supabase, clubLogo);
            if (resolvedLogo) image = resolvedLogo;
          }
        }
      }

      redirectUrl = `${APP_URL}/media/${id}`;

    } else if (type === "event") {
      const { data: event, error: eventError } = await supabase
        .from("events")
        .select("title, event_date, type, preview_image_url, club_id, team_id, teams(name), clubs!events_club_id_fkey(name, logo_url)")
        .eq("id", id)
        .maybeSingle();

      console.log("Event lookup:", { id, event, eventError: eventError?.message });

      if (event) {
        title = event.title || "Event on Ignite Club HQ";
        const parts: string[] = [];
        if ((event as any).clubs?.name) parts.push((event as any).clubs.name);
        if ((event as any).teams?.name) parts.push((event as any).teams.name);
        if (event.event_date) {
          try {
            const d = new Date(event.event_date);
            parts.push(d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" }));
          } catch {
            // ignore
          }
        }
        description = parts.length > 0
          ? `You're invited! ${parts.join(" · ")}`
          : "You've been invited to an event on Ignite Club HQ";

        // Try preview image first, then club logo, then keep default
        const candidates = [event.preview_image_url, (event as any).clubs?.logo_url].filter(Boolean);
        console.log("Event image candidates:", candidates);
        for (const candidate of candidates) {
          const resolved = await resolvePreviewImageUrl(supabase, candidate);
          console.log("Resolved candidate:", { candidate, resolved });
          if (resolved && resolved.startsWith("http")) {
            image = resolved;
            break;
          }
        }
        console.log("Final image for event:", image);
      }

      redirectUrl = `${APP_URL}/events/${id}`;

    } else if (type === "folder") {
      const { data: folder } = await supabase
        .from("vault_folders")
        .select("name, club_id, clubs(name, logo_url)")
        .eq("id", id)
        .maybeSingle();

      if (folder) {
        const clubName = (folder as any).clubs?.name;
        title = `${folder.name} — ${clubName || "Ignite Club HQ"}`;
        description = clubName
          ? `A folder from ${clubName} has been shared with you`
          : "A folder has been shared with you on Ignite Club HQ";

        const clubLogo = (folder as any).clubs?.logo_url;
        if (clubLogo) {
          const resolvedImage = await resolvePreviewImageUrl(supabase, clubLogo);
          if (resolvedImage) image = resolvedImage;
        }
      }

      redirectUrl = `${APP_URL}/vault/folder/${id}`;
    }
  } catch (err) {
    console.error("Error fetching share data:", err);
  }

  // Always return HTML with OG tags + meta-refresh redirect.
  // Crawlers parse the OG tags; humans get redirected instantly.
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}"/>
<meta property="og:title" content="${esc(title)}"/>
<meta property="og:description" content="${esc(description)}"/>
<meta property="og:image" content="${esc(image)}"/>
<meta property="og:image:width" content="1200"/>
<meta property="og:image:height" content="630"/>
<meta property="og:url" content="${esc(redirectUrl)}"/>
<meta property="og:type" content="website"/>
<meta property="og:site_name" content="Ignite Club HQ"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${esc(title)}"/>
<meta name="twitter:description" content="${esc(description)}"/>
<meta name="twitter:image" content="${esc(image)}"/>
<link rel="canonical" href="${esc(redirectUrl)}"/>
<meta http-equiv="refresh" content="0;url=${esc(redirectUrl)}"/>
</head>
<body>
<p>Redirecting to <a href="${esc(redirectUrl)}">Ignite Club HQ</a>…</p>
<script>window.location.replace(${JSON.stringify(redirectUrl)});</script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Override Supabase's restrictive CSP so meta-refresh and JS redirect work
      "content-security-policy": "default-src 'self' https:; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolvePreviewImageUrl(
  supabase: ReturnType<typeof createClient>,
  rawUrl: string | null | undefined,
): Promise<string | null> {
  if (!rawUrl) return null;

  const source = rawUrl.trim();
  if (!source) return null;

  // Fully-qualified non-storage URL → use directly
  if (/^https?:\/\//i.test(source) && !source.includes("/storage/v1/object/")) {
    return source;
  }

  // Public storage URLs are directly accessible
  if (/\/storage\/v1\/object\/public\//i.test(source)) {
    // Ensure it's a full URL
    if (source.startsWith("http")) return source;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    return `${supabaseUrl}${source.startsWith("/") ? "" : "/"}${source}`;
  }

  // Extract bucket + path from various URL formats
  let bucket = "";
  let filePath = "";

  const signedMatch = source.match(/\/storage\/v1\/object\/sign\/([^/?#]+)\/(.+?)(?:\?.*)?$/i);
  const privateMatch = source.match(/\/storage\/v1\/object\/(?:private|authenticated)\/([^/?#]+)\/(.+?)(?:\?.*)?$/i);
  const publicMatch = source.match(/\/storage\/v1\/object\/public\/([^/?#]+)\/(.+?)(?:\?.*)?$/i);

  if (signedMatch) {
    bucket = signedMatch[1];
    filePath = signedMatch[2];
  } else if (privateMatch) {
    bucket = privateMatch[1];
    filePath = privateMatch[2];
  } else if (publicMatch) {
    bucket = publicMatch[1];
    filePath = publicMatch[2];
  } else if (!source.startsWith("http")) {
    // Raw path like "bucket/path/to/file.jpg"
    const normalised = source.replace(/^\/+/, "");
    const rawMatch = normalised.match(/^([^/]+)\/(.+)$/);
    if (rawMatch) {
      bucket = rawMatch[1];
      filePath = rawMatch[2];
    }
  }

  if (!bucket || !filePath) {
    // Can't parse — return as-is if it's a URL, otherwise null
    return source.startsWith("http") ? source : null;
  }

  try {
    filePath = decodeURIComponent(filePath).replace(/^\/+/, "");
  } catch {
    filePath = filePath.replace(/^\/+/, "");
  }

  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(filePath, 3600);
  if (error || !data?.signedUrl) {
    console.warn("Failed to sign image:", { bucket, filePath, error: error?.message });
    return source.startsWith("http") ? source : null;
  }

  return data.signedUrl;
}

function esc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
