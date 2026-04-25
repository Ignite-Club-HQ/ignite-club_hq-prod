import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const GOOGLE_EXPORT_TYPES: Record<string, string> = {
  'application/vnd.google-apps.document': 'application/pdf',
  'application/vnd.google-apps.spreadsheet': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.google-apps.presentation': 'application/pdf',
  'application/vnd.google-apps.drawing': 'application/pdf',
};

const getDownloadConfig = (fileId: string, mimeType: string, fileName?: string) => {
  const exportMimeType = GOOGLE_EXPORT_TYPES[mimeType] ?? null;
  if (exportMimeType) {
    return {
      downloadUrl: `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(exportMimeType)}`,
      exportMimeType,
    };
  }

  if (
    typeof mimeType === 'string' &&
    mimeType.startsWith('application/vnd.google-apps.') &&
    !mimeType.startsWith('application/vnd.google-apps.drive-sdk')
  ) {
    const friendly = mimeType.replace('application/vnd.google-apps.', '');
    return {
      error: `Google ${friendly} files can't be imported. Please convert it to a Doc, Sheet, Slide, PDF, or other downloadable file first.`,
      code: 'unsupported_google_apps_type',
      mimeType,
      fileName,
    };
  }

  return {
    downloadUrl: `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
    exportMimeType: null,
  };
};

const applyExportExtension = (fileName: string, exportedMimeType: string | null) => {
  if (exportedMimeType === 'application/pdf' && !fileName.toLowerCase().endsWith('.pdf')) return `${fileName}.pdf`;
  if (exportedMimeType?.includes('spreadsheet') && !fileName.toLowerCase().endsWith('.xlsx')) return `${fileName}.xlsx`;
  return fileName;
};

const getSafeExtension = (fileName: string, contentType: string) => {
  const fromName = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() : '';
  if (fromName && /^[a-z0-9]{1,8}$/.test(fromName)) return fromName;
  if (contentType === 'application/pdf') return 'pdf';
  if (contentType.includes('spreadsheet')) return 'xlsx';
  if (contentType.startsWith('image/')) return contentType.split('/')[1] || 'img';
  return 'bin';
};

const importDriveFile = async ({
  serviceClient,
  supabaseUrl,
  accessToken,
  file,
  folderId,
  clubId,
  teamId,
  userId,
}: {
  serviceClient: any;
  supabaseUrl: string;
  accessToken: string;
  file: any;
  folderId?: string | null;
  clubId: string;
  teamId?: string | null;
  userId: string;
}) => {
  if (!file?.id || !file?.name || !file?.mimeType) {
    return { success: false, fileId: file?.id, fileName: file?.name ?? 'Unknown file', error: 'Missing file details' };
  }

  const config = getDownloadConfig(file.id, file.mimeType, file.name);
  if ('error' in config) {
    return { success: false, fileId: file.id, fileName: file.name, error: config.error, code: config.code };
  }

  const fileResponse = await fetch(config.downloadUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!fileResponse.ok) {
    const errorText = await fileResponse.text();
    console.error(`Failed to download Drive file ${file.name}:`, errorText);
    return { success: false, fileId: file.id, fileName: file.name, error: 'Failed to download file', details: errorText };
  }

  const fileData = await fileResponse.arrayBuffer();
  const finalFileName = applyExportExtension(file.name, config.exportMimeType);
  const contentType = config.exportMimeType ?? file.mimeType;
  const safeExt = getSafeExtension(finalFileName, contentType);
  const timestamp = Date.now();
  const randomSuffix = crypto.randomUUID().slice(0, 8);
  const storagePath = teamId
    ? `clubs/${clubId}/teams/${teamId}/${userId}/${timestamp}-${randomSuffix}.${safeExt}`
    : `clubs/${clubId}/${userId}/${timestamp}-${randomSuffix}.${safeExt}`;

  const { error: uploadError } = await serviceClient.storage
    .from('photos')
    .upload(storagePath, fileData, { contentType, upsert: false });

  if (uploadError) {
    console.error(`Failed to upload imported Drive file ${file.name}:`, uploadError);
    return { success: false, fileId: file.id, fileName: file.name, error: uploadError.message };
  }

  const fileUrl = `${supabaseUrl}/storage/v1/object/public/photos/${storagePath}`;
  const { error: insertError } = await serviceClient.from('vault_files').insert({
    file_url: fileUrl,
    name: finalFileName,
    club_id: clubId,
    team_id: teamId ?? null,
    folder_id: folderId ?? null,
    uploaded_by: userId,
    file_size: fileData.byteLength,
    file_type: contentType,
    drive_file_id: file.id,
    drive_modified_time: file.modifiedTime ?? null,
  });

  if (insertError) {
    console.error(`Failed to record imported Drive file ${file.name}:`, insertError);
    await serviceClient.storage.from('photos').remove([storagePath]);
    return { success: false, fileId: file.id, fileName: file.name, error: insertError.message };
  }

  return { success: true, fileId: file.id, fileName: finalFileName, size: fileData.byteLength };
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

    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // Verify user is a club admin (only club admins can import from Google Drive)
    if (user) {
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
      
      // drive.readonly is required so users can browse and import their
      // existing Drive files via our custom file picker UI. The narrower
      // drive.file scope only grants access to files the user opens via
      // Google Picker or that this app created — which makes the listing
      // appear empty for normal Drive content.
      const scopes = [
        'https://www.googleapis.com/auth/drive.readonly',
      ].join(' ');
      
      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', scopes);
      authUrl.searchParams.set('access_type', 'offline');
      // Always show account selector AND force consent — without `consent`,
      // Google will not return a refresh_token on subsequent authorizations,
      // which breaks background sync for folder linking.
      authUrl.searchParams.set('prompt', 'select_account consent');
      authUrl.searchParams.set('include_granted_scopes', 'true');
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
      console.log("Successfully exchanged code for tokens, refresh_token present:", !!tokens.refresh_token);

      // Try to fetch the user's Google email so we can label the linked account
      let googleEmail: string | null = null;
      try {
        const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        if (userInfoRes.ok) {
          const info = await userInfoRes.json();
          googleEmail = info.email ?? null;
        }
      } catch (_e) {
        // non-fatal
      }

      return new Response(
        JSON.stringify({
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token ?? null,
          googleEmail,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Action: List Drive files/folders
    if (action === 'list-files') {
      const body = await req.json();
      const { accessToken, folderId } = body;

      const parentId = folderId || 'root';
      const query = `'${parentId}' in parents and trashed = false`;

      // Page through Drive results so folders with more than 1000 entries
      // surface every file (otherwise "Select all" would silently miss any
      // file beyond the first page).
      const allItems: any[] = [];
      let pageToken: string | undefined = undefined;
      let safetyPages = 0;

      do {
        const driveUrl = new URL('https://www.googleapis.com/drive/v3/files');
        driveUrl.searchParams.set('q', query);
        driveUrl.searchParams.set(
          'fields',
          'nextPageToken,files(id,name,mimeType,size,createdTime,modifiedTime,parents,shortcutDetails)'
        );
        driveUrl.searchParams.set('pageSize', '1000');
        driveUrl.searchParams.set('orderBy', 'folder,name');
        driveUrl.searchParams.set('supportsAllDrives', 'true');
        driveUrl.searchParams.set('includeItemsFromAllDrives', 'true');
        if (pageToken) driveUrl.searchParams.set('pageToken', pageToken);

        const driveResponse = await fetch(driveUrl.toString(), {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!driveResponse.ok) {
          const errorText = await driveResponse.text();
          console.error('Failed to list Drive files:', errorText);
          return new Response(
            JSON.stringify({ error: 'Failed to list Drive files', details: errorText }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const data = await driveResponse.json();
        if (Array.isArray(data.files)) allItems.push(...data.files);
        pageToken = data.nextPageToken;
        safetyPages++;
      } while (pageToken && safetyPages < 50); // hard cap ~50,000 entries / folder

      const resolvedItems = allItems.map((f: any) => {
        if (
          f.mimeType === 'application/vnd.google-apps.shortcut' &&
          f.shortcutDetails?.targetId &&
          f.shortcutDetails?.targetMimeType
        ) {
          return { ...f, id: f.shortcutDetails.targetId, mimeType: f.shortcutDetails.targetMimeType };
        }
        return f;
      });

      // Separate folders and files
      const folders = resolvedItems.filter((f: any) => f.mimeType === 'application/vnd.google-apps.folder');
      const files = resolvedItems.filter((f: any) => f.mimeType !== 'application/vnd.google-apps.folder');

      console.log(`list-files: parent=${parentId} pages=${safetyPages} folders=${folders.length} files=${files.length}`);

      return new Response(
        JSON.stringify({ folders, files }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Action: Download a file from Drive
    if (action === 'download-file') {
      const body = await req.json();
      const { accessToken, fileId, mimeType, fileName } = body;

      const config = getDownloadConfig(fileId, mimeType, fileName);
      if ('error' in config) {
        console.error(`Unsupported Google Workspace file type: ${mimeType} (file: ${fileName})`);
        return new Response(
          JSON.stringify({ error: config.error, code: config.code, mimeType: config.mimeType }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const fileResponse = await fetch(config.downloadUrl, {
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
      
      // Convert to base64 using chunked approach to avoid stack overflow
      const bytes = new Uint8Array(fileData);
      let base64Data = '';
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        base64Data += String.fromCharCode.apply(null, Array.from(chunk));
      }
      base64Data = btoa(base64Data);
      
      return new Response(
        JSON.stringify({ 
          data: base64Data, 
          exportedMimeType: config.exportMimeType,
          size: fileData.byteLength,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Action: Import Drive files completely server-side. This avoids returning
    // large base64 payloads to mobile browsers and supports small batches so
    // large folder imports don't create hundreds of client→function requests.
    if (action === 'import-file') {
      const body = await req.json();
      const {
        accessToken,
        file,
        files,
        folderId,
        clubId,
        teamId,
      } = body;

      const filesToImport = Array.isArray(files) ? files : file ? [{ file, folderId }] : [];

      if (!accessToken || !clubId || filesToImport.length === 0 || filesToImport.length > 10) {
        return new Response(
          JSON.stringify({ error: 'Missing required import details, or batch is too large' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const results = [];
      for (const item of filesToImport) {
        results.push(await importDriveFile({
          serviceClient,
          supabaseUrl,
          accessToken,
          file: item.file ?? item,
          folderId: item.folderId ?? folderId ?? null,
          clubId,
          teamId,
          userId: user!.id,
        }));
      }

      const successCount = results.filter((result) => result.success).length;
      const failureCount = results.length - successCount;

      return new Response(
        JSON.stringify({ success: failureCount === 0, successCount, failureCount, results }),
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
