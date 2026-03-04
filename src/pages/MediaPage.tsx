import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Image, Lock, Crown, Plus, MessageCircle, Send, Trash2, Loader2, Filter, X, Calendar, MoreVertical, Flag, ShieldAlert } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ReportPhotoDialog } from "@/components/ReportPhotoDialog";
import { BlockUserDialog } from "@/components/BlockUserDialog";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { PageLoading } from "@/components/ui/page-loading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { useClubTheme } from "@/hooks/useClubTheme";
import { format, formatDistanceToNow, startOfDay, endOfDay, isWithinInterval } from "date-fns";
import { Link } from "react-router-dom";
import { EmojiReactions } from "@/components/EmojiReactions";
import { PhotoComment } from "@/components/PhotoComment";
import { CommentRepliesThread } from "@/components/CommentRepliesThread";
import { LazyImage } from "@/components/LazyImage";
import { PhotoLightbox } from "@/components/PhotoLightbox";
import { UploadPhotoSheet } from "@/components/UploadPhotoSheet";
import { SharePhotoButton } from "@/components/SharePhotoButton";
import { ClubTeamFilter } from "@/components/ClubTeamFilter";
import { cachePhotos, removePhotoFromCache, getFeedPhotosFromCache, backgroundRefreshPhotos, CachedPhoto } from "@/lib/mediaCache";
import { useProfiles } from "@/hooks/useProfiles";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Skeleton component for photos while loading
function PhotoSkeleton() {
  return (
    <Card className="overflow-hidden">
      <Skeleton className="aspect-square w-full" />
      <div className="p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-8 rounded-full" />
          <div className="space-y-1.5 flex-1">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-2.5 w-16" />
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-5 w-5 ml-auto rounded-full" />
        </div>
      </div>
    </Card>
  );
}

export default function MediaPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const highlightedPhotoId = searchParams.get("photo");
  const photoRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const { activeClubFilter } = useClubTheme();
  
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [expandedComments, setExpandedComments] = useState<Set<string>>(new Set());
  const [commentInputs, setCommentInputs] = useState<Record<string, string>>({});
  const [replyingTo, setReplyingTo] = useState<Record<string, { id: string; name: string } | undefined>>({});
  const [deletePhotoId, setDeletePhotoId] = useState<string | null>(null);
  const [deletingPhotoId, setDeletingPhotoId] = useState<string | null>(null);
  const [selectedDeleteOption, setSelectedDeleteOption] = useState<'feed' | 'vault' | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [reportPhotoId, setReportPhotoId] = useState<string | null>(null);
  const [blockTarget, setBlockTarget] = useState<{ userId: string; userName: string } | null>(null);
  const [cachedPhotosData, setCachedPhotosData] = useState<CachedPhoto[] | null>(null);
  const [isCacheStale, setIsCacheStale] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const PHOTOS_PER_PAGE = 9; // Smaller initial load for faster first paint

  // Load cached photos immediately on mount for instant display
  useEffect(() => {
    const { photos: cached, isStale } = getFeedPhotosFromCache();
    if (cached && cached.length > 0) {
      setCachedPhotosData(cached);
      setIsCacheStale(isStale);
    }
  }, []);

  // Filter state - default to active club filter if set
  const [selectedClubId, setSelectedClubId] = useState<string>("all");
  const [selectedTeamId, setSelectedTeamId] = useState<string>("all");
  const [dateRange, setDateRange] = useState<{ from: Date | undefined; to: Date | undefined }>({
    from: undefined,
    to: undefined,
  });
  const [showFilters, setShowFilters] = useState(false);

  // Sync club filter with theme - reset to "all" when theme is cleared
  useEffect(() => {
    if (activeClubFilter) {
      setSelectedClubId(activeClubFilter);
      setSelectedTeamId("all"); // Reset team when club changes
    } else {
      setSelectedClubId("all");
      setSelectedTeamId("all");
    }
  }, [activeClubFilter]);


  // Scroll to highlighted photo when loaded
  useEffect(() => {
    if (highlightedPhotoId && photoRefs.current.has(highlightedPhotoId)) {
      const element = photoRefs.current.get(highlightedPhotoId);
      if (element) {
        setTimeout(() => {
          element.scrollIntoView({ behavior: "smooth", block: "center" });
          // Auto-expand comments for highlighted photo
          setExpandedComments(prev => new Set(prev).add(highlightedPhotoId));
        }, 100);
      }
    }
  }, [highlightedPhotoId, photoRefs.current.size]);

  // Fast parallel queries - don't block on access check
  const { data: userRoles, isLoading: loadingRoles } = useQuery({
    queryKey: ["user-roles-media", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role, club_id, team_id")
        .eq("user_id", user!.id);

      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
    staleTime: 300000, // Cache for 5 minutes
  });

  const isAppAdmin = useMemo(() => 
    userRoles?.some(r => r.role === "app_admin") ?? false, 
    [userRoles]
  );

  const roleClubIds = useMemo(
    () => [...new Set((userRoles ?? []).map((r) => r.club_id).filter(Boolean) as string[])].sort(),
    [userRoles]
  );

  const roleTeamIds = useMemo(
    () => [...new Set((userRoles ?? []).map((r) => r.team_id).filter(Boolean) as string[])].sort(),
    [userRoles]
  );

  // Quick Pro check - check if user has any Pro club/team membership
  // Logic: Club Pro → all teams inherit Pro; Free club → check team subscription
  const { data: hasProClub, isLoading: loadingProAccess, error: proAccessError } = useQuery({
    queryKey: ["has-pro-access", user?.id, roleClubIds.join(","), roleTeamIds.join(","), activeClubFilter ?? ""],
    queryFn: async () => {
      const candidateClubIds = activeClubFilter
        ? [...new Set([...roleClubIds, activeClubFilter])]
        : roleClubIds;

      if (candidateClubIds.length === 0 && roleTeamIds.length === 0) return false;

      // Fetch club subscriptions and team info in parallel
      const [clubSubResult, teamInfoResult] = await Promise.all([
        candidateClubIds.length > 0
          ? supabase
              .from("club_subscriptions")
              .select("club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
              .in("club_id", candidateClubIds)
          : Promise.resolve({ data: [], error: null }),
        roleTeamIds.length > 0
          ? supabase.from("teams").select("id, club_id").in("id", roleTeamIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (clubSubResult.error) throw clubSubResult.error;
      if (teamInfoResult.error) throw teamInfoResult.error;

      const hasCandidateClubPro = (clubSubResult.data || []).some(
        (sub) => sub.is_pro || sub.is_pro_football || sub.admin_pro_override || sub.admin_pro_football_override
      );

      if (hasCandidateClubPro) return true;

      const teamParentClubIds = [...new Set((teamInfoResult.data || []).map((t) => t.club_id).filter(Boolean) as string[])];
      const missingParentClubIds = teamParentClubIds.filter((clubId) => !candidateClubIds.includes(clubId));

      if (missingParentClubIds.length > 0) {
        const { data: parentClubSubs, error: parentClubSubsError } = await supabase
          .from("club_subscriptions")
          .select("club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
          .in("club_id", missingParentClubIds);

        if (parentClubSubsError) throw parentClubSubsError;

        const parentHasPro = (parentClubSubs || []).some(
          (sub) => sub.is_pro || sub.is_pro_football || sub.admin_pro_override || sub.admin_pro_football_override
        );

        if (parentHasPro) return true;
      }

      if (roleTeamIds.length > 0) {
        const { data: teamSubs, error: teamSubsError } = await supabase
          .from("team_subscriptions")
          .select("team_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
          .in("team_id", roleTeamIds);

        if (teamSubsError) throw teamSubsError;

        const teamHasPro = (teamSubs || []).some(
          (sub) => sub.is_pro || sub.is_pro_football || sub.admin_pro_override || sub.admin_pro_football_override
        );

        if (teamHasPro) return true;
      }

      const allResolvedClubIds = [...new Set([...candidateClubIds, ...teamParentClubIds])];
      if (allResolvedClubIds.length > 0) {
        const { data: clubs, error: clubsError } = await supabase
          .from("clubs")
          .select("id")
          .in("id", allResolvedClubIds)
          .eq("is_pro", true);

        if (clubsError) throw clubsError;
        if ((clubs || []).length > 0) return true;
      }

      return false;
    },
    enabled: !!user,
    staleTime: 0,
    gcTime: 300000,
  });

  const { data: userProfile } = useQuery({
    queryKey: ["user-profile-media", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("display_name, avatar_url")
        .eq("id", user!.id)
        .maybeSingle();
      return data;
    },
    enabled: !!user,
    staleTime: 300000,
  });

  // Fetch clubs user has access to for filtering
  const { data: availableClubs } = useQuery({
    queryKey: ["media-filter-clubs", user?.id],
    queryFn: async () => {
      const clubIds = [...new Set(userRoles?.map(r => r.club_id).filter(Boolean))] as string[];
      if (clubIds.length === 0) return [];
      
      const { data } = await supabase
        .from("clubs")
        .select("id, name")
        .in("id", clubIds)
        .order("name");
      return data || [];
    },
    enabled: !!user && !!userRoles && userRoles.length > 0,
    staleTime: 300000,
  });

  // Fetch teams user has access to for filtering
  const { data: availableTeams } = useQuery({
    queryKey: ["media-filter-teams", user?.id],
    queryFn: async () => {
      const teamIds = [...new Set(userRoles?.map(r => r.team_id).filter(Boolean))] as string[];
      if (teamIds.length === 0) return [];
      
      const { data } = await supabase
        .from("teams")
        .select("id, name, club_id, clubs(name)")
        .in("id", teamIds)
        .order("name");
      return data || [];
    },
    enabled: !!user && !!userRoles && userRoles.length > 0,
    staleTime: 300000,
  });

  // Filter teams by selected club
  const filteredTeams = useMemo(() => {
    if (!availableTeams) return [];
    if (selectedClubId === "all") return availableTeams;
    return availableTeams.filter(team => team.club_id === selectedClubId);
  }, [availableTeams, selectedClubId]);

  // Get first admin club/team for upgrade link
  const adminUpgradeInfo = useMemo(() => {
    if (!userRoles) return { clubId: undefined, teamId: undefined };
    const clubAdminRole = userRoles.find(r => r.role === "club_admin" && r.club_id);
    if (clubAdminRole?.club_id) return { clubId: clubAdminRole.club_id, teamId: undefined };
    const teamAdminRole = userRoles.find(r => r.role === "team_admin" && r.team_id);
    if (teamAdminRole?.team_id) return { clubId: undefined, teamId: teamAdminRole.team_id };
    return { clubId: undefined, teamId: undefined };
  }, [userRoles]);

  const { 
    data: photosData, 
    isLoading: loadingPhotos,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isSuccess: photosSuccess,
  } = useInfiniteQuery({
    queryKey: ["photos", user?.id],
    queryFn: async ({ pageParam = 0 }) => {
      const { data, error } = await supabase
        .from("photos")
        .select("id, file_url, image_url, title, created_at, club_id, team_id, mini_league_id, uploader_id, clubs(name, is_pro), teams(name, club_id, clubs(name)), mini_leagues(name, club_id, clubs(name))")
        .eq("show_in_feed", true)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .range(pageParam, pageParam + PHOTOS_PER_PAGE - 1);

      if (error) throw error;
      
      // Cache first page results for offline access
      if (pageParam === 0 && data) {
        cachePhotos(null, null, null, data.map(p => ({
          id: p.id,
          file_url: p.file_url || p.image_url,
          title: p.title,
          created_at: p.created_at,
          uploader_id: p.uploader_id,
          team_id: p.team_id,
          club_id: p.club_id,
          folder_id: null,
        })));
        // Clear cached photos state once real data arrives
        setCachedPhotosData(null);
        setIsCacheStale(false);
      }
      
      return { photos: data || [], nextCursor: data && data.length === PHOTOS_PER_PAGE ? pageParam + PHOTOS_PER_PAGE : undefined };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: 0,
    enabled: !!user,
    staleTime: 60000,
    gcTime: 300000,
  });

  // Background refresh if cache was stale
  useEffect(() => {
    if (isCacheStale && user) {
      backgroundRefreshPhotos(null, null, null, 50).then(freshPhotos => {
        if (freshPhotos) {
          setIsCacheStale(false);
        }
      });
    }
  }, [isCacheStale, user]);

  // Flatten all pages into single photos array - prefer real data, fallback to cache
  const allPhotos = useMemo(() => {
    const serverPhotos = photosData?.pages.flatMap(page => page.photos) ?? [];
    
    // If we have server data, use it
    if (serverPhotos.length > 0) {
      return serverPhotos;
    }
    
    // Otherwise use cached photos (with placeholder profile data)
    if (cachedPhotosData && cachedPhotosData.length > 0) {
      return cachedPhotosData.map(p => ({
        ...p,
        image_url: p.file_url, // Cached data uses file_url
        mini_league_id: null,
        clubs: null,
        teams: null,
        mini_leagues: null,
        profiles: null,
      }));
    }
    
    return [];
  }, [photosData, cachedPhotosData]);

  // Track if we're showing cached data
  const isShowingCachedData = !photosSuccess && cachedPhotosData && cachedPhotosData.length > 0;

  // Fetch profiles for all uploader IDs (covers RLS-blocked profiles and cached photos)
  const allUploaderIds = useMemo(() => {
    const ids = allPhotos?.map(p => p.uploader_id).filter(Boolean) || [];
    return [...new Set(ids)];
  }, [allPhotos]);
  
  const { getProfile, isLoading: loadingProfiles } = useProfiles(allUploaderIds);

  // Apply filters to photos
  const photos = useMemo(() => {
    let filtered = allPhotos;
    
    // Filter by club
    if (selectedClubId !== "all") {
      filtered = filtered.filter(photo => photo.club_id === selectedClubId);
    }
    
    // Filter by team
    if (selectedTeamId !== "all") {
      filtered = filtered.filter(photo => photo.team_id === selectedTeamId);
    }
    
    // Filter by date range
    if (dateRange.from || dateRange.to) {
      filtered = filtered.filter(photo => {
        const photoDate = new Date(photo.created_at);
        if (dateRange.from && dateRange.to) {
          return isWithinInterval(photoDate, {
            start: startOfDay(dateRange.from),
            end: endOfDay(dateRange.to),
          });
        } else if (dateRange.from) {
          return photoDate >= startOfDay(dateRange.from);
        } else if (dateRange.to) {
          return photoDate <= endOfDay(dateRange.to);
        }
        return true;
      });
    }
    
    return filtered;
  }, [allPhotos, selectedClubId, selectedTeamId, dateRange]);

  const hasActiveFilters = selectedClubId !== "all" || selectedTeamId !== "all" || dateRange.from || dateRange.to;

  const clearFilters = () => {
    setSelectedClubId("all");
    setSelectedTeamId("all");
    setDateRange({ from: undefined, to: undefined });
  };

  // Intersection observer for infinite scroll - load more photos when reaching bottom
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { threshold: 0.1, rootMargin: "400px" }
    );

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }

    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Pro access check - don't show content until we've confirmed Pro status
  // Also treat as loading if user exists but roles haven't been fetched yet (prevents flash on app open)
  // Additionally, if roles are loaded but pro-access query hasn't resolved yet (enabled but no data), keep loading
  const proQueryShouldBeEnabled = !!user && (roleClubIds.length > 0 || roleTeamIds.length > 0 || !!activeClubFilter);
  const hasProAccessQueryFailed = !!proAccessError;
  const proQueryNotYetResolved = proQueryShouldBeEnabled && hasProClub === undefined && !hasProAccessQueryFailed;
  const waitingOnRolesWithoutFallback = !!user && !userRoles && !activeClubFilter;
  const isCheckingProAccess = !user || loadingProAccess || loadingRoles || waitingOnRolesWithoutFallback || proQueryNotYetResolved;
  const hasProAccess = isAppAdmin || hasProClub === true;

  // Get ALL loaded photo IDs (not filtered) for fetching reactions/comments
  const allPhotoIds = useMemo(() => allPhotos?.map(p => p.id) || [], [allPhotos]);

  // Stable query key for reactions - include photo count to refetch when more photos load
  const reactionsQueryKey = useMemo(() => ["photo-reactions", user?.id, allPhotoIds.length], [user?.id, allPhotoIds.length]);
  
  // Fetch reactions for ALL loaded photos - use inline reactions as placeholder for instant display
  const { data: fetchedReactions } = useQuery({
    queryKey: reactionsQueryKey,
    queryFn: async () => {
      if (allPhotoIds.length === 0) return [];
      const { data, error } = await supabase
        .from("photo_reactions")
        .select("photo_id, user_id, reaction_type, profiles:user_id(display_name, avatar_url)")
        .in("photo_id", allPhotoIds);
      if (error) {
        console.error("Error fetching reactions:", error);
        return [];
      }
      return data || [];
    },
    enabled: !!user && allPhotoIds.length > 0,
    staleTime: 120000, // Cache for 2 minutes
  });

  // Use fetched reactions
  const allReactions = fetchedReactions || [];

  // Stable query key for comments - include photo count to refetch when more photos load
  const commentsQueryKey = useMemo(() => ["photo-comments", user?.id, allPhotoIds.length], [user?.id, allPhotoIds.length]);

  // Fetch comments for ALL loaded photos (not just filtered)
  const { data: allComments } = useQuery({
    queryKey: commentsQueryKey,
    queryFn: async () => {
      if (allPhotoIds.length === 0) return [];
      const { data, error } = await supabase
        .from("photo_comments")
        .select("*, profiles:user_id(display_name, avatar_url)")
        .in("photo_id", allPhotoIds)
        .order("created_at", { ascending: true });
      if (error) {
        console.error("Error fetching comments:", error);
        return [];
      }
      return data || [];
    },
    enabled: !!user && allPhotoIds.length > 0,
    staleTime: 120000, // Cache for 2 minutes
  });

  const reactMutation = useMutation({
    mutationFn: async ({ photoId, reactionType }: { photoId: string; reactionType: string }) => {
      // First remove any existing reaction
      const { error: deleteError } = await supabase.from("photo_reactions").delete()
        .eq("photo_id", photoId)
        .eq("user_id", user!.id);
      
      if (deleteError) throw deleteError;
      
      // Then add the new reaction
      const { error: insertError } = await supabase.from("photo_reactions").insert({
        photo_id: photoId,
        user_id: user!.id,
        reaction_type: reactionType,
      });
      
      if (insertError) throw insertError;
    },
    onMutate: async ({ photoId, reactionType }) => {
      await queryClient.cancelQueries({ queryKey: reactionsQueryKey });
      const previousReactions = queryClient.getQueryData(reactionsQueryKey);
      
      queryClient.setQueryData(reactionsQueryKey, (old: any[] | undefined) => {
        const newReaction = { 
          photo_id: photoId, 
          user_id: user!.id, 
          reaction_type: reactionType,
          profiles: { display_name: userProfile?.display_name || "You", avatar_url: userProfile?.avatar_url || null }
        };
        if (!old) return [newReaction];
        // Remove existing reaction from this user on this photo
        const filtered = old.filter(r => !(r.photo_id === photoId && r.user_id === user!.id));
        // Add the new reaction
        return [...filtered, newReaction];
      });
      
      return { previousReactions };
    },
    onError: (err, variables, context) => {
      if (context?.previousReactions) {
        queryClient.setQueryData(reactionsQueryKey, context.previousReactions);
      }
      toast.error("Failed to add reaction");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: reactionsQueryKey });
    },
  });

  const removeReactionMutation = useMutation({
    mutationFn: async (photoId: string) => {
      const { error } = await supabase.from("photo_reactions").delete()
        .eq("photo_id", photoId)
        .eq("user_id", user!.id);
      if (error) throw error;
    },
    onMutate: async (photoId: string) => {
      await queryClient.cancelQueries({ queryKey: reactionsQueryKey });
      const previousReactions = queryClient.getQueryData(reactionsQueryKey);
      
      queryClient.setQueryData(reactionsQueryKey, (old: any[] | undefined) => {
        if (!old) return [];
        return old.filter(r => !(r.photo_id === photoId && r.user_id === user!.id));
      });
      
      return { previousReactions };
    },
    onError: (err, variables, context) => {
      if (context?.previousReactions) {
        queryClient.setQueryData(reactionsQueryKey, context.previousReactions);
      }
      toast.error("Failed to remove reaction");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: reactionsQueryKey });
    },
  });

  const addCommentMutation = useMutation({
    mutationFn: async ({ photoId, text, replyToId }: { photoId: string; text: string; replyToId?: string }) => {
      if (!user?.id) {
        throw new Error("User not authenticated");
      }
      const { error } = await supabase.from("photo_comments").insert({
        photo_id: photoId,
        user_id: user.id,
        text,
        reply_to_id: replyToId || null,
      });
      
      if (error) throw error;
    },
    onMutate: async ({ photoId, text, replyToId }) => {
      if (!user?.id) return { previousComments: undefined };
      
      // Clear input immediately for instant feedback
      setCommentInputs(prev => ({ ...prev, [photoId]: "" }));
      setReplyingTo(prev => ({ ...prev, [photoId]: undefined }));
      // Auto-expand comments to show the new comment
      setExpandedComments(prev => new Set(prev).add(photoId));
      
      await queryClient.cancelQueries({ queryKey: commentsQueryKey });
      const previousComments = queryClient.getQueryData(commentsQueryKey);
      
      const tempId = `temp-${Date.now()}`;
      queryClient.setQueryData(commentsQueryKey, (old: any[] | undefined) => {
        const optimisticComment = {
          id: tempId,
          photo_id: photoId,
          user_id: user.id,
          text,
          reply_to_id: replyToId || null,
          created_at: new Date().toISOString(),
          profiles: { display_name: userProfile?.display_name || "You", avatar_url: userProfile?.avatar_url || null },
          reply_to: null,
        };
        return old ? [...old, optimisticComment] : [optimisticComment];
      });
      
      return { previousComments, tempId, photoId };
    },
    onSuccess: () => {
      // Invalidate to replace temp comment with real data from server
      queryClient.invalidateQueries({ queryKey: commentsQueryKey });
    },
    onError: (err, variables, context) => {
      console.error("Failed to add comment:", err);
      if (context?.previousComments) {
        queryClient.setQueryData(commentsQueryKey, context.previousComments);
      }
      toast.error("Failed to add comment");
    },
  });

  const deletePhotoMutation = useMutation({
    mutationFn: async ({ photoId, deleteFromVault }: { photoId: string; deleteFromVault: boolean }) => {
      if (deleteFromVault) {
        // Soft delete - move to trash instead of permanently deleting
        const { error } = await supabase
          .from("photos")
          .update({ 
            deleted_at: new Date().toISOString(),
            show_in_feed: false
          })
          .eq("id", photoId);
        if (error) throw error;
      } else {
        // Just hide from feed by setting show_in_feed to false
        const { error } = await supabase
          .from("photos")
          .update({ show_in_feed: false })
          .eq("id", photoId);
        if (error) throw error;
      }
    },
    onMutate: async ({ photoId }) => {
      // Set deleting state for UI feedback
      setDeletingPhotoId(photoId);
      setDeletePhotoId(null);
      setSelectedDeleteOption(null);
      
      // Cancel any outgoing refetches - use correct query key with user id
      await queryClient.cancelQueries({ queryKey: ["photos", user?.id] });
      
      // Snapshot the previous value
      const previousPhotos = queryClient.getQueryData(["photos", user?.id]);
      
      // Optimistically remove the photo from the cache
      queryClient.setQueryData(["photos", user?.id], (old: any) => {
        if (!old?.pages) return old;
        return {
          ...old,
          pages: old.pages.map((page: { photos: any[]; nextCursor?: number }) => ({
            ...page,
            photos: page.photos.filter((photo: any) => photo.id !== photoId)
          })),
        };
      });
      
      return { previousPhotos, photoId };
    },
    onSuccess: (_, { photoId, deleteFromVault }) => {
      // Remove from local storage cache
      removePhotoFromCache(photoId);
      // Silent success - no toast
    },
    onError: (error: any, _, context) => {
      // Rollback on error
      if (context?.previousPhotos) {
        queryClient.setQueryData(["photos", user?.id], context.previousPhotos);
      }
      toast.error(error.message || "Failed to delete photo");
    },
    onSettled: () => {
      setDeletingPhotoId(null);
      queryClient.invalidateQueries({ queryKey: ["photos", user?.id] });
    },
  });

  const canDeletePhoto = (photo: any) => {
    if (isAppAdmin) return true;
    if (photo.uploader_id === user?.id) return true;
    if (userRoles?.some(r => r.role === "club_admin" && r.club_id === photo.club_id)) return true;
    // Team admins can only delete team-level photos (not club-level photos where team_id is null)
    if (photo.team_id && userRoles?.some(r => r.role === "team_admin" && r.team_id === photo.team_id)) return true;
    return false;
  };

  // Anyone who can view a photo should be able to share it
  const canSharePhoto = (_photo: any) => {
    return !!user;
  };

  const toggleComments = (photoId: string) => {
    setExpandedComments(prev => {
      const newSet = new Set(prev);
      if (newSet.has(photoId)) {
        newSet.delete(photoId);
      } else {
        newSet.add(photoId);
      }
      return newSet;
    });
  };

  const photoReactionsMap = useMemo(() => {
    const map = new Map<string, typeof allReactions>();
    if (!allReactions) return map;
    for (const reaction of allReactions) {
      const existing = map.get(reaction.photo_id) || [];
      existing.push(reaction);
      map.set(reaction.photo_id, existing);
    }
    return map;
  }, [allReactions]);

  const photoCommentsMap = useMemo(() => {
    const map = new Map<string, typeof allComments>();
    if (!allComments) return map;
    for (const comment of allComments) {
      const existing = map.get(comment.photo_id) || [];
      existing.push(comment);
      map.set(comment.photo_id, existing);
    }
    return map;
  }, [allComments]);

  const getPhotoReactions = useCallback((photoId: string) => 
    photoReactionsMap.get(photoId) || [], [photoReactionsMap]);
  
  const getPhotoComments = useCallback((photoId: string) => 
    photoCommentsMap.get(photoId) || [], [photoCommentsMap]);

  // Show skeletons only if we have no cached data and are loading
  const showSkeletons = (loadingPhotos || loadingProAccess) && allPhotos.length === 0;
  
  // Don't block on loading if we have cached data to show
  if (showSkeletons) {
    return (
      <div className="py-6 pb-32 space-y-6 h-full overflow-y-auto">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-2xl font-bold">Media</h1>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <PhotoSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="py-6 pb-32 space-y-6 h-full overflow-y-auto">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">Media</h1>
          {(isShowingCachedData || isCacheStale) && loadingPhotos && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Updating...</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-4 sm:gap-2">
          <Button 
            variant={hasActiveFilters ? "default" : "outline"} 
            size="icon"
            onClick={() => setShowFilters(!showFilters)}
            className="h-12 w-12 sm:h-9 sm:w-auto sm:px-3 relative"
          >
            <Filter className="h-6 w-6 sm:h-4 sm:w-4" /> 
            <span className="hidden sm:inline ml-1">Filter</span>
            {hasActiveFilters && (
              <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-primary sm:hidden" />
            )}
            {hasActiveFilters && <Badge variant="secondary" className="ml-1 h-5 px-1.5 hidden sm:inline-flex">!</Badge>}
          </Button>
          {hasProAccess && (
            <>
              <Button size="icon" onClick={() => setUploadDialogOpen(true)} className="h-12 w-12 sm:h-9 sm:w-auto sm:px-3">
                <Plus className="h-6 w-6 sm:h-4 sm:w-4" />
                <span className="hidden sm:inline ml-1">Add Photo</span>
              </Button>
              <UploadPhotoSheet 
                open={uploadDialogOpen} 
                onOpenChange={setUploadDialogOpen}
                onUploadingCountChange={setUploadingCount}
              />
            </>
          )}
        </div>
      </div>

      {/* Filter Panel */}
      <Collapsible open={showFilters}>
        <CollapsibleContent>
          <Card className="p-4">
            {/* Check if any filters are available to show */}
            {(availableClubs?.length || 0) > 1 || (filteredTeams?.length || 0) > 0 ? (
              <>
                <ClubTeamFilter
                  clubs={availableClubs || []}
                  teams={filteredTeams || []}
                  selectedClubId={selectedClubId}
                  selectedTeamId={selectedTeamId}
                  onClubChange={(value) => {
                    setSelectedClubId(value);
                    if (value !== "all") {
                      setSelectedTeamId("all");
                    }
                  }}
                  onTeamChange={setSelectedTeamId}
                  showClubFilter={(availableClubs?.length || 0) > 0}
                  showTeamFilter={(filteredTeams?.length || 0) > 0}
                />
                
                {hasActiveFilters && (
                  <p className="text-xs text-muted-foreground mt-3">
                    Showing {photos.length} of {allPhotos.length} photos
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-2">
                No filters available
              </p>
            )}
          </Card>
        </CollapsibleContent>
      </Collapsible>

      {isCheckingProAccess ? (
        // Show loading skeletons while checking Pro access - prevents flash of cached photos
        <div className="max-w-lg mx-auto space-y-6">
          {[...Array(3)].map((_, i) => <PhotoSkeleton key={i} />)}
        </div>
      ) : hasProAccessQueryFailed ? (
        <Card className="border-dashed max-w-lg mx-auto">
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">We couldn’t verify Pro access right now.</p>
            <Button
              variant="outline"
              className="mt-3"
              onClick={() => queryClient.invalidateQueries({ queryKey: ["has-pro-access", user?.id] })}
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : !hasProAccess ? (
        <ProFeatureGate feature="Photos" clubId={adminUpgradeInfo.clubId} teamId={adminUpgradeInfo.teamId} />
      ) : photos.length === 0 && !hasActiveFilters ? (
        <Card className="border-dashed max-w-lg mx-auto">
          <CardContent className="p-8 text-center">
            <Image className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No photos yet</p>
            <p className="text-sm text-muted-foreground mt-1">Upload your first photo to get started</p>
          </CardContent>
        </Card>
      ) : photos.length === 0 && hasActiveFilters ? (
        <Card className="border-dashed max-w-lg mx-auto">
          <CardContent className="p-8 text-center">
            <Filter className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No photos match your filters</p>
            <Button variant="link" onClick={clearFilters} className="mt-2 text-muted-foreground hover:text-foreground">
              Clear filters
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6 max-w-lg mx-auto">
          {/* Skeleton placeholders for uploading photos */}
          {uploadingCount > 0 && (
            Array.from({ length: uploadingCount }).map((_, i) => (
              <Card key={`uploading-${i}`} className="overflow-hidden">
                <div className="p-3 flex items-center gap-3 border-b">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <div className="space-y-1.5">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-2 w-16" />
                  </div>
                </div>
                <div className="relative aspect-square bg-muted">
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground font-medium">Uploading photo...</p>
                  </div>
                </div>
                <CardContent className="p-3 space-y-3">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-10 w-full" />
                </CardContent>
              </Card>
            ))
          )}
          {photos.map((photo, index) => {
            const reactions = getPhotoReactions(photo.id);
            const comments = getPhotoComments(photo.id);
            const isExpanded = expandedComments.has(photo.id);
            const commentInput = commentInputs[photo.id] || "";
            const isHighlighted = highlightedPhotoId === photo.id;

            const isDeleting = deletingPhotoId === photo.id;
            
            // Always check useProfiles hook as fallback (handles RLS-blocked profiles)
            const cachedProfile = getProfile(photo.uploader_id);
            const displayName = photo.profiles?.display_name || cachedProfile?.display_name || null;
            const avatarUrl = photo.profiles?.avatar_url || cachedProfile?.avatar_url || null;

            return (
              <Card 
                key={photo.id}
                ref={(el) => {
                  if (el) {
                    photoRefs.current.set(photo.id, el);
                  }
                }}
                className={`overflow-hidden transition-all duration-300 ${
                  isHighlighted ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""
                } ${isDeleting ? "opacity-50 pointer-events-none" : ""}`}
              >
                {/* Header */}
                <div className="flex items-center gap-3 p-3 border-b">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={avatarUrl || undefined} />
                    <AvatarFallback>
                      {displayName?.[0]?.toUpperCase() || <Loader2 className="h-3 w-3 animate-spin" />}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{displayName || <Skeleton className="h-3 w-20 inline-block" />}</p>
                    <p className="text-xs text-muted-foreground">
                      {photo.mini_leagues?.name 
                        ? `${photo.mini_leagues?.clubs?.name || photo.clubs?.name} ${photo.mini_leagues.name}`
                        : photo.teams?.name 
                          ? `${photo.teams?.clubs?.name || photo.clubs?.name} ${photo.teams.name}`
                          : photo.clubs?.name}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {canSharePhoto(photo) && (
                      <SharePhotoButton 
                        photoId={photo.id}
                        imageUrl={photo.file_url || photo.image_url} 
                        title={photo.title} 
                      />
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-10 w-10 text-muted-foreground">
                          <MoreVertical className="h-5 w-5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {canDeletePhoto(photo) && (
                          <DropdownMenuItem
                            onClick={() => setDeletePhotoId(photo.id)}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete Photo
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => setReportPhotoId(photo.id)}>
                          <Flag className="h-4 w-4 mr-2" />
                          Report Photo
                        </DropdownMenuItem>
                        {photo.uploader_id && photo.uploader_id !== user?.id && (
                          <DropdownMenuItem onClick={() => setBlockTarget({ userId: photo.uploader_id!, userName: displayName || "this user" })}>
                            <ShieldAlert className="h-4 w-4 mr-2" />
                            Block User
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

{/* Image with lazy loading */}
                <div 
                  className="relative w-full aspect-square bg-muted overflow-hidden cursor-pointer"
                  onClick={() => !isDeleting && setLightboxIndex(index)}
                >
                  <LazyImage
                    src={photo.file_url || photo.image_url}
                    alt={photo.title || "Photo"}
                    priority={index < 2}
                  />
                  {isDeleting && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/50">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-5 w-5 animate-spin" />
                        <span>Deleting...</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="p-3 space-y-2">
                  <div className="flex items-center gap-4">
                    <EmojiReactions
                      reactions={reactions}
                      currentUserId={user?.id}
                      onReact={(type) => reactMutation.mutate({ photoId: photo.id, reactionType: type })}
                      onRemove={() => removeReactionMutation.mutate(photo.id)}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleComments(photo.id)}
                      className="gap-1 p-0 h-auto hover:bg-transparent ml-auto"
                    >
                      <MessageCircle className="h-5 w-5" />
                      {comments.length > 0 && <span className="text-xs">{comments.length}</span>}
                    </Button>
                  </div>

                  {photo.title && (
                    <p className="text-sm">
                      <span className="font-medium">{photo.profiles?.display_name}</span>{" "}
                      {photo.title}
                    </p>
                  )}

                  <p className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(photo.created_at), { addSuffix: true })}
                  </p>

                  {comments.length > 0 && !isExpanded && (
                    <button 
                      onClick={() => toggleComments(photo.id)}
                      className="text-sm text-muted-foreground"
                    >
                      View all {comments.length} comment{comments.length !== 1 ? "s" : ""}
                    </button>
                  )}

                  {/* Inline Comments */}
                  <Collapsible open={isExpanded}>
                    <CollapsibleContent className="space-y-2">
                      {comments
                        .filter((c: any) => !c.reply_to_id)
                        .map((comment: any) => {
                          const replies = comments.filter((c: any) => c.reply_to_id === comment.id);
                          return (
                            <div key={comment.id}>
                              <PhotoComment
                                id={comment.id}
                                text={comment.text}
                                userId={comment.user_id}
                                displayName={comment.profiles?.display_name}
                                avatarUrl={comment.profiles?.avatar_url}
                                currentUserId={user?.id}
                                createdAt={comment.created_at}
                                onReply={(commentId, name) => {
                                  setReplyingTo(prev => ({ ...prev, [photo.id]: { id: commentId, name } }));
                                }}
                              />
                              <CommentRepliesThread
                                replies={replies}
                                parentDisplayName={comment.profiles?.display_name}
                                currentUserId={user?.id}
                                onReply={(commentId, name) => {
                                  setReplyingTo(prev => ({ ...prev, [photo.id]: { id: commentId, name } }));
                                }}
                              />
                            </div>
                          );
                        })}
                    </CollapsibleContent>
                  </Collapsible>

                  {/* Reply indicator */}
                  {replyingTo[photo.id] && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 px-2 py-1 rounded">
                      <span>Replying to {replyingTo[photo.id]!.name}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 px-1 text-xs"
                        onClick={() => setReplyingTo(prev => ({ ...prev, [photo.id]: undefined }))}
                      >
                        Cancel
                      </Button>
                    </div>
                  )}

                  {/* Add Comment */}
                  <div className="flex gap-2 pt-2 border-t">
                    <Input
                      value={commentInput}
                      onChange={(e) => setCommentInputs(prev => ({ ...prev, [photo.id]: e.target.value }))}
                      placeholder={replyingTo[photo.id] ? `Reply to ${replyingTo[photo.id]!.name}...` : "Add a comment..."}
                      className="flex-1 h-8 text-sm"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && commentInput.trim()) {
                          addCommentMutation.mutate({ 
                            photoId: photo.id, 
                            text: commentInput.trim(),
                            replyToId: replyingTo[photo.id]?.id
                          });
                        }
                      }}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        const trimmedText = commentInput.trim();
                        if (!trimmedText) return;
                        addCommentMutation.mutate({ 
                          photoId: photo.id, 
                          text: trimmedText,
                          replyToId: replyingTo[photo.id]?.id
                        });
                      }}
                      disabled={!commentInput.trim() || addCommentMutation.isPending}
                      className="h-8"
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
          
          {/* Load more sentinel */}
          {hasNextPage && (
            <div ref={loadMoreRef} className="flex justify-center py-4">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
          {!hasNextPage && photos.length > 0 && (
            <p className="text-center text-muted-foreground text-sm py-4">No more photos</p>
          )}
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deletePhotoId} onOpenChange={() => {
        // Keep dialog stable on mobile; close only through explicit Cancel/Confirm actions.
      }}>
        <AlertDialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-xl p-5 gap-3">
          <AlertDialogHeader className="pb-0 space-y-1">
            <AlertDialogTitle className="text-center text-base font-semibold">Delete Photo</AlertDialogTitle>
            <AlertDialogDescription className="text-center text-sm">
              How would you like to delete this photo?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              className={cn(
                "w-full text-left py-3 px-3 rounded-lg border transition-all",
                selectedDeleteOption === 'feed' 
                  ? 'border-primary bg-primary/10' 
                  : 'border-border hover:bg-muted'
              )}
              onClick={() => setSelectedDeleteOption('feed')}
            >
              <p className="font-medium text-sm">Remove from feed only</p>
              <p className="text-xs text-muted-foreground">Photo will be removed from the feed but remain in the vault</p>
            </button>
            <button
              type="button"
              className={cn(
                "w-full text-left py-3 px-3 rounded-lg border transition-all",
                selectedDeleteOption === 'vault' 
                  ? 'border-destructive bg-destructive/10' 
                  : 'border-border hover:bg-muted'
              )}
              onClick={() => setSelectedDeleteOption('vault')}
            >
              <p className={cn("font-medium text-sm", selectedDeleteOption === 'vault' && 'text-destructive')}>Delete from feed and vault</p>
              <p className="text-xs text-muted-foreground">Photo will be moved to trash</p>
            </button>
          </div>
          <AlertDialogFooter className="flex-col gap-2 pt-1 sm:flex-col">
            <Button
              className="w-full"
              variant={selectedDeleteOption === 'vault' ? 'destructive' : 'default'}
              disabled={!selectedDeleteOption}
              onClick={() => {
                if (!deletePhotoId || !selectedDeleteOption) return;
                deletePhotoMutation.mutate({ 
                  photoId: deletePhotoId, 
                  deleteFromVault: selectedDeleteOption === 'vault' 
                });
              }}
            >
              Confirm
            </Button>
            <AlertDialogCancel className="w-full mt-0" onClick={() => {
              setDeletePhotoId(null);
              setSelectedDeleteOption(null);
            }}>Cancel</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Photo Lightbox */}
      <PhotoLightbox
        isOpen={lightboxIndex !== null}
        onClose={() => setLightboxIndex(null)}
        photos={photos}
        currentIndex={lightboxIndex ?? 0}
        onNavigate={setLightboxIndex}
        onDelete={(photoId) => {
          setLightboxIndex(null);
          setTimeout(() => setDeletePhotoId(photoId), 100);
        }}
        canDelete={lightboxIndex !== null && photos[lightboxIndex] ? canDeletePhoto(photos[lightboxIndex]) : false}
      />

      {/* Report Photo Dialog */}
      <ReportPhotoDialog
        isOpen={!!reportPhotoId}
        onClose={() => setReportPhotoId(null)}
        photoId={reportPhotoId || ""}
      />

      {/* Block User Dialog */}
      {blockTarget && (
        <BlockUserDialog
          open={!!blockTarget}
          onOpenChange={(open) => !open && setBlockTarget(null)}
          userId={blockTarget.userId}
          userName={blockTarget.userName}
        />
      )}
    </div>
  );
}

function ProFeatureGate({ feature, clubId, teamId }: { feature: string; clubId?: string; teamId?: string }) {
  return (
    <Card className="border-primary/20 bg-primary/5 max-w-lg mx-auto">
      <CardContent className="p-8 text-center">
        <div className="p-4 rounded-full bg-primary/10 w-fit mx-auto mb-4">
          <Lock className="h-8 w-8 text-primary" />
        </div>
        <h3 className="font-semibold text-lg mb-2">{feature} is a Pro Feature</h3>
        <p className="text-muted-foreground text-sm mb-4">
          Upgrade to Pro to unlock {feature.toLowerCase()}.
        </p>
        <Badge variant="secondary" className="mb-4 bg-primary/20 text-primary">
          <Crown className="h-3 w-3 mr-1" /> Pro Only
        </Badge>
        {(clubId || teamId) && (
          <div className="mt-4">
            <Link to={teamId ? `/teams/${teamId}/upgrade` : `/clubs/${clubId}/upgrade`}>
              <Button size="sm">
                <Crown className="h-4 w-4 mr-2" />
                Upgrade to Pro
              </Button>
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}