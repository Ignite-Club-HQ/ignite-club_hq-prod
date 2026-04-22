import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID')!;
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

/**
 * Resolves real Google Drive titles for vault_files whose names are still the
 * placeholder labels (e.g. "Google Sheet (1aB2cD)").
 *
 * Strategy per file:
 *   1. Extract the Drive file ID from `file_url`.
 *   2. Try every refresh_token on `vault_drive_links` for the same club (each
 *      represents a Google account a club admin previously linked). The first
 *      one that returns a 200 wins.
 *   3. Fall back to anonymous fetch (works only for publicly shared files).
 *   4. If nothing works, leave the row untouched.
 *
 * Body: { clubId: string, fileIds?: string[] }   // fileIds optional — when
 *       omitted, scans all placeholder-named Google rows in the club.
 */

interface ResolveResult {
  fileId: string;
  status: 'updated' | 'skipped' | 'unresolved' | 'error';
  newName?: string;
  error?: string;
}

const PLACEHOLDER_NAME_RE =
  /^(Google (Sheet|Doc|Slides|Form|Drive file)( \([a-zA-Z0-9_-]{1,12}\))?|edit|view|preview|comment|copy|template)$/i;

function extractDriveFileId(url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname.toLowerCase().includes('google.com')) return null;
    const m = u.pathname.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (m) return m[1];
    // Forms uses /forms/d/e/<id> too — already covered. Drive open URLs:
    const idParam = u.searchParams.get('id');
    if (idParam) return idParam;
    return null;
  } catch {
    return null;
  }
}

async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.access_token ?? null;
  } catch {
    return null;
  }
}

async function fetchDriveTitle(fileId: string, accessToken: string | null): Promise<string | null> {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=name`;
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.name === 'string' && data.name.trim().length > 0 ? data.name.trim() : null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));
    const clubId: string | undefined = body.clubId;
    const fileIds: string[] | undefined = Array.isArray(body.fileIds) ? body.fileIds : undefined;

    if (!clubId) {
      return new Response(JSON.stringify({ error: 'clubId required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Confirm caller is club admin / app admin for this club.
    const { data: roles } = await service
      .from('user_roles')
      .select('role, club_id')
      .eq('user_id', user.id);
    const isAuthorized = (roles || []).some(
      (r: any) => r.role === 'app_admin' || (r.role === 'club_admin' && r.club_id === clubId)
    );
    if (!isAuthorized) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Pull candidate vault files.
    let query = service
      .from('vault_files')
      .select('id, name, file_url')
      .eq('club_id', clubId)
      .like('file_url', '%google.com%');
    if (fileIds && fileIds.length > 0) query = query.in('id', fileIds);

    const { data: files, error: filesErr } = await query.limit(500);
    if (filesErr) throw filesErr;

    const candidates = (files || []).filter((f: any) => PLACEHOLDER_NAME_RE.test(f.name || ''));

    // Pull club's stored Drive refresh tokens for OAuth fallback.
    const { data: links } = await service
      .from('vault_drive_links')
      .select('refresh_token')
      .eq('club_id', clubId);
    const refreshTokens = Array.from(
      new Set((links || []).map((l: any) => l.refresh_token).filter(Boolean))
    );

    // Refresh each token once, cache the resulting access tokens.
    const accessTokens: string[] = [];
    for (const rt of refreshTokens) {
      const at = await refreshAccessToken(rt);
      if (at) accessTokens.push(at);
    }

    const results: ResolveResult[] = [];

    for (const file of candidates) {
      const driveId = extractDriveFileId(file.file_url);
      if (!driveId) {
        results.push({ fileId: file.id, status: 'skipped' });
        continue;
      }

      let title: string | null = null;
      // Try each linked Google account.
      for (const at of accessTokens) {
        title = await fetchDriveTitle(driveId, at);
        if (title) break;
      }
      // Fallback: public/anonymous (works for "anyone with the link" public files).
      if (!title) title = await fetchDriveTitle(driveId, null);

      if (!title) {
        results.push({ fileId: file.id, status: 'unresolved' });
        continue;
      }

      const { error: updErr } = await service
        .from('vault_files')
        .update({ name: title })
        .eq('id', file.id);
      if (updErr) {
        results.push({ fileId: file.id, status: 'error', error: updErr.message });
      } else {
        results.push({ fileId: file.id, status: 'updated', newName: title });
      }
    }

    const summary = {
      scanned: candidates.length,
      updated: results.filter((r) => r.status === 'updated').length,
      unresolved: results.filter((r) => r.status === 'unresolved').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      errors: results.filter((r) => r.status === 'error').length,
      hasOAuth: accessTokens.length > 0,
    };

    return new Response(JSON.stringify({ summary, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('resolve-drive-titles error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
