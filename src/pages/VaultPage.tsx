import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { getShareUrl } from "@/lib/shareUtils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { FolderOpen, FileText, Image, Lock, Crown, ChevronRight, ArrowLeft, Upload, Trash2, Download, ImageIcon, FolderPlus, Plus, Home, Pencil, FolderDown, Loader2, FileArchive, X, CheckSquare, Square, Share2, HardDrive, RotateCcw, ExternalLink, Sheet, FileSpreadsheet, Link2, CloudDownload, MoreVertical, RefreshCw, Search } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CreateFolderDialog } from "@/components/vault/CreateFolderDialog";
import { UploadFilesDialog } from "@/components/vault/UploadFilesDialog";
import { AddLinkDialog } from "@/components/vault/AddLinkDialog";
import { MoveFileDialog } from "@/components/vault/MoveFileDialog";
import { GoogleDriveImportDialog } from "@/components/vault/GoogleDriveImportDialog";
import { LinkDriveFolderDialog } from "@/components/vault/LinkDriveFolderDialog";
import JSZip from "jszip";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { format } from "date-fns";
import { getFolderColorClass } from "@/components/TeamFoldersManager";
import { VaultFolderCard } from "@/components/vault/VaultFolderCard";
import { VaultExportDialogs } from "@/components/vault/VaultExportDialogs";
import { VaultLargeFilesDialog } from "@/components/vault/VaultLargeFilesDialog";
import { VaultFolderExportDialog } from "@/components/vault/VaultFolderExportDialog";
import { VaultStoragePanel } from "@/components/vault/VaultStoragePanel";
import { VaultMutationConfirmationDialogs } from "@/components/vault/VaultMutationConfirmationDialogs";
import { VaultRenameDialogs } from "@/components/vault/VaultRenameDialogs";
import { VaultPhotoItem } from "@/components/vault/VaultPhotoItem";
import { resolveEmptyTrashOutcome } from "@/lib/vaultTrashOutcome";
import { fuzzyFilter } from "@/lib/fuzzySearch";
import { useDebounce } from "@/hooks/useDebounce";
import { HighlightedText } from "@/components/vault/HighlightedText";
import { PhotoLightbox } from "@/components/PhotoLightbox";
import { removePhotoFromCache } from "@/lib/mediaCache";
import { downloadImage } from "@/lib/downloadImage";
import { StoragePurchaseDialog } from "@/components/StoragePurchaseDialog";
import { useClubTheme } from "@/hooks/useClubTheme";
import { useSignedPhotoUrl } from "@/hooks/useSignedPhotoUrl";
import { permanentlyDeleteVaultItems } from "@/lib/vaultDelete";
import {
  permanentlyDeleteVaultTrash,
  softDeleteVaultSelection,
} from "@/features/vault/vaultBulkMutationService";
import {
  createVaultExternalLink,
  uploadVaultItem,
} from "@/features/vault/vaultUploadService";
import {
  exchangeVaultDriveOAuthCode,
  getVaultDriveRedirectUri,
  isVaultDriveEnabled,
  resolveVaultDriveTitles,
  storeVaultDriveOAuthTokens,
} from "@/features/vault/vaultDriveService";
import {
  collectVaultExportContents,
  fetchVaultExportFolderContents,
} from "@/features/vault/vaultExportRepository";
import {
  excludeVaultExportFolders,
  resolveSelectedVaultExportItems,
  selectAllVaultExportItems,
  summarizeVaultExport,
  toggleVaultExportSelection,
} from "@/features/vault/vaultExportSelection";
import {
  buildVaultZip,
  VAULT_EXPORT_CANCELLED_MESSAGE,
} from "@/features/vault/vaultExportService";
import {
  prepareVaultLargeFileDeletion,
  type VaultLargeFileItem,
  type VaultLargeFileSort,
} from "@/features/vault/vaultLargeFileManagement";
import { fetchVaultLargeFiles } from "@/features/vault/vaultLargeFileRepository";
import type { VaultFolderView } from "@/features/vault/types";
import {
  abbreviateVaultOrganisationName,
  collectVaultClubRoles,
  getVaultScope,
} from "@/features/vault/vaultScope";
import {
  canAccessVault as resolveCanAccessVault,
  getVaultAdminUpgradeInfo,
  getVaultTeamIds,
  hasVaultRoleAccess as resolveHasVaultRoleAccess,
  isVaultClubAdminOrCommittee,
  isVaultCoachOrTeamAdmin,
  resolveVaultContextPro,
} from "@/features/vault/vaultAccess";
import {
  fetchVaultAccessibleClubs,
  fetchVaultAnyProAccess,
  fetchVaultAppAdmin,
  fetchVaultClubHasPro,
  fetchVaultTeamHasPro,
  fetchVaultUserRoles,
} from "@/features/vault/vaultAccessRepository";
import {
  fetchVaultClubTeams,
  fetchVaultMiniLeagues,
  fetchVaultTeamFolders,
  resolveVaultFolderDeepLink,
  resolveVaultScopeDeepLink,
} from "@/features/vault/vaultNavigationRepository";
import {
  fetchVaultFolderTree,
  fetchVaultItems,
  fetchVaultSubfolders,
  fetchVaultTrash,
  isVaultImage,
  partitionVaultItems,
  searchVaultContents,
} from "@/features/vault/vaultReadRepository";
import {
  emptyVaultStorageBreakdown,
  fetchVaultStorageBreakdown,
  fetchVaultStorageSubscription,
} from "@/features/vault/vaultStorageRepository";
import {
  createVaultFolder,
  deleteVaultFolder,
  moveVaultFile,
  permanentlyDeleteVaultFile,
  permanentlyDeleteVaultPhoto,
  renameVaultFolder,
  renameVaultItem,
  restoreVaultItem,
  softDeleteVaultItem,
} from "@/features/vault/vaultMutationRepository";
import { summarizeVaultDeletion, buildVaultDeleteMessage } from "@/features/vault/vaultDeleteReporting";
import { runZipExport, summarizeZipExport, type ZipExportItem } from "@/features/vault/vaultZipExport";
import { vaultKeys } from "@/features/vault/vaultQueryKeys";
import {
  refreshVaultBulkDelete,
  refreshVaultFileStorage,
  refreshVaultFiles,
  refreshVaultFolders,
  refreshVaultImportedContent,
  refreshVaultPermanentDelete,
  refreshVaultRestore,
  refreshVaultUpload,
} from "@/features/vault/vaultCacheCompletion";


import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Sheet as UISheet,
  SheetContent as UISheetContent,
  SheetHeader as UISheetHeader,
  SheetTitle as UISheetTitle,
} from "@/components/ui/sheet";

export default function VaultPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { folderId: urlFolderId } = useParams<{ folderId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  // Capture once — subsequent setSearchParams({}, { replace: true }) calls
  // below wipe location.state, which would otherwise lose the fromChat flag
  // and break the header back button after opening from a chat's pinned vault.
  const [fromChat] = useState<boolean>(
    () => (location.state as { fromChat?: boolean } | null)?.fromChat === true,
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const { activeClubFilter } = useClubTheme();
  const [currentView, setCurrentView] = useState<VaultFolderView>({ type: "root" });
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [vaultSearchQuery, setVaultSearchQuery] = useState("");
  const debouncedVaultSearchQuery = useDebounce(vaultSearchQuery, 300);
  useEffect(() => { setVaultSearchQuery(""); }, [currentView]);

  const [uploadType, setUploadType] = useState<"photo" | "file">("photo");
  const [fileName, setFileName] = useState("");
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [deletePhotoId, setDeletePhotoId] = useState<string | null>(null);
  const [deleteFileId, setDeleteFileId] = useState<string | null>(null);
  const [restoreItemId, setRestoreItemId] = useState<string | null>(null);
  const [restoreItemType, setRestoreItemType] = useState<"photo" | "file">("photo");
  const [deleteFolderId, setDeleteFolderId] = useState<string | null>(null);
  const [newFolderDialogOpen, setNewFolderDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [folderPath, setFolderPath] = useState<{ id: string; name: string }[]>([]);
  const [renameFolderId, setRenameFolderId] = useState<string | null>(null);
  const [renameFolderName, setRenameFolderName] = useState("");
  const [renameFileId, setRenameFileId] = useState<string | null>(null);
  const [renameFileName, setRenameFileName] = useState("");
  const [renamePhotoId, setRenamePhotoId] = useState<string | null>(null);
  const [renamePhotoName, setRenamePhotoName] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState({ current: 0, total: 0 });
  const exportAbortController = useRef<AbortController | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set());
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [exportPreviewOpen, setExportPreviewOpen] = useState(false);
  const [exportPreviewData, setExportPreviewData] = useState<{
    photos: any[];
    files: any[];
    folderBreakdown: { path: string; photoCount: number; fileCount: number }[];
    loading: boolean;
  }>({ photos: [], files: [], folderBreakdown: [], loading: false });
  const [excludedFolders, setExcludedFolders] = useState<Set<string>>(new Set());
  const [exportConfirmOpen, setExportConfirmOpen] = useState(false);
  const [pendingExportAction, setPendingExportAction] = useState<{ type: 'zip' | 'download' | 'zipAll'; includeSubfolders?: boolean } | null>(null);
  const [largeFilesDialogOpen, setLargeFilesDialogOpen] = useState(false);
  const [largeFilesData, setLargeFilesData] = useState<{
    loading: boolean;
    items: VaultLargeFileItem[];
  }>({ loading: false, items: [] });
  const [selectedLargeFiles, setSelectedLargeFiles] = useState<Set<string>>(new Set());
  const [deletingLargeFiles, setDeletingLargeFiles] = useState(false);
  const [largeFilesSortBy, setLargeFilesSortBy] = useState<VaultLargeFileSort>('size');
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const [isDeletingSelected, setIsDeletingSelected] = useState(false);
  const [storagePurchaseDialogOpen, setStoragePurchaseDialogOpen] = useState(false);
  const [addLinkDialogOpen, setAddLinkDialogOpen] = useState(false);
  const [addingLink, setAddingLink] = useState(false);
  const [moveFileDialogOpen, setMoveFileDialogOpen] = useState(false);
  const [fileToMove, setFileToMove] = useState<{ id: string; name: string; folder_id: string | null; team_id?: string | null } | null>(null);
  const [googleDriveImportOpen, setGoogleDriveImportOpen] = useState(false);
  const [linkDriveFolderOpen, setLinkDriveFolderOpen] = useState(false);
  const [resolvingDriveTitles, setResolvingDriveTitles] = useState(false);

  const handleResolveDriveTitles = async () => {
    const clubId = currentView.type !== "root" ? currentView.clubId : undefined;
    if (!clubId) return;
    setResolvingDriveTitles(true);
    const toastId = toast.loading("Fetching real Google Drive titles…");
    try {
      const summary = await resolveVaultDriveTitles(clubId);
      if (!summary || summary.scanned === 0) {
        toast.success("No Google files needed renaming.", { id: toastId });
      } else {
        const parts: string[] = [`${summary.updated} renamed`];
        if (summary.unresolved > 0) parts.push(`${summary.unresolved} unresolved`);
        if (summary.errors > 0) parts.push(`${summary.errors} errors`);
        toast.success(parts.join(" · "), {
          id: toastId,
          description:
            summary.unresolved > 0 && !summary.hasOAuth
              ? "Tip: link a Google Drive folder so private files can be renamed too."
              : undefined,
        });
        refreshVaultFiles(queryClient);
      }
    } catch (err: any) {
      console.error("resolve-drive-titles failed", err);
      toast.error("Couldn't fetch Drive titles", { id: toastId, description: err?.message });
    } finally {
      setResolvingDriveTitles(false);
    }
  };
  const [folderExportDialogOpen, setFolderExportDialogOpen] = useState(false);
  const [folderExportData, setFolderExportData] = useState<{
    folderId: string;
    folderName: string;
    photos: any[];
    files: any[];
    selectedPhotos: Set<string>;
    selectedFiles: Set<string>;
    loading: boolean;
  } | null>(null);

  const togglePhotoSelection = (photoId: string) => {
    setSelectedPhotos(prev => toggleVaultExportSelection(prev, photoId));
  };

  const toggleFileSelection = (fileId: string) => {
    setSelectedFiles(prev => toggleVaultExportSelection(prev, fileId));
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedPhotos(new Set());
    setSelectedFiles(new Set());
  };

  const selectAll = () => {
    setSelectedPhotos(selectAllVaultExportItems(photos || []));
    setSelectedFiles(selectAllVaultExportItems(files || []));
  };

  const getSelectedItems = () => {
    return resolveSelectedVaultExportItems(
      photos || [],
      files || [],
      selectedPhotos,
      selectedFiles,
    );
  };

  const selectedCount = selectedPhotos.size + selectedFiles.size;

  const { data: isAppAdmin, isLoading: isLoadingAppAdmin } = useQuery({
    queryKey: ["is-app-admin", user?.id],
    queryFn: () => fetchVaultAppAdmin(user!.id),
    enabled: !!user,
  });

  const { data: userRoles, isLoading: isLoadingRoles } = useQuery({
    queryKey: ["user-admin-roles", user?.id],
    queryFn: () => fetchVaultUserRoles(user!.id),
    enabled: !!user,
  });

  // Check if user has vault access (admins and coaches only)
  const hasVaultRoleAccess = useMemo(() => {
    return resolveHasVaultRoleAccess(Boolean(isAppAdmin), userRoles);
  }, [isAppAdmin, userRoles]);

  const { data: userClubs, isLoading: isLoadingClubs } = useQuery({
    queryKey: vaultKeys.clubsForUser(user?.id, isAppAdmin),
    queryFn: () => fetchVaultAccessibleClubs(user!.id, Boolean(isAppAdmin)),
    enabled: !!user && isAppAdmin !== undefined,
  });

  // Auto-navigate to club view when theme filter is active - only on initial load
  const hasAutoNavigatedRef = useRef(false);
  useEffect(() => {
    if (activeClubFilter && currentView.type === "root" && userClubs && userClubs.length > 0 && !hasAutoNavigatedRef.current) {
      const club = userClubs.find(c => c.id === activeClubFilter);
      if (club && club.is_pro) {
        hasAutoNavigatedRef.current = true;
        setCurrentView({ type: "club", clubId: activeClubFilter, clubName: club.name });
      }
    }
  }, [activeClubFilter, userClubs, currentView.type]);

  // Handle Google OAuth callback from redirect
  // The OAuth code is now captured in App.tsx before router init
  // This effect just processes any saved errors
  useEffect(() => {
    const savedError = sessionStorage.getItem('googleDriveOAuthError');
    
    if (savedError) {
      console.error("[GoogleDrive OAuth] Error from Google:", savedError);
      toast.error("Google authentication was cancelled or failed");
      sessionStorage.removeItem('googleDriveOAuthError');
      sessionStorage.removeItem('googleDriveImportPending');
    }
  }, []);
  
  // Process saved OAuth code
  useEffect(() => {
    const savedCode = sessionStorage.getItem('googleDriveOAuthCode');
    
    if (savedCode) {
      console.log("[GoogleDrive OAuth] Processing saved code");
      sessionStorage.removeItem('googleDriveOAuthCode');
      
      const exchangeCode = async () => {
        try {
          const isNative = typeof window !== 'undefined' && !!(window as any).Capacitor?.isNativePlatform?.();
          const redirectUri = getVaultDriveRedirectUri(isNative, window.location.origin);
          console.log("[GoogleDrive OAuth] Exchanging code with redirectUri:", redirectUri);
          const tokens = await exchangeVaultDriveOAuthCode({ code: savedCode, redirectUri });
          console.log("[GoogleDrive OAuth] Token exchange successful");
          const route = storeVaultDriveOAuthTokens(tokens, sessionStorage);
          if (route === "link") {
            setLinkDriveFolderOpen(true);
          } else {
            setGoogleDriveImportOpen(true);
          }
        } catch (err) {
          console.error("[GoogleDrive OAuth] Exception:", err);
          toast.error("Failed to connect to Google Drive");
        } finally {
          sessionStorage.removeItem('googleDriveImportPending');
        }
      };
      
      exchangeCode();
    }
  }, []); // Only run on mount after the first effect

  // Check if user is a club admin or committee member for the current club (can see all teams)
  const isClubAdminOrCommittee = useMemo(() => {
    return isVaultClubAdminOrCommittee(Boolean(isAppAdmin), currentView, userRoles);
  }, [isAppAdmin, currentView, userRoles]);

  // Alias for backward compatibility
  const isClubAdmin = isClubAdminOrCommittee;

  // Check if user is a coach or team admin in the current club (can see club-level chat folders)
  const isCoachOrTeamAdmin = useMemo(() => {
    return isVaultCoachOrTeamAdmin(isClubAdmin, currentView, userRoles);
  }, [isClubAdmin, currentView, userRoles]);

  // Get first admin club/team for upgrade link
  const adminUpgradeInfo = useMemo(() => {
    return getVaultAdminUpgradeInfo(userRoles);
  }, [userRoles]);

  // Get teams user has access to
  const userTeamIds = useMemo(() => {
    return getVaultTeamIds(userRoles);
  }, [userRoles]);

  // Check if the current club has Pro
  const { data: currentClubHasPro, isLoading: isLoadingClubHasPro } = useQuery({
    queryKey: vaultKeys.clubHasPro((currentView.type === "club" || currentView.type === "team" || currentView.type === "mini-league") ? currentView.clubId : null),
    queryFn: () => currentView.type === "root"
      ? false
      : fetchVaultClubHasPro(currentView.clubId),
    enabled: currentView.type === "club" || currentView.type === "team" || currentView.type === "mini-league",
  });

  // Check if the current team has Pro (for teams in non-Pro clubs)
  const { data: currentTeamHasPro, isLoading: isLoadingTeamHasPro } = useQuery({
    queryKey: vaultKeys.teamHasPro(currentView.type === "team" ? currentView.teamId : null),
    queryFn: () => currentView.type === "team"
      ? fetchVaultTeamHasPro(currentView.teamId)
      : false,
    enabled: currentView.type === "team",
  });

  // Determine if current context has Pro access for uploads
  const currentContextHasPro = useMemo(() => {
    return resolveVaultContextPro(currentView, currentClubHasPro, currentTeamHasPro);
  }, [currentView.type, currentClubHasPro, currentTeamHasPro]);

  const { data: clubTeams } = useQuery({
    queryKey: vaultKeys.clubTeamsForAccess(currentView.type === "club" ? currentView.clubId : null, isClubAdmin, userTeamIds, currentClubHasPro),
    queryFn: () => currentView.type === "club"
      ? fetchVaultClubTeams({
        clubId: currentView.clubId,
        isClubAdmin,
        userTeamIds,
        clubHasPro: Boolean(currentClubHasPro),
      })
      : [],
    enabled: currentView.type === "club" && currentClubHasPro !== undefined,
  });

  // Fetch team folders for the current club
  const { data: teamFolders } = useQuery({
    queryKey: vaultKeys.teamFoldersForClub(currentView.type === "club" ? currentView.clubId : null),
    queryFn: () => currentView.type === "club" ? fetchVaultTeamFolders(currentView.clubId) : [],
    enabled: currentView.type === "club",
  });

  // Fetch mini-leagues for the current club (Pro Football only)
  const { data: clubMiniLeagues } = useQuery({
    queryKey: vaultKeys.clubMiniLeaguesForAccess(currentView.type === "club" ? currentView.clubId : null, isClubAdmin, user?.id, userRoles?.length),
    queryFn: () => currentView.type === "club"
      ? fetchVaultMiniLeagues({
        clubId: currentView.clubId,
        userId: user!.id,
        isAppAdmin: Boolean(isAppAdmin),
      })
      : [],
    enabled: currentView.type === "club" && !!user,
  });

  const currentScope = getVaultScope(currentView);
  const getCurrentFolderId = () => currentScope.folderId;
  const getCurrentClubId = () => currentScope.clubId;
  const getCurrentTeamId = () => currentScope.teamId;
  const getCurrentMiniLeagueId = () => currentScope.miniLeagueId;

  // Roles the current user holds in the active club (used to filter
  // role-restricted chat folders like "Coaches Chat", "Club Admin Chat", etc.)
  const userClubRoleSet = useMemo(() => {
    return collectVaultClubRoles(userRoles, getCurrentClubId());
  }, [userRoles, currentView]);
  const userClubRoleSignature = Array.from(userClubRoleSet).sort().join(",");

  const { data: subfolders } = useQuery({
    queryKey: vaultKeys.subfoldersForView(currentView, isClubAdmin, isCoachOrTeamAdmin, Boolean(isAppAdmin), userClubRoleSignature),
    queryFn: () => fetchVaultSubfolders({
      view: currentView,
      isAppAdmin: Boolean(isAppAdmin),
      isClubAdmin,
      isCoachOrTeamAdmin,
      clubRoles: userClubRoleSet,
    }),
    enabled: currentView.type !== "root",
  });

  const [showTrash, setShowTrash] = useState(false);

  // Vault now reads all content from vault_files table only
  // Photos uploaded via Media page are also added to vault_files
  // Photos uploaded directly to Vault stay in vault_files only (not in photos table)
  const { data: vaultItems } = useQuery({
    queryKey: vaultKeys.filesForView(currentView, isClubAdmin, isCoachOrTeamAdmin),
    queryFn: () => fetchVaultItems({ view: currentView, isClubAdmin, isCoachOrTeamAdmin }),
    enabled: currentView.type !== "root" && !showTrash,
  });

  // Separate vault items into photos and files based on file_type
  const { photos, files } = useMemo(() => partitionVaultItems(vaultItems), [vaultItems]);


  // Recursive search - always search inside subfolders when a query is active.
  // Performance strategy:
  //  - Debounce the query so we don't re-fetch on every keystroke.
  //  - Cache the folder tree per scope (no query in its key) so paths are
  //    available instantly across searches.
  //  - Push the name filter to Postgres via ilike so the payload only
  //    contains matches, not the entire vault.
  const recursiveEnabled = debouncedVaultSearchQuery.trim().length > 0 && currentView.type !== "root" && !showTrash;
  const recursiveScope = useMemo(() => ({
    type: currentView.type,
    clubId: getCurrentClubId(),
    teamId: getCurrentTeamId(),
    miniLeagueId: getCurrentMiniLeagueId(),
    startFolderId: getCurrentFolderId(),
  }), [currentView]);

  // Folder tree cache (per scope) — used for path display and descendant set.
  const { data: folderTree } = useQuery({
    queryKey: vaultKeys.folderTree(
      recursiveScope.type,
      recursiveScope.clubId,
      recursiveScope.teamId,
      isClubAdmin,
      Boolean(isAppAdmin),
      userClubRoleSignature,
    ),
    queryFn: () => fetchVaultFolderTree({
      view: currentView,
      isPrivilegedViewer: Boolean(isAppAdmin || isClubAdmin),
      clubRoles: userClubRoleSet,
    }),
    enabled: recursiveScope.type === "club" || recursiveScope.type === "team",
    staleTime: 60_000,
  });

  const { data: recursiveData, isFetching: isFetchingRecursive } = useQuery({
    queryKey: vaultKeys.recursiveSearch(
      recursiveScope,
      debouncedVaultSearchQuery.trim().toLowerCase(),
      isClubAdmin,
      isCoachOrTeamAdmin,
      userClubRoleSignature,
    ),
    queryFn: () => searchVaultContents({
      view: currentView,
      searchQuery: debouncedVaultSearchQuery,
      tree: folderTree!,
    }),
    enabled: recursiveEnabled && !!folderTree,
    keepPreviousData: true,
    staleTime: 30_000,
  } as any);


  // Search filtering across folders, photos, and files (fuzzy + ranked)
  const normalizedSearch = vaultSearchQuery.trim();
  const recursiveResult = recursiveData as { folders: any[]; files: any[] } | undefined;
  const searchSourceFolders = recursiveEnabled ? (recursiveResult?.folders || []) : (subfolders || []);
  const searchSourcePhotos = recursiveEnabled
    ? ((recursiveResult?.files || []).filter(isVaultImage))
    : (photos || []);
  const searchSourceFiles = recursiveEnabled
    ? ((recursiveResult?.files || []).filter((file: any) => !isVaultImage(file)))
    : (files || []);
  const displaySubfolders = useMemo(() => {
    return fuzzyFilter(searchSourceFolders as any[], normalizedSearch, (f: any) => f.name || "");
  }, [searchSourceFolders, normalizedSearch]);
  const displayPhotos = useMemo(() => {
    return fuzzyFilter(searchSourcePhotos as any[], normalizedSearch, (p: any) => p.title || p.name || "");
  }, [searchSourcePhotos, normalizedSearch]);
  const displayFiles = useMemo(() => {
    return fuzzyFilter(searchSourceFiles as any[], normalizedSearch, (f: any) => f.name || "");
  }, [searchSourceFiles, normalizedSearch]);

  // Trash query - fetches ALL deleted items from vault_files for the current club
  const { data: trashItems, isLoading: isLoadingTrash } = useQuery({
    queryKey: vaultKeys.trashForClub(currentView.type !== "root" ? currentView.clubId : null),
    queryFn: () => fetchVaultTrash(currentView),
    enabled: showTrash && currentView.type !== "root",
  });

  // Check for Pro subscription and get plan details
  // Logic: Club Pro → all teams inherit Pro; Free club → check team subscription
  const { data: proAccessInfo, isLoading: isLoadingProClub } = useQuery({
    queryKey: ["pro-access-info", user?.id],
    queryFn: () => fetchVaultAnyProAccess(user!.id),
    enabled: !!user,
  });

  const hasProClub = proAccessInfo ?? false;
  const isLoadingAccess = isLoadingAppAdmin || isLoadingProClub || isLoadingRoles || isLoadingClubHasPro || isLoadingTeamHasPro;
  // Vault access requires: 1) Pro subscription in current context AND 2) Admin/coach role
  const vaultAccessContextHasPro = currentView.type === "root" ? hasProClub : currentContextHasPro;
  const canAccessVault = resolveCanAccessVault({
    isAppAdmin: Boolean(isAppAdmin),
    hasRoleAccess: hasVaultRoleAccess,
    hasAnyPro: hasProClub,
    currentContextHasPro,
    isRoot: currentView.type === "root",
  });

  // Handle storage purchase success redirect
  useEffect(() => {
    if (searchParams.get("success") === "storage") {
      toast.success("Storage add-on purchased successfully! Your storage limit has been increased.");
      searchParams.delete("success");
      setSearchParams(searchParams, { replace: true });
      queryClient.invalidateQueries({ queryKey: ["club-purchased-storage"] });
      queryClient.invalidateQueries({ queryKey: vaultKeys.clubs() });
    }
  }, [searchParams, setSearchParams, queryClient]);

  // Load folder from URL parameter
  useEffect(() => {
    const loadFolderFromUrl = async () => {
      if (!urlFolderId || initialLoadComplete || !userClubs) return;
      
      try {
        const destination = await resolveVaultFolderDeepLink(urlFolderId);
        if (!destination) {
          toast.error("Folder not found or access denied");
          navigate("/vault", { replace: true });
          setInitialLoadComplete(true);
          return;
        }
        setFolderPath(destination.path);
        if (destination.view) setCurrentView(destination.view);
        
        setInitialLoadComplete(true);
      } catch (error) {
        console.error("Error loading folder:", error);
        toast.error("Failed to load folder");
        navigate("/vault", { replace: true });
        setInitialLoadComplete(true);
      }
    };

    loadFolderFromUrl();
  }, [urlFolderId, userClubs, initialLoadComplete, navigate]);

  // Handle direct navigation via query parameters (?club=X or ?team=X)
  useEffect(() => {
    const loadFromQueryParams = async () => {
      if (urlFolderId || initialLoadComplete || !userClubs || userClubs.length === 0) return;

      const clubId = searchParams.get("club");
      const teamId = searchParams.get("team");
      const miniLeagueId = searchParams.get("miniLeague");

      if (!clubId && !teamId && !miniLeagueId) {
        setInitialLoadComplete(true);
        return;
      }

      try {
        const destination = await resolveVaultScopeDeepLink({
          clubId,
          teamId,
          miniLeagueId,
          accessibleClubs: userClubs,
        });
        if (destination) {
          setCurrentView(destination);
          setSearchParams({}, { replace: true });
        }
      } catch (error) {
        console.error("Error loading from query params:", error);
      }

      setInitialLoadComplete(true);
    };

    loadFromQueryParams();
  }, [urlFolderId, userClubs, initialLoadComplete, searchParams, setSearchParams]);

  const shareFolder = async (folderId: string) => {
    const shareUrl = getShareUrl("folder", folderId);
    
    try {
      if (Capacitor.isNativePlatform()) {
        try {
          await Share.share({
            url: shareUrl,
            dialogTitle: "Share Folder",
          });
        } catch (error) {
          if ((error as Error).name !== "AbortError") {
            await navigator.clipboard.writeText(shareUrl);
            toast.success("Link copied to clipboard!");
          }
        }
        return;
      }

      if (navigator.share) {
        await navigator.share({
          url: shareUrl,
        });
      } else {
        await navigator.clipboard.writeText(shareUrl);
        toast.success("Link copied to clipboard!");
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        await navigator.clipboard.writeText(shareUrl);
        toast.success("Link copied to clipboard!");
      }
    }
  };

  const currentClub = useMemo(() => {
    if (currentView.type === "club") return userClubs?.find(c => c.id === currentView.clubId);
    if (currentView.type === "team") return userClubs?.find(c => c.id === currentView.clubId);
    return null;
  }, [currentView, userClubs]);

  // 5GB base storage limit for Pro tier (in bytes)
  const BASE_STORAGE_LIMIT = 5 * 1024 * 1024 * 1024;

  // Query for purchased storage and scheduled downgrade info for current club
  const { data: storageSubscriptionData } = useQuery({
    queryKey: ["purchased-storage", currentClub?.id],
    queryFn: () => currentClub?.id
      ? fetchVaultStorageSubscription(currentClub.id)
      : { storage_purchased_gb: 0, scheduled_storage_downgrade_gb: null, storage_downgrade_at: null },
    enabled: !!currentClub?.id,
  });

  const purchasedStorageGb = storageSubscriptionData?.storage_purchased_gb || 0;
  const scheduledDowngradeGb = storageSubscriptionData?.scheduled_storage_downgrade_gb;
  const storageDowngradeAt = storageSubscriptionData?.storage_downgrade_at;

  // Total storage limit = base + purchased
  const PRO_STORAGE_LIMIT = BASE_STORAGE_LIMIT + ((purchasedStorageGb || 0) * 1024 * 1024 * 1024);

  // Query for storage breakdown by file type, team, and mini-league
  const { data: storageBreakdown } = useQuery({
    queryKey: vaultKeys.storageBreakdownForClub(currentClub?.id),
    queryFn: () => currentClub?.id
      ? fetchVaultStorageBreakdown(currentClub.id)
      : emptyVaultStorageBreakdown(),
    enabled: !!currentClub?.id,
  });

  // Get total club storage used (for Pro tier limit)
  const totalClubStorageUsed = useMemo(() => {
    return storageBreakdown?.total || 0;
  }, [storageBreakdown]);

  // Get current team's storage used (for display)
  const currentTeamStorageUsed = useMemo(() => {
    if (currentView.type === "team" && storageBreakdown?.byTeam) {
      const teamData = storageBreakdown.byTeam.find(t => t.teamId === currentView.teamId);
      return teamData?.size || 0;
    }
    if (currentView.type === "club" && storageBreakdown?.byTeam) {
      const clubLevelData = storageBreakdown.byTeam.find(t => t.teamId === null);
      return clubLevelData?.size || 0;
    }
    return 0;
  }, [currentView, storageBreakdown]);

  // Pro tier has 5GB limit + purchased storage
  const isStorageLimitReached = useMemo(() => {
    if (isAppAdmin) return false;
    if (!hasProClub) return true; // Free tier can't access vault
    // Pro tier has 5GB base limit + purchased storage (total club storage)
    return totalClubStorageUsed >= PRO_STORAGE_LIMIT;
  }, [isAppAdmin, hasProClub, totalClubStorageUsed]);

  // Track which warnings have been shown this session
  const shownWarningsRef = useRef<Set<string>>(new Set());

  // Show warning when club storage reaches 80% of Pro limit
  useEffect(() => {
    if (!storageBreakdown || !currentClub || isAppAdmin || !hasProClub) return;

    const WARNING_THRESHOLD = 0.8; // 80%
    const percentage = totalClubStorageUsed / PRO_STORAGE_LIMIT;
    const warningKey = `${currentClub.id}-pro-limit`;
    
    if (percentage >= WARNING_THRESHOLD && !shownWarningsRef.current.has(warningKey)) {
      shownWarningsRef.current.add(warningKey);
      
      if (percentage >= 1) {
        toast.error(`Storage limit reached`, {
          description: "Delete files or purchase more storage"
        });
      } else {
        toast.warning(`Club storage at ${Math.round(percentage * 100)}% capacity`, {
          description: `${formatStorageSize(PRO_STORAGE_LIMIT - totalClubStorageUsed)} remaining`
        });
      }
    }
  }, [storageBreakdown, currentClub, isAppAdmin, hasProClub, totalClubStorageUsed]);

  const formatStorageSize = (bytes: number) => {
    if (bytes >= 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    } else if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    } else if (bytes >= 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${bytes} B`;
  };

  const canUpload = useMemo(() => {
    if (isStorageLimitReached) return false;
    if (!currentClub) return false;
    if (isAppAdmin) return true;

    // Role-based write access for the current context. Pro is NOT required here —
    // free clubs still get to upload from device (subject to free-tier quotas).
    // Pro-only Add features (New Folder / Add Link / Drive imports) gate on
    // `canManageVaultPro` below.
    const clubId = getCurrentClubId();
    const teamId = getCurrentTeamId();

    // Club admins and committee members can upload to any club, team, or mini-league vault within their club
    if (userRoles?.some(r => (r.role === "club_admin" || r.role === "committee_member") && r.club_id === clubId)) return true;

    // Team admins can only upload to their own team vault
    if (currentView.type === "team") {
      return userRoles?.some(r => r.role === "team_admin" && r.team_id === teamId);
    }

    // Mini-league: league admins and coaches can upload
    if (currentView.type === "mini-league") {
      return userRoles?.some(r =>
        (r.role === "league_admin" || r.role === "coach") && r.club_id === clubId
      );
    }

    // For club-level view, only club admins and committee members can upload (handled above)
    return false;
  }, [isAppAdmin, currentClub, isStorageLimitReached, currentView, userRoles]);

  // Pro-gated vault management (folders, link entries, Drive imports/sync).
  // Free users may upload from device but cannot create folders/links or pull from Drive.
  const canManageVaultPro = canUpload && currentContextHasPro;

  const canDeletePhoto = useCallback((photo: any) => {
    if (isAppAdmin) return true;
    if (photo.uploader_id === user?.id) return true;
    const clubId = currentView.type === "club" ? currentView.clubId : currentView.type === "team" ? currentView.clubId : currentView.type === "mini-league" ? currentView.clubId : null;
    const teamId = currentView.type === "team" ? currentView.teamId : null;
    if (userRoles?.some(r => (r.role === "club_admin" || r.role === "committee_member") && r.club_id === clubId)) return true;
    if (teamId && userRoles?.some(r => r.role === "team_admin" && r.team_id === teamId)) return true;
    // Mini-league: league admins and coaches can delete
    if (currentView.type === "mini-league" && userRoles?.some(r => (r.role === "league_admin" || r.role === "coach") && r.club_id === clubId)) return true;
    return false;
  }, [isAppAdmin, user?.id, currentView, userRoles]);

  const canDeleteFile = useCallback((file: any) => {
    if (isAppAdmin) return true;
    // vault_files uses uploaded_by, not uploader_id
    if ((file.uploaded_by || file.uploader_id) === user?.id) return true;
    const clubId = currentView.type === "club" ? currentView.clubId : currentView.type === "team" ? currentView.clubId : currentView.type === "mini-league" ? currentView.clubId : null;
    const teamId = currentView.type === "team" ? currentView.teamId : null;
    if (userRoles?.some(r => (r.role === "club_admin" || r.role === "committee_member") && r.club_id === clubId)) return true;
    if (teamId && userRoles?.some(r => r.role === "team_admin" && r.team_id === teamId)) return true;
    // Mini-league: league admins and coaches can delete
    if (currentView.type === "mini-league" && userRoles?.some(r => (r.role === "league_admin" || r.role === "coach") && r.club_id === clubId)) return true;
    return false;
  }, [isAppAdmin, user?.id, currentView, userRoles]);

  const canRenameFile = useCallback((file: any) => {
    if (isAppAdmin) return true;
    // vault_files uses uploaded_by, not uploader_id
    if ((file.uploaded_by || file.uploader_id) === user?.id) return true;
    const clubId = currentView.type === "club" ? currentView.clubId : currentView.type === "team" ? currentView.clubId : currentView.type === "mini-league" ? currentView.clubId : null;
    const teamId = currentView.type === "team" ? currentView.teamId : null;
    if (userRoles?.some(r => (r.role === "club_admin" || r.role === "committee_member") && r.club_id === clubId)) return true;
    if (teamId && userRoles?.some(r => r.role === "team_admin" && r.team_id === teamId)) return true;
    // Mini-league: league admins and coaches can rename
    if (currentView.type === "mini-league" && userRoles?.some(r => (r.role === "league_admin" || r.role === "coach") && r.club_id === clubId)) return true;
    return false;
  }, [isAppAdmin, user?.id, currentView, userRoles]);

  const canRenamePhoto = useCallback((photo: any) => {
    if (isAppAdmin) return true;
    if (photo.uploader_id === user?.id) return true;
    const clubId = currentView.type === "club" ? currentView.clubId : currentView.type === "team" ? currentView.clubId : currentView.type === "mini-league" ? currentView.clubId : null;
    const teamId = currentView.type === "team" ? currentView.teamId : null;
    if (userRoles?.some(r => (r.role === "club_admin" || r.role === "committee_member") && r.club_id === clubId)) return true;
    if (teamId && userRoles?.some(r => r.role === "team_admin" && r.team_id === teamId)) return true;
    // Mini-league: league admins and coaches can rename
    if (currentView.type === "mini-league" && userRoles?.some(r => (r.role === "league_admin" || r.role === "coach") && r.club_id === clubId)) return true;
    return false;
  }, [isAppAdmin, user?.id, currentView, userRoles]);

  const canDeleteFolder = useCallback((folder: any) => {
    if (isAppAdmin) return true;
    if (folder.created_by === user?.id) return true;
    const clubId = getCurrentClubId();
    const teamId = getCurrentTeamId();
    if (userRoles?.some(r => (r.role === "club_admin" || r.role === "committee_member") && r.club_id === clubId)) return true;
    if (teamId && userRoles?.some(r => r.role === "team_admin" && r.team_id === teamId)) return true;
    return false;
  }, [isAppAdmin, user?.id, getCurrentClubId, getCurrentTeamId, userRoles]);

  const createFolderMutation = useMutation({
    mutationFn: (name: string) => createVaultFolder({
      name,
      userId: user!.id,
      parentFolderId: getCurrentFolderId(),
      view: currentView,
    }),
    onSuccess: () => {
      refreshVaultFolders(queryClient);
      setNewFolderDialogOpen(false);
      setNewFolderName("");
      toast.success("Folder created!");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to create folder");
    },
  });

  const deleteFolderMutation = useMutation({
    mutationFn: deleteVaultFolder,
    onSuccess: () => {
      refreshVaultFolders(queryClient);
      setDeleteFolderId(null);
      toast.success("Folder deleted");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to delete folder");
    },
  });

  const renameFolderMutation = useMutation({
    mutationFn: ({ folderId, newName }: { folderId: string; newName: string }) =>
      renameVaultFolder(folderId, newName),
    onSuccess: (_, variables) => {
      refreshVaultFolders(queryClient);
      // Update folder path if renamed folder is in the path
      setFolderPath(prev => prev.map(f => f.id === variables.folderId ? { ...f, name: variables.newName } : f));
      setRenameFolderId(null);
      setRenameFolderName("");
      toast.success("Folder renamed");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to rename folder");
    },
  });

  const renameFileMutation = useMutation({
    mutationFn: ({ fileId, newName }: { fileId: string; newName: string }) =>
      renameVaultItem(fileId, newName),
    onSuccess: () => {
      refreshVaultFiles(queryClient);
      setRenameFileId(null);
      setRenameFileName("");
      toast.success("File renamed");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to rename file");
    },
  });

  // Vault photos are stored in vault_files, so rename updates vault_files.name
  const renamePhotoMutation = useMutation({
    mutationFn: ({ photoId, newName }: { photoId: string; newName: string }) =>
      renameVaultItem(photoId, newName),
    onSuccess: () => {
      refreshVaultFiles(queryClient);
      setRenamePhotoId(null);
      setRenamePhotoName("");
      toast.success("Photo renamed");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to rename photo");
    },
  });

  // Vault photo uploads go to vault_files ONLY (not photos table)
  // This keeps vault photos separate from the media gallery
  const uploadPhotoMutation = useMutation({
    mutationFn: (file: File) => uploadVaultItem({
      kind: "photo",
      file,
      name: file.name,
      userId: user!.id,
      folderId: getCurrentFolderId(),
      view: currentView,
    }),

    onSuccess: () => {
      refreshVaultUpload(queryClient, { includeFreeUsage: false });
      setUploadDialogOpen(false);
      // No toast for successful photo uploads
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to upload photo");
    },
  });

  const uploadFileMutation = useMutation({
    mutationFn: ({ file, customFileName }: { file: File; customFileName?: string }) => uploadVaultItem({
      kind: "file",
      file,
      name: customFileName || fileName || file.name,
      userId: user!.id,
      folderId: getCurrentFolderId(),
      view: currentView,
    }),

    onSuccess: () => {
      refreshVaultUpload(queryClient, { includeFreeUsage: true });
      setUploadDialogOpen(false);
      setFileName("");
      toast.success("File uploaded successfully!");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to upload file");
    },
  });

  const addLinkMutation = useMutation({
    mutationFn: ({ url, name }: { url: string; name: string }) => createVaultExternalLink({
      url,
      name,
      userId: user!.id,
      folderId: getCurrentFolderId(),
      view: currentView,
    }),
    onSuccess: () => {
      refreshVaultFiles(queryClient);
      setAddLinkDialogOpen(false);
      toast.success("Link added successfully!");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to add link");
    },
  });

  // Vault photos are now stored in vault_files
  const deletePhotoMutation = useMutation({
    mutationFn: (photoId: string) => softDeleteVaultItem(photoId, user?.id),
    onMutate: async (photoId: string) => {
      // Close dialogs immediately
      setDeletePhotoId(null);
      setLightboxOpen(false);
      
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: vaultKeys.files() });
      
      // Snapshot the previous value
      const viewKey = vaultKeys.filesForView(currentView, isClubAdmin, isCoachOrTeamAdmin);
      const previousItems = queryClient.getQueryData(viewKey);
      
      // Optimistically remove the photo from the cache
      queryClient.setQueryData(viewKey, (old: any[] | undefined) => {
        if (!old) return old;
        return old.filter((item: any) => item.id !== photoId);
      });
      
      return { previousItems, photoId };
    },
    onSuccess: (photoId) => {
      // Remove from local storage cache
      removePhotoFromCache(photoId);
      // Silent success - no toast
    },
    onError: (error: any, _, context) => {
      // Rollback on error
      if (context?.previousItems) {
        queryClient.setQueryData(
          vaultKeys.filesForView(currentView, isClubAdmin, isCoachOrTeamAdmin),
          context.previousItems,
        );
      }
      toast.error(error.message || "Failed to delete photo");
    },
    onSettled: () => {
      refreshVaultFileStorage(queryClient);
    },
  });

  const deleteFileMutation = useMutation({
    mutationFn: (fileId: string) => softDeleteVaultItem(fileId, user?.id),
    onSuccess: () => {
      refreshVaultFileStorage(queryClient);
      setDeleteFileId(null);
      // Silent success - no toast
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to delete file");
    },
  });

  // Restore photo from trash (vault photos are in vault_files)
  const restorePhotoMutation = useMutation({
    mutationFn: restoreVaultItem,
    onSuccess: () => {
      refreshVaultRestore(queryClient);
      toast.success("Photo restored to original location");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to restore photo");
    },
  });

  // Restore file from trash
  const restoreFileMutation = useMutation({
    mutationFn: restoreVaultItem,
    onSuccess: () => {
      refreshVaultRestore(queryClient);
      toast.success("File restored to original location");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to restore file");
    },
  });

  // Permanently delete photo via edge function (handles storage + DB + audit log)
  const permanentDeletePhotoMutation = useMutation({
    mutationFn: permanentlyDeleteVaultPhoto,
    onSuccess: (photoId) => {
      removePhotoFromCache(photoId);
      refreshVaultPermanentDelete(queryClient, { includePhotos: true });
      toast.success("Photo permanently deleted");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to permanently delete photo");
    },
  });

  // Permanently delete file via edge function (handles storage + DB + audit log)
  const permanentDeleteFileMutation = useMutation({
    mutationFn: permanentlyDeleteVaultFile,
    onSuccess: () => {
      refreshVaultPermanentDelete(queryClient, { includePhotos: false });
      toast.success("File permanently deleted");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to permanently delete file");
    },
  });

  // Empty all trash
  const [isEmptyingTrash, setIsEmptyingTrash] = useState(false);
  const emptyTrash = async () => {
    if (!trashItems) return;
    if (isEmptyingTrash) return;
    setIsEmptyingTrash(true);
    try {
      const result = await permanentlyDeleteVaultTrash({
        photos: trashItems.photos || [],
        files: trashItems.files || [],
      });

      // Item-level acknowledgements only; aggregate counts never imply success.
      const requestedKeys = new Set(result.requested.map((item) => `${item.kind}:${item.id}`));
      const failedKeys = new Set(result.failed.map((f) => `${f.kind}:${f.id}`));
      const succeededKeys = new Set(
        result.succeeded
          .map((s) => `${s.kind}:${s.id}`)
          .filter((k) => requestedKeys.has(k) && !failedKeys.has(k)),
      );
      const succeededCount = succeededKeys.size;
      const failedCount = requestedKeys.size - succeededCount;


      // Always refresh so remaining (failed) items stay visible and counts are accurate
      refreshVaultPermanentDelete(queryClient, { includePhotos: true });

      // Exactly one toast; never a success message when any item failed
      const outcome = resolveEmptyTrashOutcome({ succeededCount, failedCount });
      toast[outcome.kind](outcome.message);

    } catch (error: any) {
      toast.error(error.message || "Failed to empty trash");
    } finally {
      setIsEmptyingTrash(false);
    }
  };


  // Move file to a different folder or team
  const moveFileMutation = useMutation({
    mutationFn: (variables: { fileId: string; targetFolderId: string | null; targetTeamId?: string | null }) =>
      moveVaultFile(variables),
    onSuccess: () => {
      refreshVaultFiles(queryClient);
      setMoveFileDialogOpen(false);
      setFileToMove(null);
      toast.success("File moved successfully");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to move file");
    },
  });

  // Bulk delete selected photos and files (soft delete)
  const deleteSelectedItems = async () => {
    setIsDeletingSelected(true);
    const { photos: selectedPhotoItems, files: selectedFileItems } = getSelectedItems();

    try {
      const result = await softDeleteVaultSelection({
        photoIds: selectedPhotoItems.map((photo) => photo.id),
        fileIds: selectedFileItems.map((file) => file.id),
        deletedBy: user?.id,
      });
      result.deletedPhotoIds.forEach(removePhotoFromCache);
      result.failed.forEach((failure) => {
        console.error(`Failed to soft-delete ${failure.kind}`, failure.id, failure.error);
      });
      const deletedCount = result.deletedPhotoIds.length + result.deletedFileIds.length;
      const errorCount = result.failed.length;

      refreshVaultBulkDelete(queryClient);

      if (errorCount === 0) {
        toast.success(`Moved ${deletedCount} items to trash`);
      } else {
        toast.warning(`Moved ${deletedCount} items to trash, ${errorCount} failed`);
      }
    } catch (error: any) {
      toast.error(error.message || "Failed to delete items");
    } finally {
      setIsDeletingSelected(false);
      setBulkDeleteDialogOpen(false);
      exitSelectionMode();
    }
  };

  // Fetch large files for the current club
  const fetchLargeFiles = useCallback(async () => {
    if (!currentClub?.id) return;
    
    setLargeFilesData({ loading: true, items: [] });
    setSelectedLargeFiles(new Set());
    
    try {
      const items = await fetchVaultLargeFiles(currentClub.id);
      setLargeFilesData({ loading: false, items });
    } catch (error) {
      console.error("Failed to fetch large files:", error);
      setLargeFilesData({ loading: false, items: [] });
      toast.error("Failed to load large files");
    }
  }, [currentClub?.id]);
  
  const toggleLargeFileSelection = (id: string) => {
    setSelectedLargeFiles(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };
  
  const deleteSelectedLargeFiles = async () => {
    if (selectedLargeFiles.size === 0) return;
    
    setDeletingLargeFiles(true);
    
    try {
      const deletion = prepareVaultLargeFileDeletion(
        largeFilesData.items,
        selectedLargeFiles,
      );
      
      // Use the permanent delete edge function to handle storage cleanup + audit
      const result = await permanentlyDeleteVaultItems({
        photoIds: deletion.photoIds,
        fileIds: deletion.fileIds,
      });

      // Truthful reporting: only server-acknowledged deletions count, and
      // freed bytes are summed over successful items only.
      const summary = summarizeVaultDeletion(
        deletion.items.map(i => ({ id: i.id, type: i.type, size: i.size })),
        result,
      );
      const { outcome, message } = buildVaultDeleteMessage(summary, formatStorageSize);

      if (summary.deletedCount > 0) {
        refreshVaultBulkDelete(queryClient);
      }

      // Failed items stay selected so the user can retry; successes are cleared.
      const deletedIds = new Set(summary.deletedIds);
      setSelectedLargeFiles(prev => new Set([...prev].filter(id => !deletedIds.has(id))));

      if (outcome === "failure") toast.error(message);
      else toast.success(message);
      
      // Refresh the list
      fetchLargeFiles();

    } catch (error: any) {
      toast.error(error.message || "Failed to delete files");
    } finally {
      setDeletingLargeFiles(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    if (uploadType === "photo") {
      await uploadPhotoMutation.mutateAsync(file);
    } else {
      await uploadFileMutation.mutateAsync({ file });
    }
    setUploading(false);
  };

  const handleDialogUpload = async (file: File, type: "photo" | "file", customFileName?: string) => {
    setUploading(true);
    try {
      if (type === "photo") {
        await uploadPhotoMutation.mutateAsync(file);
      } else {
        await uploadFileMutation.mutateAsync({ file, customFileName });
      }
    } finally {
      setUploading(false);
    }
  };

  const navigateToFolder = (folder: { id: string; name: string }) => {
    if (currentView.type === "club") {
      setFolderPath([...folderPath, folder]);
      setCurrentView({
        ...currentView,
        folderId: folder.id,
        folderName: folder.name,
      });
    } else if (currentView.type === "team") {
      setFolderPath([...folderPath, folder]);
      setCurrentView({
        ...currentView,
        folderId: folder.id,
        folderName: folder.name,
      });
    }
  };

  const goBack = () => {
    if (fromChat) {
      navigate(-1);
      return;
    }
    if (folderPath.length > 0) {
      const newPath = [...folderPath];
      newPath.pop();
      setFolderPath(newPath);
      const parentFolder = newPath[newPath.length - 1];
      
      if (currentView.type === "club") {
        setCurrentView({
          ...currentView,
          folderId: parentFolder?.id,
          folderName: parentFolder?.name,
        });
      } else if (currentView.type === "team") {
        setCurrentView({
          ...currentView,
          folderId: parentFolder?.id,
          folderName: parentFolder?.name,
        });
      } else if (currentView.type === "mini-league") {
        setCurrentView({
          ...currentView,
          folderId: parentFolder?.id,
          folderName: parentFolder?.name,
        });
      }
    } else if (currentView.type === "team") {
      setCurrentView({ type: "club", clubId: currentView.clubId, clubName: currentView.clubName });
    } else if (currentView.type === "mini-league") {
      setCurrentView({ type: "club", clubId: currentView.clubId, clubName: currentView.clubName });
    } else {
      setCurrentView({ type: "root" });
    }
  };

  const navigateToRoot = () => {
    setFolderPath([]);
    setCurrentView({ type: "root" });
  };

  const navigateToClub = () => {
    if (currentView.type === "club" || currentView.type === "team" || currentView.type === "mini-league") {
      setFolderPath([]);
      setCurrentView({ 
        type: "club", 
        clubId: currentView.clubId, 
        clubName: currentView.clubName 
      });
    }
  };

  const navigateToMiniLeague = () => {
    if (currentView.type === "mini-league") {
      setFolderPath([]);
      setCurrentView({
        type: "mini-league",
        clubId: currentView.clubId,
        clubName: currentView.clubName,
        miniLeagueId: currentView.miniLeagueId,
        miniLeagueName: currentView.miniLeagueName,
      });
    }
  };

  const navigateToTeam = () => {
    if (currentView.type === "team") {
      setFolderPath([]);
      setCurrentView({
        type: "team",
        clubId: currentView.clubId,
        clubName: currentView.clubName,
        teamId: currentView.teamId,
        teamName: currentView.teamName,
      });
    }
  };

  const navigateToFolderAtIndex = (index: number) => {
    const newPath = folderPath.slice(0, index + 1);
    const targetFolder = newPath[index];
    setFolderPath(newPath);
    
    if (currentView.type === "club") {
      setCurrentView({
        ...currentView,
        folderId: targetFolder.id,
        folderName: targetFolder.name,
      });
    } else if (currentView.type === "team") {
      setCurrentView({
        ...currentView,
        folderId: targetFolder.id,
        folderName: targetFolder.name,
      });
    }
  };

  // Mobile-first hierarchy: returns an ordered list of nodes that represent
  // the current vault location. The last node is the "current" page (rendered
  // as a large title); the rest become clickable chips in the secondary path.
  type CrumbNode = { key: string; label: string; onClick?: () => void };

  const getHierarchyNodes = (): CrumbNode[] => {
    const nodes: CrumbNode[] = [];

    // Vault root chip — only shown when we're past it.
    nodes.push({ key: "vault", label: "Vault", onClick: navigateToRoot });

    if (currentView.type === "club" || currentView.type === "team") {
      nodes.push({
        key: "club",
        label: abbreviateVaultOrganisationName(currentView.clubName || "Club"),
        onClick: navigateToClub,
      });
    }

    if (currentView.type === "team") {
      nodes.push({
        key: "team",
        label: currentView.teamName || "Team",
        onClick: navigateToTeam,
      });
    }

    if (currentView.type === "mini-league") {
      nodes.push({
        key: "mini-league",
        label: currentView.miniLeagueName || "League",
        onClick: navigateToMiniLeague,
      });
    }

    folderPath.forEach((folder, index) => {
      nodes.push({
        key: `folder-${folder.id}`,
        label: folder.name,
        onClick: () => navigateToFolderAtIndex(index),
      });
    });

    return nodes;
  };


  const openLightbox = (index: number) => {
    setLightboxIndex(index);
    setLightboxOpen(true);
  };

  const handleLightboxDelete = (photoId: string) => {
    // Close lightbox first, then show confirmation dialog
    setLightboxOpen(false);
    setDeletePhotoId(photoId);
  };

  const downloadFile = async (url: string, filename: string) => {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to fetch file (${response.status})`);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      toast.error("Failed to download file");
    }
  };

  const downloadPhotoFile = async (url: string, filename?: string) => {
    const friendlyName = (filename || "ignite-photo").replace(/\.[^.]+$/, "") || "ignite-photo";
    await downloadImage(url, friendlyName);
  };

  const exportCurrentFolder = async () => {
    const { photos: photosToExport, files: filesToExport } = selectionMode 
      ? getSelectedItems() 
      : { photos: photos || [], files: files || [] };

    if (!photosToExport.length && !filesToExport.length) {
      toast.error(selectionMode ? "No files selected" : "No files to export");
      return;
    }

    exportAbortController.current = new AbortController();
    const signal = exportAbortController.current.signal;
    
    const totalFiles = photosToExport.length + filesToExport.length;
    setExportProgress({ current: 0, total: totalFiles });
    setIsExporting(true);

    try {
      let downloadCount = 0;
      
      // Download photos
      for (const photo of photosToExport) {
        if (signal.aborted) throw new Error("Export cancelled");
        const filename = photo.title || `photo-${photo.id}.jpg`;
        await downloadPhotoFile(photo.file_url, filename);
        downloadCount++;
        setExportProgress({ current: downloadCount, total: totalFiles });
        // Small delay between downloads to avoid browser blocking
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      // Download files
      for (const file of filesToExport) {
        if (signal.aborted) throw new Error("Export cancelled");
        await downloadFile(file.file_url, file.name);
        downloadCount++;
        setExportProgress({ current: downloadCount, total: totalFiles });
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      toast.success(`Exported ${downloadCount} files`);
      if (selectionMode) exitSelectionMode();
    } catch (error: any) {
      if (error.message === "Export cancelled") {
        toast.info("Export cancelled");
      } else {
        toast.error("Export failed");
      }
    } finally {
      setIsExporting(false);
      setExportProgress({ current: 0, total: 0 });
      exportAbortController.current = null;
    }
  };

  const cancelExport = () => {
    if (exportAbortController.current) {
      exportAbortController.current.abort();
    }
  };

  // Open preview dialog and fetch all subfolder contents
  const openExportPreview = async () => {
    const clubId = getCurrentClubId();
    const teamId = getCurrentTeamId();
    const folderId = getCurrentFolderId();

    setExportPreviewData({ photos: [], files: [], folderBreakdown: [], loading: true });
    setExcludedFolders(new Set());
    setExportPreviewOpen(true);

    try {
      const allContents = await collectVaultExportContents({ folderId, clubId, teamId });
      setExportPreviewData({
        photos: allContents.photos,
        files: allContents.files,
        folderBreakdown: allContents.folderBreakdown,
        loading: false,
      });
    } catch (error) {
      console.error("Failed to fetch folder contents:", error);
      toast.error("Failed to scan folders");
      setExportPreviewOpen(false);
    }
  };

  // Open folder export dialog - fetches folder contents and opens selection dialog
  const openFolderExportDialog = async (folder: { id: string; name: string }) => {
    const clubId = getCurrentClubId();
    const teamId = getCurrentTeamId();

    setFolderExportData({
      folderId: folder.id,
      folderName: folder.name,
      photos: [],
      files: [],
      selectedPhotos: new Set(),
      selectedFiles: new Set(),
      loading: true,
    });
    setFolderExportDialogOpen(true);

    try {
      const contents = await fetchVaultExportFolderContents({
        folderId: folder.id,
        clubId,
        teamId,
      });
      setFolderExportData({
        folderId: folder.id,
        folderName: folder.name,
        photos: contents.photos,
        files: contents.files,
        selectedPhotos: new Set(contents.photos.map((p: any) => p.id)),
        selectedFiles: new Set(contents.files.map((f: any) => f.id)),
        loading: false,
      });
    } catch (error) {
      console.error("Failed to fetch folder contents for export:", error);
      toast.error("Failed to load folder contents");
      setFolderExportDialogOpen(false);
    }
  };

  const toggleFolderExportPhotoSelection = (photoId: string) => {
    if (!folderExportData) return;
    setFolderExportData({
      ...folderExportData,
      selectedPhotos: toggleVaultExportSelection(folderExportData.selectedPhotos, photoId),
    });
  };

  const toggleFolderExportFileSelection = (fileId: string) => {
    if (!folderExportData) return;
    setFolderExportData({
      ...folderExportData,
      selectedFiles: toggleVaultExportSelection(folderExportData.selectedFiles, fileId),
    });
  };

  const selectAllFolderExportItems = () => {
    if (!folderExportData) return;
    setFolderExportData({
      ...folderExportData,
      selectedPhotos: selectAllVaultExportItems(folderExportData.photos),
      selectedFiles: selectAllVaultExportItems(folderExportData.files),
    });
  };

  const deselectAllFolderExportItems = () => {
    if (!folderExportData) return;
    setFolderExportData({
      ...folderExportData,
      selectedPhotos: new Set(),
      selectedFiles: new Set(),
    });
  };

  const exportSelectedFolderItems = async () => {
    if (!folderExportData) return;
    
    const photosToExport = folderExportData.photos.filter((p: any) => folderExportData.selectedPhotos.has(p.id));
    const filesToExport = folderExportData.files.filter((f: any) => folderExportData.selectedFiles.has(f.id));
    
    if (photosToExport.length === 0 && filesToExport.length === 0) {
      toast.error("No items selected for export");
      return;
    }
    
    setFolderExportDialogOpen(false);
    
    // Use ZIP export for multiple files
    const totalItems = photosToExport.length + filesToExport.length;
    if (totalItems > 1) {
      // Create ZIP
      exportAbortController.current = new AbortController();
      const signal = exportAbortController.current.signal;
      
      setExportProgress({ current: 0, total: totalItems });
      setIsExporting(true);
      
      try {
        const zip = new JSZip();
        const items: ZipExportItem[] = [
          ...photosToExport.map((photo: any) => ({
            id: photo.id,
            kind: "photo" as const,
            url: photo.file_url,
            filename: photo.title || `photo-${photo.id}.jpg`,
          })),
          ...filesToExport.map((file: any) => ({
            id: file.id,
            kind: "file" as const,
            url: file.file_url,
            filename: file.name,
          })),
        ];

        const result = await runZipExport(items, {
          signal,
          isAborted: () => signal.aborted,
          fetchBlob: async (url, sig) => {
            const response = await fetch(url, { signal: sig });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.blob();
          },
          addToZip: (filename, blob) => zip.file(filename, blob),
          onProgress: (processed) => setExportProgress({ current: processed, total: totalItems }),
        });

        const { outcome, message, shouldDownload } = summarizeZipExport(result);

        if (shouldDownload) {
          const zipBlob = await zip.generateAsync({ type: "blob" });
          const blobUrl = window.URL.createObjectURL(zipBlob);
          const link = document.createElement('a');
          link.href = blobUrl;
          link.download = `${folderExportData.folderName}.zip`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          window.URL.revokeObjectURL(blobUrl);
        }

        if (outcome === "cancelled") toast.info(message);
        else if (outcome === "failure") toast.error(message);
        else if (outcome === "partial") toast.warning(message);
        else toast.success(message);
      } catch (error: any) {
        if (signal.aborted || error?.message === "Export cancelled") {
          toast.info("Export cancelled");
        } else {
          toast.error("Export failed");
        }
      } finally {
        setIsExporting(false);
        setExportProgress({ current: 0, total: 0 });
        exportAbortController.current = null;
      }

    } else {
      // Single file - just download
      const item = photosToExport[0] || filesToExport[0];
      if (item) {
        if (photosToExport[0]) {
          await downloadPhotoFile(item.file_url, item.title || `photo-${item.id}.jpg`);
        } else {
          await downloadFile(item.file_url, item.name || 'file');
        }
        toast.success("Downloaded file");
      }
    }
    
    setFolderExportData(null);
  };

  const toggleFolderExclusion = (folderPath: string) => {
    setExcludedFolders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(folderPath)) {
        newSet.delete(folderPath);
      } else {
        newSet.add(folderPath);
      }
      return newSet;
    });
  };

  const getFilteredExportData = () => {
    return excludeVaultExportFolders(
      exportPreviewData.photos,
      exportPreviewData.files,
      excludedFolders,
    );
  };

  const getExportSummary = () => {
    return summarizeVaultExport(
      selectionMode,
      photos || [],
      files || [],
      selectedPhotos,
      selectedFiles,
    );
  };

  const handleExportConfirm = () => {
    if (!pendingExportAction) return;
    setExportConfirmOpen(false);
    
    if (pendingExportAction.type === 'zip') {
      exportAsZip(false);
    } else if (pendingExportAction.type === 'download') {
      exportCurrentFolder();
    } else if (pendingExportAction.type === 'zipAll') {
      openExportPreview();
    }
    setPendingExportAction(null);
  };

  const initiateExport = (type: 'zip' | 'download' | 'zipAll') => {
    setPendingExportAction({ type });
    setExportConfirmOpen(true);
  };

  const confirmExportWithSubfolders = async () => {
    setExportPreviewOpen(false);
    
    const { photos: photosToExport, files: filesToExport } = getFilteredExportData();
    
    if (!photosToExport.length && !filesToExport.length) {
      toast.error("No files to export");
      return;
    }

    exportAbortController.current = new AbortController();
    const signal = exportAbortController.current.signal;

    const totalFiles = photosToExport.length + filesToExport.length;
    setExportProgress({ current: 0, total: totalFiles });
    setIsExporting(true);

    try {
      const result = await buildVaultZip({
        photos: photosToExport,
        files: filesToExport,
        signal,
        onProgress: current => setExportProgress({ current, total: totalFiles }),
        onItemFailure: ({ id, type, error }) =>
          console.error(`Failed to fetch ${type}: ${id}`, error),
      });

      if (!result.blob) {
        toast.error("No files could be added to ZIP");
        return;
      }

      // Generate ZIP and download
      const folderName = currentView.type === "root" 
        ? "vault" 
        : currentView.folderName || (currentView.type === "team" ? currentView.teamName : currentView.clubName) || "export";
      
      const blobUrl = window.URL.createObjectURL(result.blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `${folderName}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);

      toast.success(`Exported ${result.successfulCount} files as ZIP`);
    } catch (error: any) {
      if (error.message === VAULT_EXPORT_CANCELLED_MESSAGE) {
        toast.info("Export cancelled");
      } else {
        console.error("ZIP export failed:", error);
        toast.error("Failed to create ZIP file");
      }
    } finally {
      setIsExporting(false);
      setExportProgress({ current: 0, total: 0 });
      exportAbortController.current = null;
    }
  };

  const exportAsZip = async (includeSubfolders: boolean = false) => {
    const clubId = getCurrentClubId();
    const teamId = getCurrentTeamId();
    const folderId = getCurrentFolderId();

    let photosToExport: any[] = [];
    let filesToExport: any[] = [];

    if (selectionMode) {
      const selected = getSelectedItems();
      photosToExport = selected.photos.map(p => ({ ...p, path: "" }));
      filesToExport = selected.files.map(f => ({ ...f, path: "" }));
    } else if (includeSubfolders && currentView.type !== "root") {
      toast.info("Scanning folders...");
      const allContents = await collectVaultExportContents({ folderId, clubId, teamId });
      photosToExport = allContents.photos;
      filesToExport = allContents.files;
    } else {
      photosToExport = (photos || []).map(p => ({ ...p, path: "" }));
      filesToExport = (files || []).map(f => ({ ...f, path: "" }));
    }

    if (!photosToExport.length && !filesToExport.length) {
      toast.error(selectionMode ? "No files selected" : "No files to export");
      return;
    }

    exportAbortController.current = new AbortController();
    const signal = exportAbortController.current.signal;

    const totalFiles = photosToExport.length + filesToExport.length;
    setExportProgress({ current: 0, total: totalFiles });
    setIsExporting(true);

    try {
      const result = await buildVaultZip({
        photos: photosToExport,
        files: filesToExport,
        signal,
        onProgress: current => setExportProgress({ current, total: totalFiles }),
        onItemFailure: ({ id, type, error }) =>
          console.error(`Failed to fetch ${type}: ${id}`, error),
      });

      if (!result.blob) {
        toast.error("No files could be added to ZIP");
        return;
      }

      // Generate ZIP and download
      const folderName = selectionMode 
        ? "selected-files"
        : currentView.type === "root" 
          ? "vault" 
          : currentView.folderName || (currentView.type === "team" ? currentView.teamName : currentView.clubName) || "export";
      
      const blobUrl = window.URL.createObjectURL(result.blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `${folderName}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);

      toast.success(`Exported ${result.successfulCount} files as ZIP`);
      if (selectionMode) exitSelectionMode();
    } catch (error: any) {
      if (error.message === VAULT_EXPORT_CANCELLED_MESSAGE) {
        toast.info("Export cancelled");
      } else {
        console.error("ZIP export failed:", error);
        toast.error("Failed to create ZIP file");
      }
    } finally {
      setIsExporting(false);
      setExportProgress({ current: 0, total: 0 });
      exportAbortController.current = null;
    }
  };

  if (isLoadingAccess) {
    return (
      <div className="py-6 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!canAccessVault) {
    // Determine if it's a role issue or a Pro subscription issue
    const hasProButNoRole = vaultAccessContextHasPro && !hasVaultRoleAccess;
    
    return (
      <div className="py-6 space-y-6">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
        </div>
        <Card className="border-primary/20 bg-primary/5 max-w-lg mx-auto">
          <CardContent className="p-8 text-center">
            <div className="p-4 rounded-full bg-primary/10 w-fit mx-auto mb-4">
              <Lock className="h-8 w-8 text-primary" />
            </div>
            {hasProButNoRole ? (
              <>
                <h3 className="font-semibold text-lg mb-2">Permission Required</h3>
                <p className="text-muted-foreground text-sm mb-4">
                  The File Vault is only accessible to club admins, team admins, coaches, and committee members.
                </p>
              </>
            ) : (
              <>
                <h3 className="font-semibold text-lg mb-2">Vault is a Pro Feature</h3>
                <p className="text-muted-foreground text-sm mb-4">
                  Upgrade to Pro to unlock file storage.
                </p>
                <Badge variant="secondary" className="mb-4 bg-primary/20 text-primary">
                  <Crown className="h-3 w-3 mr-1" /> Pro Only
                </Badge>
                {(adminUpgradeInfo.clubId || adminUpgradeInfo.teamId) && (
                  <div className="mt-4">
                    <Link to={adminUpgradeInfo.teamId ? `/teams/${adminUpgradeInfo.teamId}/upgrade` : `/clubs/${adminUpgradeInfo.clubId}/upgrade`}>
                      <Button size="sm">
                        <Crown className="h-4 w-4 mr-2" />
                        Upgrade to Pro
                      </Button>
                    </Link>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={currentView.type === "root" ? "py-6 space-y-6" : "pt-3 pb-6 space-y-4"}>
      {/* Header - different for root vs inner views */}
      {currentView.type === "root" ? (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 h-10 w-10"
              onClick={() => navigate(-1)}
              aria-label="Go back"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-primary/10">
                <FolderOpen className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="text-lg font-semibold">Vault</h1>
                <p className="text-xs text-muted-foreground">Club file storage</p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {(() => {
            const nodes = getHierarchyNodes();
            const current = nodes[nodes.length - 1];
            const parents = nodes.slice(0, -1);
            return (
              <div className="flex items-center gap-1 min-w-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 -ml-2 h-10 w-10"
                  onClick={goBack}
                  aria-label="Go back"
                >
                  <ArrowLeft className="h-5 w-5" />
                </Button>
                <div className="min-w-0 flex-1">
                  <h1 className="text-lg font-semibold leading-tight truncate">
                    {current?.label ?? "Vault"}
                  </h1>
                  {parents.length > 0 && (
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
                      {parents.map((node, i) => (
                        <span key={node.key} className="flex items-center gap-1 min-w-0">
                          <button
                            type="button"
                            onClick={node.onClick}
                            className="px-1.5 py-0.5 -mx-1 rounded-md hover:bg-muted active:bg-muted/70 transition-colors max-w-[160px] truncate text-foreground/70 hover:text-foreground touch-manipulation"
                          >
                            {node.label}
                          </button>
                          {i < parents.length - 1 && (
                            <ChevronRight className="h-3 w-3 shrink-0 opacity-60" />
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}


        
          {/* Compact Storage Bar - always visible */}
          {currentClub && (
            <VaultStoragePanel
              storagePercentage={PRO_STORAGE_LIMIT > 0
                ? Math.min(100, Math.max(0, (totalClubStorageUsed / PRO_STORAGE_LIMIT) * 100))
                : 0}
              usageLabel={`${formatStorageSize(totalClubStorageUsed)} / ${5 + (purchasedStorageGb || 0)} GB`}
              isStorageLimitReached={isStorageLimitReached}
              headerActions={!canUpload && !selectionMode && !isExporting ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Storage actions">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="bg-popover">
                    {(photos?.length > 0 || files?.length > 0) && !showTrash && (
                      <DropdownMenuItem onClick={() => setSelectionMode(true)}>
                        <CheckSquare className="h-4 w-4 mr-2" />
                        Select
                      </DropdownMenuItem>
                    )}
                    {(photos?.length > 0 || files?.length > 0 || subfolders?.length > 0) && (
                      <>
                        <DropdownMenuItem onClick={() => initiateExport("zip")}>
                          <FileArchive className="h-4 w-4 mr-2" />
                          Export as ZIP
                        </DropdownMenuItem>
                        {subfolders && subfolders.length > 0 && (
                          <DropdownMenuItem onClick={() => initiateExport("zipAll")}>
                            <FolderDown className="h-4 w-4 mr-2" />
                            ZIP All (with subfolders)
                          </DropdownMenuItem>
                        )}
                      </>
                    )}
                    {(isClubAdmin || isAppAdmin) && (
                      <DropdownMenuItem onClick={() => setShowTrash(!showTrash)}>
                        {showTrash ? (
                          <>
                            <FolderOpen className="h-4 w-4 mr-2" />
                            View Files
                          </>
                        ) : (
                          <>
                            <Trash2 className="h-4 w-4 mr-2" />
                            View Trash
                          </>
                        )}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : undefined}
              viewType={currentView.type === "team"
                ? "team"
                : currentView.type === "club" ? "club" : "other"}
              currentTeamStorageUsed={currentTeamStorageUsed}
              totalClubStorageUsed={totalClubStorageUsed}
              breakdown={storageBreakdown}
              showLargeFilesAction={(totalClubStorageUsed / PRO_STORAGE_LIMIT) >= 0.8}
              showStoragePurchaseAction={Boolean(isClubAdmin)}
              storagePurchaseLabel={purchasedStorageGb > 0 ? "Manage Storage" : "Buy Storage"}
              onManageLargeFiles={() => {
                setLargeFilesDialogOpen(true);
                fetchLargeFiles();
              }}
              onManageStorage={() => setStoragePurchaseDialogOpen(true)}
              formatSize={formatStorageSize}
            />
          )}
          
          <div className="flex items-center gap-2 flex-wrap sm:ml-auto">
            <TooltipProvider>
              {/* Selection Mode Controls - visible when there's content */}
              {(photos?.length > 0 || files?.length > 0) && !showTrash && selectionMode && (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={selectAll}
                      >
                        <CheckSquare className="h-4 w-4 mr-1" />
                        Select All
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Select all photos and files</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={exitSelectionMode}
                      >
                        <X className="h-4 w-4 mr-1" />
                        Cancel
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Exit selection mode</TooltipContent>
                  </Tooltip>
                  {selectedCount > 0 && (
                    <>
                      {isExporting ? (
                        <>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            disabled
                            className="min-w-[80px]"
                          >
                            <Loader2 className="h-4 w-4 animate-spin mr-1" />
                            <span className="text-xs">{exportProgress.current}/{exportProgress.total}</span>
                          </Button>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button 
                                variant="destructive" 
                                size="sm" 
                                onClick={cancelExport}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Cancel export</TooltipContent>
                          </Tooltip>
                        </>
                      ) : (
                        <>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button 
                                variant="default" 
                                size="sm" 
                                onClick={() => initiateExport('zip')}
                              >
                                <FileArchive className="h-4 w-4 mr-1" />
                                Export ({selectedCount})
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Export {selectedCount} selected items as ZIP</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button 
                                variant="outline" 
                                size="sm" 
                                onClick={() => initiateExport('download')}
                              >
                                <Download className="h-4 w-4 mr-1" />
                                Download ({selectedCount})
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Download {selectedCount} selected items individually</TooltipContent>
                          </Tooltip>
                          {(isClubAdmin || isAppAdmin) && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button 
                                variant="destructive" 
                                size="sm" 
                                onClick={() => setBulkDeleteDialogOpen(true)}
                              >
                                <Trash2 className="h-4 w-4 mr-1" />
                                Delete ({selectedCount})
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Delete {selectedCount} selected items</TooltipContent>
                          </Tooltip>
                          )}
                        </>
                      )}
                    </>
                  )}
                </>
              )}
              
              {/* Export progress when exporting */}
              {!selectionMode && isExporting && (
                <>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    disabled
                    className="min-w-[80px]"
                  >
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    <span className="text-xs">{exportProgress.current}/{exportProgress.total}</span>
                  </Button>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button 
                        variant="destructive" 
                        size="sm" 
                        onClick={cancelExport}
                      >
                        <X className="h-4 w-4 mr-1" />
                        Cancel
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Cancel export</TooltipContent>
                  </Tooltip>
                </>
              )}

              {/* Main toolbar - only when not in selection mode or exporting */}
              {!selectionMode && !isExporting && (
                <>
                  {/* Primary Upload Button - always visible */}
                  {canUpload && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button size="sm" onClick={() => setUploadDialogOpen(true)}>
                          <Upload className="h-4 w-4 mr-1" /> Upload
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Upload photos or files</TooltipContent>
                    </Tooltip>
                  )}

                  {/* Add Dropdown - New Folder, Add Link, Import from Drive */}
                  {canUpload && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm">
                          <Plus className="h-4 w-4 mr-1" /> Add
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="bg-popover">
                        <DropdownMenuItem onClick={() => setNewFolderDialogOpen(true)}>
                          <FolderPlus className="h-4 w-4 mr-2" />
                          New Folder
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setAddLinkDialogOpen(true)}>
                          <Link2 className="h-4 w-4 mr-2" />
                          Add Link
                        </DropdownMenuItem>
                        {isClubAdmin && Capacitor.getPlatform() !== 'ios' && 'clubId' in currentView && isVaultDriveEnabled(currentView.clubId) && (
                          <DropdownMenuItem onClick={() => setGoogleDriveImportOpen(true)}>
                            <CloudDownload className="h-4 w-4 mr-2" />
                            Import from Drive
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}

                  {/* More Dropdown - Export, ZIP All, View Trash - only shown here when user can upload */}
                  {canUpload && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="icon" className="h-9 w-9">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="bg-popover">
                        {(photos?.length > 0 || files?.length > 0) && !showTrash && (
                          <DropdownMenuItem onClick={() => setSelectionMode(true)}>
                            <CheckSquare className="h-4 w-4 mr-2" />
                            Select
                          </DropdownMenuItem>
                        )}
                        {(photos?.length > 0 || files?.length > 0 || subfolders?.length > 0) && (
                          <>
                            <DropdownMenuItem onClick={() => initiateExport('zip')}>
                              <FileArchive className="h-4 w-4 mr-2" />
                              Export as ZIP
                            </DropdownMenuItem>
                            {(subfolders && subfolders.length > 0) && (
                              <DropdownMenuItem onClick={() => initiateExport('zipAll')}>
                                <FolderDown className="h-4 w-4 mr-2" />
                                ZIP All (with subfolders)
                              </DropdownMenuItem>
                            )}
                          </>
                        )}
                        {(isClubAdmin || isAppAdmin) && (
                          <DropdownMenuItem onClick={() => setShowTrash(!showTrash)}>
                            {showTrash ? (
                              <>
                                <FolderOpen className="h-4 w-4 mr-2" />
                                View Files
                              </>
                            ) : (
                              <>
                                <Trash2 className="h-4 w-4 mr-2" />
                                View Trash
                              </>
                            )}
                          </DropdownMenuItem>
                        )}
                        {isClubAdmin && Capacitor.getPlatform() !== 'ios' && 'clubId' in currentView && isVaultDriveEnabled(currentView.clubId) && (
                          <DropdownMenuItem onClick={() => setLinkDriveFolderOpen(true)}>
                            <RefreshCw className="h-4 w-4 mr-2" />
                            Sync with Drive folder
                          </DropdownMenuItem>
                        )}
                        {isClubAdmin && (
                          <DropdownMenuItem
                            onClick={handleResolveDriveTitles}
                            disabled={resolvingDriveTitles}
                          >
                            {resolvingDriveTitles ? (
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                              <Sheet className="h-4 w-4 mr-2" />
                            )}
                            Fetch real Google titles
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </>
              )}
            </TooltipProvider>

            {/* Dialogs - always rendered */}
            <CreateFolderDialog
              open={newFolderDialogOpen}
              onOpenChange={setNewFolderDialogOpen}
              onCreateFolder={(name) => createFolderMutation.mutate(name)}
              isCreating={createFolderMutation.isPending}
            />
            
            <UploadFilesDialog
              open={uploadDialogOpen}
              onOpenChange={setUploadDialogOpen}
              onUpload={handleDialogUpload}
              isUploading={uploading}
              targetName={currentView.folderName || (currentView.type === "team" ? currentView.teamName : currentView.type === "club" ? currentView.clubName : "Vault")}
            />

            <AddLinkDialog
              open={addLinkDialogOpen}
              onOpenChange={setAddLinkDialogOpen}
              onAddLink={(url, name) => addLinkMutation.mutate({ url, name })}
              isAdding={addLinkMutation.isPending}
              targetName={currentView.folderName || (currentView.type === "team" ? currentView.teamName : currentView.type === "club" ? currentView.clubName : "Vault")}
            />

            <GoogleDriveImportDialog
              open={googleDriveImportOpen}
              onOpenChange={setGoogleDriveImportOpen}
              onImportComplete={() => {
                refreshVaultImportedContent(queryClient);
              }}
              targetFolderId={currentView.type === "team" || currentView.type === "mini-league" ? (currentView.folderId || null) : null}
              targetTeamId={currentView.type === "team" ? currentView.teamId : null}
              targetClubId={currentView.clubId}
            />

            {'clubId' in currentView && (
              <LinkDriveFolderDialog
                open={linkDriveFolderOpen}
                onOpenChange={setLinkDriveFolderOpen}
                vaultFolderId={currentView.folderId ?? null}
                clubId={currentView.clubId}
                teamId={currentView.type === "team" ? currentView.teamId : null}
                onChanged={() => {
                  refreshVaultImportedContent(queryClient);
                }}
              />
            )}
          </div>
        </div>
      )}

      {/* Search bar — filter folders, files, and photos in the current view */}
      {currentView.type !== "root" && !showTrash && (
        <div className="space-y-2">
          <div
            className={`relative rounded-md transition-shadow ${
              isFetchingRecursive ? "ring-2 ring-primary/40 ring-offset-0 animate-pulse" : ""
            }`}
          >
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
              {isFetchingRecursive ? (
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              ) : (
                <Search className="h-4 w-4" />
              )}
            </span>
            <Input
              value={vaultSearchQuery}
              onChange={(e) => setVaultSearchQuery(e.target.value)}
              placeholder="Search folders and files..."
              className="pl-9 pr-9"
              aria-busy={isFetchingRecursive}
            />
            {vaultSearchQuery && (
              <button
                type="button"
                onClick={() => setVaultSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-accent"
                aria-label="Clear search"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            )}
          </div>
          {vaultSearchQuery.trim() && (
            <p
              className="text-xs text-muted-foreground px-1 flex items-center gap-1.5"
              role="status"
              aria-live="polite"
            >
              {isFetchingRecursive ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin text-primary" />
                  <span>Searching all nested folders…</span>
                </>
              ) : (
                (() => {
                  const total = displaySubfolders.length + displayPhotos.length + displayFiles.length;
                  if (total === 0) {
                    return <span>No matches for "{vaultSearchQuery}"</span>;
                  }
                  return (
                    <span>
                      {total} {total === 1 ? "match" : "matches"} across all subfolders
                    </span>
                  );
                })()
              )}
            </p>
          )}
        </div>
      )}

      {currentView.type === "root" && (
        <div className="space-y-3">
          {isLoadingClubs ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-muted-foreground">Loading clubs...</p>
            </div>
          ) : !userClubs || userClubs.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="p-8 text-center">
                <FolderOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No clubs found</p>
              </CardContent>
            </Card>
          ) : (
            (activeClubFilter ? userClubs.filter(c => c.id === activeClubFilter) : userClubs).map((club) => {
              const isPro = club.is_pro;
              return (
                <Card
                  key={club.id}
                  className="cursor-pointer hover:bg-accent/50 transition-colors"
                  onClick={() => {
                    if (!isPro) {
                      navigate(`/clubs/${club.id}/upgrade`);
                      return;
                    }
                    setFolderPath([]);
                    setCurrentView({ type: "club", clubId: club.id, clubName: club.name });
                  }}
                >
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <FolderOpen className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium">{club.name}</p>
                      {!isPro && (
                        <p className="text-xs text-muted-foreground">Pro feature — Upgrade to unlock vault</p>
                      )}
                    </div>
                    {!isPro ? (
                      <Lock className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      )}

      {currentView.type === "club" && (
        <div className="space-y-6">
          {/* Teams grouped by team folders - only show at root of club and not in trash view */}
          {!showTrash && !currentView.folderId && clubTeams && clubTeams.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-sm font-medium text-muted-foreground">Teams</h2>
              
              {/* Render team folders with their teams */}
              {teamFolders && teamFolders.length > 0 && teamFolders.map((folder) => {
                const teamsInFolder = clubTeams.filter(team => team.folder_id === folder.id);
                if (teamsInFolder.length === 0) return null;
                
                const colorInfo = getFolderColorClass(folder.color);
                
                return (
                  <div key={folder.id} className="space-y-2">
                    <div className={`flex items-center gap-2 px-2 py-1 rounded-lg ${colorInfo.bgClassName}`}>
                      <FolderOpen className={`h-4 w-4 ${colorInfo.className}`} />
                      <span className="text-sm font-medium">{folder.name}</span>
                      <span className="text-xs text-muted-foreground">({teamsInFolder.length})</span>
                    </div>
                    <div className="pl-2 space-y-2">
                      {teamsInFolder.map((team) => (
                        <Card
                          key={team.id}
                          className="cursor-pointer hover:bg-accent/50 transition-colors"
                          onClick={() => {
                            setFolderPath([]);
                            setCurrentView({ 
                              type: "team", 
                              clubId: currentView.clubId, 
                              clubName: currentView.clubName,
                              teamId: team.id, 
                              teamName: team.name 
                            });
                          }}
                        >
                          <CardContent className="p-3 flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-secondary">
                              <FolderOpen className="h-4 w-4 text-secondary-foreground" />
                            </div>
                            <p className="font-medium flex-1 text-sm">{team.name}</p>
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                );
              })}
              
              {/* Uncategorized teams (no folder_id) */}
              {(() => {
                const uncategorizedTeams = clubTeams.filter(team => !team.folder_id);
                if (uncategorizedTeams.length === 0) return null;
                
                // Show header only if there are team folders with teams
                const hasTeamFolders = teamFolders && teamFolders.some(folder => 
                  clubTeams.some(team => team.folder_id === folder.id)
                );
                
                return (
                  <div className="space-y-2">
                    {hasTeamFolders && (
                      <div className="flex items-center gap-2 px-2 py-1 rounded-lg bg-muted/50">
                        <FolderOpen className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium text-muted-foreground">Other Teams</span>
                        <span className="text-xs text-muted-foreground">({uncategorizedTeams.length})</span>
                      </div>
                    )}
                    <div className={hasTeamFolders ? "pl-2 space-y-2" : "space-y-2"}>
                      {uncategorizedTeams.map((team) => (
                        <Card
                          key={team.id}
                          className="cursor-pointer hover:bg-accent/50 transition-colors"
                          onClick={() => {
                            setFolderPath([]);
                            setCurrentView({ 
                              type: "team", 
                              clubId: currentView.clubId, 
                              clubName: currentView.clubName,
                              teamId: team.id, 
                              teamName: team.name 
                            });
                          }}
                        >
                          <CardContent className="p-3 flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-secondary">
                              <FolderOpen className="h-4 w-4 text-secondary-foreground" />
                            </div>
                            <p className="font-medium flex-1 text-sm">{team.name}</p>
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Mini-Leagues - only show at root of club and not in trash view */}
          {!showTrash && !currentView.folderId && clubMiniLeagues && clubMiniLeagues.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-sm font-medium text-muted-foreground">Mini-Leagues</h2>
              <div className="space-y-2">
                {clubMiniLeagues.map((league) => (
                  <Card
                    key={league.id}
                    className="cursor-pointer hover:bg-accent/50 transition-colors"
                    onClick={() => {
                      setFolderPath([]);
                      setCurrentView({ 
                        type: "mini-league", 
                        clubId: currentView.clubId, 
                        clubName: currentView.clubName,
                        miniLeagueId: league.id, 
                        miniLeagueName: league.name 
                      });
                    }}
                  >
                    <CardContent className="p-3 flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-accent">
                        <FolderOpen className="h-4 w-4 text-accent-foreground" />
                      </div>
                      <p className="font-medium flex-1 text-sm">{league.name}</p>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Subfolders - hide when in trash view */}
          {!showTrash && displaySubfolders && displaySubfolders.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-medium text-muted-foreground">Folders</h2>
              {displaySubfolders.map((folder) => (
                <VaultFolderCard
                  key={folder.id}
                  folder={folder}
                  searchQuery={normalizedSearch}
                  onNavigate={() => navigateToFolder({ id: folder.id, name: folder.name })}
                  onShare={() => shareFolder(folder.id)}
                  onExport={() => openFolderExportDialog({ id: folder.id, name: folder.name })}
                  onRename={() => {
                    setRenameFolderId(folder.id);
                    setRenameFolderName(folder.name);
                  }}
                  onDelete={() => setDeleteFolderId(folder.id)}
                  canEdit={canDeleteFolder(folder)}
                />
              ))}
            </div>
          )}

          {/* Club-level content - hide when in trash view */}
          {!showTrash && (
            <ContentSection 
              searchQuery={normalizedSearch}
              photos={displayPhotos || []} 
              files={displayFiles || []} 
              onPhotoClick={openLightbox}
              canDeletePhoto={canDeletePhoto}
              canDeleteFile={canDeleteFile}
              canRenamePhoto={canRenamePhoto}
              canRenameFile={canRenameFile}
              canMoveFile={canRenameFile}
              onDeletePhoto={setDeletePhotoId}
              onDeleteFile={setDeleteFileId}
              onRenamePhoto={(photo) => {
                setRenamePhotoId(photo.id);
                setRenamePhotoName(photo.title || "");
              }}
              onRenameFile={(file) => {
                setRenameFileId(file.id);
                setRenameFileName(file.name);
              }}
              onMoveFile={(file) => {
                setFileToMove({ id: file.id, name: file.name, folder_id: file.folder_id, team_id: file.team_id });
                setMoveFileDialogOpen(true);
              }}
              onDownloadPhoto={downloadPhotoFile}
              selectionMode={selectionMode}
              selectedPhotos={selectedPhotos}
              selectedFiles={selectedFiles}
              onTogglePhotoSelection={togglePhotoSelection}
              onToggleFileSelection={toggleFileSelection}
            />
          )}

          {/* Trash view - flat list of all deleted items */}
          {showTrash && (
            <TrashSection
              photos={trashItems?.photos || []}
              files={trashItems?.files || []}
              isLoading={isLoadingTrash}
              onRestorePhoto={(id) => { setRestoreItemType("photo"); setRestoreItemId(id); }}
              onRestoreFile={(id) => { setRestoreItemType("file"); setRestoreItemId(id); }}
              onPermanentDeletePhoto={isClubAdmin ? setDeletePhotoId : undefined}
              onPermanentDeleteFile={isClubAdmin ? setDeleteFileId : undefined}
              onEmptyTrash={isClubAdmin ? emptyTrash : undefined}
              isEmptyingTrash={isEmptyingTrash}
            />
          )}
        </div>
      )}

      {currentView.type === "team" && (
        <div className="space-y-6">
          {/* Subfolders - hide when in trash view */}
          {!showTrash && displaySubfolders && displaySubfolders.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-medium text-muted-foreground">Folders</h2>
              {displaySubfolders.map((folder) => (
                <VaultFolderCard
                  key={folder.id}
                  folder={folder}
                  searchQuery={normalizedSearch}
                  onNavigate={() => navigateToFolder({ id: folder.id, name: folder.name })}
                  onShare={() => shareFolder(folder.id)}
                  onExport={() => openFolderExportDialog({ id: folder.id, name: folder.name })}
                  onRename={() => {
                    setRenameFolderId(folder.id);
                    setRenameFolderName(folder.name);
                  }}
                  onDelete={() => setDeleteFolderId(folder.id)}
                  canEdit={canDeleteFolder(folder)}
                />
              ))}
            </div>
          )}

          {/* Team content - hide when in trash view */}
          {!showTrash && (
            <ContentSection 
              searchQuery={normalizedSearch}
              photos={displayPhotos || []} 
              files={displayFiles || []} 
              onPhotoClick={openLightbox}
              canDeletePhoto={canDeletePhoto}
              canDeleteFile={canDeleteFile}
              canRenamePhoto={canRenamePhoto}
              canRenameFile={canRenameFile}
              canMoveFile={canRenameFile}
              onDeletePhoto={setDeletePhotoId}
              onDeleteFile={setDeleteFileId}
              onRenamePhoto={(photo) => {
                setRenamePhotoId(photo.id);
                setRenamePhotoName(photo.title || "");
              }}
              onRenameFile={(file) => {
                setRenameFileId(file.id);
                setRenameFileName(file.name);
              }}
              onMoveFile={(file) => {
                setFileToMove({ id: file.id, name: file.name, folder_id: file.folder_id, team_id: file.team_id });
                setMoveFileDialogOpen(true);
              }}
              onDownloadPhoto={downloadPhotoFile}
              selectionMode={selectionMode}
              selectedPhotos={selectedPhotos}
              selectedFiles={selectedFiles}
              onTogglePhotoSelection={togglePhotoSelection}
              onToggleFileSelection={toggleFileSelection}
            />
          )}

          {/* Trash view - flat list of all deleted items */}
          {showTrash && (
            <TrashSection
              photos={trashItems?.photos || []}
              files={trashItems?.files || []}
              isLoading={isLoadingTrash}
              onRestorePhoto={(id) => { setRestoreItemType("photo"); setRestoreItemId(id); }}
              onRestoreFile={(id) => { setRestoreItemType("file"); setRestoreItemId(id); }}
              onPermanentDeletePhoto={isClubAdmin ? setDeletePhotoId : undefined}
              onPermanentDeleteFile={isClubAdmin ? setDeleteFileId : undefined}
              onEmptyTrash={isClubAdmin ? emptyTrash : undefined}
              isEmptyingTrash={isEmptyingTrash}
            />
          )}
        </div>
      )}

      {currentView.type === "mini-league" && (
        <div className="space-y-6">
          {/* Mini-league content - photos only for now */}
          <ContentSection 
            searchQuery={normalizedSearch}
            photos={displayPhotos || []} 
            files={[]} 
            onPhotoClick={openLightbox}
            canDeletePhoto={canDeletePhoto}
            canDeleteFile={() => false}
            canRenamePhoto={canRenamePhoto}
            canRenameFile={() => false}
            onDeletePhoto={setDeletePhotoId}
            onDeleteFile={() => {}}
            onRenamePhoto={(photo) => {
              setRenamePhotoId(photo.id);
              setRenamePhotoName(photo.title || "");
            }}
            onRenameFile={() => {}}
            onDownloadPhoto={downloadPhotoFile}
            selectionMode={selectionMode}
            selectedPhotos={selectedPhotos}
            selectedFiles={selectedFiles}
            onTogglePhotoSelection={togglePhotoSelection}
            onToggleFileSelection={toggleFileSelection}
          />
        </div>
      )}

      {/* Photo Lightbox */}
      <PhotoLightbox
        isOpen={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
        photos={photos || []}
        currentIndex={lightboxIndex}
        onNavigate={setLightboxIndex}
        onDelete={handleLightboxDelete}
        canDelete={photos?.[lightboxIndex] ? canDeletePhoto(photos[lightboxIndex]) : false}
      />

      <VaultMutationConfirmationDialogs
        photoDelete={{
          open: Boolean(deletePhotoId),
          permanent: showTrash,
          onOpenChange: () => setDeletePhotoId(null),
          onConfirm: () => {
            if (!deletePhotoId) return;
            if (showTrash) permanentDeletePhotoMutation.mutate(deletePhotoId);
            else deletePhotoMutation.mutate(deletePhotoId);
          },
        }}
        fileDelete={{
          open: Boolean(deleteFileId),
          permanent: showTrash,
          onOpenChange: () => setDeleteFileId(null),
          onConfirm: () => {
            if (!deleteFileId) return;
            if (showTrash) permanentDeleteFileMutation.mutate(deleteFileId);
            else deleteFileMutation.mutate(deleteFileId);
          },
        }}
        restoreOpen={Boolean(restoreItemId)}
        restoreItemType={restoreItemType}
        onRestoreOpenChange={() => setRestoreItemId(null)}
        onRestore={() => {
          if (!restoreItemId) return;
          if (restoreItemType === "photo") restorePhotoMutation.mutate(restoreItemId);
          else restoreFileMutation.mutate(restoreItemId);
          setRestoreItemId(null);
        }}
        bulkDeleteOpen={bulkDeleteDialogOpen}
        selectedCount={selectedCount}
        deletingSelected={isDeletingSelected}
        onBulkDeleteOpenChange={setBulkDeleteDialogOpen}
        onBulkDelete={deleteSelectedItems}
        folderDeleteOpen={Boolean(deleteFolderId)}
        onFolderDeleteOpenChange={() => setDeleteFolderId(null)}
        onFolderDelete={() => deleteFolderId && deleteFolderMutation.mutate(deleteFolderId)}
      />

      <VaultLargeFilesDialog
        open={largeFilesDialogOpen}
        onOpenChange={(open) => {
          setLargeFilesDialogOpen(open);
          if (!open) setSelectedLargeFiles(new Set());
        }}
        loading={largeFilesData.loading}
        items={largeFilesData.items}
        sortBy={largeFilesSortBy}
        onSortChange={setLargeFilesSortBy}
        selectedIds={selectedLargeFiles}
        onToggleSelection={toggleLargeFileSelection}
        onDeleteSelected={deleteSelectedLargeFiles}
        deleting={deletingLargeFiles}
        formatSize={formatStorageSize}
      />

      <VaultRenameDialogs
        folder={{
          open: Boolean(renameFolderId),
          value: renameFolderName,
          onOpenChange: (open) => {
            if (!open) {
              setRenameFolderId(null);
              setRenameFolderName("");
            }
          },
          onValueChange: setRenameFolderName,
          onRename: () => renameFolderId && renameFolderMutation.mutate({
            folderId: renameFolderId,
            newName: renameFolderName,
          }),
        }}
        file={{
          open: Boolean(renameFileId),
          value: renameFileName,
          onOpenChange: (open) => {
            if (!open) {
              setRenameFileId(null);
              setRenameFileName("");
            }
          },
          onValueChange: setRenameFileName,
          onRename: () => renameFileId && renameFileMutation.mutate({
            fileId: renameFileId,
            newName: renameFileName,
          }),
        }}
        photo={{
          open: Boolean(renamePhotoId),
          value: renamePhotoName,
          onOpenChange: (open) => {
            if (!open) {
              setRenamePhotoId(null);
              setRenamePhotoName("");
            }
          },
          onValueChange: setRenamePhotoName,
          onRename: () => renamePhotoId && renamePhotoMutation.mutate({
            photoId: renamePhotoId,
            newName: renamePhotoName,
          }),
        }}
      />

      <VaultExportDialogs
        previewOpen={exportPreviewOpen}
        onPreviewOpenChange={setExportPreviewOpen}
        previewLoading={exportPreviewData.loading}
        previewPhotoCount={getFilteredExportData().photos.length}
        previewFileCount={getFilteredExportData().files.length}
        folderBreakdown={exportPreviewData.folderBreakdown}
        excludedFolders={excludedFolders}
        onToggleFolderExclusion={toggleFolderExclusion}
        onConfirmPreview={confirmExportWithSubfolders}
        confirmOpen={exportConfirmOpen}
        onConfirmOpenChange={setExportConfirmOpen}
        summary={getExportSummary()}
        pendingType={pendingExportAction?.type ?? null}
        onCancelConfirmation={() => setPendingExportAction(null)}
        onConfirmExport={handleExportConfirm}
      />

      <VaultFolderExportDialog
        open={folderExportDialogOpen}
        onOpenChange={(open) => {
          setFolderExportDialogOpen(open);
          if (!open) setFolderExportData(null);
        }}
        folderName={folderExportData?.folderName}
        loading={folderExportData?.loading ?? false}
        photos={folderExportData?.photos ?? []}
        files={folderExportData?.files ?? []}
        selectedPhotoIds={folderExportData?.selectedPhotos ?? new Set()}
        selectedFileIds={folderExportData?.selectedFiles ?? new Set()}
        onTogglePhoto={toggleFolderExportPhotoSelection}
        onToggleFile={toggleFolderExportFileSelection}
        onSelectAll={selectAllFolderExportItems}
        onDeselectAll={deselectAllFolderExportItems}
        onExport={exportSelectedFolderItems}
      />

      {/* Storage Purchase Dialog */}
      {currentClub && (
        <StoragePurchaseDialog
          open={storagePurchaseDialogOpen}
          onOpenChange={setStoragePurchaseDialogOpen}
          clubId={currentClub.id}
          clubName={currentClub.name}
          currentStorageLimit={PRO_STORAGE_LIMIT}
          purchasedStorageGb={purchasedStorageGb}
          scheduledDowngradeGb={scheduledDowngradeGb}
          storageDowngradeAt={storageDowngradeAt}
        />
      )}

      {/* Move File Dialog */}
      <MoveFileDialog
        open={moveFileDialogOpen}
        onOpenChange={setMoveFileDialogOpen}
        file={fileToMove}
        teamId={currentView.type === "team" ? currentView.teamId : null}
        clubId={currentView.type === "club" || currentView.type === "team" ? currentView.clubId : null}
        onMove={(fileId, targetFolderId, targetTeamId) => moveFileMutation.mutate({ fileId, targetFolderId, targetTeamId })}
        isMoving={moveFileMutation.isPending}
      />
    </div>
  );
}

// Helper function to format file sizes
function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return '';
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  } else if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  } else if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

// Helper function to check if a file is a spreadsheet
function isSpreadsheetFile(fileName: string): boolean {
  const spreadsheetExtensions = ['.xlsx', '.xls', '.csv', '.ods', '.tsv'];
  const lowerName = fileName.toLowerCase();
  return spreadsheetExtensions.some(ext => lowerName.endsWith(ext));
}

// Helper function to check if a file is a document (Word, PDF, etc.)
function isDocumentFile(fileName: string): boolean {
  const documentExtensions = ['.doc', '.docx', '.pdf', '.txt', '.rtf', '.odt', '.ppt', '.pptx', '.odp'];
  const lowerName = fileName.toLowerCase();
  return documentExtensions.some(ext => lowerName.endsWith(ext));
}

// Helper function to detect external link type from URL
function getExternalLinkInfo(url: string): { type: string; icon: string; color: string } | null {
  const lowerUrl = url.toLowerCase();
  
  if (lowerUrl.includes('docs.google.com/document')) {
    return { type: 'Google Doc', icon: '📄', color: 'text-blue-600' };
  }
  if (lowerUrl.includes('docs.google.com/spreadsheets')) {
    return { type: 'Google Sheet', icon: '📊', color: 'text-green-600' };
  }
  if (lowerUrl.includes('docs.google.com/presentation')) {
    return { type: 'Google Slides', icon: '📽️', color: 'text-yellow-600' };
  }
  if (lowerUrl.includes('drive.google.com')) {
    return { type: 'Google Drive', icon: '📁', color: 'text-blue-500' };
  }
  if (lowerUrl.includes('dropbox.com')) {
    return { type: 'Dropbox', icon: '📦', color: 'text-blue-500' };
  }
  if (lowerUrl.includes('notion.so') || lowerUrl.includes('notion.site')) {
    return { type: 'Notion', icon: '📝', color: 'text-foreground' };
  }
  if (lowerUrl.includes('onedrive.live.com') || lowerUrl.includes('sharepoint.com')) {
    return { type: 'OneDrive', icon: '☁️', color: 'text-blue-600' };
  }
  
  return { type: 'External Link', icon: '🔗', color: 'text-muted-foreground' };
}

// Helper function to download and open in external service
function downloadAndOpenExternal(
  fileUrl: string, 
  fileName: string, 
  serviceUrl: string,
  serviceName: string,
  instructions: string,
  showToast: (msg: string, opts?: { description?: string }) => void
): void {
  // Download the file first
  const link = document.createElement('a');
  link.href = fileUrl;
  link.download = fileName;
  link.click();
  
  // Show toast with instructions
  showToast("File downloaded!", {
    description: `Opening ${serviceName}... ${instructions}`
  });
  
  // Open the service after a brief delay
  setTimeout(async () => {
    const { safeOpenUrl } = await import("@/lib/safeOpenUrl");
    safeOpenUrl(serviceUrl);
  }, 500);
}

// Helper function to open a file in Google Sheets
function openInGoogleSheets(fileUrl: string, fileName: string, showToast: (msg: string, opts?: { description?: string }) => void): void {
  downloadAndOpenExternal(
    fileUrl, 
    fileName, 
    "https://docs.google.com/spreadsheets/create",
    "Google Sheets",
    "Use File > Import to open your downloaded file.",
    showToast
  );
}

// Helper function to open a file in Google Drive
function openInGoogleDrive(fileUrl: string, fileName: string, showToast: (msg: string, opts?: { description?: string }) => void): void {
  downloadAndOpenExternal(
    fileUrl, 
    fileName, 
    "https://drive.google.com/drive/my-drive",
    "Google Drive",
    "Click 'New' > 'File upload' to upload your downloaded file.",
    showToast
  );
}

// Helper function to open a file in Dropbox
function openInDropbox(fileUrl: string, fileName: string, showToast: (msg: string, opts?: { description?: string }) => void): void {
  downloadAndOpenExternal(
    fileUrl, 
    fileName, 
    "https://www.dropbox.com/home",
    "Dropbox",
    "Click 'Upload' to add your downloaded file.",
    showToast
  );
}

interface ContentSectionProps {
  photos: any[];
  files: any[];
  onPhotoClick: (index: number) => void;
  canDeletePhoto: (photo: any) => boolean;
  canDeleteFile: (file: any) => boolean;
  canRenamePhoto?: (photo: any) => boolean;
  canRenameFile?: (file: any) => boolean;
  canMoveFile?: (file: any) => boolean;
  onDeletePhoto: (id: string) => void;
  onDeleteFile: (id: string) => void;
  onRenamePhoto?: (photo: any) => void;
  onRenameFile?: (file: any) => void;
  onMoveFile?: (file: any) => void;
  onDownloadPhoto?: (url: string, filename: string) => void;
  // Selection mode props
  selectionMode?: boolean;
  selectedPhotos?: Set<string>;
  selectedFiles?: Set<string>;
  onTogglePhotoSelection?: (id: string) => void;
  onToggleFileSelection?: (id: string) => void;
  // Trash mode props
  isTrashView?: boolean;
  onRestorePhoto?: (id: string) => void;
  onRestoreFile?: (id: string) => void;
  onPermanentDeletePhoto?: (id: string) => void;
  onPermanentDeleteFile?: (id: string) => void;
  searchQuery?: string;
}

function ContentSection({ 
  photos, 
  files, 
  onPhotoClick,
  canDeletePhoto,
  canDeleteFile,
  canRenamePhoto,
  canRenameFile,
  canMoveFile,
  onDeletePhoto,
  onDeleteFile,
  onRenamePhoto,
  onRenameFile,
  onMoveFile,
  onDownloadPhoto,
  selectionMode = false,
  selectedPhotos,
  selectedFiles,
  onTogglePhotoSelection,
  onToggleFileSelection,
  isTrashView = false,
  onRestorePhoto,
  onRestoreFile,
  onPermanentDeletePhoto,
  onPermanentDeleteFile,
  searchQuery,
}: ContentSectionProps) {
  const hasContent = photos.length > 0 || files.length > 0;
  const [actionSheetFile, setActionSheetFile] = useState<any | null>(null);

  if (!hasContent) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-8 text-center">
          <FolderOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">{isTrashView ? "Trash is empty" : "This folder is empty"}</p>
          <p className="text-sm text-muted-foreground mt-1">{isTrashView ? "Deleted files will appear here" : "Upload photos or files to get started"}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {photos.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Photos ({photos.length})</h2>
          <div className="grid grid-cols-3 gap-2">
            {photos.map((photo, index) => (
              <VaultPhotoItem
                key={photo.id}
                photo={photo}
                index={index}
                onPhotoClick={selectionMode ? () => onTogglePhotoSelection?.(photo.id) : onPhotoClick}
                canDelete={canDeletePhoto(photo)}
                onDelete={onDeletePhoto}
                onDownload={onDownloadPhoto}
                canRename={canRenamePhoto?.(photo)}
                onRename={onRenamePhoto}
                selectionMode={selectionMode}
                isSelected={selectedPhotos?.has(photo.id) || false}
                onToggleSelection={onTogglePhotoSelection}
              />
            ))}
          </div>
        </div>
      )}

      {files.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Files ({files.length})</h2>
          <div className="space-y-2">
            {files.map((file) => {
              const isExternalLink = file.is_external_link;
              const externalLinkInfo = isExternalLink ? getExternalLinkInfo(file.file_url) : null;
              
              return (
              <Card 
                key={file.id} 
                className="group cursor-pointer"
                onClick={() => {
                  // External links go to the browser; stored files hand off to
                  // the native viewer so the real file name is shown.
                  if (isExternalLink) {
                    import("@/lib/safeOpenUrl").then(({ safeOpenUrl }) => safeOpenUrl(file.file_url));
                  } else {
                    import("@/lib/safeOpenFile").then(({ safeOpenFile }) =>
                      safeOpenFile(file.file_url, {
                        fileName: file.name || undefined,
                        mimeType: file.file_type || undefined,
                      }),
                    ).catch(() => {});
                  }
                }}
              >
                <CardContent className="p-3 flex items-center gap-3">
                  {isExternalLink && externalLinkInfo ? (
                    <div className="p-2 rounded-lg bg-muted flex items-center justify-center text-lg">
                      {externalLinkInfo.icon}
                    </div>
                  ) : (
                    <div className={`p-2 rounded-lg ${isSpreadsheetFile(file.name || '') ? 'bg-green-500/10' : 'bg-primary/10'}`}>
                      {isSpreadsheetFile(file.name || '') ? (
                        <FileSpreadsheet className="h-4 w-4 text-green-600" />
                      ) : (
                        <FileText className="h-4 w-4 text-primary" />
                      )}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">
                      <HighlightedText text={file.name} query={searchQuery} />
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {isExternalLink && externalLinkInfo ? (
                        <span className={externalLinkInfo.color}>{externalLinkInfo.type}</span>
                      ) : (
                        <>
                          {format(new Date(file.created_at), "MMM d, yyyy")}
                          {file.file_size ? ` • ${formatFileSize(file.file_size)}` : ''}
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                      {isTrashView ? (
                        <>
                          {onRestoreFile && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-green-600 hover:text-green-700"
                              onClick={(e) => {
                                e.stopPropagation();
                                onRestoreFile(file.id);
                              }}
                            >
                              <RotateCcw className="h-4 w-4" />
                            </Button>
                          )}
                          {onPermanentDeleteFile && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteFile(file.id);
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActionSheetFile(file);
                          }}
                          aria-label="File actions"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                </CardContent>
              </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* File actions bottom sheet */}
      <UISheet open={!!actionSheetFile} onOpenChange={(o) => { if (!o) setActionSheetFile(null); }}>
        <UISheetContent side="bottom" className="rounded-t-xl pb-[max(env(safe-area-inset-bottom),1rem)]">
          {actionSheetFile && (() => {
            const file = actionSheetFile;
            const isExternalLink = file.is_external_link;
            const externalLinkInfo = isExternalLink ? getExternalLinkInfo(file.file_url) : null;
            const close = () => setActionSheetFile(null);
            const Item = ({ icon: Icon, label, onClick, destructive = false }: { icon: any; label: string; onClick: () => void; destructive?: boolean }) => (
              <button
                type="button"
                onClick={() => { onClick(); close(); }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left text-sm hover:bg-accent active:bg-accent transition-colors ${destructive ? 'text-destructive' : 'text-foreground'}`}
              >
                <Icon className="h-5 w-5" />
                <span>{label}</span>
              </button>
            );
            return (
              <>
                <UISheetHeader className="text-left">
                  <UISheetTitle className="truncate">{file.name}</UISheetTitle>
                </UISheetHeader>
                <div className="mt-2 flex flex-col gap-1">
                  {isExternalLink ? (
                    <Item
                      icon={ExternalLink}
                      label={`Open ${externalLinkInfo?.type || 'Link'}`}
                      onClick={() => import("@/lib/safeOpenUrl").then(({ safeOpenUrl }) => safeOpenUrl(file.file_url))}
                    />
                  ) : (
                    <>
                      <Item
                        icon={ExternalLink}
                        label="Open"
                        onClick={() =>
                          import("@/lib/safeOpenFile").then(({ safeOpenFile }) =>
                            safeOpenFile(file.file_url, {
                              fileName: file.name || undefined,
                              mimeType: file.file_type || undefined,
                            }),
                          ).catch(() => {})
                        }
                      />
                      <Item
                        icon={Download}
                        label="Download"
                        onClick={async () => {
                          const { resolveSignedUrl } = await import("@/hooks/useSignedPhotoUrl");
                          const href = await resolveSignedUrl(file.file_url);
                          const a = document.createElement('a');
                          a.href = href;
                          a.download = file.name || '';
                          a.rel = 'noopener';
                          a.target = '_blank';
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);
                        }}
                      />
                    </>
                  )}
                  {!isExternalLink && isSpreadsheetFile(file.name || '') && (
                    <Item
                      icon={Sheet}
                      label="Open in Google Sheets"
                      onClick={() => openInGoogleSheets(file.file_url, file.name || 'spreadsheet', toast)}
                    />
                  )}
                  {!isExternalLink && isDocumentFile(file.name || '') && (
                    <Item
                      icon={HardDrive}
                      label="Open in Google Drive"
                      onClick={() => openInGoogleDrive(file.file_url, file.name || 'document', toast)}
                    />
                  )}
                  {canMoveFile?.(file) && onMoveFile && (
                    <Item icon={FolderDown} label="Move to Folder" onClick={() => onMoveFile(file)} />
                  )}
                  {canRenameFile?.(file) && onRenameFile && (
                    <Item icon={Pencil} label="Rename" onClick={() => onRenameFile(file)} />
                  )}
                  {canDeleteFile(file) && (
                    <Item icon={Trash2} label="Delete" destructive onClick={() => onDeleteFile(file.id)} />
                  )}
                </div>
              </>
            );
          })()}
        </UISheetContent>
      </UISheet>
    </div>
  );
}

// Small component to render signed thumbnail for trash photos
function TrashPhotoThumbnail({ src, alt }: { src: string; alt: string }) {
  const { signedUrl, isLoading } = useSignedPhotoUrl(src);
  const effectiveSrc = signedUrl || src;
  
  if (isLoading) {
    return <div className="h-12 w-12 rounded-lg bg-muted animate-pulse flex-shrink-0" />;
  }
  
  return (
    <img
      src={effectiveSrc}
      alt={alt}
      className="h-12 w-12 object-cover rounded-lg flex-shrink-0"
    />
  );
}

// Trash section component - shows all deleted items in a flat list with original location
interface TrashSectionProps {
  photos: any[];
  files: any[];
  isLoading: boolean;
  onRestorePhoto: (id: string) => void;
  onRestoreFile: (id: string) => void;
  onPermanentDeletePhoto?: (id: string) => void;
  onPermanentDeleteFile?: (id: string) => void;
  onEmptyTrash?: () => void;
  isEmptyingTrash?: boolean;
}

function TrashSection({
  photos,
  files,
  isLoading,
  onRestorePhoto,
  onRestoreFile,
  onPermanentDeletePhoto,
  onPermanentDeleteFile,
  onEmptyTrash,
  isEmptyingTrash,
}: TrashSectionProps) {
  const hasContent = photos.length > 0 || files.length > 0;

  const getLocationPath = (item: any): string => {
    const parts: string[] = [];
    if (item.team?.name) {
      parts.push(item.team.name);
    }
    if (item.folder?.name) {
      parts.push(item.folder.name);
    }
    if (parts.length === 0) {
      return item.team_id ? "Team root" : "Club root";
    }
    return parts.join(" / ");
  };

  if (isLoading) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-8 text-center">
          <Loader2 className="h-8 w-8 mx-auto text-muted-foreground mb-4 animate-spin" />
          <p className="text-muted-foreground">Loading trash...</p>
        </CardContent>
      </Card>
    );
  }

  if (!hasContent) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-8 text-center">
          <Trash2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">Trash is empty</p>
          <p className="text-sm text-muted-foreground mt-1">Deleted files will appear here for recovery</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Auto-purge notice + Empty Trash */}
      <div className="flex items-center justify-between bg-muted/50 rounded-lg p-3">
        <p className="text-xs text-muted-foreground">
          Items in trash are automatically deleted after 30 days.
        </p>
        {onEmptyTrash && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="destructive"
                size="sm"
                disabled={isEmptyingTrash}
              >
                {isEmptyingTrash ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-1" />
                )}
                Empty Trash
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Empty Trash?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete all {photos.length + files.length} item{photos.length + files.length !== 1 ? 's' : ''} in the trash. Files will be removed from storage and cannot be recovered.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={onEmptyTrash}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Yes, empty trash
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {photos.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Deleted Photos ({photos.length})</h2>
          <div className="space-y-2">
            {photos.map((photo) => (
              <Card key={photo.id} className="group">
                <CardContent className="p-3 flex items-center gap-3">
                  <TrashPhotoThumbnail src={photo.file_url} alt={photo.title || "Photo"} />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{photo.title || "Untitled photo"}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <FolderOpen className="h-3 w-3" />
                      {getLocationPath(photo)}
                    </p>
                    {photo.deleted_at && (
                      <p className="text-xs text-muted-foreground">
                        Deleted {format(new Date(photo.deleted_at), "MMM d, yyyy")}
                        {(() => {
                          const daysLeft = Math.max(0, 30 - Math.floor((Date.now() - new Date(photo.deleted_at).getTime()) / (1000 * 60 * 60 * 24)));
                          return ` • Auto-deletes in ${daysLeft}d`;
                        })()}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-green-600 hover:text-green-700 hover:bg-green-50"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRestorePhoto(photo.id);
                      }}
                    >
                      <RotateCcw className="h-4 w-4 mr-1" />
                      Restore
                    </Button>
                    {onPermanentDeletePhoto && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={(e) => {
                          e.stopPropagation();
                          onPermanentDeletePhoto(photo.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        Delete
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {files.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Deleted Files ({files.length})</h2>
          <div className="space-y-2">
            {files.map((file) => (
              <Card key={file.id} className="group">
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <FileText className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{file.name}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <FolderOpen className="h-3 w-3" />
                      {getLocationPath(file)}
                    </p>
                    {file.deleted_at && (
                      <p className="text-xs text-muted-foreground">
                        Deleted {format(new Date(file.deleted_at), "MMM d, yyyy")}
                        {file.file_size ? ` • ${formatFileSize(file.file_size)}` : ''}
                        {(() => {
                          const daysLeft = Math.max(0, 30 - Math.floor((Date.now() - new Date(file.deleted_at).getTime()) / (1000 * 60 * 60 * 24)));
                          return ` • Auto-deletes in ${daysLeft}d`;
                        })()}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-green-600 hover:text-green-700 hover:bg-green-50"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRestoreFile(file.id);
                      }}
                    >
                      <RotateCcw className="h-4 w-4 mr-1" />
                      Restore
                    </Button>
                    {onPermanentDeleteFile && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={(e) => {
                          e.stopPropagation();
                          onPermanentDeleteFile(file.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        Delete
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
