import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Supported private buckets
const PRIVATE_BUCKETS = ["photos", "chat-attachments", "avatars"];

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create Supabase client with service role key
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify the user is authenticated
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { paths, expiresIn = 3600 } = await req.json();

    if (!paths || !Array.isArray(paths) || paths.length === 0) {
      return new Response(JSON.stringify({ error: "paths array is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Limit to 50 URLs per request to prevent abuse
    if (paths.length > 50) {
      return new Response(JSON.stringify({ error: "Maximum 50 paths per request" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Generate signed URLs for each path
    const signedUrls: Record<string, string> = {};
    
    for (const path of paths) {
      // Detect which bucket this URL belongs to
      let bucketId: string | null = null;
      let storagePath = path;

      for (const bucket of PRIVATE_BUCKETS) {
        if (path.includes(`/storage/v1/object/public/${bucket}/`)) {
          bucketId = bucket;
          storagePath = path.split(`/storage/v1/object/public/${bucket}/`)[1];
          break;
        } else if (path.includes(`/storage/v1/object/sign/${bucket}/`)) {
          bucketId = bucket;
          storagePath = path.split(`/storage/v1/object/sign/${bucket}/`)[1].split("?")[0];
          break;
        }
      }

      // Skip if not a recognized private bucket URL
      if (!bucketId) {
        signedUrls[path] = path; // Return original URL
        continue;
      }

      const { data, error } = await supabase.storage
        .from(bucketId)
        .createSignedUrl(storagePath, expiresIn);

      if (error) {
        console.error(`Error creating signed URL for ${bucketId}/${storagePath}:`, error);
        // Skip this URL but continue with others
        continue;
      }

      signedUrls[path] = data.signedUrl;
    }

    return new Response(JSON.stringify({ signedUrls }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in get-signed-photo-url:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
