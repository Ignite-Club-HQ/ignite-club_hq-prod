import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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
    original: GiphyImage;
    downsized_medium?: GiphyImage;
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
    const rawKey = Deno.env.get("GIPHY_API_KEY") ?? "";
    const apiKey = rawKey.trim();
    console.log("[giphy-search] key diagnostics:", {
      present: rawKey.length > 0,
      rawLength: rawKey.length,
      trimmedLength: apiKey.length,
      hasWhitespace: rawKey.length !== apiKey.length,
    });
    if (!apiKey) {
      console.error("[giphy-search] GIPHY_API_KEY not configured (empty after trim)");
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
    const gifs = (data.data || []).map((g) => ({
      id: g.id,
      title: g.title,
      preview: g.images.fixed_width.url,
      previewWidth: Number(g.images.fixed_width.width),
      previewHeight: Number(g.images.fixed_width.height),
      url: g.images.downsized_medium?.url || g.images.original.url,
      width: Number((g.images.downsized_medium ?? g.images.original).width),
      height: Number((g.images.downsized_medium ?? g.images.original).height),
    }));

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
