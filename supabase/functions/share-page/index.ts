import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const APP_URL = "https://igniteclubhq.app";
const DEFAULT_IMAGE = `${APP_URL}/ignite-logo.png`;
const CRAWLER_UA_REGEX = /(facebookexternalhit|facebot|twitterbot|linkedinbot|slackbot|discordbot|whatsapp|telegrambot|skypeuripreview|googlebot|bingbot|duckduckbot|yandexbot|applebot|pinterest|redditbot|vkshare)/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  const id = url.searchParams.get("id");

  if (!type || !id) {
    return new Response("Missing type or id", {
      status: 400,
      headers: { ...corsHeaders, "content-type": "text/plain; charset=utf-8" },
    });
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

        const resolvedImage = await resolvePreviewImageUrl(supabase, photo.file_url || photo.image_url);
        if (resolvedImage) image = resolvedImage;
      }

      redirectUrl = `${APP_URL}/media/${id}`;
    } else if (type === "event") {
      const { data: event } = await supabase
        .from("events")
        .select("title, event_date, type, preview_image_url, teams(name), clubs(name, logo_url)")
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
          } catch {
            // Ignore invalid date formatting issues
          }
        }

        description = parts.length > 0
          ? `You're invited! ${parts.join(" · ")}`
          : "You've been invited to an event on Ignite Club HQ";

        const eventImage = event.preview_image_url || (event as any).clubs?.logo_url;
        const resolvedImage = await resolvePreviewImageUrl(supabase, eventImage);
        if (resolvedImage) image = resolvedImage;
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

  const isLikelyUserNavigation = req.headers.get("sec-fetch-user") === "?1";
  if (!isCrawlerRequest(req) && isLikelyUserNavigation) {
    return new Response(null, {
      status: 302,
      headers: {
        ...corsHeaders,
        location: redirectUrl,
        "cache-control": "no-store",
      },
    });
  }

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
  <link rel="canonical" href="${escapeHtml(redirectUrl)}" />
</head>
<body>
  <p>Open <a href="${escapeHtml(redirectUrl)}">Ignite Club HQ</a>.</p>
</body>
</html>`;

  return new Response(html, {
    headers: {
      ...corsHeaders,
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
});

function isCrawlerRequest(req: Request): boolean {
  const userAgent = req.headers.get("user-agent") || "";
  const purpose = req.headers.get("purpose") || req.headers.get("sec-purpose") || "";

  return CRAWLER_UA_REGEX.test(userAgent) || /(prefetch|preview|crawler|spider|bot)/i.test(purpose);
}

async function resolvePreviewImageUrl(
  supabase: ReturnType<typeof createClient>,
  rawUrl: string | null | undefined,
): Promise<string | null> {
  if (!rawUrl) return null;

  const source = rawUrl.trim();
  if (!source) return null;

  if (/^https?:\/\//i.test(source) && !source.includes("/storage/v1/object/")) {
    return source;
  }

  if (/\/storage\/v1\/object\/public\//i.test(source) || /\/storage\/v1\/object\/sign\//i.test(source)) {
    return source;
  }

  let bucket = "";
  let filePath = "";

  const privateStorageMatch = source.match(/\/storage\/v1\/object\/(?:private|authenticated)\/([^/?#]+)\/(.+?)(?:\?.*)?$/i);
  if (privateStorageMatch) {
    bucket = privateStorageMatch[1];
    filePath = privateStorageMatch[2];
  } else {
    const normalizedSource = source.replace(/^\/+/, "");
    const rawPathMatch = normalizedSource.match(/^([^/]+)\/(.+)$/);
    if (rawPathMatch) {
      bucket = rawPathMatch[1];
      filePath = rawPathMatch[2];
    }
  }

  if (!bucket || !filePath) {
    return source;
  }

  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(filePath, 3600);
  if (error || !data?.signedUrl) {
    console.warn("Failed to create signed image URL", { source, bucket, filePath, error: error?.message });
    return source;
  }

  return data.signedUrl;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
