import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID');
    const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET');
    
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      console.error("Missing Google OAuth credentials");
      return new Response(
        JSON.stringify({ error: "Google OAuth not configured" }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const url = new URL(req.url);
    const action = url.searchParams.get('action');

    // Get the authorization token to verify user
    const authHeader = req.headers.get('Authorization');
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabase = createClient(supabaseUrl, authHeader ? supabaseAnonKey : supabaseServiceKey, {
      global: {
        headers: authHeader ? { Authorization: authHeader } : {},
      },
    });

    // Verify user is authenticated for protected actions
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (!user && action !== 'oauth-callback') {
      console.error("User not authenticated");
      return new Response(
        JSON.stringify({ error: "Not authenticated" }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify user is a club admin (only club admins can import from Google Drive)
    if (user) {
      const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
      const { data: userRoles } = await serviceClient
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .in('role', ['club_admin', 'app_admin']);
      
      if (!userRoles || userRoles.length === 0) {
        console.error("User is not a club admin:", user.id);
        return new Response(
          JSON.stringify({ error: "Only club admins can import from Google Drive" }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Action: Get OAuth URL for popup
    if (action === 'get-auth-url') {
      const body = await req.json();
      const { redirectUri } = body;
      
      const scopes = [
        'https://www.googleapis.com/auth/drive.readonly',
      ].join(' ');
      
      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', scopes);
      authUrl.searchParams.set('access_type', 'offline');
      // Always show account selector to allow switching accounts
      authUrl.searchParams.set('prompt', 'select_account');
      // Pass user ID in state for verification
      authUrl.searchParams.set('state', user!.id);
      
      console.log("Generated OAuth URL for user:", user!.id);
      
      return new Response(
        JSON.stringify({ authUrl: authUrl.toString() }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Action: Exchange code for tokens
    if (action === 'exchange-code') {
      const body = await req.json();
      const { code, redirectUri } = body;
      
      console.log("Exchanging code for tokens");
      
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          code,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });
      
      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error("Token exchange failed:", errorText);
        return new Response(
          JSON.stringify({ error: "Failed to exchange code for tokens", details: errorText }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      const tokens = await tokenResponse.json();
      console.log("Successfully exchanged code for tokens");
      
      return new Response(
        JSON.stringify({ accessToken: tokens.access_token }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Action: List Drive files/folders
    if (action === 'list-files') {
      const body = await req.json();
      const { accessToken, folderId } = body;
      
      const parentId = folderId || 'root';
      const query = `'${parentId}' in parents and trashed = false`;
      
      const driveUrl = new URL('https://www.googleapis.com/drive/v3/files');
      driveUrl.searchParams.set('q', query);
      driveUrl.searchParams.set('fields', 'files(id,name,mimeType,size,createdTime,modifiedTime,parents)');
      driveUrl.searchParams.set('pageSize', '100');
      driveUrl.searchParams.set('orderBy', 'folder,name');
      
      const driveResponse = await fetch(driveUrl.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      
      if (!driveResponse.ok) {
        const errorText = await driveResponse.text();
        console.error("Failed to list Drive files:", errorText);
        return new Response(
          JSON.stringify({ error: "Failed to list Drive files", details: errorText }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      const data = await driveResponse.json();
      
      // Separate folders and files
      const folders = data.files.filter((f: any) => f.mimeType === 'application/vnd.google-apps.folder');
      const files = data.files.filter((f: any) => f.mimeType !== 'application/vnd.google-apps.folder');
      
      return new Response(
        JSON.stringify({ folders, files }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Action: Download a file from Drive
    if (action === 'download-file') {
      const body = await req.json();
      const { accessToken, fileId, mimeType, fileName } = body;
      
      let downloadUrl: string;
      let exportMimeType: string | null = null;
      
      // Handle Google Docs/Sheets/Slides - need to export
      if (mimeType === 'application/vnd.google-apps.document') {
        exportMimeType = 'application/pdf';
        downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(exportMimeType)}`;
      } else if (mimeType === 'application/vnd.google-apps.spreadsheet') {
        exportMimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(exportMimeType)}`;
      } else if (mimeType === 'application/vnd.google-apps.presentation') {
        exportMimeType = 'application/pdf';
        downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(exportMimeType)}`;
      } else {
        // Regular file - direct download
        downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
      }
      
      const fileResponse = await fetch(downloadUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      
      if (!fileResponse.ok) {
        const errorText = await fileResponse.text();
        console.error("Failed to download file:", errorText);
        return new Response(
          JSON.stringify({ error: "Failed to download file", details: errorText }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      const fileData = await fileResponse.arrayBuffer();
      
      // Return base64 encoded file data
      const base64Data = btoa(String.fromCharCode(...new Uint8Array(fileData)));
      
      return new Response(
        JSON.stringify({ 
          data: base64Data, 
          exportedMimeType: exportMimeType,
          size: fileData.byteLength,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Action: Get folder path (for recreating structure)
    if (action === 'get-folder-path') {
      const body = await req.json();
      const { accessToken, folderId } = body;
      
      const path: { id: string; name: string }[] = [];
      let currentId = folderId;
      
      while (currentId && currentId !== 'root') {
        const response = await fetch(
          `https://www.googleapis.com/drive/v3/files/${currentId}?fields=id,name,parents`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        
        if (!response.ok) break;
        
        const file = await response.json();
        path.unshift({ id: file.id, name: file.name });
        currentId = file.parents?.[0];
      }
      
      return new Response(
        JSON.stringify({ path }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Unknown action" }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error("Error in google-drive-import:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
