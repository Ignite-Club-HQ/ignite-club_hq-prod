import { useState, useCallback, useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { HardDrive, Folder, FileText, Image, Loader2, ChevronRight, ChevronLeft, Check, ArrowLeft, X, RefreshCw, UserCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  createdTime?: string;
}

interface SelectedDriveFile {
  file: DriveFile;
  folderPath: string;
}

interface SelectedDriveFolder {
  folder: DriveFile;
  folderPath: string;
}

interface GoogleDriveImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportComplete: () => void;
  targetFolderId: string | null;
  targetTeamId: string | null;
  targetClubId: string;
}

export function GoogleDriveImportDialog({
  open,
  onOpenChange,
  onImportComplete,
  targetFolderId,
  targetTeamId,
  targetClubId,
}: GoogleDriveImportDialogProps) {
  const [step, setStep] = useState<"connect" | "browse" | "importing">("connect");
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [googleEmail, setGoogleEmail] = useState<string | null>(null);
  const [folders, setFolders] = useState<DriveFile[]>([]);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [folderPath, setFolderPath] = useState<{ id: string; name: string }[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Map<string, SelectedDriveFile>>(new Map());
  const [selectedFolders, setSelectedFolders] = useState<Map<string, SelectedDriveFolder>>(new Map());
  const [keepInSync, setKeepInSync] = useState(true);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0, currentFile: "" });

  // Get the redirect URI based on current origin
  // On native platforms, use production URL since the system browser handles OAuth
  const getRedirectUri = useCallback(() => {
    if (Capacitor.isNativePlatform()) {
      return 'https://igniteclubhq.app/vault';
    }
    return `${window.location.origin}/vault`;
  }, []);

  // Check for stored access token on open (from redirect flow)
  useEffect(() => {
    if (open) {
      const storedToken = sessionStorage.getItem('googleDriveAccessToken');
      const storedRefresh = sessionStorage.getItem('googleDriveRefreshToken');
      const storedEmail = sessionStorage.getItem('googleDriveGoogleEmail');
      if (storedToken) {
        sessionStorage.removeItem('googleDriveAccessToken');
        sessionStorage.removeItem('googleDriveRefreshToken');
        sessionStorage.removeItem('googleDriveGoogleEmail');
        setAccessToken(storedToken);
        setRefreshToken(storedRefresh);
        setGoogleEmail(storedEmail);
        setStep("browse");
        loadFolderContents(null, storedToken);
      }
    }
  }, [open]);

  // Clean up on close
  useEffect(() => {
    if (!open) {
      setStep("connect");
      setAccessToken(null);
      setRefreshToken(null);
      setGoogleEmail(null);
      setFolders([]);
      setFiles([]);
      setCurrentFolderId(null);
      setFolderPath([]);
      setSelectedFiles(new Map());
      setSelectedFolders(new Map());
      setKeepInSync(true);
      setImporting(false);
      setImportProgress({ current: 0, total: 0, currentFile: "" });
    }
  }, [open]);

  const startOAuth = async () => {
    try {
      setLoading(true);
      
      // Clear any stale tokens before starting new auth
      sessionStorage.removeItem('googleDriveAccessToken');
      sessionStorage.removeItem('googleDriveRefreshToken');
      sessionStorage.removeItem('googleDriveGoogleEmail');
      sessionStorage.removeItem('googleDriveImportPending');
      
      const { data, error } = await supabase.functions.invoke('google-drive-import?action=get-auth-url', {
        body: { redirectUri: getRedirectUri() },
      });

      if (error || data?.error) {
        throw new Error(data?.error || error?.message || 'Failed to get auth URL');
      }

      // Store state in sessionStorage to resume after redirect
      sessionStorage.setItem('googleDriveImportPending', JSON.stringify({
        targetFolderId,
        targetTeamId,
        targetClubId,
      }));

      // On native, open system browser for OAuth; on web, redirect
      if (Capacitor.isNativePlatform()) {
        import("@/lib/safeOpenUrl").then(({ safeOpenUrl }) => safeOpenUrl(data.authUrl));
      } else {
        window.location.href = data.authUrl;
      }

    } catch (err) {
      console.error("OAuth start error:", err);
      toast.error("Failed to start Google authentication");
      setLoading(false);
    }
  };

  const loadFolderContents = async (folderId: string | null, token?: string) => {
    try {
      setLoading(true);
      const tokenToUse = token || accessToken;
      
      const { data, error } = await supabase.functions.invoke('google-drive-import?action=list-files', {
        body: { 
          accessToken: tokenToUse,
          folderId: folderId || undefined,
        },
      });

      if (error || data?.error) {
        throw new Error(data?.error || error?.message || 'Failed to load files');
      }

      setFolders(data.folders || []);
      setFiles(data.files || []);
      setCurrentFolderId(folderId);
    } catch (err) {
      console.error("Load folder error:", err);
      toast.error("Failed to load Drive contents");
    } finally {
      setLoading(false);
    }
  };

  const navigateToFolder = async (folder: DriveFile) => {
    setFolderPath([...folderPath, { id: folder.id, name: folder.name }]);
    await loadFolderContents(folder.id);
  };

  const navigateBack = async () => {
    if (folderPath.length > 0) {
      const newPath = [...folderPath];
      newPath.pop();
      setFolderPath(newPath);
      const parentId = newPath.length > 0 ? newPath[newPath.length - 1].id : null;
      await loadFolderContents(parentId);
    }
  };

  const navigateToPath = async (index: number) => {
    const newPath = folderPath.slice(0, index + 1);
    setFolderPath(newPath);
    const folderId = newPath.length > 0 ? newPath[newPath.length - 1].id : null;
    await loadFolderContents(folderId);
  };

  const getCurrentDrivePath = useCallback(() => folderPath.map((folder) => folder.name).join('/'), [folderPath]);

  const toggleFileSelection = (file: DriveFile) => {
    const newMap = new Map(selectedFiles);
    if (newMap.has(file.id)) {
      newMap.delete(file.id);
    } else {
      newMap.set(file.id, { file, folderPath: getCurrentDrivePath() });
    }
    setSelectedFiles(newMap);
  };

  const toggleFolderSelection = (folder: DriveFile) => {
    const newMap = new Map(selectedFolders);
    if (newMap.has(folder.id)) {
      newMap.delete(folder.id);
    } else {
      const currentPath = getCurrentDrivePath();
      const folderImportPath = [currentPath, folder.name].filter(Boolean).join('/');
      newMap.set(folder.id, { folder, folderPath: folderImportPath });
    }
    setSelectedFolders(newMap);
  };

  const selectAll = () => {
    const currentPath = getCurrentDrivePath();
    const nextFiles = new Map(selectedFiles);
    const nextFolders = new Map(selectedFolders);
    files.forEach((file) => nextFiles.set(file.id, { file, folderPath: currentPath }));
    folders.forEach((folder) => {
      const folderImportPath = [currentPath, folder.name].filter(Boolean).join('/');
      nextFolders.set(folder.id, { folder, folderPath: folderImportPath });
    });
    setSelectedFiles(nextFiles);
    setSelectedFolders(nextFolders);
  };

  const deselectAll = () => {
    setSelectedFiles(new Map());
    setSelectedFolders(new Map());
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType.startsWith('image/')) return <Image className="h-4 w-4 text-primary" />;
    if (mimeType === 'application/vnd.google-apps.folder') return <Folder className="h-4 w-4 text-primary" />;
    return <FileText className="h-4 w-4 text-muted-foreground" />;
  };

  const startImport = async () => {
    if (selectedFiles.size === 0 && selectedFolders.size === 0) {
      toast.error("Please select files or folders to import");
      return;
    }

    setStep("importing");
    setImporting(true);

    try {
      // Collect all files to import (including from selected folders)
      const filesToImport: { file: DriveFile; folderPath: string }[] = [];
      
      // Add directly selected files
      for (const { file, folderPath: relativePath } of selectedFiles.values()) {
        filesToImport.push({ file, folderPath: relativePath });
      }

      // Recursively collect files from selected folders
      for (const { folder, folderPath: relativePath } of selectedFolders.values()) {
        await collectFolderFiles(folder.id, relativePath, filesToImport);
      }

      setImportProgress({ current: 0, total: filesToImport.length, currentFile: "" });

      // Resolve user once up-front so failed inserts don't silently no-op
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) {
        toast.error("You must be signed in to import files");
        setImporting(false);
        return;
      }

      // Process each file
      let successCount = 0;
      const failures: { name: string; reason: string }[] = [];
      const folderCache: Record<string, string> = {}; // path -> folder_id mapping

      for (let i = 0; i < filesToImport.length; i++) {
        const { file, folderPath: relativePath } = filesToImport[i];
        setImportProgress({ current: i + 1, total: filesToImport.length, currentFile: file.name });

        try {
          // Ensure folder structure exists
          let uploadFolderId = targetFolderId;
          if (relativePath) {
            uploadFolderId = await ensureFolderPath(relativePath, folderCache);
          }

          // Download file from Drive
          const { data: downloadData, error: downloadError } = await supabase.functions.invoke('google-drive-import?action=download-file', {
            body: {
              accessToken,
              fileId: file.id,
              mimeType: file.mimeType,
              fileName: file.name,
            },
          });

          if (downloadError || downloadData?.error) {
            const reason = downloadData?.error || downloadError?.message || "Download failed";
            console.error(`Failed to download ${file.name}:`, reason);
            failures.push({ name: file.name, reason });
            continue;
          }

          // Convert base64 to blob
          const binaryString = atob(downloadData.data);
          const bytes = new Uint8Array(binaryString.length);
          for (let j = 0; j < binaryString.length; j++) {
            bytes[j] = binaryString.charCodeAt(j);
          }

          // Determine file extension and name
          let fileName = file.name;
          let contentType = file.mimeType;

          if (downloadData.exportedMimeType) {
            contentType = downloadData.exportedMimeType;
            // Add appropriate extension for exported Google docs
            if (downloadData.exportedMimeType === 'application/pdf' && !fileName.endsWith('.pdf')) {
              fileName += '.pdf';
            } else if (downloadData.exportedMimeType.includes('spreadsheet') && !fileName.endsWith('.xlsx')) {
              fileName += '.xlsx';
            }
          }

          const blob = new Blob([bytes], { type: contentType });

          // Upload to Supabase storage using the same vault-only storage path
          // as standard Vault uploads so Drive imports never create Media posts.
          const timestamp = Date.now();
          const randomSuffix = Math.random().toString(36).substring(7);
          const safeExt = fileName.split('.').pop() || 'bin';
          let storagePath: string;
          if (targetTeamId) {
            storagePath = `clubs/${targetClubId}/teams/${targetTeamId}/${userId}/${timestamp}-${randomSuffix}.${safeExt}`;
          } else {
            storagePath = `clubs/${targetClubId}/${userId}/${timestamp}-${randomSuffix}.${safeExt}`;
          }

          const { error: uploadError } = await supabase.storage
            .from('photos')
            .upload(storagePath, blob, { contentType });

          if (uploadError) {
            console.error(`Failed to upload ${file.name}:`, uploadError);
            failures.push({ name: file.name, reason: uploadError.message });
            continue;
          }

          // Store the storage URL; the vault resolves signed URLs on demand.
          const supabaseUrl = "https://yabcfiuntwqjwvschnji.supabase.co";
          const fileUrl = `${supabaseUrl}/storage/v1/object/public/photos/${storagePath}`;

          // Always insert into vault_files so the file appears in the Vault.
          // Images are still classified as photos by the vault UI via file_type,
          // but they live in vault_files rather than the public media gallery.
          const { error: insertError } = await supabase.from('vault_files').insert({
            file_url: fileUrl,
            name: fileName,
            club_id: targetClubId,
            team_id: targetTeamId,
            folder_id: uploadFolderId,
            uploaded_by: userId,
            file_size: downloadData.size ?? blob.size,
            file_type: contentType,
            drive_file_id: file.id,
            drive_modified_time: file.createdTime ?? null,
          });

          if (insertError) {
            console.error(`Failed to record ${file.name} in vault:`, insertError);
            failures.push({ name: file.name, reason: insertError.message });
            continue;
          }

          successCount++;
        } catch (fileError: any) {
          const reason = fileError?.message || "Unknown error";
          console.error(`Error processing ${file.name}:`, fileError);
          failures.push({ name: file.name, reason });
        }
      }

      if (successCount > 0) {
        toast.success(`Imported ${successCount} of ${filesToImport.length} file${filesToImport.length === 1 ? '' : 's'} to your vault`);
      }
      if (failures.length > 0) {
        const preview = failures.slice(0, 3).map((f) => `• ${f.name}: ${f.reason}`).join('\n');
        const more = failures.length > 3 ? `\n…and ${failures.length - 3} more` : '';
        toast.error(`${failures.length} file${failures.length === 1 ? '' : 's'} failed to import`, {
          description: `${preview}${more}`,
          duration: 8000,
        });
      } else if (successCount === 0) {
        toast.error("No files were imported");
      }

      // If "Keep in sync" is enabled, register a vault_drive_link for each
      // selected top-level Drive folder so the background sync job picks
      // up future additions/updates without the user needing a separate
      // "Link folder" step.
      if (keepInSync && selectedFolders.size > 0) {
        if (!refreshToken) {
          toast.warning(
            "Couldn't enable auto-sync — Google didn't return a refresh token. Tap 'Switch Account' and re-approve to enable sync.",
            { duration: 7000 }
          );
        } else {
          let linkedCount = 0;
          for (const { folder, folderPath: relativePath } of selectedFolders.values()) {
            // The folder cache key for a top-level selected folder is just its
            // name (see collectFolderFiles + ensureFolderPath). If the folder
            // contained no importable files the cache entry won't exist yet —
            // create the vault folder now so the sync link points at the right
            // destination.
            let vaultFolderId = folderCache[relativePath];
            if (!vaultFolderId) {
              vaultFolderId = (await ensureFolderPath(relativePath, folderCache)) ?? targetFolderId ?? undefined as any;
            }
            if (!vaultFolderId) continue;
            try {
              // Tag the vault folder with its Drive id (best-effort).
              await supabase
                .from('vault_folders')
                .update({ drive_folder_id: folder.id })
                .eq('id', vaultFolderId);

              const { error: linkErr } = await supabase
                .from('vault_drive_links')
                .insert({
                  club_id: targetClubId,
                  team_id: targetTeamId,
                  vault_folder_id: vaultFolderId,
                  drive_folder_id: folder.id,
                  drive_folder_name: folder.name,
                  refresh_token: refreshToken,
                  google_account_email: googleEmail,
                  created_by: userId,
                });
              if (linkErr) {
                // Duplicate = already linked; treat as success silently.
                if (!String(linkErr.message || '').toLowerCase().includes('duplicate')) {
                  console.error(`Failed to link ${folder.name} for sync:`, linkErr);
                }
              } else {
                linkedCount++;
              }
            } catch (e) {
              console.error(`Sync link error for ${folder.name}:`, e);
            }
          }
          if (linkedCount > 0) {
            toast.success(
              `Auto-sync enabled for ${linkedCount} folder${linkedCount === 1 ? '' : 's'} — new files in Drive will appear here automatically.`
            );
          }
        }
      }

      onImportComplete();
      onOpenChange(false);

    } catch (err) {
      console.error("Import error:", err);
      toast.error("Import failed");
    } finally {
      setImporting(false);
    }
  };

  const collectFolderFiles = async (
    folderId: string, 
    pathPrefix: string, 
    collected: { file: DriveFile; folderPath: string }[]
  ) => {
    try {
      const { data, error } = await supabase.functions.invoke('google-drive-import?action=list-files', {
        body: { 
          accessToken,
          folderId,
        },
      });

      if (error || data?.error) {
        const reason = data?.error || error?.message || 'unknown error';
        console.error(`collectFolderFiles: failed to list folder ${folderId} (${pathPrefix}): ${reason}`);
        toast.error(`Couldn't list "${pathPrefix || 'folder'}"`, { description: reason });
        return;
      }

      const folderFiles = (data?.files ?? []) as DriveFile[];
      const subfolders = (data?.folders ?? []) as DriveFile[];
      console.log(`collectFolderFiles: ${pathPrefix || '(root)'} -> ${folderFiles.length} files, ${subfolders.length} subfolders`);

      // Add files from this folder
      for (const file of folderFiles) {
        collected.push({ file, folderPath: pathPrefix });
      }

      // Recursively process subfolders
      for (const subfolder of subfolders) {
        await collectFolderFiles(subfolder.id, `${pathPrefix}/${subfolder.name}`, collected);
      }
    } catch (err) {
      console.error("Error collecting folder files:", err);
    }
  };

  const ensureFolderPath = async (relativePath: string, cache: Record<string, string>): Promise<string | null> => {
    if (cache[relativePath]) {
      return cache[relativePath];
    }

    const parts = relativePath.split('/').filter(Boolean);
    let parentId = targetFolderId;

    for (let i = 0; i < parts.length; i++) {
      const partPath = parts.slice(0, i + 1).join('/');

      if (cache[partPath]) {
        parentId = cache[partPath];
        continue;
      }

      const folderName = parts[i];

      // Look up an existing folder with the same name UNDER THE CORRECT PARENT
      // and matching team scope. Without these filters every subfolder with the
      // same name would collapse onto the first match and the Drive structure
      // would be lost on import.
      const { data: candidateFolders } = await supabase
        .from('vault_folders')
        .select('id, parent_id, team_id')
        .eq('name', folderName)
        .eq('club_id', targetClubId);

      const existing = (candidateFolders ?? []).find((f) => {
        const parentMatches = parentId
          ? f.parent_id === parentId
          : f.parent_id === null;
        const teamMatches = targetTeamId
          ? f.team_id === targetTeamId
          : f.team_id === null;
        return parentMatches && teamMatches;
      });

      if (existing) {
        cache[partPath] = existing.id;
        parentId = existing.id;
      } else {
        // Create folder
        const userId = (await supabase.auth.getUser()).data.user?.id;
        const { data: newFolder, error } = await supabase
          .from('vault_folders')
          .insert({
            name: folderName,
            club_id: targetClubId,
            team_id: targetTeamId,
            parent_id: parentId,
            created_by: userId,
          })
          .select('id')
          .single();

        if (error || !newFolder) {
          console.error("Failed to create folder:", error);
          return parentId;
        }

        cache[partPath] = newFolder.id;
        parentId = newFolder.id;
      }
    }

    return parentId;
  };

  const selectedCount = selectedFiles.size + selectedFolders.size;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-2xl" fullScreen={step === "browse"}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <HardDrive className="h-5 w-5" />
            Import from Google Drive
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        {step === "connect" && (
          <div className="py-8 flex flex-col items-center gap-6">
            <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
              <HardDrive className="h-10 w-10 text-primary" />
            </div>
            <div className="text-center space-y-2">
              <p className="font-medium">Connect your Google Drive</p>
              <p className="text-sm text-muted-foreground">
                Sign in to browse and import files from your Drive
              </p>
            </div>
            <Button onClick={startOAuth} disabled={loading} size="lg">
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <HardDrive className="h-4 w-4 mr-2" />
                  Connect Google Drive
                </>
              )}
            </Button>
          </div>
        )}

        {step === "browse" && (
          <div className="flex flex-col h-full min-h-0">
            {/* Breadcrumb navigation */}
            <div className="flex items-center gap-2 px-4 py-2 border-b overflow-x-auto">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFolderPath([]);
                  loadFolderContents(null);
                }}
                className="shrink-0"
              >
                <HardDrive className="h-4 w-4 mr-1" />
                My Drive
              </Button>
              {folderPath.map((folder, index) => (
                <div key={folder.id} className="flex items-center shrink-0">
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigateToPath(index)}
                  >
                    {folder.name}
                  </Button>
                </div>
              ))}
            </div>

            {/* Selection toolbar */}
            <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
              <div className="flex items-center gap-2">
                {folderPath.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={navigateBack}>
                    <ArrowLeft className="h-4 w-4 mr-1" />
                    Back
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => loadFolderContents(currentFolderId)}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => {
                    setAccessToken(null);
                    setRefreshToken(null);
                    setGoogleEmail(null);
                    setStep("connect");
                    setFolders([]);
                    setFiles([]);
                    setCurrentFolderId(null);
                    setFolderPath([]);
                    setSelectedFiles(new Set());
                    setSelectedFolders(new Set());
                  }}
                  className="text-muted-foreground"
                >
                  <UserCircle className="h-4 w-4 mr-1" />
                  Switch Account
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={selectAll}>
                  Select All
                </Button>
                {selectedCount > 0 && (
                  <Button variant="ghost" size="sm" onClick={deselectAll}>
                    Clear ({selectedCount})
                  </Button>
                )}
              </div>
            </div>

            {/* File list */}
            <ScrollArea className="flex-1 min-h-0">
              {loading ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-muted-foreground">Loading...</p>
                </div>
              ) : folders.length === 0 && files.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Folder className="h-12 w-12 text-muted-foreground" />
                  <p className="text-muted-foreground">This folder is empty</p>
                </div>
              ) : (
                <div className="p-4 space-y-1">
                  {/* Folders */}
                  {folders.map((folder) => (
                    <Card
                      key={folder.id}
                      className={`cursor-pointer transition-colors ${
                        selectedFolders.has(folder.id) ? 'border-primary bg-primary/5' : 'hover:bg-accent/50'
                      }`}
                    >
                      <CardContent className="p-3 flex items-center gap-3">
                        <Checkbox
                          checked={selectedFolders.has(folder.id)}
                          onCheckedChange={() => toggleFolderSelection(folder.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <div
                          className="flex items-center gap-3 flex-1"
                          onClick={() => navigateToFolder(folder)}
                        >
                          <Folder className="h-5 w-5 text-primary" />
                          <span className="font-medium">{folder.name}</span>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </CardContent>
                    </Card>
                  ))}

                  {/* Files */}
                  {files.map((file) => (
                    <Card
                      key={file.id}
                      className={`cursor-pointer transition-colors ${
                        selectedFiles.has(file.id) ? 'border-primary bg-primary/5' : 'hover:bg-accent/50'
                      }`}
                      onClick={() => toggleFileSelection(file.id)}
                    >
                      <CardContent className="p-3 flex items-center gap-3">
                        <Checkbox
                          checked={selectedFiles.has(file.id)}
                          onCheckedChange={() => toggleFileSelection(file.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        {getFileIcon(file.mimeType)}
                        <span className="flex-1 truncate">{file.name}</span>
                        {file.size && (
                          <span className="text-xs text-muted-foreground">
                            {formatBytes(parseInt(file.size))}
                          </span>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </ScrollArea>

            {/* Footer with import button */}
            <div className="border-t p-4 space-y-3">
              {selectedFolders.size > 0 && (
                <label className="flex items-start gap-2 cursor-pointer">
                  <Checkbox
                    checked={keepInSync}
                    onCheckedChange={(v) => setKeepInSync(v === true)}
                    disabled={!refreshToken}
                    className="mt-0.5"
                  />
                  <span className="text-sm">
                    <span className="font-medium">Keep in sync</span>
                    <span className="text-muted-foreground">
                      {' '}— automatically import new and updated files added to{' '}
                      {selectedFolders.size === 1 ? 'this folder' : 'these folders'} in Drive.
                    </span>
                    {!refreshToken && (
                      <span className="block text-xs text-amber-600 mt-1">
                        Tap "Switch Account" and re-approve to enable auto-sync.
                      </span>
                    )}
                  </span>
                </label>
              )}
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {selectedCount} item{selectedCount !== 1 ? 's' : ''} selected
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => onOpenChange(false)}>
                    Cancel
                  </Button>
                  <Button onClick={startImport} disabled={selectedCount === 0}>
                    <Check className="h-4 w-4 mr-2" />
                    Import {selectedCount > 0 ? `(${selectedCount})` : ''}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {step === "importing" && (
          <div className="py-8 flex flex-col items-center gap-6">
            <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
              <Loader2 className="h-10 w-10 text-primary animate-spin" />
            </div>
            <div className="text-center space-y-2 w-full px-4">
              <p className="font-medium">Importing files...</p>
              <p className="text-sm text-muted-foreground truncate">
                {importProgress.currentFile || "Preparing..."}
              </p>
              <div className="mt-4">
                <Progress 
                  value={importProgress.total > 0 ? (importProgress.current / importProgress.total) * 100 : 0} 
                  className="h-2"
                />
                <p className="text-xs text-muted-foreground mt-2">
                  {importProgress.current} of {importProgress.total} files
                </p>
              </div>
            </div>
          </div>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
