const SUPABASE_FUNCTION_URL =
  "https://yabcfiuntwqjwvschnji.supabase.co/functions/v1/share-page";

export default async (request: Request) => {
  const url = new URL(request.url);

  // Forward query params to the Supabase edge function
  const target = new URL(SUPABASE_FUNCTION_URL);
  target.search = url.search;

  try {
    const response = await fetch(target.toString(), {
      method: "GET",
      headers: {
        "User-Agent": request.headers.get("User-Agent") || "",
      },
    });

    const body = await response.text();

    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=300",
        "x-content-type-options": "nosniff",
        "access-control-allow-origin": "*",
        "content-security-policy":
          "default-src 'self' https:; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
      },
    });
  } catch (err) {
    // Fallback: redirect to app home
    return Response.redirect(`https://igniteclubhq.app/`, 302);
  }
};

export const config = {
  path: "/share",
};
