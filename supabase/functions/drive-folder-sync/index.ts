import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DriveLink {
  id: string;
  club_id: string;
  team_id: string | null;
  vault_folder_id: string;
  drive_folder_id: string;
  drive_folder_name: string;
  refresh_token: string;
  sync_enabled: boolean;
  files_imported_count: number;
  files_updated_count: number;
}

const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID')!;
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

async function refreshAccessToken(refreshToken: string): Promise<string> {
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
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Token refresh failed: ${t}`);
  }
  const json = await res.json();
  return json.access_token;
}

async function listDriveFolder(accessToken: string, folderId: string) {
  const url = new URL('https://www.googleapis.com/drive/v3/files');
  url.searchParams.set('q', `'${folderId}' in parents and trashed = false`);
  url.searchParams.set('fields', 'files(id,name,mimeType,size,modifiedTime)');
  url.searchParams.set('pageSize', '1000');
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Drive list failed: ${await res.text()}`);
  const data = await res.json();
  const folders = (data.files || []).filter((f: any) => f.mimeType === 'application/vnd.google-apps.folder');
  const files = (data.files || []).filter((f: any) => f.mimeType !== 'application/vnd.google-apps.folder');
  return { folders, files };
}

async function downloadDriveFile(accessToken: string, fileId: string, mimeType: string) {
  let downloadUrl: string;
  let exportedMimeType: string | null = null;
  let extraExt = '';

  if (mimeType === 'application/vnd.google-apps.document') {
    exportedMimeType = 'application/pdf';
    extraExt = '.pdf';
    downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(exportedMimeType)}`;
  } else if (mimeType === 'application/vnd.google-apps.spreadsheet') {
    exportedMimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    extraExt = '.xlsx';
    downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(exportedMimeType)}`;
  } else if (mimeType === 'application/vnd.google-apps.presentation') {
    exportedMimeType = 'application/pdf';
    extraExt = '.pdf';
    downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(exportedMimeType)}`;
  } else {
    downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  }

  const res = await fetch(downloadUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Download failed: ${await res.text()}`);
  const buf = await res.arrayBuffer();
  return { bytes: new Uint8Array(buf), contentType: exportedMimeType ?? mimeType, extraExt };
}

async function syncLink(supabase: any, link: DriveLink): Promise<{ imported: number; updated: number }> {
  const accessToken = await refreshAccessToken(link.refresh_token);
  let imported = 0;
  let updated = 0;

  // BFS: list of [driveFolderId, vaultParentFolderId]
  const queue: { driveId: string; vaultId: string }[] = [
    { driveId: link.drive_folder_id, vaultId: link.vault_folder_id },
  ];

  while (queue.length > 0) {
    const { driveId, vaultId } = queue.shift()!;
    const { folders, files } = await listDriveFolder(accessToken, driveId);

    // Mirror subfolders
    for (const sub of folders) {
      // Find or create vault folder by drive_folder_id under this vault parent
      const { data: existingFolder } = await supabase
        .from('vault_folders')
        .select('id')
        .eq('club_id', link.club_id)
        .eq('drive_folder_id', sub.id)
        .maybeSingle();

      let subVaultId: string;
      if (existingFolder) {
        subVaultId = existingFolder.id;
      } else {
        const { data: newFolder, error: folderErr } = await supabase
          .from('vault_folders')
          .insert({
            name: sub.name,
            club_id: link.club_id,
            team_id: link.team_id,
            parent_id: vaultId,
            drive_folder_id: sub.id,
            created_by: null,
          })
          .select('id')
          .single();
        if (folderErr || !newFolder) {
          console.error(`Failed to create subfolder "${sub.name}" (drive_id=${sub.id}) under vault parent ${vaultId}:`, folderErr);
          continue;
        }
        subVaultId = newFolder.id;
      }
      queue.push({ driveId: sub.id, vaultId: subVaultId });
    }

    // Process files
    for (const file of files) {
      try {
        const { data: existing } = await supabase
          .from('vault_files')
          .select('id, drive_modified_time, file_url')
          .eq('drive_file_id', file.id)
          .eq('club_id', link.club_id)
          .maybeSingle();

        const driveModified = file.modifiedTime ? new Date(file.modifiedTime).toISOString() : null;

        if (existing) {
          // Skip if not modified
          if (existing.drive_modified_time && driveModified && new Date(existing.drive_modified_time) >= new Date(driveModified)) {
            continue;
          }
          // Re-download and replace
          const { bytes, contentType, extraExt } = await downloadDriveFile(accessToken, file.id, file.mimeType);
          let fileName = file.name;
          if (extraExt && !fileName.endsWith(extraExt)) fileName += extraExt;
          const blob = new Blob([bytes], { type: contentType });
          const bucket = 'photos';
          const storagePath = `${link.club_id}/${crypto.randomUUID()}-${fileName}`;
          const { error: upErr } = await supabase.storage.from(bucket).upload(storagePath, blob, { contentType });
          if (upErr) { console.error('Upload failed', upErr); continue; }
          const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(storagePath);
          await supabase
            .from('vault_files')
            .update({
              file_url: urlData.publicUrl,
              file_size: bytes.byteLength,
              file_type: contentType,
              drive_modified_time: driveModified,
              name: fileName,
            })
            .eq('id', existing.id);
          updated++;
        } else {
          // Brand new file
          const { bytes, contentType, extraExt } = await downloadDriveFile(accessToken, file.id, file.mimeType);
          let fileName = file.name;
          if (extraExt && !fileName.endsWith(extraExt)) fileName += extraExt;
          const blob = new Blob([bytes], { type: contentType });
          const bucket = 'photos';
          const storagePath = `${link.club_id}/${crypto.randomUUID()}-${fileName}`;
          const { error: upErr } = await supabase.storage.from(bucket).upload(storagePath, blob, { contentType });
          if (upErr) { console.error('Upload failed', upErr); continue; }
          const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(storagePath);
          await supabase.from('vault_files').insert({
            file_url: urlData.publicUrl,
            name: fileName,
            club_id: link.club_id,
            team_id: link.team_id,
            folder_id: vaultId,
            uploaded_by: null,
            file_size: bytes.byteLength,
            file_type: contentType,
            drive_file_id: file.id,
            drive_modified_time: driveModified,
          });
          imported++;
        }
      } catch (fileErr) {
        console.error(`Failed processing file ${file.name}:`, fileErr);
      }
    }
  }

  return { imported, updated };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    let body: any = {};
    try { body = await req.json(); } catch (_e) {}

    let links: DriveLink[] = [];

    if (body.linkId) {
      // Single link sync (manual trigger)
      const { data, error } = await supabase
        .from('vault_drive_links')
        .select('*')
        .eq('id', body.linkId)
        .single();
      if (error || !data) {
        return new Response(JSON.stringify({ error: 'Link not found' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      links = [data as DriveLink];
    } else {
      // Scheduled: pull all enabled links
      const { data, error } = await supabase
        .from('vault_drive_links')
        .select('*')
        .eq('sync_enabled', true);
      if (error) throw error;
      links = (data || []) as DriveLink[];
    }

    console.log(`Syncing ${links.length} drive link(s)`);
    const results: any[] = [];

    for (const link of links) {
      try {
        const { imported, updated } = await syncLink(supabase, link);
        await supabase.from('vault_drive_links').update({
          last_synced_at: new Date().toISOString(),
          last_sync_status: 'success',
          last_sync_error: null,
          files_imported_count: link.files_imported_count + imported,
          files_updated_count: link.files_updated_count + updated,
        }).eq('id', link.id);
        results.push({ linkId: link.id, imported, updated, status: 'success' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Sync failed for link ${link.id}:`, msg);
        await supabase.from('vault_drive_links').update({
          last_synced_at: new Date().toISOString(),
          last_sync_status: 'error',
          last_sync_error: msg.slice(0, 500),
        }).eq('id', link.id);
        results.push({ linkId: link.id, status: 'error', error: msg });
      }
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('drive-folder-sync error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
