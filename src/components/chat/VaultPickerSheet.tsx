import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Folder,
  FileText,
  FileImage,
  FileSpreadsheet,
  FileVideo,
  FileAudio,
  FileArchive,
  ChevronLeft,
  Search,
  Loader2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";

interface VaultPickerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clubId: string | null | undefined;
  teamId?: string | null;
  onPick: (
    item:
      | { kind: "file" | "folder"; id: string; name: string }
      | { kind: "root"; scope: "team" | "club"; id: string; name: string },
  ) => void;
}

interface VaultFolder {
  id: string;
  name: string;
  parent_id: string | null;
  team_id: string | null;
  club_id: string;
}

interface VaultFile {
  id: string;
  name: string;
  file_type: string | null;
  file_size: number | null;
  folder_id: string | null;
  team_id: string | null;
  club_id: string;
  is_external_link: boolean;
}

function getIconForFile(name: string, fileType: string | null) {
  const lower = (name || "").toLowerCase();
  const type = (fileType || "").toLowerCase();
  if (type.startsWith("image/") || /\.(jpe?g|png|gif|webp|svg|heic)$/i.test(lower)) return FileImage;
  if (type.startsWith("video/") || /\.(mp4|mov|avi|webm)$/i.test(lower)) return FileVideo;
  if (type.startsWith("audio/") || /\.(mp3|wav|m4a)$/i.test(lower)) return FileAudio;
  if (/\.(xls|xlsx|csv|ods)$/i.test(lower)) return FileSpreadsheet;
  if (/\.(zip|rar|7z|tar|gz)$/i.test(lower)) return FileArchive;
  return FileText;
}

export function VaultPickerSheet({ open, onOpenChange, clubId, teamId, onPick }: VaultPickerSheetProps) {
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [pathStack, setPathStack] = useState<{ id: string | null; name: string }[]>([
    { id: null, name: "Vault" },
  ]);
  const [search, setSearch] = useState("");

  // At the root, we offer a "share entire vault" card scoped to either the
  // team (when this is a team chat) or the whole club. Fetch the display name.
  const rootScope: "team" | "club" | null = teamId ? "team" : clubId ? "club" : null;
  const rootScopeId = teamId || clubId || null;
  const rootScopeQuery = useQuery({
    queryKey: ["vault-picker-root-name", rootScope, rootScopeId],
    queryFn: async () => {
      if (!rootScope || !rootScopeId) return null;
      if (rootScope === "team") {
        const { data, error } = await supabase
          .from("teams")
          .select("id, name")
          .eq("id", rootScopeId)
          .maybeSingle();
        if (error) throw error;
        return data?.name as string | null;
      }
      const { data, error } = await supabase
        .from("clubs")
        .select("id, name")
        .eq("id", rootScopeId)
        .maybeSingle();
      if (error) throw error;
      return data?.name as string | null;
    },
    enabled: open && !!rootScope && !!rootScopeId,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch folders in the current view
  const foldersQuery = useQuery({
    queryKey: ["vault-picker-folders", clubId, teamId, currentFolderId],
    queryFn: async () => {
      if (!clubId) return [] as VaultFolder[];
      let q = supabase
        .from("vault_folders")
        .select("id, name, parent_id, team_id, club_id")
        .eq("club_id", clubId)
        .order("name");

      if (currentFolderId) {
        q = q.eq("parent_id", currentFolderId);
      } else {
        q = q.is("parent_id", null);
        // At root, show club-wide folders plus this team's folders.
        if (teamId) {
          q = q.or(`team_id.is.null,team_id.eq.${teamId}`);
        }
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as VaultFolder[];
    },
    enabled: open && !!clubId,
    staleTime: 30 * 1000,
  });

  // Fetch files in the current folder
  const filesQuery = useQuery({
    queryKey: ["vault-picker-files", clubId, teamId, currentFolderId],
    queryFn: async () => {
      if (!clubId) return [] as VaultFile[];
      let q = supabase
        .from("vault_files")
        .select("id, name, file_type, file_size, folder_id, team_id, club_id, is_external_link")
        .eq("club_id", clubId)
        .is("deleted_at", null)
        .order("name");

      if (currentFolderId) {
        q = q.eq("folder_id", currentFolderId);
      } else {
        q = q.is("folder_id", null);
        if (teamId) {
          q = q.or(`team_id.is.null,team_id.eq.${teamId}`);
        }
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as VaultFile[];
    },
    enabled: open && !!clubId,
    staleTime: 30 * 1000,
  });

  const folders = foldersQuery.data || [];
  const files = filesQuery.data || [];

  const filteredFolders = useMemo(() => {
    if (!search.trim()) return folders;
    const s = search.toLowerCase();
    return folders.filter((f) => f.name.toLowerCase().includes(s));
  }, [folders, search]);

  const filteredFiles = useMemo(() => {
    if (!search.trim()) return files;
    const s = search.toLowerCase();
    return files.filter((f) => f.name.toLowerCase().includes(s));
  }, [files, search]);

  const enterFolder = (folder: VaultFolder) => {
    setCurrentFolderId(folder.id);
    setPathStack((prev) => [...prev, { id: folder.id, name: folder.name }]);
    setSearch("");
  };

  const goBack = () => {
    if (pathStack.length <= 1) return;
    const newStack = pathStack.slice(0, -1);
    setPathStack(newStack);
    setCurrentFolderId(newStack[newStack.length - 1].id);
    setSearch("");
  };

  const reset = () => {
    setCurrentFolderId(null);
    setPathStack([{ id: null, name: "Vault" }]);
    setSearch("");
  };

  const handleClose = (newOpen: boolean) => {
    if (!newOpen) reset();
    onOpenChange(newOpen);
  };

  const currentLabel = pathStack[pathStack.length - 1]?.name || "Vault";
  const isLoading = foldersQuery.isLoading || filesQuery.isLoading;
  const isEmpty = !isLoading && filteredFolders.length === 0 && filteredFiles.length === 0;

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent
        side="bottom"
        className="h-[85vh] max-h-[85vh] flex flex-col overflow-hidden p-0 gap-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <SheetHeader className="px-4 pt-4 pb-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            {pathStack.length > 1 && (
              <Button
                variant="ghost"
                size="icon"
                onClick={goBack}
                className="h-8 w-8 shrink-0"
                aria-label="Go back"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            )}
            <SheetTitle className="flex-1 text-left truncate text-base">
              {currentLabel}
            </SheetTitle>
          </div>
          <div className="relative mt-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search files and folders…"
              className="pl-9 pr-9"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 flex items-center justify-center rounded hover:bg-accent"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            )}
          </div>
        </SheetHeader>

        <div
          data-chat-scroll-lock="true"
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-2 py-2"
          style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}
        >
          {!clubId && (
            <div className="text-center py-12 text-sm text-muted-foreground">
              Vault unavailable in this chat.
            </div>
          )}

          {clubId && isLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Share entire team/club vault — only at root, not while searching */}
          {clubId && !isLoading && currentFolderId === null && !search.trim() && rootScope && rootScopeId && (
            <div className="mb-2">
              <button
                type="button"
                onClick={() =>
                  onPick({
                    kind: "root",
                    scope: rootScope,
                    id: rootScopeId,
                    name: rootScopeQuery.data || (rootScope === "team" ? "Team vault" : "Club vault"),
                  })
                }
                className="flex items-center gap-3 w-full px-3 py-3 rounded-lg border border-border bg-primary/5 hover:bg-primary/10 active:bg-primary/15 transition-colors text-left"
              >
                <div className="h-10 w-10 rounded-md bg-primary/15 flex items-center justify-center shrink-0">
                  <Folder className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground truncate">
                    Share entire {rootScope === "team" ? "team" : "club"} vault
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {rootScopeQuery.data || (rootScope === "team" ? "This team" : "This club")} · All files & folders
                  </p>
                </div>
                <span className="text-xs font-medium text-primary shrink-0">Share</span>
              </button>
            </div>
          )}

          {clubId && !isLoading && isEmpty && !(currentFolderId === null && !search.trim() && rootScope) && (
            <div className="text-center py-12 text-sm text-muted-foreground">
              {search ? "No matches found" : "This folder is empty"}
            </div>
          )}

          {clubId && !isLoading && filteredFolders.length > 0 && (
            <div className="space-y-1 mb-2">
              {filteredFolders.map((folder) => (
                <div
                  key={folder.id}
                  className="flex items-center gap-1 group"
                >
                  <button
                    type="button"
                    onClick={() => enterFolder(folder)}
                    className="flex items-center gap-3 flex-1 min-w-0 px-3 py-2.5 rounded-md hover:bg-accent active:bg-accent/80 transition-colors text-left"
                  >
                    <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                      <Folder className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">
                        {folder.name}
                      </p>
                      <p className="text-xs text-muted-foreground">Folder</p>
                    </div>
                  </button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      onPick({ kind: "folder", id: folder.id, name: folder.name })
                    }
                    className="h-8 px-3 text-xs shrink-0"
                  >
                    Share
                  </Button>
                </div>
              ))}
            </div>
          )}

          {clubId && !isLoading && filteredFiles.length > 0 && (
            <div className="space-y-1">
              {filteredFiles.map((file) => {
                const Icon = getIconForFile(file.name, file.file_type);
                return (
                  <button
                    key={file.id}
                    type="button"
                    onClick={() =>
                      onPick({ kind: "file", id: file.id, name: file.name })
                    }
                    className="flex items-center gap-3 w-full px-3 py-2.5 rounded-md hover:bg-accent active:bg-accent/80 transition-colors text-left"
                  >
                    <div className="h-9 w-9 rounded-md bg-muted flex items-center justify-center shrink-0 text-muted-foreground">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">
                        {file.name}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {file.is_external_link ? "External link" : "File"}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
