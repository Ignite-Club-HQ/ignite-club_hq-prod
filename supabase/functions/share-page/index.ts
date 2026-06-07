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
        const photoTitle = photo.title || "Photo shared";
        const context = [clubName, teamName].filter(Boolean).join(" · ");
        title = context ? `${photoTitle} — ${context}` : `${photoTitle} on Ignite Club HQ`;
        description = context || "Check out this photo on Ignite Club HQ";

        // Try to resolve the actual photo image with a timeout
        // Crawlers have limited patience, so fall back quickly
        const photoImageUrl = photo.file_url || photo.image_url;
        const resolvedImage = await resolveWithTimeout(supabase, photoImageUrl, 4000);
        if (resolvedImage) {
          image = resolvedImage;
        } else {
          // Fall back to club logo (skip SVGs — not supported by social platforms)
          const clubLogo = (photo as any).clubs?.logo_url;
          if (clubLogo && !/\.svg(\?|$)/i.test(clubLogo)) {
            const resolvedLogo = await resolveWithTimeout(supabase, clubLogo, 3000);
            if (resolvedLogo) image = resolvedLogo;
          }
        }
        console.log("Photo share resolved image:", { photoImageUrl, resolvedImage: image });
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
        const eventTitle = event.title || "Event";
        const clubName = (event as any).clubs?.name;
        const teamName = (event as any).teams?.name;
        let dateStr = "";
        if (event.event_date) {
          try {
            const d = new Date(event.event_date);
            dateStr = d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
          } catch {
            // ignore
          }
        }

        // Build a rich title since Messenger often hides og:description
        const contextParts = [clubName, teamName, dateStr].filter(Boolean);
        title = contextParts.length > 0
          ? `${eventTitle} — ${contextParts.join(" · ")}`
          : `${eventTitle} on Ignite Club HQ`;
        description = contextParts.length > 0
          ? `You're invited! ${contextParts.join(" · ")}`
          : "You've been invited to an event on Ignite Club HQ";

        // Use the default Ignite logo for all event share previews
        image = DEFAULT_IMAGE;
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
    } else if (type === "competition") {
      // `id` here is the competition join token (UUID)
      const { data: rows } = await supabase
        .rpc("get_competition_by_join_token", { p_token: id });
      const comp = Array.isArray(rows) ? (rows as any[])[0] : null;
      if (comp) {
        const organiser = comp.organizer_club_name;
        const bits = [comp.sport, comp.season].filter(Boolean).join(" · ");
        title = organiser
          ? `${comp.name} — ${organiser}`
          : `${comp.name} on Ignite Club HQ`;
        description = bits
          ? `Join ${comp.name} on Ignite Club HQ · ${bits}`
          : `You're invited to join ${comp.name} on Ignite Club HQ`;
      } else {
        title = "Join a competition on Ignite Club HQ";
        description = "Open the link to enter your team in this competition.";
      }
      redirectUrl = `${APP_URL}/competitions/join?token=${id}`;
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

/** Resolve image URL with a timeout to avoid blocking crawlers */
async function resolveWithTimeout(
  supabase: ReturnType<typeof createClient>,
  rawUrl: string | null | undefined,
  timeoutMs: number,
): Promise<string | null> {
  if (!rawUrl) return null;
  try {
    const result = await Promise.race([
      resolvePreviewImageUrl(supabase, rawUrl),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    return result;
  } catch (err) {
    console.warn("resolveWithTimeout failed:", err);
    return null;
  }
}

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

function isSvgLikeImage(rawUrl: string): boolean {
  const source = rawUrl.trim().toLowerCase();
  if (!source) return false;

  if (/\.svg(\?|$)/i.test(source) || /\/svg(\?|$)/i.test(source) || source.includes("/svg?")) {
    return true;
  }

  try {
    const parsed = new URL(source);
    const path = parsed.pathname.toLowerCase();
    const format = parsed.searchParams.get("format")?.toLowerCase();
    return path.endsWith(".svg") || path.endsWith("/svg") || format === "svg";
  } catch {
    return false;
  }
}

function getSocialPreviewImageCandidate(rawUrl: string): string | null {
  const source = rawUrl.trim();
  if (!source) return null;

  if (!isSvgLikeImage(source)) {
    return source;
  }

  try {
    const parsed = new URL(source);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();

    // Convert Dicebear SVG endpoints to PNG so OG crawlers can render them
    if (host.includes("dicebear.com") && path.endsWith("/svg")) {
      parsed.pathname = parsed.pathname.replace(/\/svg$/i, "/png");
      if (!parsed.searchParams.has("size")) {
        parsed.searchParams.set("size", "1200");
      }
      return parsed.toString();
    }
  } catch {
    // Fall through for non-URL strings
  }

  return null;
}

function esc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
