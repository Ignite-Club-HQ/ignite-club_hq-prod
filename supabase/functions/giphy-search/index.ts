import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface GiphyImage {
  url: string;
  width: string;
  height: string;
}

interface GiphyGif {
  id: string;
  title: string;
  images: {
    fixed_width: GiphyImage;
    fixed_width_small: GiphyImage;
    fixed_height?: GiphyImage;
    original: GiphyImage;
    downsized?: GiphyImage;
    downsized_medium?: GiphyImage;
    downsized_large?: GiphyImage;
  };
}

interface GiphyResponse {
  data: GiphyGif[];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Require authenticated user (protects GIPHY quota from anonymous abuse).
    const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    );
    const { data: claims, error: claimsError } = await supabase.auth.getClaims(
      authHeader.replace("Bearer ", ""),
    );
    if (claimsError || !claims?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = (Deno.env.get("GIPHY_API_KEY") ?? "").trim();
    if (!apiKey) {
      console.error("[giphy-search] GIPHY_API_KEY not configured");
      return new Response(JSON.stringify({ error: "GIF service not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { query = "", limit = 24, offset = 0 } = await req.json().catch(() => ({}));
    const safeLimit = Math.min(Math.max(Number(limit) || 24, 1), 50);
    const safeOffset = Math.max(Number(offset) || 0, 0);

    const endpoint = query.trim()
      ? `https://api.giphy.com/v1/gifs/search?api_key=${apiKey}&q=${encodeURIComponent(query.trim())}&limit=${safeLimit}&offset=${safeOffset}&rating=pg-13&lang=en&bundle=messaging_non_clips`
      : `https://api.giphy.com/v1/gifs/trending?api_key=${apiKey}&limit=${safeLimit}&offset=${safeOffset}&rating=pg-13&bundle=messaging_non_clips`;

    const response = await fetch(endpoint);
    if (!response.ok) {
      const text = await response.text();
      console.error("[giphy-search] Giphy API error:", response.status, text);
      return new Response(JSON.stringify({ error: "Giphy request failed" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = (await response.json()) as GiphyResponse;
    const gifs = (data.data || []).map((g) => {
      // Prefer the smallest still-animated rendition for fast in-chat playback.
      // Giphy size guidance: fixed_width ~200px wide animated GIF (typically <1MB),
      // downsized is capped at 2MB. Avoid `original` (often 5-15MB) and
      // `downsized_medium` (capped at 8MB) which take ages to load on mobile.
      const sendable =
        g.images.fixed_width ??
        g.images.downsized ??
        g.images.downsized_medium ??
        g.images.original;
      return {
        id: g.id,
        title: g.title,
        preview: g.images.fixed_width.url,
        previewWidth: Number(g.images.fixed_width.width),
        previewHeight: Number(g.images.fixed_width.height),
        url: sendable.url,
        width: Number(sendable.width),
        height: Number(sendable.height),
      };
    });

    return new Response(JSON.stringify({ gifs }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[giphy-search] error:", error);
    return new Response(JSON.stringify({ error: "Failed to load GIFs" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
