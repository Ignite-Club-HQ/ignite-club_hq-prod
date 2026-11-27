import prod from '../../../deploy/opencloud/prod.json' with { type: 'json' };

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
  const canisterId = prod.shared.frontend;
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