import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { cn } from "@/lib/utils";
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Image, Lock, Crown, Plus, MessageCircle, Trash2, Loader2, Filter, X, Calendar, Flag, ShieldAlert, Eye } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ReportPhotoDialog } from "@/components/ReportPhotoDialog";
import { BlockUserDialog } from "@/components/BlockUserDialog";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { PageLoading } from "@/components/ui/page-loading";
import { Button } from "@/components/ui/button";

import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { useClubTheme } from "@/hooks/useClubTheme";
import { format, startOfDay, endOfDay, isWithinInterval } from "date-fns";
import { formatTimeShort } from "@/lib/formatTimeShort";
import { Link } from "react-router-dom";
import { EmojiReactions } from "@/components/EmojiReactions";

import { MediaCommentSheet } from "@/components/MediaCommentSheet";
import { LazyImage } from "@/components/LazyImage";
import { PhotoLightbox } from "@/components/PhotoLightbox";
import { UploadPhotoSheet } from "@/components/UploadPhotoSheet";
import { SharePhotoButton } from "@/components/SharePhotoButton";
import { ClubTeamFilter } from "@/components/ClubTeamFilter";
import { cachePhotos, removePhotoFromCache, getFeedPhotosFromCache, backgroundRefreshPhotos, CachedPhoto } from "@/lib/mediaCache";
import { useProfiles } from "@/hooks/useProfiles";
import { usePhotoViewCounts, useRecordPhotoView, usePhotoViewRealtime } from "@/hooks/usePhotoViews";
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

// Feed-scroll view tracking launched 2026-04-18. Photos uploaded before this
// date don't show a view count since scroll views weren't recorded yet.
const PHOTO_VIEWS_FEATURE_LAUNCH = new Date("2026-04-18T00:00:00Z");

export default function MediaPage() {
  const { user } = useAuth();
  usePageTitle("Media");
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const highlightedPhotoId = searchParams.get("photo");
  const photoRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const { activeClubFilter } = useClubTheme();
  
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);

  // Auto-open the upload sheet when ?upload=1 is in the URL (e.g. tapped from
  // a post-game gallery prompt card in team chat).
  useEffect(() => {
    if (searchParams.get("upload") === "1") {
      setUploadDialogOpen(true);
    }
  }, [searchParams]);

  const [uploadingCount, setUploadingCount] = useState(0);
  const [expandedComments, setExpandedComments] = useState<Set<string>>(new Set());
  const [commentInputs, setCommentInputs] = useState<Record<string, string>>({});
  const [replyingTo, setReplyingTo] = useState<Record<string, { id: string; name: string } | undefined>>({});
  const [activeCommentPhotoId, setActiveCommentPhotoId] = useState<string | null>(null);
  const [deletePhotoId, setDeletePhotoId] = useState<string | null>(null);
  const [deletingPhotoId, setDeletingPhotoId] = useState<string | null>(null);
  const [selectedDeleteOption, setSelectedDeleteOption] = useState<'feed' | 'vault' | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [reportPhotoId, setReportPhotoId] = useState<string | null>(null);
  const [blockTarget, setBlockTarget] = useState<{ userId: string; userName: string } | null>(null);
  // Long-press action sheet — opens Delete/Report/Block when the user holds
  // a finger on a photo. Replaces the previous kebab menu, which was being
  // tapped accidentally during scroll.
  const [actionPhotoId, setActionPhotoId] = useState<string | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);

  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressStartRef.current = null;
  }, []);

  const startLongPress = useCallback((photoId: string, x: number, y: number) => {
    cancelLongPress();
    longPressFiredRef.current = false;
    longPressStartRef.current = { x, y };
    longPressTimerRef.current = window.setTimeout(() => {
      longPressFiredRef.current = true;
      longPressTimerRef.current = null;
      // Light haptic if available
      try {
        if (typeof navigator !== "undefined" && "vibrate" in navigator) {
          navigator.vibrate?.(15);
        }
      } catch { /* noop */ }
      setActionPhotoId(photoId);
    }, 500);
  }, [cancelLongPress]);

  const moveLongPress = useCallback((x: number, y: number) => {
    const start = longPressStartRef.current;
    if (!start) return;
    if (Math.abs(x - start.x) > 8 || Math.abs(y - start.y) > 8) {
      cancelLongPress();
    }
  }, [cancelLongPress]);
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

  // Apply team/club/event filter from URL search params (e.g. from My Teams gallery link or post-game prompt)
  const urlTeamId = searchParams.get("team");
  const urlClubId = searchParams.get("club");
  const urlEventId = searchParams.get("event");

  // Sync club filter with theme - reset to "all" when theme is cleared
  useEffect(() => {
    // When deep-linking to a specific photo, clear all filters so it's visible
    if (highlightedPhotoId) {
      setSelectedClubId("all");
      setSelectedTeamId("all");
      setDateRange({ from: undefined, to: undefined });
      return;
    }
    
    if (urlTeamId) {
      setSelectedTeamId(urlTeamId);
      setShowFilters(true);
    } else if (urlClubId) {
      setSelectedClubId(urlClubId);
      setShowFilters(true);
    } else if (activeClubFilter) {
      setSelectedClubId(activeClubFilter);
      setSelectedTeamId("all");
    } else {
      setSelectedClubId("all");
      setSelectedTeamId("all");
    }
  }, [activeClubFilter, urlTeamId, urlClubId, highlightedPhotoId]);


  // Scroll to highlighted photo when loaded — retry until element appears
  useEffect(() => {
    if (!highlightedPhotoId) return;
    
    let attempts = 0;
    const maxAttempts = 15;
    
    const tryScroll = () => {
      const element = photoRefs.current.get(highlightedPhotoId);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
        setExpandedComments(prev => new Set(prev).add(highlightedPhotoId));
        return;
      }
      attempts++;
      if (attempts < maxAttempts) {
        setTimeout(tryScroll, 300);
      }
    };
    
    // Start trying after a short delay to let initial render complete
    setTimeout(tryScroll, 200);
  }, [highlightedPhotoId]);

  // Auto-open the comment sheet when arriving from a comment notification
  // (e.g. ?photo=ID&comments=1). This ensures comment notifications take the
  // user straight to the comment screen rather than just the photo feed.
  useEffect(() => {
    if (!highlightedPhotoId) return;
    if (searchParams.get("comments") !== "1") return;
    setActiveCommentPhotoId(highlightedPhotoId);
  }, [highlightedPhotoId, searchParams]);

  // Fast parallel queries - don't block on access check
  // ─── Diagnostic logging for hung-spinner debugging ───
  // Uses console.warn so messages survive the production console silencer.
  const diagLog = (step: string, extra?: Record<string, unknown>) => {
    console.warn(`[MediaDiag] ${step}`, { t: new Date().toISOString(), userId: user?.id, ...extra });
  };

  const { data: userRoles, isLoading: loadingRoles } = useQuery({
    queryKey: ["user-roles-media", user?.id],
    queryFn: async () => {
      const start = performance.now();
      diagLog("userRoles:start");
      const { data, error } = await supabase
        .from("user_roles")
        .select("role, club_id, team_id")
        .eq("user_id", user!.id);
      diagLog("userRoles:end", { ms: Math.round(performance.now() - start), count: data?.length ?? null, error: error?.message });

      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
    staleTime: 300000,
    placeholderData: (prev) => prev,
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
      const overall = performance.now();
      diagLog("hasProClub:start", { roleClubIds: roleClubIds.length, roleTeamIds: roleTeamIds.length, activeClubFilter });
      const candidateClubIds = activeClubFilter
        ? [...new Set([...roleClubIds, activeClubFilter])]
        : roleClubIds;

      if (candidateClubIds.length === 0 && roleTeamIds.length === 0) {
        diagLog("hasProClub:end-no-candidates");
        return false;
      }

      // Fetch club subscriptions and team info in parallel
      const parallelStart = performance.now();
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
      diagLog("hasProClub:parallel-resolved", {
        ms: Math.round(performance.now() - parallelStart),
        clubSubError: clubSubResult.error?.message,
        teamInfoError: teamInfoResult.error?.message,
        totalMs: Math.round(performance.now() - overall),
      });

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
    staleTime: 300000,
    gcTime: 300000,
    placeholderData: (prev) => prev,
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
    placeholderData: (prev) => prev,
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
    placeholderData: (prev) => prev,
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
    placeholderData: (prev) => prev,
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

  const cardId = searchParams.get("card");

  // Fetch the gallery card's photo_ids when ?card= is present so we can scope
  // the gallery to just that upload batch.
  const { data: cardPhotoIds } = useQuery({
    queryKey: ["gallery-chat-card-photo-ids", cardId],
    queryFn: async () => {
      if (!cardId) return null;
      const { data } = await supabase
        .from("gallery_chat_cards")
        .select("photo_ids")
        .eq("id", cardId)
        .maybeSingle();
      return (data?.photo_ids as string[] | null) ?? [];
    },
    enabled: !!cardId,
    staleTime: 60 * 1000,
  });

  const selectedClubFilter = selectedClubId !== "all" ? selectedClubId : null;
  const selectedTeamFilter = selectedTeamId !== "all" ? selectedTeamId : null;
  const dateFromKey = dateRange.from ? startOfDay(dateRange.from).toISOString() : null;
  const dateToKey = dateRange.to ? endOfDay(dateRange.to).toISOString() : null;
  const cardPhotoIdsKey = cardPhotoIds?.join(",") ?? "";
  const photosQueryKey = useMemo(
    () => ["photos", user?.id, selectedClubFilter, selectedTeamFilter, urlEventId ?? null, dateFromKey, dateToKey, cardId, cardPhotoIdsKey] as const,
    [user?.id, selectedClubFilter, selectedTeamFilter, urlEventId, dateFromKey, dateToKey, cardId, cardPhotoIdsKey]
  );

  const { 
    data: photosData, 
    isLoading: loadingPhotos,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isSuccess: photosSuccess,
  } = useInfiniteQuery({
    queryKey: photosQueryKey,
    queryFn: async ({ pageParam = 0 }) => {
      if (cardId && (cardPhotoIds?.length ?? 0) === 0) {
        return { photos: [], nextCursor: undefined };
      }

      const start = performance.now();
      diagLog("photos:start", { pageParam });
      let query = supabase
        .from("photos")
        .select("id, file_url, image_url, title, caption, created_at, club_id, team_id, event_id, mini_league_id, uploader_id, clubs(name, is_pro), teams(name, club_id, clubs(name)), mini_leagues(name, club_id, clubs(name))")
        .eq("show_in_feed", true)
        .is("deleted_at", null);

      if (cardId && cardPhotoIds?.length) query = query.in("id", cardPhotoIds);
      if (selectedClubFilter) query = query.eq("club_id", selectedClubFilter);
      if (selectedTeamFilter) query = query.eq("team_id", selectedTeamFilter);
      if (urlEventId) query = query.eq("event_id", urlEventId);
      if (dateFromKey) query = query.gte("created_at", dateFromKey);
      if (dateToKey) query = query.lte("created_at", dateToKey);

      const { data, error } = await query
        .order("created_at", { ascending: false })
        .range(pageParam, pageParam + PHOTOS_PER_PAGE - 1);
      diagLog("photos:end", { pageParam, ms: Math.round(performance.now() - start), rows: data?.length ?? null, error: error?.message });

      if (error) throw error;
      
      // Cache first page results for offline access
      if (pageParam === 0 && data && !selectedClubFilter && !selectedTeamFilter && !urlEventId && !dateFromKey && !dateToKey && !cardId) {
        cachePhotos(null, null, null, data.map(p => ({
          id: p.id,
          file_url: p.file_url || p.image_url,
          title: p.title,
          caption: p.caption,
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
    enabled: !!user && (!cardId || cardPhotoIds !== undefined),
    staleTime: 60000,
    gcTime: 300000,
  });

  const { data: highlightedPhoto } = useQuery({
    queryKey: ["highlighted-photo", user?.id, highlightedPhotoId],
    queryFn: async () => {
      if (!highlightedPhotoId) return null;
      const { data, error } = await supabase
        .from("photos")
        .select("id, file_url, image_url, title, caption, created_at, club_id, team_id, event_id, mini_league_id, uploader_id, clubs(name, is_pro), teams(name, club_id, clubs(name)), mini_leagues(name, club_id, clubs(name))")
        .eq("id", highlightedPhotoId)
        .eq("show_in_feed", true)
        .is("deleted_at", null)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    enabled: !!user && !!highlightedPhotoId,
    staleTime: 60000,
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
  const allPhotos = useMemo<any[]>(() => {
    const serverPhotos = photosData?.pages.flatMap(page => page.photos) ?? [];
    const withHighlightedPhoto = highlightedPhoto && !serverPhotos.some((p) => p.id === highlightedPhoto.id)
      ? [highlightedPhoto, ...serverPhotos]
      : serverPhotos;
    
    // If we have server data, use it
    if (withHighlightedPhoto.length > 0) {
      return withHighlightedPhoto;
    }
    
    // Otherwise use cached photos (with placeholder profile data)
    if (cachedPhotosData && cachedPhotosData.length > 0) {
      return cachedPhotosData.map(p => ({
        ...p,
        caption: p.caption ?? null,
        image_url: p.file_url,
        mini_league_id: null,
        clubs: null,
        teams: null,
        mini_leagues: null,
        profiles: null,
      }));
    }
    
    return [];
  }, [photosData, highlightedPhoto, cachedPhotosData]);

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

    // Filter by gallery card batch (overrides other filters when active)
    if (cardId && cardPhotoIds) {
      const idSet = new Set(cardPhotoIds);
      return filtered.filter(photo => idSet.has(photo.id));
    }
    
    // Filter by club
    if (selectedClubId !== "all") {
      filtered = filtered.filter(photo => photo.club_id === selectedClubId);
    }
    
    // Filter by team
    if (selectedTeamId !== "all") {
      filtered = filtered.filter(photo => photo.team_id === selectedTeamId);
    }

    // Filter by event (auto-applied from URL ?event= param)
    if (urlEventId) {
      filtered = filtered.filter(photo => photo.event_id === urlEventId);
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
  }, [allPhotos, selectedClubId, selectedTeamId, dateRange, cardId, cardPhotoIds, urlEventId]);

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

  // Pro access check - don't show content until we've confirmed Pro status on FIRST load.
  // Once resolved, never re-show skeletons on background refetch (prevents jolt on resume/unlock).
  const hasProAccess = isAppAdmin || hasProClub === true;
  const hasProAccessQueryFailed = !!proAccessError;
  const proAccessEverResolved = useRef(false);
  // Only mark as resolved when the query ran with REAL role data (not empty due to auth race).
  // If roles haven't loaded yet, a premature `false` from empty candidateIds must not be treated as final.
  const rolesAreReady = !!userRoles && !loadingRoles;
  if ((hasProClub !== undefined && rolesAreReady) || hasProAccessQueryFailed || isAppAdmin) {
    proAccessEverResolved.current = true;
  }

  const proQueryShouldBeEnabled = !!user && (roleClubIds.length > 0 || roleTeamIds.length > 0 || !!activeClubFilter);
  const proQueryNotYetResolved = proQueryShouldBeEnabled && hasProClub === undefined && !hasProAccessQueryFailed;
  const waitingOnRolesWithoutFallback = !!user && !userRoles && !activeClubFilter;
  // Only show loading state on initial resolution — never on refetch/resume
  const isCheckingProAccess = !proAccessEverResolved.current && (!user || loadingProAccess || loadingRoles || waitingOnRolesWithoutFallback || proQueryNotYetResolved);

  // Get ALL loaded photo IDs (not filtered) for fetching reactions/comments
  const allPhotoIds = useMemo(() => allPhotos?.map(p => p.id) || [], [allPhotos]);

  // Photo view tracking — count, recording, and realtime updates
  const { data: photoViewCounts } = usePhotoViewCounts(allPhotoIds);
  const { recordView, observeView } = useRecordPhotoView(user?.id);
  usePhotoViewRealtime(allPhotoIds);

  // Stable query key for reactions - bucket photo count by 50 to avoid refetching
  // on every infinite-scroll page load. Realtime channel below keeps data fresh in between.
  const photoCountBucket = Math.ceil(allPhotoIds.length / 50);
  const reactionsQueryKey = useMemo(() => ["photo-reactions", user?.id, photoCountBucket], [user?.id, photoCountBucket]);
  
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
    staleTime: 120000,
    placeholderData: (prev) => prev,
  });

  // Use fetched reactions
  const allReactions = fetchedReactions || [];

  // Stable query key for comments - bucket photo count by 50 to avoid refetching on every page
  const commentsQueryKey = useMemo(() => ["photo-comments", user?.id, photoCountBucket], [user?.id, photoCountBucket]);

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
    staleTime: 120000,
    placeholderData: (prev) => prev,
  });

  // Realtime: keep comments and reactions in sync so newly added ones
  // appear without waiting for the 2-minute staleTime to expire.
  useEffect(() => {
    if (!user?.id || allPhotoIds.length === 0) return;
    const channel = supabase
      .channel(`media-comments-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "photo_comments" },
        (payload: any) => {
          const row = (payload.new || payload.old) as { photo_id?: string } | undefined;
          if (row?.photo_id && allPhotoIds.includes(row.photo_id)) {
            queryClient.invalidateQueries({ queryKey: ["photo-comments", user.id] });
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "photo_reactions" },
        (payload: any) => {
          const row = (payload.new || payload.old) as { photo_id?: string } | undefined;
          if (row?.photo_id && allPhotoIds.includes(row.photo_id)) {
            queryClient.invalidateQueries({ queryKey: ["photo-reactions", user.id] });
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, allPhotoIds, queryClient]);

  // Refresh comments/reactions when the tab/app becomes visible again so
  // returning to the app surfaces anything posted while away.
  useEffect(() => {
    if (!user?.id) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        queryClient.invalidateQueries({ queryKey: ["photo-comments", user.id] });
        queryClient.invalidateQueries({ queryKey: ["photo-reactions", user.id] });
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [user?.id, queryClient]);

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
    onSuccess: (_, variables) => {
      // Invalidate to replace temp comment with real data from server
      queryClient.invalidateQueries({ queryKey: commentsQueryKey });
      // Award engagement points for photo comment (fire and forget)
      if (user?.id && variables.photoId) {
        const photo = allPhotos?.find(p => p.id === variables.photoId);
        if (photo?.club_id) {
          import("@/lib/engagementPoints").then(({ awardEngagementPoints }) => {
            awardEngagementPoints({
              userId: user.id,
              clubId: photo.club_id,
              action: "photo_comment",
              scopeId: variables.photoId,
            }).catch(() => {});
          });
        }
      }
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
      const now = new Date().toISOString();
      if (deleteFromVault) {
        // Soft delete in photos table
        const { error } = await supabase
          .from("photos")
          .update({ 
            deleted_at: now,
            show_in_feed: false
          })
          .eq("id", photoId);
        if (error) throw error;

        // Also soft delete the corresponding vault_files record so it appears in Vault trash
        // First get the photo's file_url to find the matching vault_files record
        const { data: photoData } = await supabase
          .from("photos")
          .select("file_url, image_url")
          .eq("id", photoId)
          .single();
        
        if (photoData) {
          const fileUrl = photoData.file_url || photoData.image_url;
          if (fileUrl) {
            await supabase
              .from("vault_files")
              .update({ 
                deleted_at: now,
                deleted_by: user?.id 
              })
              .eq("file_url", fileUrl);
          }
        }
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
      await queryClient.cancelQueries({ queryKey: photosQueryKey });
      
      // Snapshot the previous value
      const previousPhotos = queryClient.getQueryData(photosQueryKey);
      
      // Optimistically remove the photo from the cache
      queryClient.setQueryData(photosQueryKey, (old: any) => {
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
        queryClient.setQueryData(photosQueryKey, context.previousPhotos);
      }
      toast.error(error.message || "Failed to delete photo");
    },
    onSettled: () => {
      setDeletingPhotoId(null);
      queryClient.invalidateQueries({ queryKey: photosQueryKey });
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

  // Diagnostic: log what's blocking the skeleton from clearing.
  useEffect(() => {
    console.warn("[MediaDiag] render-state", {
      t: new Date().toISOString(),
      hasUser: !!user,
      userId: user?.id,
      loadingRoles,
      hasUserRoles: !!userRoles,
      userRolesCount: userRoles?.length ?? null,
      loadingProAccess,
      hasProClub,
      proAccessError: (proAccessError as Error | null)?.message,
      loadingPhotos,
      photosSuccess,
      allPhotosCount: allPhotos.length,
      cachedPhotos: cachedPhotosData?.length ?? null,
      showSkeletons,
    });
  }, [user, loadingRoles, userRoles, loadingProAccess, hasProClub, proAccessError, loadingPhotos, photosSuccess, allPhotos.length, cachedPhotosData, showSkeletons]);

  // Don't block on loading if we have cached data to show
  if (showSkeletons) {
    return (
      <div className="py-6 pb-32 space-y-6">
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
    <div className="py-6 pb-32 space-y-6">
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
                defaultTeamId={searchParams.get("team")}
                defaultEventId={searchParams.get("event")}
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
      ) : photos.length === 0 && urlEventId ? (
        <Card className="border-dashed border-primary/40 bg-primary/5 max-w-lg mx-auto">
          <CardContent className="p-8 text-center">
            <div className="mx-auto h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Image className="h-7 w-7 text-primary" />
            </div>
            <p className="font-semibold text-foreground">Be the first to add photos</p>
            <p className="text-sm text-muted-foreground mt-1">
              No photos from this event yet — share what you captured today.
            </p>
            <Button onClick={() => setUploadDialogOpen(true)} className="mt-4 gap-2" size="sm">
              <Plus className="h-4 w-4" />
              Add photos
            </Button>
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
            const photoText = photo.title || photo.caption;

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
                  <div className="flex items-center gap-3">
                    {canSharePhoto(photo) && (
                      <SharePhotoButton 
                        photoId={photo.id}
                        imageUrl={photo.file_url || photo.image_url} 
                        title={photoText}
                        clubName={photo.teams?.clubs?.name || photo.clubs?.name}
                        teamName={photo.teams?.name}
                      />
                    )}
                  </div>
                </div>

                {/* Image with lazy loading. Long-press opens the action menu
                    (Delete / Report / Block). The kebab dropdown was removed
                    because it was being tapped accidentally during scroll. */}
                <div 
                  ref={observeView(photo.id)}
                  className="relative w-full aspect-square bg-muted overflow-hidden cursor-pointer select-none"
                  style={{ WebkitTouchCallout: "none" }}
                  onClick={() => {
                    if (isDeleting) return;
                    if (longPressFiredRef.current) {
                      // Suppress click that follows a long-press release.
                      longPressFiredRef.current = false;
                      return;
                    }
                    recordView(photo.id);
                    setLightboxIndex(index);
                  }}
                  onTouchStart={(e) => {
                    if (isDeleting) return;
                    const t = e.touches[0];
                    if (!t) return;
                    startLongPress(photo.id, t.clientX, t.clientY);
                  }}
                  onTouchMove={(e) => {
                    const t = e.touches[0];
                    if (!t) return;
                    moveLongPress(t.clientX, t.clientY);
                  }}
                  onTouchEnd={cancelLongPress}
                  onTouchCancel={cancelLongPress}
                  onContextMenu={(e) => {
                    // Suppress native long-press context menu — we provide our own.
                    e.preventDefault();
                  }}
                >
                  <LazyImage
                    src={photo.file_url || photo.image_url}
                    alt={photoText || "Photo"}
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
                      onClick={() => setActiveCommentPhotoId(photo.id)}
                      className="gap-1 p-0 h-auto hover:bg-transparent ml-auto"
                    >
                      <MessageCircle className="h-5 w-5" />
                      {comments.length > 0 && <span className="text-xs">{comments.length}</span>}
                    </Button>
                    {new Date(photo.created_at) >= PHOTO_VIEWS_FEATURE_LAUNCH && (photoViewCounts?.get(photo.id) || 0) > 0 && (
                      <div
                        className="flex items-center gap-1 text-muted-foreground"
                        title={`${photoViewCounts?.get(photo.id) || 0} view${(photoViewCounts?.get(photo.id) || 0) === 1 ? "" : "s"}`}
                        aria-label={`${photoViewCounts?.get(photo.id) || 0} views`}
                      >
                        <Eye className="h-5 w-5" />
                        <span className="text-xs">{photoViewCounts?.get(photo.id)}</span>
                      </div>
                    )}
                  </div>

                  {photoText && (
                    <p className="text-sm">
                      <span className="font-medium">{displayName}</span>{" "}
                      {photoText}
                    </p>
                  )}

                  <p className="text-xs text-muted-foreground">
                    {formatTimeShort(photo.created_at)}
                  </p>

                  {comments.length > 0 && (
                    <button 
                      onClick={() => setActiveCommentPhotoId(photo.id)}
                      className="text-sm text-muted-foreground"
                    >
                      View all {comments.length} comment{comments.length !== 1 ? "s" : ""}
                    </button>
                  )}
                </div>
              </Card>
            );
          })}
          
          {/* Load more sentinel - always rendered so the IntersectionObserver
              can fire as soon as hasNextPage flips true (e.g. when server data
              arrives after initial cached photos render). */}
          {(hasNextPage || isFetchingNextPage || loadingPhotos || isShowingCachedData) && (
            <div ref={loadMoreRef} className="flex min-h-8 justify-center py-2" aria-live="polite">
              {isFetchingNextPage ? (
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              ) : null}
            </div>
          )}
          {!hasNextPage && !loadingPhotos && !isShowingCachedData && photos.length > 0 && (
            <p className="text-center text-muted-foreground text-sm py-4">No more photos</p>
          )}
        </div>
      )}

      {/* Comment Bottom Sheet */}
      {activeCommentPhotoId && (() => {
        const activePhoto = allPhotos.find(p => p.id === activeCommentPhotoId);
        if (!activePhoto) return null;
        const activeComments = getPhotoComments(activeCommentPhotoId);
        const activeInput = commentInputs[activeCommentPhotoId] || "";
        const cachedProfileSheet = getProfile(activePhoto.uploader_id);
        const sheetDisplayName = (activePhoto as any).profiles?.display_name || cachedProfileSheet?.display_name || null;
        const sheetAvatarUrl = (activePhoto as any).profiles?.avatar_url || cachedProfileSheet?.avatar_url || null;
        return (
          <MediaCommentSheet
            open={!!activeCommentPhotoId}
            onOpenChange={(open) => { if (!open) setActiveCommentPhotoId(null); }}
            photoUrl={activePhoto.file_url || activePhoto.image_url}
            uploaderName={sheetDisplayName}
            uploaderAvatar={sheetAvatarUrl}
            comments={activeComments}
            commentInput={activeInput}
            onCommentInputChange={(val) => setCommentInputs(prev => ({ ...prev, [activeCommentPhotoId]: val }))}
            onSubmitComment={() => {
              const trimmedText = activeInput.trim();
              if (!trimmedText) return;
              addCommentMutation.mutate({
                photoId: activeCommentPhotoId,
                text: trimmedText,
                replyToId: replyingTo[activeCommentPhotoId]?.id
              });
            }}
            isPending={addCommentMutation.isPending}
            replyingTo={replyingTo[activeCommentPhotoId]}
            onSetReplyingTo={(reply) => setReplyingTo(prev => ({ ...prev, [activeCommentPhotoId]: reply }))}
            currentUserId={user?.id}
          />
        );
      })()}

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
        onNavigate={(idx) => {
          const navPhoto = photos[idx];
          if (navPhoto) recordView(navPhoto.id);
          setLightboxIndex(idx);
        }}
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

      {/* Long-press action sheet (Delete / Report / Block).
          Replaces the kebab dropdown that was opening accidentally on scroll. */}
      <Sheet open={!!actionPhotoId} onOpenChange={(open) => !open && setActionPhotoId(null)}>
        <SheetContent side="bottom" className="rounded-t-2xl pb-safe">
          {(() => {
            const actionPhoto = actionPhotoId
              ? allPhotos.find((p) => p.id === actionPhotoId)
              : null;
            if (!actionPhoto) return null;
            const cachedProfile = getProfile(actionPhoto.uploader_id);
            const actionDisplayName =
              actionPhoto.profiles?.display_name || cachedProfile?.display_name || "this user";
            return (
              <>
                <SheetHeader>
                  <SheetTitle className="text-center">Photo options</SheetTitle>
                </SheetHeader>
                <div className="flex flex-col gap-1 mt-4">
                  {canDeletePhoto(actionPhoto) && (
                    <Button
                      variant="ghost"
                      className="justify-start h-12 text-destructive hover:text-destructive"
                      onClick={() => {
                        setActionPhotoId(null);
                        setDeletePhotoId(actionPhoto.id);
                      }}
                    >
                      <Trash2 className="h-5 w-5 mr-3" />
                      Delete Photo
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    className="justify-start h-12"
                    onClick={() => {
                      setActionPhotoId(null);
                      setReportPhotoId(actionPhoto.id);
                    }}
                  >
                    <Flag className="h-5 w-5 mr-3" />
                    Report Photo
                  </Button>
                  {actionPhoto.uploader_id && actionPhoto.uploader_id !== user?.id && (
                    <Button
                      variant="ghost"
                      className="justify-start h-12"
                      onClick={() => {
                        setActionPhotoId(null);
                        setBlockTarget({
                          userId: actionPhoto.uploader_id!,
                          userName: actionDisplayName,
                        });
                      }}
                    >
                      <ShieldAlert className="h-5 w-5 mr-3" />
                      Block User
                    </Button>
                  )}
                </div>
              </>
            );
          })()}
        </SheetContent>
      </Sheet>
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