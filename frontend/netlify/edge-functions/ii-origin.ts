// Public routing pin; host-build-env verifies this against the canonical PROD manifest.
const PROD_FRONTEND_CANISTER_ID = 'f7fgd-eiaaa-aaac5-aaeaa-cai';

/** Netlify does not forward the gateway's discovery/CORS headers on the site proxy.
 * II resolves a custom derivation origin with HEAD /, then reads its certified
 * canister manifest. This exposes public routing metadata, never a delegation. */
export default async function iiOrigin(request: Request, context: {
  next(): Promise<Response>;
  deploy?: { context: string };
}): Promise<Response> {
  const url = new URL(request.url);
  const response = await context.next();
  // Build variables such as BRANCH are not available to Edge Functions. Use
  // Netlify's trusted runtime deploy context; host-build-env already pins prod.
  if (context.deploy?.context !== 'production' || url.origin !== 'https://igniteclubhq.app' || url.pathname !== '/' ||
      !['GET', 'HEAD'].includes(request.method) || response.status !== 200) return response;
  const canisterId = PROD_FRONTEND_CANISTER_ID;
  const upstream = response.headers.get('x-ic-canister-id');
  if (upstream && upstream !== canisterId) {
    return new Response('Sign-in configuration unavailable', { status: 503 });
  }
  const headers = new Headers(response.headers);
  headers.set('X-IC-Canister-ID', canisterId);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.append('Access-Control-Expose-Headers', 'X-IC-Canister-ID');
  return new Response(request.method === 'HEAD' ? null : response.body, {
    status: response.status, statusText: response.statusText, headers,
  });
}