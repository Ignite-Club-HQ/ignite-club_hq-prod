import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface FailedFileRef {
  drive_file_id: string;
  vault_folder_id: string;
  name?: string;
}

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
  last_failed_files?: FailedFileRef[] | null;
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
  const allFiles: any[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL('https://www.googleapis.com/drive/v3/files');
    url.searchParams.set('q', `'${folderId}' in parents and trashed = false`);
    url.searchParams.set(
      'fields',
      'nextPageToken, files(id,name,mimeType,size,modifiedTime,shortcutDetails)',
    );
    url.searchParams.set('pageSize', '1000');
    // Required so 'root' resolves to the user's My Drive root and so we can
    // see files in shared drives the user has access to.
    url.searchParams.set('supportsAllDrives', 'true');
    url.searchParams.set('includeItemsFromAllDrives', 'true');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Drive list failed for folder ${folderId}: ${await res.text()}`);
    const data = await res.json();
    if (Array.isArray(data.files)) allFiles.push(...data.files);
    pageToken = data.nextPageToken;
  } while (pageToken);

  // Resolve shortcuts to their target so we treat them like the real file/folder.
  const resolved = allFiles.map((f: any) => {
    if (
      f.mimeType === 'application/vnd.google-apps.shortcut' &&
      f.shortcutDetails?.targetId &&
      f.shortcutDetails?.targetMimeType
    ) {
      return {
        ...f,
        id: f.shortcutDetails.targetId,
        mimeType: f.shortcutDetails.targetMimeType,
      };
    }
    return f;
  });

  const folders = resolved.filter((f: any) => f.mimeType === 'application/vnd.google-apps.folder');
  const files = resolved.filter((f: any) => f.mimeType !== 'application/vnd.google-apps.folder');
  return { folders, files };
}


async function getDriveFileMetadata(accessToken: string, fileId: string) {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,size,modifiedTime,trashed`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Drive metadata fetch failed for ${fileId}: ${await res.text()}`);
  return await res.json();
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
  } else if (mimeType === 'application/vnd.google-apps.form') {
    // Google Forms cannot be exported via the Drive API. Skip cleanly.
    throw new Error('SKIP_UNSUPPORTED: Google Forms cannot be exported');
  } else if (mimeType.startsWith('application/vnd.google-apps.')) {
    // Other Google native types (drawings, sites, scripts, etc.) — try PDF export.
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

const MAX_FILE_BYTES = 40 * 1024 * 1024; // 40 MB — edge function memory safety

function sanitizeExtension(name: string): string {
  const rawExt = name.includes('.') ? name.split('.').pop() ?? 'bin' : 'bin';
  const cleanExt = rawExt
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toLowerCase();

  return cleanExt || 'bin';
}

function buildStoragePath(link: DriveLink, fileName: string): string {
  const ext = sanitizeExtension(fileName);
  const objectName = `${crypto.randomUUID()}.${ext}`;

  if (link.team_id) {
    return `clubs/${link.club_id}/teams/${link.team_id}/drive-sync/${objectName}`;
  }

  return `clubs/${link.club_id}/drive-sync/${objectName}`;
}

type FileOutcome = 'imported' | 'updated' | 'skipped' | 'failed' | 'unchanged';

async function processFile(
  supabase: any,
  accessToken: string,
  link: DriveLink,
  file: any,
  vaultFolderId: string,
): Promise<FileOutcome> {
  const declaredSize = file.size ? Number(file.size) : 0;
  if (declaredSize && declaredSize > MAX_FILE_BYTES) {
    console.warn(`Skipping "${file.name}" (${(declaredSize / 1024 / 1024).toFixed(1)} MB) — exceeds ${MAX_FILE_BYTES / 1024 / 1024} MB limit`);
    return 'skipped';
  }

  const { data: existing } = await supabase
    .from('vault_files')
    .select('id, drive_modified_time, file_url')
    .eq('drive_file_id', file.id)
    .eq('club_id', link.club_id)
    .maybeSingle();

  const driveModified = file.modifiedTime ? new Date(file.modifiedTime).toISOString() : null;

  if (existing) {
    if (existing.drive_modified_time && driveModified && new Date(existing.drive_modified_time) >= new Date(driveModified)) {
      return 'unchanged';
    }
    const { bytes, contentType, extraExt } = await downloadDriveFile(accessToken, file.id, file.mimeType);
    let fileName = file.name;
    if (extraExt && !fileName.endsWith(extraExt)) fileName += extraExt;
    const blob = new Blob([bytes], { type: contentType });
    const bucket = 'photos';
    const storagePath = buildStoragePath(link, fileName);
    const { error: upErr } = await supabase.storage.from(bucket).upload(storagePath, blob, { contentType });
    if (upErr) throw new Error(`Storage upload failed: ${upErr.message ?? upErr}`);
    const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(storagePath);
    const { error: updErr } = await supabase
      .from('vault_files')
      .update({
        file_url: urlData.publicUrl,
        file_size: bytes.byteLength,
        file_type: contentType,
        drive_modified_time: driveModified,
        name: fileName,
      })
      .eq('id', existing.id);
    if (updErr) throw new Error(`DB update failed: ${updErr.message ?? updErr}`);
    return 'updated';
  }

  const { bytes, contentType, extraExt } = await downloadDriveFile(accessToken, file.id, file.mimeType);
  let fileName = file.name;
  if (extraExt && !fileName.endsWith(extraExt)) fileName += extraExt;
  const blob = new Blob([bytes], { type: contentType });
  const bucket = 'photos';
  const storagePath = buildStoragePath(link, fileName);
  const { error: upErr } = await supabase.storage.from(bucket).upload(storagePath, blob, { contentType });
  if (upErr) throw new Error(`Storage upload failed: ${upErr.message ?? upErr}`);
  const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(storagePath);
  const { error: insErr } = await supabase.from('vault_files').insert({
    file_url: urlData.publicUrl,
    name: fileName,
    club_id: link.club_id,
    team_id: link.team_id,
    folder_id: vaultFolderId,
    uploaded_by: null,
    file_size: bytes.byteLength,
    file_type: contentType,
    drive_file_id: file.id,
    drive_modified_time: driveModified,
  });
  if (insErr) throw new Error(`DB insert failed: ${insErr.message ?? insErr}`);
  return 'imported';
}

interface SyncCounts {
  imported: number;
  updated: number;
  skipped: number;
  failed: number;
  failedFiles: FailedFileRef[];
}

async function syncLink(supabase: any, link: DriveLink): Promise<SyncCounts> {
  const accessToken = await refreshAccessToken(link.refresh_token);
  const counts: SyncCounts = { imported: 0, updated: 0, skipped: 0, failed: 0, failedFiles: [] };

  // PHASE 1 — Walk the entire Drive tree FIRST (folder listing only, no
  // downloads). This is fast and ensures the full folder structure is created
  // in the vault even if the function later runs out of time during file
  // downloads. We also collect every (file, vaultFolderId) pair so we can
  // process them with predictable ordering in phase 2.
  const allFiles: { file: any; vaultId: string }[] = [];
  const queue: { driveId: string; vaultId: string }[] = [
    { driveId: link.drive_folder_id, vaultId: link.vault_folder_id },
  ];

  while (queue.length > 0) {
    const { driveId, vaultId } = queue.shift()!;
    let folders: any[] = [];
    let files: any[] = [];
    try {
      ({ folders, files } = await listDriveFolder(accessToken, driveId));
    } catch (listErr) {
      console.error(`Failed listing drive folder ${driveId}:`, listErr);
      continue;
    }

    for (const sub of folders) {
      // Scope the lookup to children of the CURRENT vault parent. Without this
      // scope, a second link to the same Drive (or any link sharing Drive IDs
      // with an earlier link) would silently re-use folders that live under a
      // different vault root, leaving the new link's tree empty of subfolders.
      // NB: use limit(1) + maybeSingle (not .maybeSingle() alone) so that legacy
      // duplicate rows for the same drive_folder_id don't make this lookup return
      // null (which would trigger yet another duplicate insert every cron run).
      const { data: existingFolders } = await supabase
        .from('vault_folders')
        .select('id')
        .eq('club_id', link.club_id)
        .eq('parent_id', vaultId)
        .eq('drive_folder_id', sub.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: true })
        .limit(1);
      const existingFolder = existingFolders?.[0] ?? null;

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

    for (const file of files) {
      allFiles.push({ file, vaultId });
    }
  }

  console.log(`Drive tree walked: ${allFiles.length} file(s) discovered across all folders`);

  // PHASE 2 — Process files. Interleave by folder so that even if we time out
  // we still get a representative sample of files in every folder rather than
  // filling root-level files first and starving the deep tree. We sort so
  // files in different folders are visited round-robin style.
  const filesByFolder = new Map<string, any[]>();
  for (const entry of allFiles) {
    if (!filesByFolder.has(entry.vaultId)) filesByFolder.set(entry.vaultId, []);
    filesByFolder.get(entry.vaultId)!.push(entry.file);
  }

  const folderQueues = Array.from(filesByFolder.entries()).map(([vaultId, files]) => ({ vaultId, files, cursor: 0 }));

  let stillWorking = true;
  while (stillWorking) {
    stillWorking = false;
    for (const fq of folderQueues) {
      if (fq.cursor >= fq.files.length) continue;
      stillWorking = true;
      const file = fq.files[fq.cursor++];
      try {
        const outcome = await processFile(supabase, accessToken, link, file, fq.vaultId);
        if (outcome === 'imported') counts.imported++;
        else if (outcome === 'updated') counts.updated++;
        else if (outcome === 'skipped') counts.skipped++;
      } catch (fileErr) {
        counts.failed++;
        counts.failedFiles.push({ drive_file_id: file.id, vault_folder_id: fq.vaultId, name: file.name });
        console.error(`Failed processing file "${file.name}" (drive_id=${file.id}):`, fileErr);
      }
    }
  }

  return counts;
}

async function retryFailedFiles(supabase: any, link: DriveLink): Promise<SyncCounts> {
  const counts: SyncCounts = { imported: 0, updated: 0, skipped: 0, failed: 0, failedFiles: [] };
  const failedList = Array.isArray(link.last_failed_files) ? link.last_failed_files : [];
  if (failedList.length === 0) return counts;

  const accessToken = await refreshAccessToken(link.refresh_token);

  for (const ref of failedList) {
    try {
      const meta = await getDriveFileMetadata(accessToken, ref.drive_file_id);
      if (meta.trashed) {
        // File is gone in Drive — drop it from the failed list silently.
        continue;
      }
      const outcome = await processFile(supabase, accessToken, link, meta, ref.vault_folder_id);
      if (outcome === 'imported') counts.imported++;
      else if (outcome === 'updated') counts.updated++;
      else if (outcome === 'skipped') counts.skipped++;
    } catch (err) {
      counts.failed++;
      counts.failedFiles.push(ref);
      console.error(`Retry still failed for "${ref.name ?? ref.drive_file_id}":`, err);
    }
  }

  return counts;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    let body: any = {};
    try { body = await req.json(); } catch (_e) {}

    const retryOnly: boolean = !!body.retryFailedOnly;

    let links: DriveLink[] = [];

    if (body.linkId) {
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
      if (retryOnly) {
        return new Response(JSON.stringify({ error: 'retryFailedOnly requires linkId' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data, error } = await supabase
        .from('vault_drive_links')
        .select('*')
        .eq('sync_enabled', true);
      if (error) throw error;
      links = (data || []) as DriveLink[];
    }

    console.log(`Syncing ${links.length} drive link(s)${retryOnly ? ' (retry-only)' : ''}`);
    const results: any[] = [];

    for (const link of links) {
      try {
        const { imported, updated, skipped, failed, failedFiles } = retryOnly
          ? await retryFailedFiles(supabase, link)
          : await syncLink(supabase, link);

        await supabase.from('vault_drive_links').update({
          last_synced_at: new Date().toISOString(),
          last_sync_status: failed > 0 ? 'partial' : 'success',
          last_sync_error: failed > 0 ? `${failed} file(s) failed${skipped ? `, ${skipped} skipped (too large)` : ''}` : null,
          files_imported_count: link.files_imported_count + imported,
          files_updated_count: link.files_updated_count + updated,
          last_failed_files: failedFiles,
        }).eq('id', link.id);

        results.push({
          linkId: link.id,
          imported, updated, skipped, failed,
          retried: retryOnly,
          status: failed > 0 ? 'partial' : 'success',
        });
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
