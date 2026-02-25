import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload, X, Check, Loader2, Camera, Crown, ImagePlus, CheckCircle2, XCircle, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { compressImage, formatFileSize } from "@/lib/imageCompression";
import { useClubTheme } from "@/hooks/useClubTheme";
import { Capacitor } from "@capacitor/core";
import { Camera as CapacitorCamera, CameraResultType, CameraSource } from "@capacitor/camera";
import { cameraPhotoToBlob } from "@/lib/binaryUtils";

interface UploadPhotoSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploadingCountChange?: (count: number) => void;
}

interface Club {
  id: string;
  name: string;
  is_pro: boolean;
  has_pro_access?: boolean;
}

interface Team {
  id: string;
  name: string;
  is_pro?: boolean;
}

interface MiniLeague {
  id: string;
  name: string;
}

interface SelectedPhoto {
  id: string;
  file: File;
  originalFile: File;
  previewUrl: string;
  status: 'pending' | 'compressing' | 'uploading' | 'success' | 'error';
  error?: string;
  originalSize: number;
  compressedSize: number;
}


const isCancelledSelectionError = (error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  return message.toLowerCase().includes("cancel");
};

const getReadableUploadError = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return "";
};

export function UploadPhotoSheet({ open, onOpenChange, onUploadingCountChange }: UploadPhotoSheetProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { activeClubFilter } = useClubTheme();
  
  const [selectedClubId, setSelectedClubId] = useState<string>("");
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");
  const [selectedMiniLeagueId, setSelectedMiniLeagueId] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState<SelectedPhoto[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isPickingNativePhoto, setIsPickingNativePhoto] = useState(false);
  const shouldUseNativePhotoPicker = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";

  // Get user roles
  const { data: userRoles } = useQuery({
    queryKey: ["user-roles-upload", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role, club_id, team_id")
        .eq("user_id", user!.id);
      return data || [];
    },
    enabled: !!user,
    staleTime: 300000,
  });

  const isAppAdmin = userRoles?.some(r => r.role === "app_admin") ?? false;

  // Fetch clubs
  const { data: userClubs, isLoading: isLoadingClubs } = useQuery({
    queryKey: ["user-clubs-upload-sheet", user?.id, isAppAdmin, JSON.stringify(userRoles)],
    queryFn: async () => {
      let clubs: Club[] = [];
      
      if (isAppAdmin) {
        const { data } = await supabase
          .from("clubs")
          .select("id, name, is_pro")
          .order("name");
        clubs = data || [];
      } else {
        if (!userRoles || userRoles.length === 0) return [];

        const clubIdsFromRoles = userRoles.map((r) => r.club_id).filter(Boolean) as string[];
        const teamIds = userRoles.map((r) => r.team_id).filter(Boolean) as string[];
        
        let clubIdsFromTeams: string[] = [];
        if (teamIds.length > 0) {
          const { data: teamsData } = await supabase
            .from("teams")
            .select("club_id")
            .in("id", teamIds);
          clubIdsFromTeams = (teamsData || []).map(t => t.club_id).filter(Boolean) as string[];
        }
        
        const allClubIds = [...new Set([...clubIdsFromRoles, ...clubIdsFromTeams])];
        if (allClubIds.length === 0) return [];
        
        const { data: clubsData } = await supabase
          .from("clubs")
          .select("id, name, is_pro")
          .in("id", allClubIds)
          .order("name");
        
        clubs = clubsData || [];
      }

      if (clubs.length === 0) return [];

      const clubIdList = clubs.map(c => c.id);
      const [teamsData, clubSubscriptionsData] = await Promise.all([
        supabase.from("teams").select("id, club_id").in("club_id", clubIdList),
        supabase.from("club_subscriptions").select("club_id, is_pro, is_pro_football").in("club_id", clubIdList),
      ]);

      const teams = teamsData.data || [];
      const clubSubscriptions = clubSubscriptionsData.data || [];

      const teamIds = teams.map(t => t.id);
      const { data: teamSubscriptions } = teamIds.length > 0
        ? await supabase.from("team_subscriptions").select("team_id, is_pro, is_pro_football").in("team_id", teamIds)
        : { data: [] };

      return clubs.map(club => {
        const clubSub = clubSubscriptions.find(cs => cs.club_id === club.id);
        const hasClubPro = clubSub?.is_pro || clubSub?.is_pro_football || club.is_pro;
        
        const clubTeams = teams.filter(t => t.club_id === club.id);
        const hasProTeam = clubTeams.some(team => {
          const teamSub = teamSubscriptions?.find(s => s.team_id === team.id);
          return teamSub?.is_pro || teamSub?.is_pro_football;
        });
        
        return {
          ...club,
          has_pro_access: hasClubPro || hasProTeam
        };
      });
    },
    enabled: !!user && userRoles !== undefined,
  });

  // Fetch teams for selected club - only teams where user has a role
  const { data: userTeams } = useQuery({
    queryKey: ["user-teams-upload-sheet", user?.id, selectedClubId, isAppAdmin, JSON.stringify(userRoles)],
    queryFn: async () => {
      if (!selectedClubId) return [];
      
      // Get user's team IDs from their roles
      const userTeamIds = userRoles?.filter(r => r.team_id).map(r => r.team_id) || [];
      const isClubAdmin = userRoles?.some(r => r.role === "club_admin" && r.club_id === selectedClubId);
      
      let teams: { id: string; name: string }[] = [];
      
      if (isAppAdmin || isClubAdmin) {
        // App admins and club admins can upload to any team in the club
        const { data } = await supabase
          .from("teams")
          .select("id, name")
          .eq("club_id", selectedClubId);
        teams = data || [];
      } else if (userTeamIds.length > 0) {
        // Regular users can only upload to teams they have a role in
        const { data } = await supabase
          .from("teams")
          .select("id, name")
          .eq("club_id", selectedClubId)
          .in("id", userTeamIds);
        teams = data || [];
      }
      
      if (teams.length === 0) return [];
      
      const [subscriptionsResult, clubSubResult, clubDataResult] = await Promise.all([
        supabase.from("team_subscriptions").select("team_id, is_pro, is_pro_football").in("team_id", teams.map(t => t.id)),
        supabase.from("club_subscriptions").select("is_pro, is_pro_football").eq("club_id", selectedClubId).maybeSingle(),
        supabase.from("clubs").select("is_pro").eq("id", selectedClubId).maybeSingle(),
      ]);
      
      const subscriptions = subscriptionsResult.data;
      const clubSub = clubSubResult.data;
      const clubData = clubDataResult.data;
      
      const clubHasProAccess = clubSub?.is_pro || clubSub?.is_pro_football || clubData?.is_pro || false;
      
      if (clubHasProAccess) {
        return teams.map(team => ({ ...team, is_pro: true }));
      }
      
      return teams.filter(team => {
        const teamSub = subscriptions?.find(s => s.team_id === team.id);
        return teamSub?.is_pro || teamSub?.is_pro_football;
      }).map(team => ({ ...team, is_pro: true }));
    },
    enabled: !!user && !!selectedClubId && userRoles !== undefined,
  });

  // Fetch mini-leagues for selected club (Pro Football only)
  const { data: userMiniLeagues } = useQuery({
    queryKey: ["user-mini-leagues-upload-sheet", user?.id, selectedClubId, isAppAdmin, JSON.stringify(userRoles)],
    queryFn: async () => {
      if (!selectedClubId) return [];
      
      const isClubAdmin = userRoles?.some(r => r.role === "club_admin" && r.club_id === selectedClubId);
      const isLeagueAdmin = userRoles?.some(r => r.role === "league_admin" && r.club_id === selectedClubId);
      const isCoach = userRoles?.some(r => r.role === "coach" && r.club_id === selectedClubId);
      
      // Check if club has Pro Football access
      const { data: clubSub } = await supabase
        .from("club_subscriptions")
        .select("is_pro_football, admin_pro_football_override")
        .eq("club_id", selectedClubId)
        .maybeSingle();
      
      const hasProFootball = clubSub?.is_pro_football || clubSub?.admin_pro_football_override;
      if (!hasProFootball && !isAppAdmin) return [];
      
      let miniLeagues: MiniLeague[] = [];
      
      if (isAppAdmin || isClubAdmin || isLeagueAdmin || isCoach) {
        // Admins and coaches can upload to any mini-league in the club
        const { data } = await supabase
          .from("mini_leagues")
          .select("id, name")
          .eq("club_id", selectedClubId)
          .order("name");
        miniLeagues = data || [];
      } else {
        // Parents can only upload to leagues their children are in
        const { data: playerLeagues } = await supabase
          .from("mini_league_players")
          .select("mini_league_id, mini_leagues!inner(id, name, club_id)")
          .eq("parent_user_id", user!.id);
        
        if (playerLeagues) {
          miniLeagues = playerLeagues
            .filter((pl: any) => pl.mini_leagues?.club_id === selectedClubId)
            .map((pl: any) => ({ id: pl.mini_leagues.id, name: pl.mini_leagues.name }));
        }
      }
      
      return miniLeagues;
    },
    enabled: !!user && !!selectedClubId && userRoles !== undefined,
  });

  // Filter to show only clubs with Pro access (unless app admin)
  // Also filter by activeClubFilter when in filtered mode
  const availableClubs = (() => {
    let clubs = isAppAdmin ? userClubs : userClubs?.filter(club => club.has_pro_access);
    if (activeClubFilter && clubs) {
      clubs = clubs.filter(club => club.id === activeClubFilter);
    }
    return clubs;
  })();

  // Auto-select filtered club when active
  useEffect(() => {
    if (activeClubFilter && availableClubs?.some(c => c.id === activeClubFilter) && !selectedClubId) {
      setSelectedClubId(activeClubFilter);
    }
  }, [activeClubFilter, availableClubs, selectedClubId]);

  const uploadSinglePhoto = async (file: File, clubId: string, teamId: string, miniLeagueId: string): Promise<string> => {
    const fileExt = file.name.split(".").pop();
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(7);
    
    // Structure path with club/team/mini-league context for easier backup identification
    let storagePath: string;
    if (miniLeagueId) {
      storagePath = `clubs/${clubId}/mini-leagues/${miniLeagueId}/${user!.id}/${timestamp}-${randomSuffix}.${fileExt}`;
    } else if (teamId) {
      storagePath = `clubs/${clubId}/teams/${teamId}/${user!.id}/${timestamp}-${randomSuffix}.${fileExt}`;
    } else if (clubId) {
      storagePath = `clubs/${clubId}/${user!.id}/${timestamp}-${randomSuffix}.${fileExt}`;
    } else {
      // Fallback for legacy/unassociated uploads
      storagePath = `unassigned/${user!.id}/${timestamp}-${randomSuffix}.${fileExt}`;
    }

    const { error: uploadError } = await supabase.storage
      .from("photos")
      .upload(storagePath, file);

    if (uploadError) throw uploadError;

    // Store the Supabase storage URL format (will be converted to signed URL when displayed)
    const supabaseUrl = "https://yabcfiuntwqjwvschnji.supabase.co";
    const storageUrl = `${supabaseUrl}/storage/v1/object/public/photos/${storagePath}`;

    // 1. Insert into photos table (for media gallery)
    const { error: insertError } = await supabase.from("photos").insert({
      image_url: storageUrl,
      uploader_id: user!.id,
      club_id: clubId || null,
      team_id: teamId || null,
      mini_league_id: miniLeagueId || null,
      file_size: file.size,
    });

    if (insertError) {
      // Cleanup: remove the uploaded file from storage if database insert fails
      console.error("Database insert failed, cleaning up storage:", insertError);
      try {
        await supabase.storage.from("photos").remove([storagePath]);
      } catch (cleanupError) {
        console.error("Failed to cleanup orphaned storage file:", cleanupError);
      }
      throw insertError;
    }
    
    // 2. Also insert into vault_files (for vault access)
    // This ensures media photos also appear in the vault
    const vaultInsertData: any = {
      file_url: storageUrl,
      uploaded_by: user!.id,
      name: file.name,
      file_size: file.size,
      file_type: file.type,
      club_id: clubId || null,
      team_id: teamId || null,
    };
    
    if (miniLeagueId) {
      vaultInsertData.mini_league_id = miniLeagueId;
    }

    // Insert into vault_files - don't fail if this errors (photo is already in media)
    const { error: vaultError } = await supabase.from("vault_files").insert(vaultInsertData);
    if (vaultError) {
      console.warn("Failed to add photo to vault (continuing anyway):", vaultError);
    }
    
    return storageUrl;
  };

  const handleClose = () => {
    // Cleanup preview URLs
    selectedPhotos.forEach(photo => URL.revokeObjectURL(photo.previewUrl));
    setSelectedClubId("");
    setSelectedTeamId("");
    setSelectedMiniLeagueId("");
    setSelectedPhotos([]);
    setUploading(false);
    setUploadProgress(0);
    onOpenChange(false);
  };

  const addPhotosToSelection = async (files: File[]) => {
    if (files.length === 0) return;

    // Create initial photos with compressing status
    const newPhotos: SelectedPhoto[] = files.map(file => ({
      id: `${Date.now()}-${Math.random().toString(36).substring(7)}`,
      file,
      originalFile: file,
      previewUrl: URL.createObjectURL(file),
      status: 'compressing' as const,
      originalSize: file.size,
      compressedSize: file.size,
    }));

    setSelectedPhotos(prev => [...prev, ...newPhotos]);

    // Compress each photo
    for (const photo of newPhotos) {
      try {
        const result = await compressImage(photo.originalFile);
        setSelectedPhotos(prev => prev.map(p =>
          p.id === photo.id
            ? {
                ...p,
                file: result.file,
                status: 'pending' as const,
                compressedSize: result.compressedSize,
              }
            : p
        ));
      } catch (error) {
        // If compression fails, use original file
        setSelectedPhotos(prev => prev.map(p =>
          p.id === photo.id ? { ...p, status: 'pending' as const } : p
        ));
      }
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    await addPhotosToSelection(Array.from(files));

    // Reset the input so the same files can be selected again
    e.target.value = '';
  };

  const handleNativePhotoPick = async () => {
    if (!shouldUseNativePhotoPicker || uploading || isPickingNativePhoto) return;

    setIsPickingNativePhoto(true);
    try {
      let permissions = await CapacitorCamera.checkPermissions();
      if (permissions.photos === "denied") {
        permissions = await CapacitorCamera.requestPermissions();
      }

      if (permissions.photos === "denied") {
        throw new Error("Photo library access is denied");
      }

      const photo = await CapacitorCamera.getPhoto({
        resultType: CameraResultType.Uri,
        source: CameraSource.Photos,
        quality: 80,
        width: 2000,
        height: 2000,
      });

      if (!photo.base64String && !photo.webPath) {
        throw new Error("No photo selected");
      }

      const { blob, mimeType, extension } = await cameraPhotoToBlob(photo);
      const file = new File([blob], `photo-${Date.now()}.${extension}`, {
        type: mimeType,
        lastModified: Date.now(),
      });

      await addPhotosToSelection([file]);
    } catch (error) {
      if (!isCancelledSelectionError(error)) {
        const message = getReadableUploadError(error);
        console.error("[UploadPhotoSheet] iOS photo picker error:", error);
        toast.error(message ? `Failed to select photo: ${message}` : "Failed to select photo");
      }
    } finally {
      setIsPickingNativePhoto(false);
    }
  };

  const removePhoto = (id: string) => {
    setSelectedPhotos(prev => {
      const photo = prev.find(p => p.id === id);
      if (photo) URL.revokeObjectURL(photo.previewUrl);
      return prev.filter(p => p.id !== id);
    });
  };

  const handleUpload = async () => {
    if (selectedPhotos.length === 0 || !selectedClubId) return;
    
    const totalPhotos = selectedPhotos.length;
    const photosToUpload = [...selectedPhotos]; // Copy the array before closing
    const clubId = selectedClubId;
    const teamId = selectedTeamId;
    const miniLeagueId = selectedMiniLeagueId;
    
    // Notify parent about uploading count for skeleton display BEFORE closing
    onUploadingCountChange?.(totalPhotos);
    
    // Close sheet immediately so user can see skeletons
    onOpenChange(false);
    
    // Show persistent loading toast
    const uploadToastId = toast.loading(
      `Uploading ${totalPhotos} photo${totalPhotos > 1 ? 's' : ''}...`,
      { duration: Infinity }
    );
    
    let successCount = 0;
    let errorCount = 0;
    let firstErrorMessage: string | null = null;
    const uploadedUrls: string[] = [];
    
    for (let i = 0; i < photosToUpload.length; i++) {
      const photo = photosToUpload[i];
      
      // Update toast progress
      toast.loading(
        `Uploading photo ${i + 1} of ${totalPhotos}...`,
        { id: uploadToastId }
      );
      
      try {
        const url = await uploadSinglePhoto(photo.file, clubId, teamId, miniLeagueId);
        uploadedUrls.push(url);
        successCount++;
      } catch (error: unknown) {
        errorCount++;
        if (!firstErrorMessage) {
          firstErrorMessage = getReadableUploadError(error) || null;
        }
        console.error("Upload error:", error);
      }
    }
    
    // Preload all uploaded images before dismissing toast
    if (uploadedUrls.length > 0) {
      toast.loading(
        `Processing ${uploadedUrls.length} photo${uploadedUrls.length > 1 ? 's' : ''}...`,
        { id: uploadToastId }
      );
      
      // Preload all images in parallel
      await Promise.all(
        uploadedUrls.map(url => 
          new Promise<void>((resolve) => {
            const img = new Image();
            img.onload = () => resolve();
            img.onerror = () => resolve(); // Continue even if preload fails
            img.src = url;
          })
        )
      );
    }
    
    // Invalidate photos query, vault files query, and storage breakdown
    queryClient.invalidateQueries({ queryKey: ["photos"] });
    queryClient.invalidateQueries({ queryKey: ["vault-files"] });
    queryClient.invalidateQueries({ queryKey: ["storage-breakdown"] });
    
    // Notify parent that uploading is complete
    onUploadingCountChange?.(0);
    
    // Dismiss loading toast and show final result
    toast.dismiss(uploadToastId);
    
    // Cleanup state
    selectedPhotos.forEach(photo => URL.revokeObjectURL(photo.previewUrl));
    setSelectedClubId("");
    setSelectedTeamId("");
    setSelectedMiniLeagueId("");
    setSelectedPhotos([]);
    setUploading(false);
    setUploadProgress(0);
    
    if (successCount > 0 && errorCount === 0) {
      toast.success(`${successCount} photo${successCount > 1 ? 's' : ''} uploaded`);
    } else if (successCount > 0 && errorCount > 0) {
      toast.warning(`${successCount} uploaded, ${errorCount} failed`);
    } else {
      toast.error(firstErrorMessage ? `Failed to upload photos: ${firstErrorMessage}` : "Failed to upload photos");
    }
  };

  const compressingCount = selectedPhotos.filter(p => p.status === 'compressing').length;
  const pendingCount = selectedPhotos.filter(p => p.status === 'pending').length;
  const uploadingCount = selectedPhotos.filter(p => p.status === 'uploading').length;
  const successCount = selectedPhotos.filter(p => p.status === 'success').length;
  const errorCount = selectedPhotos.filter(p => p.status === 'error').length;
  
  // Calculate total savings
  const totalOriginalSize = selectedPhotos.reduce((sum, p) => sum + p.originalSize, 0);
  const totalCompressedSize = selectedPhotos.reduce((sum, p) => sum + p.compressedSize, 0);
  const totalSavings = totalOriginalSize - totalCompressedSize;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[90vh] rounded-t-3xl px-0 overflow-hidden" hideCloseButton>
        <div className="flex flex-col h-full">
          {/* Header */}
          <SheetHeader className="px-4 pb-4 border-b">
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="sm" onClick={handleClose}>
                Cancel
              </Button>
              <SheetTitle className="text-lg font-semibold">
                Upload Photos {selectedPhotos.length > 0 && `(${selectedPhotos.length})`}
              </SheetTitle>
              <Button 
                size="sm" 
                onClick={handleUpload}
                disabled={selectedPhotos.length === 0 || !selectedClubId || uploading || compressingCount > 0 || isPickingNativePhoto}
              >
                {uploading || isPickingNativePhoto ? <Loader2 className="h-4 w-4 animate-spin" /> : compressingCount > 0 ? "Compressing..." : "Upload"}
              </Button>
            </div>
          </SheetHeader>

          {/* Upload Progress */}
          {uploading && (
            <div className="px-4 py-3 bg-muted/50 border-b">
              <div className="flex items-center justify-between text-sm mb-2">
                <span>Uploading {uploadingCount > 0 ? uploadingCount : successCount + errorCount} of {selectedPhotos.length}...</span>
                <span>{uploadProgress}%</span>
              </div>
              <Progress value={uploadProgress} className="h-2" />
            </div>
          )}

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            {/* Photo Grid / Select Area */}
            <div className="p-4">
              {selectedPhotos.length === 0 ? (
                <label
                  className={cn(
                    "block cursor-pointer",
                    (uploading || isPickingNativePhoto) && "pointer-events-none opacity-70"
                  )}
                  onClick={(e) => {
                    if (!shouldUseNativePhotoPicker) return;
                    e.preventDefault();
                    void handleNativePhotoPick();
                  }}
                >
                  <div className="aspect-[4/3] rounded-2xl border-2 border-dashed border-muted-foreground/25 bg-muted/50 flex flex-col items-center justify-center gap-4 transition-colors hover:border-muted-foreground/50 hover:bg-muted">
                    <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                      {isPickingNativePhoto ? (
                        <Loader2 className="h-8 w-8 text-primary animate-spin" />
                      ) : (
                        <Camera className="h-8 w-8 text-primary" />
                      )}
                    </div>
                    <div className="text-center">
                      <p className="font-medium">{isPickingNativePhoto ? "Opening photo library..." : "Tap to select photos"}</p>
                      <p className="text-sm text-muted-foreground mt-1">Select multiple photos at once</p>
                    </div>
                  </div>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp,image/heic,image/heif"
                    multiple
                    className="hidden"
                    onChange={handleFileSelect}
                    disabled={uploading || isPickingNativePhoto || shouldUseNativePhotoPicker}
                  />
                </label>
              ) : (
                <div className="space-y-4">
                  {/* Photo Grid */}
                  <div className="grid grid-cols-3 gap-2">
                    {selectedPhotos.map((photo) => (
                      <div key={photo.id} className="relative aspect-square rounded-xl overflow-hidden bg-muted">
                        <img 
                          src={photo.previewUrl} 
                          alt="Preview" 
                          className={cn(
                            "w-full h-full object-cover transition-opacity",
                            photo.status === 'success' && "opacity-75"
                          )}
                        />
                        
                        {/* Status Overlay */}
                        {photo.status === 'compressing' && (
                          <div className="absolute inset-0 bg-background/50 flex flex-col items-center justify-center gap-1">
                            <Zap className="h-5 w-5 animate-pulse text-amber-500" />
                            <span className="text-[10px] font-medium text-muted-foreground">Compressing</span>
                          </div>
                        )}
                        
                        {photo.status === 'uploading' && (
                          <div className="absolute inset-0 bg-background/50 flex items-center justify-center">
                            <Loader2 className="h-6 w-6 animate-spin text-primary" />
                          </div>
                        )}
                        
                        {photo.status === 'success' && (
                          <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                            <CheckCircle2 className="h-8 w-8 text-primary" />
                          </div>
                        )}
                        
                        {photo.status === 'error' && (
                          <div className="absolute inset-0 bg-destructive/20 flex items-center justify-center">
                            <XCircle className="h-8 w-8 text-destructive" />
                          </div>
                        )}
                        
                        {/* Compression Badge */}
                        {photo.status === 'pending' && photo.originalSize > photo.compressedSize && (
                          <div className="absolute bottom-1 left-1 bg-background/80 backdrop-blur-sm rounded px-1.5 py-0.5 text-[10px] font-medium text-primary flex items-center gap-0.5">
                            <Zap className="h-3 w-3" />
                            {Math.round((1 - photo.compressedSize / photo.originalSize) * 100)}%
                          </div>
                        )}
                        
                        {/* Remove Button */}
                        {photo.status === 'pending' && !uploading && (
                          <Button
                            variant="secondary"
                            size="icon"
                            className="absolute top-1 right-1 h-6 w-6 rounded-full bg-background/80 backdrop-blur-sm"
                            onClick={() => removePhoto(photo.id)}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    ))}
                    
                    {/* Add More Button */}
                    {!uploading && (
                      <label
                        className={cn(
                          "aspect-square rounded-xl border-2 border-dashed border-muted-foreground/25 bg-muted/50 flex items-center justify-center cursor-pointer hover:border-muted-foreground/50 hover:bg-muted transition-colors",
                          isPickingNativePhoto && "pointer-events-none opacity-70"
                        )}
                        onClick={(e) => {
                          if (!shouldUseNativePhotoPicker) return;
                          e.preventDefault();
                          void handleNativePhotoPick();
                        }}
                      >
                        {isPickingNativePhoto ? (
                          <Loader2 className="h-6 w-6 animate-spin text-primary" />
                        ) : (
                          <ImagePlus className="h-6 w-6 text-muted-foreground" />
                        )}
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/gif,image/webp,image/heic,image/heif"
                          multiple
                          className="hidden"
                          onChange={handleFileSelect}
                          disabled={uploading || isPickingNativePhoto || shouldUseNativePhotoPicker}
                        />
                      </label>
                    )}
                  </div>
                  
                  {/* Status Summary */}
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    {compressingCount > 0 && (
                      <span className="text-amber-500 flex items-center gap-1">
                        <Zap className="h-4 w-4 animate-pulse" /> Compressing {compressingCount}...
                      </span>
                    )}
                    {totalSavings > 0 && compressingCount === 0 && (
                      <span className="text-primary flex items-center gap-1">
                        <Zap className="h-4 w-4" /> Saved {formatFileSize(totalSavings)}
                      </span>
                    )}
                    {successCount > 0 && (
                      <span className="text-primary flex items-center gap-1">
                        <CheckCircle2 className="h-4 w-4" /> {successCount} uploaded
                      </span>
                    )}
                    {errorCount > 0 && (
                      <span className="text-destructive flex items-center gap-1">
                        <XCircle className="h-4 w-4" /> {errorCount} failed
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Form Fields */}
            <div className="px-4 pb-6 space-y-6">
              {/* Club Selection */}
              <div className="space-y-3">
                <Label className="text-sm font-medium flex items-center gap-2">
                  Select Club <span className="text-destructive">*</span>
                </Label>
                
                {isLoadingClubs ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : !availableClubs || availableClubs.length === 0 ? (
                  <div className="rounded-xl bg-muted/50 p-4 text-center">
                    <Crown className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">
                      No clubs with Pro access available.
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Upgrade a club or team to Pro to upload photos.
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-2">
                    {availableClubs.map((club) => (
                      <button
                        key={club.id}
                        type="button"
                        disabled={uploading || !!activeClubFilter}
                        onClick={() => {
                          setSelectedClubId(club.id);
                          setSelectedTeamId("");
                          setSelectedMiniLeagueId("");
                        }}
                        className={cn(
                          "flex items-center justify-between p-4 rounded-xl border-2 transition-all text-left w-full",
                          selectedClubId === club.id
                            ? "border-primary bg-primary/5"
                            : "border-border bg-card hover:border-muted-foreground/50",
                          (uploading || !!activeClubFilter) && "opacity-50 cursor-not-allowed"
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            "h-10 w-10 rounded-full flex items-center justify-center text-lg font-semibold",
                            selectedClubId === club.id
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground"
                          )}>
                            {club.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-medium">{club.name}</p>
                            {club.has_pro_access && (
                              <p className="text-xs text-primary flex items-center gap-1">
                                <Crown className="h-3 w-3" /> Pro
                              </p>
                            )}
                          </div>
                        </div>
                        {selectedClubId === club.id && (
                          <div className="h-6 w-6 rounded-full bg-primary flex items-center justify-center">
                            <Check className="h-4 w-4 text-primary-foreground" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Team Selection */}
              {selectedClubId && userTeams && userTeams.length > 0 && !selectedMiniLeagueId && (
                <div className="space-y-3">
                  <Label className="text-sm font-medium">Team (optional)</Label>
                  <div className="grid gap-2">
                    <button
                      type="button"
                      disabled={uploading}
                      onClick={() => setSelectedTeamId("")}
                      className={cn(
                        "flex items-center justify-between p-3 rounded-xl border-2 transition-all text-left w-full",
                        selectedTeamId === ""
                          ? "border-primary bg-primary/5"
                          : "border-border bg-card hover:border-muted-foreground/50",
                        uploading && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      <span className="text-muted-foreground">No specific team</span>
                      {selectedTeamId === "" && (
                        <div className="h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                          <Check className="h-3 w-3 text-primary-foreground" />
                        </div>
                      )}
                    </button>
                    {userTeams.map((team) => (
                      <button
                        key={team.id}
                        type="button"
                        disabled={uploading}
                        onClick={() => setSelectedTeamId(team.id)}
                        className={cn(
                          "flex items-center justify-between p-3 rounded-xl border-2 transition-all text-left w-full",
                          selectedTeamId === team.id
                            ? "border-primary bg-primary/5"
                            : "border-border bg-card hover:border-muted-foreground/50",
                          uploading && "opacity-50 cursor-not-allowed"
                        )}
                      >
                        <span>{team.name}</span>
                        {selectedTeamId === team.id && (
                          <div className="h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                            <Check className="h-3 w-3 text-primary-foreground" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Mini-League Selection */}
              {selectedClubId && userMiniLeagues && userMiniLeagues.length > 0 && !selectedTeamId && (
                <div className="space-y-3">
                  <Label className="text-sm font-medium">Mini League (optional)</Label>
                  <div className="grid gap-2">
                    <button
                      type="button"
                      disabled={uploading}
                      onClick={() => setSelectedMiniLeagueId("")}
                      className={cn(
                        "flex items-center justify-between p-3 rounded-xl border-2 transition-all text-left w-full",
                        selectedMiniLeagueId === ""
                          ? "border-primary bg-primary/5"
                          : "border-border bg-card hover:border-muted-foreground/50",
                        uploading && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      <span className="text-muted-foreground">No specific league</span>
                      {selectedMiniLeagueId === "" && (
                        <div className="h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                          <Check className="h-3 w-3 text-primary-foreground" />
                        </div>
                      )}
                    </button>
                    {userMiniLeagues.map((league) => (
                      <button
                        key={league.id}
                        type="button"
                        disabled={uploading}
                        onClick={() => setSelectedMiniLeagueId(league.id)}
                        className={cn(
                          "flex items-center justify-between p-3 rounded-xl border-2 transition-all text-left w-full",
                          selectedMiniLeagueId === league.id
                            ? "border-primary bg-primary/5"
                            : "border-border bg-card hover:border-muted-foreground/50",
                          uploading && "opacity-50 cursor-not-allowed"
                        )}
                      >
                        <span>{league.name}</span>
                        {selectedMiniLeagueId === league.id && (
                          <div className="h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                            <Check className="h-3 w-3 text-primary-foreground" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Bottom Action - for large screens */}
          <div className="hidden sm:block border-t p-4">
            <Button 
              className="w-full h-12 text-base"
              onClick={handleUpload}
              disabled={selectedPhotos.length === 0 || !selectedClubId || uploading}
            >
              {uploading ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  Uploading {successCount + errorCount + uploadingCount} of {selectedPhotos.length}...
                </>
              ) : (
                <>
                  <Upload className="h-5 w-5 mr-2" />
                  Upload {selectedPhotos.length > 0 ? `${selectedPhotos.length} Photo${selectedPhotos.length > 1 ? 's' : ''}` : 'Photos'}
                </>
              )}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
