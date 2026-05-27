// Backfill historical group chat attachments (images and file/document links)
// into the vault, mirroring chatVaultSync.ts folder strategy:
//   - Every group chat gets its own dedicated club-level folder, named after
//     the group, linked via chat_group_id.
//   - Role-restricted groups persist restricted_roles=allowed_roles.
//
// Idempotent: skips URLs already present in vault_files for the same club.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RESTRICTED_ROLES = new Set([
  "club_admin",
  "committee_member",
  "coach",
  "team_admin",
  "league_admin",
]);

const FILE_EXT = /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|csv|zip|rar|txt|rtf|odt|ods|odp|png|jpg|jpeg|gif|webp|svg|mp4|mov|avi|mp3|wav)$/i;
const GOOGLE_ACTION = new Set([
  "edit", "view", "preview", "comment", "copy", "template", "htmlview", "pub", "embed", "viewform", "formresponse",
]);

function isFileLink(url: string): boolean {
  return (
    FILE_EXT.test(url) ||
    url.includes("drive.google.com") ||
    url.includes("docs.google.com") ||
    url.includes("sheets.google.com") ||
    url.includes("slides.google.com") ||
    url.includes("forms.google.com") ||
    url.includes("goo.gl") ||
    url.includes("dropbox.com")
  );
}

function extractFileUrls(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/(?:https?:\/\/)[^\s]+/gi) || [];
  return matches.filter(isFileLink);
}

function googleDocLabel(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (!host.endsWith("google.com") && !host.endsWith("goo.gl") && !host.endsWith("googleusercontent.com")) return null;
    const path = u.pathname.toLowerCase();
    let kind: string | null = null;
    let isFolder = false;
    if (path.includes("/spreadsheets/")) kind = "Google Sheet";
    else if (path.includes("/document/")) kind = "Google Doc";
    else if (path.includes("/presentation/")) kind = "Google Slides";
    else if (path.includes("/forms/")) kind = "Google Form";
    else if (path.includes("/drawings/")) kind = "Google Drawing";
    else if (path.includes("/folders/") || path.includes("/folderview")) { kind = "Google Drive folder"; isFolder = true; }
    else if (host === "goo.gl" || host.endsWith(".goo.gl")) kind = "Google share link";
    else if (host.startsWith("drive.") || host.endsWith("googleusercontent.com")) kind = "Google Drive file";
    else if (host.startsWith("docs.")) kind = "Google Doc";
    else return null;

    let id: string | null = null;
    const folderMatch = u.pathname.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    const deMatch = u.pathname.match(/\/d\/e\/([a-zA-Z0-9_-]+)/);
    const dMatch = u.pathname.match(/\/d\/([a-zA-Z0-9_-]+)/);
    const fileMatch = u.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    const idParam = u.searchParams.get("id");
    if (isFolder && folderMatch) id = folderMatch[1];
    else if (fileMatch) id = fileMatch[1];
    else if (deMatch) id = deMatch[1];
    else if (dMatch) id = dMatch[1];
    else if (folderMatch) id = folderMatch[1];
    else if (idParam) id = idParam;
    if (id) return `${kind} (${id.slice(0, 6)})`;
    return kind;
  } catch { return null; }
}

function extractFileName(url: string): string | null {
  try {
    const g = googleDocLabel(url);
    if (g) return g;
    const segs = new URL(url).pathname.split("/").filter(Boolean);
    for (let i = segs.length - 1; i >= 0; i--) {
      const s = segs[i];
      if (GOOGLE_ACTION.has(s.toLowerCase())) continue;
      if (s.includes(".")) return decodeURIComponent(s);
      break;
    }
    return null;
  } catch { return null; }
}

function guessFileType(url: string): string | null {
  const l = url.toLowerCase();
  if (/\.(jpg|jpeg)/.test(l)) return "image/jpeg";
  if (/\.png/.test(l)) return "image/png";
  if (/\.gif/.test(l)) return "image/gif";
  if (/\.webp/.test(l)) return "image/webp";
  if (/\.pdf/.test(l)) return "application/pdf";
  if (/\.doc(x)?/.test(l)) return "application/msword";
  if (/\.xls(x)?/.test(l)) return "application/vnd.ms-excel";
  if (/\.ppt(x)?/.test(l)) return "application/vnd.ms-powerpoint";
  if (/\.csv/.test(l)) return "text/csv";
  if (/\.mp4/.test(l)) return "video/mp4";
  if (/\.mp3/.test(l)) return "audio/mpeg";
  if (url.includes("drive.google.com") || url.includes("docs.google.com")) return "link/google-drive";
  if (url.includes("dropbox.com")) return "link/dropbox";
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const body = await req.json().catch(() => ({}));
  const onlyGroupId: string | null = body?.group_id ?? null;
  const onlyClubId: string | null = body?.club_id ?? null;

  // 1. Fetch all (non-deleted) club-scoped chat groups.
  let gq = supabase
    .from("chat_groups")
    .select("id, name, club_id, allowed_roles")
    .is("deleted_at", null)
    .not("club_id", "is", null);
  if (onlyGroupId) gq = gq.eq("id", onlyGroupId);
  if (onlyClubId) gq = gq.eq("club_id", onlyClubId);

  const { data: groups, error: gerr } = await gq;
  if (gerr) return new Response(JSON.stringify({ error: gerr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  let foldersCreated = 0;
  let filesInserted = 0;
  let groupsProcessed = 0;

  for (const g of groups ?? []) {
    groupsProcessed++;
    const allowedRoles: string[] = Array.isArray(g.allowed_roles) ? g.allowed_roles : [];
    const restricted = allowedRoles.some((r) => RESTRICTED_ROLES.has(r));

    // 2. Get or create the group's vault folder.
    // Match by chat_group_id only — the existing folder may already live nested
    // under a parent folder, so don't constrain on parent_id IS NULL.
    const { data: existingFolder } = await supabase
      .from("vault_folders")
      .select("id")
      .eq("club_id", g.club_id)
      .eq("chat_group_id", g.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    let folderId = existingFolder?.id as string | undefined;
    if (!folderId) {
      const { data: nf, error: nerr } = await supabase
        .from("vault_folders")
        .insert({
          club_id: g.club_id,
          name: g.name,
          created_by: null,
          team_id: null,
          chat_group_id: g.id,
          restricted_roles: restricted ? allowedRoles : null,
        } as any)
        .select("id")
        .single();
      if (nerr || !nf) { console.warn("folder create failed", g.id, nerr?.message); continue; }
      folderId = nf.id;
      foldersCreated++;
    }

    // 3. Fetch all non-deleted, non-system messages with content.
    const { data: msgs, error: merr } = await supabase
      .from("group_messages")
      .select("author_id, text, image_url, created_at")
      .eq("group_id", g.id)
      .is("deleted_at", null)
      .or("image_url.not.is.null,text.not.is.null")
      .order("created_at", { ascending: true })
      .limit(10000);
    if (merr) { console.warn("msgs fetch failed", g.id, merr.message); continue; }

    type Row = { file_url: string; name: string; file_type: string | null; is_external_link: boolean; file_size: null; uploaded_by: string | null; created_at: string };
    const rows: Row[] = [];
    for (const m of msgs ?? []) {
      if (m.image_url) {
        rows.push({
          file_url: m.image_url,
          name: extractFileName(m.image_url) || `chat-attachment-${new Date(m.created_at).getTime()}`,
          file_type: guessFileType(m.image_url),
          is_external_link: false,
          file_size: null,
          uploaded_by: m.author_id,
          created_at: m.created_at,
        });
      }
      const urls = extractFileUrls(m.text || "");
      for (const u of urls) {
        rows.push({
          file_url: u,
          name: extractFileName(u) || u,
          file_type: guessFileType(u),
          is_external_link: true,
          file_size: null,
          uploaded_by: m.author_id,
          created_at: m.created_at,
        });
      }
    }
    if (rows.length === 0) continue;

    // Dedupe within this run, keep earliest occurrence.
    const seen = new Map<string, Row>();
    for (const r of rows) if (!seen.has(r.file_url)) seen.set(r.file_url, r);
    const unique = [...seen.values()];

    // 4. Skip URLs already in vault_files for this club.
    const urls = unique.map((r) => r.file_url);
    const existingUrls = new Set<string>();
    // chunk IN clause
    const chunk = 200;
    for (let i = 0; i < urls.length; i += chunk) {
      const slice = urls.slice(i, i + chunk);
      const { data: existing } = await supabase
        .from("vault_files")
        .select("file_url")
        .eq("club_id", g.club_id)
        .in("file_url", slice);
      (existing ?? []).forEach((e: any) => existingUrls.add(e.file_url));
    }
    const fresh = unique.filter((r) => !existingUrls.has(r.file_url));
    if (fresh.length === 0) continue;

    const insertRows = fresh.map((r) => ({
      file_url: r.file_url,
      name: r.name,
      file_type: r.file_type,
      is_external_link: r.is_external_link,
      file_size: r.file_size,
      club_id: g.club_id,
      team_id: null,
      uploaded_by: r.uploaded_by,
      folder_id: folderId,
      created_at: r.created_at,
    }));

    // Insert in batches.
    for (let i = 0; i < insertRows.length; i += 500) {
      const batch = insertRows.slice(i, i + 500);
      const { error: ierr } = await supabase.from("vault_files").insert(batch as any);
      if (ierr) { console.warn("insert failed", g.id, ierr.message); break; }
      filesInserted += batch.length;
    }
  }

  return new Response(
    JSON.stringify({ ok: true, groupsProcessed, foldersCreated, filesInserted }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
