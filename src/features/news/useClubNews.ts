import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { readHomeSectionSnapshot, writeHomeSectionSnapshot } from "@/lib/homeSectionSnapshot";

/**
 * Club News data access.
 *
 * News is official, persistent club information — deliberately separate from
 * chat/broadcast messaging. RLS on `club_news` is the security boundary:
 * members only see published posts for their club whose audience (whole club
 * or selected teams) includes them, so an optional `clubId` here only narrows
 * an already-authorised set.
 */
export interface ClubNewsRow {
  id: string;
  club_id: string;
  title: string;
  content: string;
  image_url: string | null;
  author_id: string | null;
  target_team_ids: string[] | null;
  target_mini_league_id?: string | null;
  target_competition_id?: string | null;
  is_important: boolean;
  published_at: string;
  attachments?: unknown;
}

const NEWS_COLUMNS =
  "id, club_id, title, content, image_url, author_id, target_team_ids, target_mini_league_id, target_competition_id, is_important, published_at, attachments";


export function useClubNewsFeed(clubId?: string | null, limit = 50) {
  const snapshotScope = `${clubId ?? "all"}_${limit}`;
  return useQuery<ClubNewsRow[]>({
    queryKey: ["club-news", clubId ?? "all", limit],
    queryFn: async () => {
      let query = supabase
        .from("club_news")
        .select(NEWS_COLUMNS)
        .eq("is_published", true)
        .order("published_at", { ascending: false })
        .limit(limit);

      if (clubId) {
        // Competition news lives on the organising club, but must also show in
        // the News of every club with a team entered. RLS still decides who
        // actually sees each post.
        const { data: compIds } = await (supabase.rpc as any)("club_news_competition_ids", {
          _club_id: clubId,
        });
        const ids = ((compIds || []) as unknown[])
          .map((r) => (typeof r === "string" ? r : (r as any)?.club_news_competition_ids))
          .filter(Boolean) as string[];
        query = ids.length
          ? query.or(`club_id.eq.${clubId},target_competition_id.in.(${ids.join(",")})`)
          : query.eq("club_id", clubId);
      }

      const { data, error } = await query;
      if (error) throw error;
      const rows = (data || []) as ClubNewsRow[];
      writeHomeSectionSnapshot("club-news", snapshotScope, rows);
      return rows;
    },
    // Paint the last known posts immediately on cold open so the Home section
    // doesn't pop in after everything else.
    placeholderData: () =>
      readHomeSectionSnapshot<ClubNewsRow[]>("club-news", snapshotScope) ?? undefined,
    staleTime: 2 * 60 * 1000,
  });
}


/** Latest single post — powers the compact Home section. */
export function useLatestClubNews(clubId?: string | null) {
  const feed = useClubNewsFeed(clubId, 1);
  return { ...feed, latest: feed.data?.[0] ?? null };
}

export function useClubNewsPost(newsId?: string | null) {
  return useQuery<ClubNewsRow | null>({
    queryKey: ["club-news-post", newsId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("club_news")
        .select(NEWS_COLUMNS)
        .eq("id", newsId!)
        .maybeSingle();
      if (error) throw error;
      return (data as ClubNewsRow | null) ?? null;
    },
    enabled: !!newsId,
  });
}

/**
 * Clubs where the viewer may publish news. Reuses the existing role model
 * (`club_admin` at club level) — no new role system.
 */
export function useNewsPublishableClubs() {
  const { user } = useAuth();
  return useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["news-publishable-clubs", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("club_id, role")
        .eq("user_id", user!.id)
        .in("role", ["club_admin"]);
      if (error) throw error;
      const ids = Array.from(
        new Set((data || []).map((r) => r.club_id).filter(Boolean) as string[]),
      );
      if (ids.length === 0) return [];
      const { data: clubs, error: clubErr } = await supabase
        .from("clubs")
        .select("id, name")
        .in("id", ids);
      if (clubErr) throw clubErr;
      return (clubs || []) as Array<{ id: string; name: string }>;
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });
}

export function useClubTeamsForNews(clubId?: string | null) {
  return useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["club-teams-for-news", clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("id, name")
        .eq("club_id", clubId!)
        .order("name");
      if (error) throw error;
      return (data || []) as Array<{ id: string; name: string }>;
    },
    enabled: !!clubId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Resolve team names directly by id. Used by News audience labels so we can
 * always name the targeted teams, even before/without the club team list
 * (e.g. an article opened by deep link before `club_id` teams have loaded).
 */
export function useTeamNamesByIds(teamIds?: string[] | null) {
  const ids = Array.from(new Set((teamIds || []).filter(Boolean)));
  return useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["news-team-names", ids.slice().sort().join(",")],
    queryFn: async () => {
      const { data, error } = await supabase.from("teams").select("id, name").in("id", ids);
      if (error) throw error;
      return (data || []) as Array<{ id: string; name: string }>;
    },
    enabled: ids.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}

/** Competitions where the viewer is an owner/admin and may publish news. */
export function useNewsPublishableCompetitions() {
  const { user } = useAuth();
  return useQuery<Array<{ id: string; name: string; organizer_club_id: string }>>({
    queryKey: ["news-publishable-competitions", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("competition_roles")
        .select("competition_id, role")
        .eq("user_id", user!.id)
        .in("role", ["owner", "admin"]);
      if (error) throw error;
      const ids = Array.from(new Set((data || []).map((r) => r.competition_id)));
      if (ids.length === 0) return [];
      const { data: comps, error: cErr } = await supabase
        .from("competitions")
        .select("id, name, organizer_club_id")
        .in("id", ids)
        .order("name");
      if (cErr) throw cErr;
      return (comps || []) as Array<{ id: string; name: string; organizer_club_id: string }>;
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });
}

export function useClubMiniLeaguesForNews(clubId?: string | null) {
  return useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["club-mini-leagues-for-news", clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mini_leagues")
        .select("id, name")
        .eq("club_id", clubId!)
        .order("name");
      if (error) throw error;
      return (data || []) as Array<{ id: string; name: string }>;
    },
    enabled: !!clubId,
    staleTime: 5 * 60 * 1000,
  });
}
