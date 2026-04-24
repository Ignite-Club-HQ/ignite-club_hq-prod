import { useState, useCallback, useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { HardDrive, Folder, Loader2, ChevronRight, ArrowLeft, Check, Link as LinkIcon, RefreshCw, Trash2, Power } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { formatDistanceToNow } from "date-fns";

interface DriveFolder {
  id: string;
  name: string;
  mimeType: string;
}

interface ExistingLink {
  id: string;
  drive_folder_name: string;
  google_account_email: string | null;
  sync_enabled: boolean;
  last_synced_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
  files_imported_count: number;
  files_updated_count: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vaultFolderId: string;
  clubId: string;
  teamId: string | null;
  onChanged: () => void;
}

export function LinkDriveFolderDialog({ open, onOpenChange, vaultFolderId, clubId, teamId, onChanged }: Props) {
  const [existing, setExisting] = useState<ExistingLink | null>(null);
  const [checkingExisting, setCheckingExisting] = useState(true);
  const [step, setStep] = useState<"connect" | "browse">("connect");
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [googleEmail, setGoogleEmail] = useState<string | null>(null);
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [folderPath, setFolderPath] = useState<{ id: string; name: string }[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [linking, setLinking] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const getRedirectUri = useCallback(() => {
    if (Capacitor.isNativePlatform()) return 'https://igniteclubhq.app/vault';
    return `${window.location.origin}/vault`;
  }, []);

  // Check for existing link when opened
  useEffect(() => {
    if (!open) return;
    setCheckingExisting(true);
    supabase
      .from('vault_drive_links')
      .select('id, drive_folder_name, google_account_email, sync_enabled, last_synced_at, last_sync_status, last_sync_error, files_imported_count, files_updated_count')
      .eq('vault_folder_id', vaultFolderId)
      .maybeSingle()
      .then(({ data }) => {
        setExisting(data as ExistingLink | null);
        setCheckingExisting(false);
      });
  }, [open, vaultFolderId]);

  // Resume from OAuth redirect (uses keys distinct from import dialog)
  useEffect(() => {
    if (!open) return;
    const stored = sessionStorage.getItem('driveLinkAccessToken');
    const storedRefresh = sessionStorage.getItem('driveLinkRefreshToken');
    const storedEmail = sessionStorage.getItem('driveLinkGoogleEmail');
    if (stored) {
      sessionStorage.removeItem('driveLinkAccessToken');
      sessionStorage.removeItem('driveLinkRefreshToken');
      sessionStorage.removeItem('driveLinkGoogleEmail');
      setAccessToken(stored);
      setRefreshToken(storedRefresh);
      setGoogleEmail(storedEmail);
      setStep("browse");
      loadFolderContents(null, stored);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      setStep("connect");
      setAccessToken(null);
      setRefreshToken(null);
      setGoogleEmail(null);
      setFolders([]);
      setFolderPath([]);
      setCurrentFolderId(null);
    }
  }, [open]);

  const startOAuth = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.functions.invoke('google-drive-import?action=get-auth-url', {
        body: { redirectUri: getRedirectUri() },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      // Mark this OAuth as for linking, not importing
      sessionStorage.setItem('driveLinkPending', JSON.stringify({ vaultFolderId, clubId, teamId }));
      sessionStorage.removeItem('googleDriveImportPending');
      if (Capacitor.isNativePlatform()) {
        const { safeOpenUrl } = await import("@/lib/safeOpenUrl");
        safeOpenUrl(data.authUrl);
      } else {
        window.location.href = data.authUrl;
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to start Google authentication");
      setLoading(false);
    }
  };

  const loadFolderContents = async (folderId: string | null, token?: string) => {
    try {
      setLoading(true);
      const { data, error } = await supabase.functions.invoke('google-drive-import?action=list-files', {
        body: { accessToken: token || accessToken, folderId: folderId || undefined },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      setFolders(data.folders || []);
      setCurrentFolderId(folderId);
    } catch (err) {
      console.error(err);
      toast.error("Failed to load Drive folders");
    } finally {
      setLoading(false);
    }
  };

  const linkFolder = async (folder: DriveFolder) => {
    if (!refreshToken) {
      toast.error("Missing refresh token. Please disconnect Google Drive in your Google account and reconnect.");
      return;
    }
    try {
      setLinking(true);
      const userId = (await supabase.auth.getUser()).data.user?.id;
      if (!userId) throw new Error("Not authenticated");

      // Mark vault folder with drive id
      await supabase.from('vault_folders').update({ drive_folder_id: folder.id }).eq('id', vaultFolderId);

      const { data: newLink, error: insertErr } = await supabase
        .from('vault_drive_links')
        .insert({
          club_id: clubId,
          team_id: teamId,
          vault_folder_id: vaultFolderId,
          drive_folder_id: folder.id,
          drive_folder_name: folder.name,
          refresh_token: refreshToken,
          google_account_email: googleEmail,
          created_by: userId,
        })
        .select('*')
        .single();

      if (insertErr) throw insertErr;

      toast.success(`Linked "${folder.name}" — running initial sync...`);

      // Trigger first sync
      await supabase.functions.invoke('drive-folder-sync', { body: { linkId: newLink.id } });

      toast.success("Initial sync complete");
      onChanged();
      onOpenChange(false);
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : 'Unknown';
      if (msg.includes('duplicate')) {
        toast.error("This vault folder is already linked to a Drive folder");
      } else {
        toast.error(`Failed to link folder: ${msg}`);
      }
    } finally {
      setLinking(false);
    }
  };

  const triggerManualSync = async () => {
    if (!existing) return;
    try {
      setSyncing(true);
      const { data, error } = await supabase.functions.invoke('drive-folder-sync', { body: { linkId: existing.id } });
      if (error) throw error;
      const r = data?.results?.[0];
      if (r?.status === 'error') {
        toast.error(`Sync failed: ${r.error}`);
      } else {
        const parts = [`${r?.imported ?? 0} new`, `${r?.updated ?? 0} updated`];
        if (r?.skipped) parts.push(`${r.skipped} skipped (>40MB)`);
        if (r?.failed) parts.push(`${r.failed} failed`);
        if (r?.status === 'partial') {
          toast.warning(`Synced with issues — ${parts.join(', ')}`);
        } else {
          toast.success(`Synced — ${parts.join(', ')}`);
        }
      }
      onChanged();
      // Refresh existing
      const { data: refreshed } = await supabase
        .from('vault_drive_links')
        .select('id, drive_folder_name, google_account_email, sync_enabled, last_synced_at, last_sync_status, last_sync_error, files_imported_count, files_updated_count')
        .eq('id', existing.id)
        .single();
      setExisting(refreshed as ExistingLink);
    } catch (err) {
      console.error(err);
      toast.error("Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const toggleSync = async (enabled: boolean) => {
    if (!existing) return;
    await supabase.from('vault_drive_links').update({ sync_enabled: enabled }).eq('id', existing.id);
    setExisting({ ...existing, sync_enabled: enabled });
  };

  const removeLink = async () => {
    if (!existing) return;
    if (!confirm("Remove this Drive link? Files already imported will stay in the vault.")) return;
    await supabase.from('vault_drive_links').delete().eq('id', existing.id);
    await supabase.from('vault_folders').update({ drive_folder_id: null }).eq('id', vaultFolderId);
    toast.success("Drive link removed");
    onChanged();
    onOpenChange(false);
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-2xl" fullScreen={step === "browse" && !existing}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <LinkIcon className="h-5 w-5" />
            {existing ? "Drive Sync Settings" : "Link Google Drive Folder"}
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        {checkingExisting ? (
          <div className="py-12 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : existing ? (
          <div className="p-4 space-y-4">
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <HardDrive className="h-5 w-5 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{existing.drive_folder_name}</p>
                    {existing.google_account_email && (
                      <p className="text-xs text-muted-foreground truncate">{existing.google_account_email}</p>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-md bg-muted/50 p-2">
                    <p className="text-xs text-muted-foreground">Imported</p>
                    <p className="font-semibold">{existing.files_imported_count}</p>
                  </div>
                  <div className="rounded-md bg-muted/50 p-2">
                    <p className="text-xs text-muted-foreground">Updated</p>
                    <p className="font-semibold">{existing.files_updated_count}</p>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  Last synced: {existing.last_synced_at ? formatDistanceToNow(new Date(existing.last_synced_at), { addSuffix: true }) : "Never"}
                </div>
                {existing.last_sync_error && (
                  <div className="text-xs text-destructive bg-destructive/10 rounded p-2">
                    Last error: {existing.last_sync_error}
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Power className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Background sync</p>
                  <p className="text-xs text-muted-foreground">Auto-pulls new and updated files every 30 min</p>
                </div>
              </div>
              <Switch checked={existing.sync_enabled} onCheckedChange={toggleSync} />
            </div>

            <div className="flex flex-col gap-2">
              <Button onClick={triggerManualSync} disabled={syncing}>
                {syncing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                Sync now
              </Button>
              <Button variant="outline" onClick={removeLink} className="text-destructive hover:text-destructive">
                <Trash2 className="h-4 w-4 mr-2" />
                Remove Drive link
              </Button>
            </div>
          </div>
        ) : step === "connect" ? (
          <div className="py-8 flex flex-col items-center gap-6 px-4">
            <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
              <LinkIcon className="h-10 w-10 text-primary" />
            </div>
            <div className="text-center space-y-2">
              <p className="font-medium">Link a Drive folder to this vault folder</p>
              <p className="text-sm text-muted-foreground">
                New and updated files in Drive will sync automatically. Files won't be deleted.
              </p>
            </div>
            <Button onClick={startOAuth} disabled={loading} size="lg">
              {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <HardDrive className="h-4 w-4 mr-2" />}
              Connect Google Drive
            </Button>
          </div>
        ) : (
          <div className="flex flex-col h-full min-h-0">
            <div className="flex items-center gap-2 px-4 py-2 border-b overflow-x-auto">
              <Button variant="ghost" size="sm" onClick={() => { setFolderPath([]); loadFolderContents(null); }} className="shrink-0">
                <HardDrive className="h-4 w-4 mr-1" /> My Drive
              </Button>
              {folderPath.map((f, i) => (
                <div key={f.id} className="flex items-center shrink-0">
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  <Button variant="ghost" size="sm" onClick={() => {
                    const newPath = folderPath.slice(0, i + 1);
                    setFolderPath(newPath);
                    loadFolderContents(newPath[newPath.length - 1].id);
                  }}>{f.name}</Button>
                </div>
              ))}
            </div>

            {folderPath.length > 0 && (
              <div className="px-4 py-2 border-b">
                <Button variant="ghost" size="sm" onClick={() => {
                  const newPath = [...folderPath]; newPath.pop();
                  setFolderPath(newPath);
                  loadFolderContents(newPath.length > 0 ? newPath[newPath.length - 1].id : null);
                }}>
                  <ArrowLeft className="h-4 w-4 mr-1" /> Back
                </Button>
              </div>
            )}

            <ScrollArea className="flex-1 min-h-0">
              {loading ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : folders.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Folder className="h-12 w-12 text-muted-foreground" />
                  <p className="text-muted-foreground text-sm">No subfolders here</p>
                </div>
              ) : (
                <div className="p-4 space-y-2">
                  <p className="text-xs text-muted-foreground px-1">Tap a folder to drill in, or "Link this folder" to sync it</p>
                  {folders.map((folder) => (
                    <Card key={folder.id} className="hover:bg-accent/50 transition-colors">
                      <CardContent className="p-3 flex items-center gap-3">
                        <Folder className="h-5 w-5 text-primary" />
                        <button
                          className="flex-1 text-left font-medium truncate"
                          onClick={() => {
                            setFolderPath([...folderPath, { id: folder.id, name: folder.name }]);
                            loadFolderContents(folder.id);
                          }}
                        >
                          {folder.name}
                        </button>
                        <Button size="sm" disabled={linking} onClick={() => linkFolder(folder)}>
                          {linking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3 mr-1" />}
                          Link
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </ScrollArea>

            {folderPath.length > 0 && (
              <div className="border-t p-3">
                <Button
                  className="w-full"
                  disabled={linking}
                  onClick={() => {
                    const current = folderPath[folderPath.length - 1];
                    linkFolder({ id: current.id, name: current.name, mimeType: 'application/vnd.google-apps.folder' });
                  }}
                >
                  {linking ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
                  Link this folder ({folderPath[folderPath.length - 1].name})
                </Button>
              </div>
            )}
          </div>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
