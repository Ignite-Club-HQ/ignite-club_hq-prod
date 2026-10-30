import { env } from 'node:process';

export default async (request: Request) => {
  const branch = env.BRANCH;
  const target = branch === 'prod' ? 'https://yabcfiuntwqjwvschnji.supabase.co' : 'https://ecsdwrarzfexssxtrymj.supabase.co';
  if (env.CONTEXT === 'production' && branch !== 'prod') return new Response('Release configuration unavailable', { status: 503 });
  const url = new URL('/functions/v1/share-page', target);
  url.search = new URL(request.url).search;
  try {
    const response = await fetch(url, { headers: { 'User-Agent': request.headers.get('User-Agent') || '' } });
    if (!response.ok) return Response.redirect(new URL('/', request.url), 302);
    return new Response(await response.text(), { status: response.status, headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=300',
      'x-content-type-options': 'nosniff',
    } });
  } catch { return Response.redirect(new URL('/', request.url), 302); }
};