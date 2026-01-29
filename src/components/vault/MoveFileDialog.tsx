import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { FolderOpen, ChevronRight, Home, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { supabase } from "@/integrations/supabase/client";

interface MoveFileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  file: { id: string; name: string; folder_id: string | null } | null;
  teamId?: string | null;
  clubId?: string | null;
  onMove: (fileId: string, targetFolderId: string | null) => void;
  isMoving?: boolean;
}

export function MoveFileDialog({
  open,
  onOpenChange,
  file,
  teamId,
  clubId,
  onMove,
  isMoving = false,
}: MoveFileDialogProps) {
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  // Fetch all folders for this team/club
  const { data: folders, isLoading } = useQuery({
    queryKey: ["vault-folders-for-move", teamId, clubId],
    queryFn: async () => {
      let query = supabase
        .from("vault_folders")
        .select("id, name, parent_id")
        .order("name");

      if (teamId) {
        query = query.eq("team_id", teamId);
      } else if (clubId) {
        query = query.eq("club_id", clubId).is("team_id", null);
      }

      const { data } = await query;
      return data || [];
    },
    enabled: open && (!!teamId || !!clubId),
  });

  type Folder = { id: string; name: string; parent_id: string | null };
  type FolderTree = {
    folderMap: Map<string | null, Folder[]>;
    rootFolders: Folder[];
  };

  // Build folder tree structure
  const folderTree = useMemo((): FolderTree => {
    if (!folders) return { folderMap: new Map(), rootFolders: [] };

    const folderMap = new Map<string | null, Folder[]>();
    
    // Group folders by parent_id
    folders.forEach(folder => {
      const parentId = folder.parent_id;
      if (!folderMap.has(parentId)) {
        folderMap.set(parentId, []);
      }
      folderMap.get(parentId)!.push(folder);
    });

    return { folderMap, rootFolders: folderMap.get(null) || [] };
  }, [folders]);

  const toggleExpanded = (folderId: string) => {
    setExpandedFolders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(folderId)) {
        newSet.delete(folderId);
      } else {
        newSet.add(folderId);
      }
      return newSet;
    });
  };

  const handleMove = () => {
    if (file) {
      onMove(file.id, selectedFolderId);
    }
  };

  const renderFolder = (folder: { id: string; name: string; parent_id: string | null }, level: number = 0) => {
    const childFolders = folderTree.folderMap?.get(folder.id) || [];
    const hasChildren = childFolders.length > 0;
    const isExpanded = expandedFolders.has(folder.id);
    const isSelected = selectedFolderId === folder.id;
    const isCurrentFolder = file?.folder_id === folder.id;

    return (
      <div key={folder.id}>
        <div
          className={`flex items-center gap-2 py-2 px-3 rounded-lg cursor-pointer transition-colors ${
            isSelected
              ? "bg-primary text-primary-foreground"
              : isCurrentFolder
              ? "bg-muted/50 text-muted-foreground cursor-not-allowed"
              : "hover:bg-muted"
          }`}
          style={{ paddingLeft: `${12 + level * 20}px` }}
          onClick={() => {
            if (!isCurrentFolder) {
              setSelectedFolderId(folder.id);
            }
          }}
        >
          {hasChildren && (
            <button
              className="p-0.5 -ml-1 hover:bg-background/20 rounded"
              onClick={(e) => {
                e.stopPropagation();
                toggleExpanded(folder.id);
              }}
            >
              <ChevronRight
                className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-90" : ""}`}
              />
            </button>
          )}
          {!hasChildren && <div className="w-4" />}
          <FolderOpen className={`h-4 w-4 ${isSelected ? "text-primary-foreground" : "text-muted-foreground"}`} />
          <span className="text-sm truncate flex-1">{folder.name}</span>
          {isCurrentFolder && (
            <span className="text-xs opacity-70">(current)</span>
          )}
        </div>
        {hasChildren && isExpanded && (
          <div>
            {childFolders.map(child => renderFolder(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  const isRootSelected = selectedFolderId === null;
  const isCurrentlyAtRoot = file?.folder_id === null;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Move "{file?.name}"</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <div className="py-4">
          <p className="text-sm text-muted-foreground mb-4">
            Select a destination folder
          </p>

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="max-h-[300px] overflow-y-auto space-y-1 border rounded-lg p-2">
              {/* Root option (no folder) */}
              <div
                className={`flex items-center gap-2 py-2 px-3 rounded-lg cursor-pointer transition-colors ${
                  isRootSelected
                    ? "bg-primary text-primary-foreground"
                    : isCurrentlyAtRoot
                    ? "bg-muted/50 text-muted-foreground cursor-not-allowed"
                    : "hover:bg-muted"
                }`}
                onClick={() => {
                  if (!isCurrentlyAtRoot) {
                    setSelectedFolderId(null);
                  }
                }}
              >
                <Home className={`h-4 w-4 ${isRootSelected ? "text-primary-foreground" : "text-muted-foreground"}`} />
                <span className="text-sm font-medium">Root (No Folder)</span>
                {isCurrentlyAtRoot && (
                  <span className="text-xs opacity-70 ml-auto">(current)</span>
                )}
              </div>

              {/* Folder tree */}
              {folderTree.rootFolders?.map(folder => renderFolder(folder, 0))}

              {(!folders || folders.length === 0) && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No folders available
                </p>
              )}
            </div>
          )}
        </div>

        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isMoving}>
            Cancel
          </Button>
          <Button
            onClick={handleMove}
            disabled={
              isMoving ||
              (selectedFolderId === file?.folder_id) ||
              (selectedFolderId === null && file?.folder_id === null)
            }
          >
            {isMoving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Moving...
              </>
            ) : (
              "Move Here"
            )}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
