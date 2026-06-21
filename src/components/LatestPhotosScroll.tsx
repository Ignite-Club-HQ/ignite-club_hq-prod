import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useClubTheme } from "@/hooks/useClubTheme";
import { Image, Lock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";

interface LatestPhoto {
  id: string;
  file_url: string | null;
  image_url: string | null;
  title: string | null;
  created_at: string;
  team_name: string | null;
  club_name: string | null;
}

interface LatestPhotosScrollProps {
  showProBadge?: boolean;
}

export function LatestPhotosScroll({ showProBadge = false }: LatestPhotosScrollProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { activeClubFilter } = useClubTheme();

  const { data: photos = [], isLoading } = useQuery({
    queryKey: ["latest-photos-scroll", user?.id, activeClubFilter],
    queryFn: async () => {
      if (!user) return [];

      // Get user's roles to know which clubs/teams they belong to
      const { data: roles } = await supabase
        .from("user_roles")
        .select("team_id, club_id")
        .eq("user_id", user.id);

      if (!roles) return [];

      const clubIds = [...new Set(roles.filter(r => r.club_id).map(r => r.club_id))] as string[];
      const teamIds = [...new Set(roles.filter(r => r.team_id).map(r => r.team_id))] as string[];

      if (clubIds.length === 0 && teamIds.length === 0) return [];

      // Build query for recent feed photos the user has access to
      let query = supabase
        .from("photos")
        .select("id, file_url, image_url, title, created_at, club_id, team_id, teams(name), clubs!photos_club_id_fkey(name)")
        .eq("show_in_feed", true)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(12);

      if (activeClubFilter) {
        query = query.eq("club_id", activeClubFilter);
      } else {
        // Filter to user's clubs/teams
        const orFilters: string[] = [];
        if (clubIds.length > 0) orFilters.push(`club_id.in.(${clubIds.join(",")})`);
        if (teamIds.length > 0) orFilters.push(`team_id.in.(${teamIds.join(",")})`);
        if (orFilters.length > 0) {
          query = query.or(orFilters.join(","));
        }
      }

      const { data } = await query;

      if (!data) return [];

      return data.map((p): LatestPhoto => ({
        id: p.id,
        file_url: p.file_url,
        image_url: p.image_url,
        title: p.title,
        created_at: p.created_at,
        team_name: (p.teams as any)?.name || null,
        club_name: (p.clubs as any)?.name || null,
      }));
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Latest Photos</h2>
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="shrink-0 w-[100px] h-[100px] rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      </section>
    );
  }

  if (photos.length === 0) {
    return (
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">Latest Photos</h2>
            {showProBadge && (
              <Badge variant="outline" className="text-[10px] py-0 h-4 border-muted-foreground/30">
                <Lock className="h-2.5 w-2.5 mr-0.5" />
                Pro
              </Badge>
            )}
          </div>
          <button
            onClick={() => navigate("/media")}
            className="text-sm text-primary hover:underline"
          >
            View all
          </button>
        </div>
        <button
          onClick={() => navigate("/media")}
          className="w-full rounded-lg border border-dashed bg-card p-4 flex flex-col items-center gap-2 hover:border-primary/50 transition-colors"
        >
          <Image className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No photos yet — upload your first!</p>
        </button>
      </section>
    );
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Latest Photos</h2>
          {showProBadge && (
            <Badge variant="outline" className="text-[10px] py-0 h-4 border-muted-foreground/30">
              <Lock className="h-2.5 w-2.5 mr-0.5" />
              Pro
            </Badge>
          )}
        </div>
        <button
          onClick={() => navigate("/media")}
          className="text-sm text-primary hover:underline"
        >
          View all
        </button>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
        {photos.map((photo) => {
          const imgSrc = photo.image_url || photo.file_url;
          return (
            <button
              key={photo.id}
              onClick={() => navigate(`/media?photo=${photo.id}`)}
              className="shrink-0 w-[100px] group relative rounded-lg overflow-hidden border bg-card hover:border-primary/50 transition-colors active:scale-[0.97]"
            >
              {imgSrc ? (
                <img
                  src={imgSrc}
                  alt={photo.title || "Photo"}
                  className="w-full h-[100px] object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="w-full h-[100px] bg-muted flex items-center justify-center">
                  <Image className="h-6 w-6 text-muted-foreground" />
                </div>
              )}
              {/* Overlay with team/time info */}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-1.5 pt-4">
                <p className="text-[10px] text-white/90 font-medium truncate">
                  {photo.team_name || photo.club_name || ""}
                </p>
                <p className="text-[9px] text-white/60">
                  {formatDistanceToNow(new Date(photo.created_at), { addSuffix: true })}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
