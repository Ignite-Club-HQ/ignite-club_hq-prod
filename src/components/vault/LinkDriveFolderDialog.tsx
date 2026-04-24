import { useState, useCallback, useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { HardDrive, Folder, Loader2, ChevronRight, ArrowLeft, Check, Link as LinkIcon, RefreshCw, Trash2, Power, AlertTriangle, RotateCw } from "lucide-react";
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

interface FailedFileRef {
  drive_file_id: string;
  vault_folder_id: string;
  name?: string;
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
  last_failed_files: FailedFileRef[];
}

const LINK_SELECT = 'id, drive_folder_name, google_account_email, sync_enabled, last_synced_at, last_sync_status, last_sync_error, files_imported_count, files_updated_count, last_failed_files';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The vault folder that the Drive folder will sync into. Pass `null` to link
   * at the club vault root — the dialog will then prompt the user to either
   * pick an existing top-level folder or auto-create a new wrapper folder
   * (named after the chosen Drive folder by default). This handles Drive
   * folders that have loose files at the top level alongside subfolders.
   */
  vaultFolderId: string | null;
  clubId: string;
  teamId: string | null;
  onChanged: () => void;
}

interface RootFolderOption {
  id: string;
  name: string;
}

export function LinkDriveFolderDialog({ open, onOpenChange, vaultFolderId, clubId, teamId, onChanged }: Props) {
  const [existing, setExisting] = useState<ExistingLink | null>(null);
  const [checkingExisting, setCheckingExisting] = useState(true);
  // "destination" only used when vaultFolderId is null (root link) — lets the
  // user choose where in the vault the Drive folder should be mirrored.
  const [step, setStep] = useState<"connect" | "browse" | "destination">("connect");
  const [pendingDriveFolder, setPendingDriveFolder] = useState<DriveFolder | null>(null);
  const [rootFolders, setRootFolders] = useState<RootFolderOption[]>([]);
  const [destinationMode, setDestinationMode] = useState<"new" | "existing">("new");
  const [newFolderName, setNewFolderName] = useState("");
  const [selectedExistingId, setSelectedExistingId] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [googleEmail, setGoogleEmail] = useState<string | null>(null);
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [folderPath, setFolderPath] = useState<{ id: string; name: string }[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [linking, setLinking] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const getRedirectUri = useCallback(() => {
    if (Capacitor.isNativePlatform()) return 'https://igniteclubhq.app/vault';
    return `${window.location.origin}/vault`;
  }, []);

  // Check for existing link when opened
  const normalizeLink = (data: any): ExistingLink | null => {
    if (!data) return null;
    const raw = data.last_failed_files;
    const failed: FailedFileRef[] = Array.isArray(raw) ? raw as FailedFileRef[] : [];
    return { ...data, last_failed_files: failed } as ExistingLink;
  };

  useEffect(() => {
    if (!open) return;
    // Root-link mode: there's no single existing link to show — skip the lookup
    // and go straight to the connect/destination flow.
    if (!vaultFolderId) {
      setExisting(null);
      setCheckingExisting(false);
      return;
    }
    setCheckingExisting(true);
    supabase
      .from('vault_drive_links')
      .select(LINK_SELECT)
      .eq('vault_folder_id', vaultFolderId)
      .maybeSingle()
      .then(({ data }) => {
        setExisting(normalizeLink(data));
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
      setPendingDriveFolder(null);
      setRootFolders([]);
      setDestinationMode("new");
      setNewFolderName("");
      setSelectedExistingId(null);
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
        .select(LINK_SELECT)
        .eq('id', existing.id)
        .single();
      setExisting(normalizeLink(refreshed));
    } catch (err) {
      console.error(err);
      toast.error("Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const retryFailed = async () => {
    if (!existing || existing.last_failed_files.length === 0) return;
    try {
      setRetrying(true);
      const { data, error } = await supabase.functions.invoke('drive-folder-sync', {
        body: { linkId: existing.id, retryFailedOnly: true },
      });
      if (error) throw error;
      const r = data?.results?.[0];
      if (r?.status === 'error') {
        toast.error(`Retry failed: ${r.error}`);
      } else {
        const recovered = (r?.imported ?? 0) + (r?.updated ?? 0);
        const stillFailed = r?.failed ?? 0;
        if (stillFailed === 0) {
          toast.success(`Recovered all ${recovered} file(s)`);
        } else {
          toast.warning(`Recovered ${recovered}, still failing: ${stillFailed}`);
        }
      }
      onChanged();
      const { data: refreshed } = await supabase
        .from('vault_drive_links')
        .select(LINK_SELECT)
        .eq('id', existing.id)
        .single();
      setExisting(normalizeLink(refreshed));
    } catch (err) {
      console.error(err);
      toast.error("Retry failed");
    } finally {
      setRetrying(false);
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

            {existing.last_failed_files.length > 0 && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {existing.last_failed_files.length} file{existing.last_failed_files.length === 1 ? '' : 's'} failed last sync
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Retry only these — full sync isn't needed.
                    </p>
                    <ul className="mt-2 space-y-0.5 max-h-24 overflow-y-auto">
                      {existing.last_failed_files.slice(0, 5).map((f) => (
                        <li key={f.drive_file_id} className="text-xs text-muted-foreground truncate">
                          • {f.name ?? f.drive_file_id}
                        </li>
                      ))}
                      {existing.last_failed_files.length > 5 && (
                        <li className="text-xs text-muted-foreground">
                          + {existing.last_failed_files.length - 5} more
                        </li>
                      )}
                    </ul>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={retryFailed}
                  disabled={retrying || syncing}
                >
                  {retrying ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RotateCw className="h-4 w-4 mr-2" />}
                  Retry failed files
                </Button>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Button onClick={triggerManualSync} disabled={syncing || retrying}>
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
