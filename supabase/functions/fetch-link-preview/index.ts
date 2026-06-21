// Native Deno.serve — no std-lib import needed (drops one cold-start fetch).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface LinkPreview {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
}

// SSRF protection: validate URLs before fetching
function validateUrl(urlString: string): URL {
  const parsed = new URL(urlString);
  
  // Only allow http and https protocols
  const allowedProtocols = ['http:', 'https:'];
  if (!allowedProtocols.includes(parsed.protocol)) {
    throw new Error('Invalid protocol - only HTTP and HTTPS are allowed');
  }
  
  // Block localhost and loopback addresses
  const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '::1'];
  if (blockedHosts.includes(parsed.hostname.toLowerCase())) {
    throw new Error('Blocked host - localhost addresses are not allowed');
  }
  
  // Block cloud metadata endpoints
  if (parsed.hostname === '169.254.169.254') {
    throw new Error('Blocked host - metadata endpoints are not allowed');
  }
  
  // Block private IP ranges (RFC 1918)
  const hostname = parsed.hostname;
  
  // 10.0.0.0/8
  if (/^10\./.test(hostname)) {
    throw new Error('Blocked host - private IP addresses are not allowed');
  }
  
  // 172.16.0.0/12
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(hostname)) {
    throw new Error('Blocked host - private IP addresses are not allowed');
  }
  
  // 192.168.0.0/16
  if (/^192\.168\./.test(hostname)) {
    throw new Error('Blocked host - private IP addresses are not allowed');
  }
  
  // Block link-local addresses (169.254.0.0/16)
  if (/^169\.254\./.test(hostname)) {
    throw new Error('Blocked host - link-local addresses are not allowed');
  }
  
  return parsed;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url } = await req.json();

    if (!url) {
      return new Response(JSON.stringify({ error: "URL is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate URL before fetching (SSRF protection)
    let validatedUrl: URL;
    try {
      validatedUrl = validateUrl(url);
    } catch (validationError) {
      const errorMessage = validationError instanceof Error ? validationError.message : 'Unknown validation error';
      console.error("URL validation failed:", errorMessage);
      return new Response(JSON.stringify({ error: "Invalid URL" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch the URL content
    const response = await fetch(validatedUrl.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; LinkPreviewBot/1.0)",
      },
    });

    if (!response.ok) {
      throw new Error("Failed to fetch URL");
    }

    const html = await response.text();

    // Extract metadata using regex (simple approach)
    const preview: LinkPreview = { url };

    // Get title
    const titleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i) ||
      html.match(/<meta\s+content="([^"]+)"\s+property="og:title"/i) ||
      html.match(/<title>([^<]+)<\/title>/i);
    if (titleMatch) preview.title = titleMatch[1].slice(0, 100);

    // Get description
    const descMatch = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i) ||
      html.match(/<meta\s+content="([^"]+)"\s+property="og:description"/i) ||
      html.match(/<meta\s+name="description"\s+content="([^"]+)"/i) ||
      html.match(/<meta\s+content="([^"]+)"\s+name="description"/i);
    if (descMatch) preview.description = descMatch[1].slice(0, 200);

    // Get image
    const imageMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i) ||
      html.match(/<meta\s+content="([^"]+)"\s+property="og:image"/i);
    if (imageMatch) {
      let imageUrl = imageMatch[1];
      // Handle relative URLs
      if (imageUrl.startsWith("/")) {
        imageUrl = `${validatedUrl.origin}${imageUrl}`;
      }
      preview.image = imageUrl;
    }

    // Get site name
    const siteMatch = html.match(/<meta\s+property="og:site_name"\s+content="([^"]+)"/i) ||
      html.match(/<meta\s+content="([^"]+)"\s+property="og:site_name"/i);
    if (siteMatch) preview.siteName = siteMatch[1];

    return new Response(JSON.stringify(preview), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error fetching link preview:", error);
    return new Response(JSON.stringify({ error: "Failed to fetch preview" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
