import { supabase } from "@/integrations/supabase/client";
import { filterRecurringEvents } from "@/lib/filterRecurringEvents";

export interface HomeEvent {
  id: string;
  title: string;
  type: "game" | "training" | "social";
  event_date: string;
  start_time?: string | null;
  address: string | null;
  location_name: string | null;
  suburb: string | null;
  club_id: string;
  team_id: string | null;
  mini_league_id: string | null;
  target_team_ids?: string[] | null;
  is_cancelled: boolean;
  is_bye?: boolean;
  is_recurring: boolean;
  parent_event_id: string | null;
  amount: number | null;
  opponent: string | null;
  arrival_minutes_before: number | null;
  adults_only?: boolean | null;
  restricted_to_roles?: string[] | null;
  rsvp_audience?: string | null;
  teams: { name: string; default_match_arrival_minutes: number | null } | null;
  clubs: { name: string; sport: string | null };
}

interface HomeReadDependencies {
  getLocalDateKey: (date?: Date) => string;
  isStillUpcomingForNextUp: (
    event: Pick<HomeEvent, "event_date" | "start_time">,
    nowMs: number,
  ) => boolean;
}

export async function fetchHomeMembershipsAndEvents(
  userId: string,
  dependencies: HomeReadDependencies,
) {
      // Step 1: Fetch user roles.
      // CRITICAL: throw on error (do NOT silently return empty). On resume from
      // background / phone unlock, the access token can be mid-rotation and
      // this call may transiently fail or return null under RLS. Returning
      // `{ events: [] }` here would *overwrite* the previously cached events
      // with an empty list (placeholderData only helps when there is no data)
      // — which is exactly the bug where the Next Up cards disappeared after
      // returning to the app. Throwing lets React Query keep the last good
      // data and retry.
      const rolesRes = await supabase
        .from("user_roles")
        .select("club_id, team_id, role")
        .eq("user_id", userId);

      if (rolesRes.error) throw rolesRes.error;
      const roles = rolesRes.data;

      if (!roles) {
        // .data is [] (not null) on a successful zero-row response, so reaching
        // here means something went wrong upstream — throw so we don't poison
        // the cache with empty events on resume races.
        throw new Error("user_roles fetch returned null data");
      }

      const teamIds = roles.filter(r => r.team_id).map(r => r.team_id) as string[];
      const clubIds = new Set<string>();
      const clubAdminClubIds = new Set<string>();
      const leagueAdminClubIds = new Set<string>();

      roles.forEach(r => {
        if (r.club_id) {
          clubIds.add(r.club_id);
          if (r.role === 'club_admin' || r.role === 'app_admin') {
            clubAdminClubIds.add(r.club_id);
          }
          if (r.role === 'league_admin') {
            leagueAdminClubIds.add(r.club_id);
          }
        }
      });

      // Step 2: Fetch team clubs, player leagues, admin leagues, AND events in parallel
      const now = new Date();
      const todayStr = dependencies.getLocalDateKey(now);
      const leagueAdminArr = Array.from(leagueAdminClubIds);

      // Scope the events fetch to clubs/teams the user is already known to
      // belong to (from `roles`). Without this scope the query pulled the
      // global next 50 events ordered by date, which on multi-club accounts
      // (e.g. a user in a high-volume club + a quieter club) was being
      // saturated by the busy club's training events — silently starving
      // the quieter club's fixtures out of the Next Up window. RLS already
      // restricts visibility, but it does NOT cap per-club volume, so the
      // limit-50 cut-off would land before the quieter club's next event
      // (manifesting as an empty Next Up after switching club themes).
      const clubIdsFromRolesArr = Array.from(clubIds);

      // PER-SCOPE FAN-OUT. A single `.or(club_id.in..., team_id.in...)` query
      // with one global `.limit()` starves quiet clubs: on a multi-club
      // account the busy club's recurring training consumed all 100 rows and
      // the quiet club's only fixture (ranked #116) never reached the client,
      // leaving Next Up empty under that club's theme. Each club (and each
      // team whose club is not already in scope) now gets its own bounded
      // query, all issued in the same Promise.all so there is no new
      // waterfall.
      // Per-scope caps: clubs carry club-wide events for every team, teams are
      // narrower. Neither can starve the other because the cap is per query.
      const CLUB_EVENTS_LIMIT = 30;
      const TEAM_EVENTS_LIMIT = 20;
      // Overall bound on the merged carousel payload (applied AFTER merge+sort
      // so the earliest events across every scope always survive).
      const MERGED_EVENTS_CAP = 100;
      // Concurrency cap — a user in many clubs/teams must not fire 30 requests
      // at once (mobile connection limits + Postgres pool pressure).
      const EVENTS_QUERY_BATCH_SIZE = 8;
      // Pass the select string through a plain-string helper so supabase-js
      // does not re-parse it at the type level for every query in the loop
      // (that is a known tsc blow-up). Row shape is pinned via .returns<T>().
      const sel = (s: string): string => s;
      const EVENT_SELECT =
        "id, title, type, event_date, start_time, address, location_name, suburb, club_id, team_id, mini_league_id, target_team_ids, is_cancelled, is_bye, is_recurring, parent_event_id, amount, opponent, arrival_minutes_before, adults_only, restricted_to_roles, rsvp_audience, teams (name, default_match_arrival_minutes), clubs!club_id (name, sport)";
      // event_date is a TIMESTAMP. For users east of UTC (e.g. AU/NZ),
      // today's local-morning fixtures are stored as YESTERDAY's UTC date
      // (e.g. 9am Adelaide June 13 = 23:30 UTC June 12). Comparing against
      // today's local YYYY-MM-DD therefore excludes them at the server, so
      // morning home-team games disappeared from Next Up while still
      // appearing on the Schedule page (which uses a wider window). Widen the
      // lower bound by one day; the client-side `dependencies.isStillUpcomingForNextUp`
      // strictly filters past events using local date + start_time, so this
      // only admits candidates that may belong to today locally.
      const eventsLowerBound = dependencies.getLocalDateKey(
        new Date(now.getTime() - 24 * 60 * 60 * 1000)
      );

      type HomeEventRow = HomeEvent & { mini_league_id: string | null };

      const scopedEventsQuery = (column: "club_id" | "team_id", value: string, rowLimit: number) =>
        supabase
          .from("events")
          .select(sel(EVENT_SELECT))
          .eq(column, value)
          .gte("event_date", eventsLowerBound)
          .order("event_date", { ascending: true })
          .limit(rowLimit)
          .returns<HomeEventRow[]>();

      // Builders are lazy (the request only fires when awaited), so we keep
      // thunks and run them in bounded batches below.
      const eventQueryThunks: Array<() => PromiseLike<{ data: HomeEventRow[] | null; error: any }>> = [
        ...clubIdsFromRolesArr.map(
          (clubId) => () => scopedEventsQuery("club_id", clubId, CLUB_EVENTS_LIMIT),
        ),
        // Team events are normally covered by their club's query, but a team can
        // sit in a club the user has no direct role in — fetch those separately
        // so they are not lost. De-duplication by event id happens on merge.
        ...teamIds.map(
          (teamId) => () => scopedEventsQuery("team_id", teamId, TEAM_EVENTS_LIMIT),
        ),
      ];

      const runEventQueries = async () => {
        const out: { data: HomeEventRow[] | null; error: any }[] = [];
        for (let i = 0; i < eventQueryThunks.length; i += EVENTS_QUERY_BATCH_SIZE) {
          const batch = eventQueryThunks.slice(i, i + EVENTS_QUERY_BATCH_SIZE);
          out.push(...(await Promise.all(batch.map((run) => run()))));
        }
        return out;
      };

      const [
        teamsResult,
        playerLeaguesResult,
        adminLeaguesResult,
        activeClubsResult,
        eventResults,
      ] = await Promise.all([
        teamIds.length > 0
          ? supabase.from("teams").select("id, club_id").in("id", teamIds).is("deleted_at", null)
          : Promise.resolve({ data: [] as { id: string; club_id: string }[], error: null as any }),
        supabase.from("mini_league_players").select("mini_league_id").eq("parent_user_id", userId),
        leagueAdminArr.length > 0
          ? supabase.from("mini_leagues").select("id").in("club_id", leagueAdminArr)
          : Promise.resolve({ data: [] as { id: string }[], error: null as any }),
        // Filter out soft-deleted clubs from role-derived memberships. Without
        // this, deleting a club leaves orphan user_roles rows that still make
        // the user look like a member (empty-state welcome hidden, ghost
        // carousel entries) because user_roles isn't cleared by the soft-
        // delete trigger.
        clubIdsFromRolesArr.length > 0
          ? supabase.from("clubs").select("id").in("id", clubIdsFromRolesArr).is("deleted_at", null)
          : Promise.resolve({ data: [] as { id: string }[], error: null as any }),
        runEventQueries(),
      ]);

      // Same protection as every other leg: if ANY per-scope events query
      // failed (RLS race on resume, token rotation), throw so React Query
      // preserves the previous Next Up data instead of caching a partial or
      // empty list.
      const mergedEventsById = new Map<string, HomeEventRow>();
      for (const res of eventResults) {
        if (res.error) throw res.error;
        if (!res.data) throw new Error("events fetch returned null data");
        for (const row of res.data) mergedEventsById.set(row.id, row);
      }
      // Merge → sort → cap. Capping only after the global sort guarantees the
      // soonest events from every scope survive the bound.
      const mergedEvents = Array.from(mergedEventsById.values())
        .sort((a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime())
        .slice(0, MERGED_EVENTS_CAP);
      const eventsResult = { data: mergedEvents, error: null as any };


      // Validate every parallel result before using any of it. A transient
      // failure (token refresh, RLS race, network blip) must throw so React
      // Query keeps its last good cache instead of caching an empty/partial
      // membership snapshot. Legitimate empty arrays stay successful.
      if ((teamsResult as any).error) throw (teamsResult as any).error;
      if (!teamsResult.data) throw new Error("teams fetch returned null data");
      if ((playerLeaguesResult as any).error) throw (playerLeaguesResult as any).error;
      if (!playerLeaguesResult.data) throw new Error("mini_league_players fetch returned null data");
      if ((adminLeaguesResult as any).error) throw (adminLeaguesResult as any).error;
      if (!adminLeaguesResult.data) throw new Error("mini_leagues fetch returned null data");
      // Same protection on the events fetch — if it failed (RLS race on
      // resume), throw so React Query preserves the previous Next Up data
      // instead of replacing it with an empty list.
      if ((eventsResult as any).error) throw (eventsResult as any).error;
      if (!eventsResult.data) throw new Error("events fetch returned null data");
      if ((activeClubsResult as any).error) throw (activeClubsResult as any).error;
      if (!activeClubsResult.data) throw new Error("clubs fetch returned null data");

      // Drop soft-deleted role-club ids from the membership sets.
      const activeClubIdSet = new Set(((activeClubsResult as any).data || []).map((c: any) => c.id as string));
      const filteredClubIds = new Set<string>();
      clubIds.forEach((id) => { if (activeClubIdSet.has(id)) filteredClubIds.add(id); });
      const filteredClubAdmin = new Set<string>();
      clubAdminClubIds.forEach((id) => { if (activeClubIdSet.has(id)) filteredClubAdmin.add(id); });
      const filteredLeagueAdmin = new Set<string>();
      leagueAdminClubIds.forEach((id) => { if (activeClubIdSet.has(id)) filteredLeagueAdmin.add(id); });

      // Team-derived memberships must also be filtered. A deleted club can leave
      // user_roles rows with team_id populated; counting the raw teamIds keeps
      // the new-user welcome hidden even after the club itself is filtered out.
      const filteredTeamIds = new Set<string>();
      (teamsResult.data || []).forEach((t: any) => {
        if (!activeClubIdSet.has(t.club_id)) return;
        filteredTeamIds.add(t.id);
        filteredClubIds.add(t.club_id);
      });

      const miniLeagueIds = (playerLeaguesResult.data || []).map((p: any) => p.mini_league_id);
      (adminLeaguesResult.data || []).forEach((l: any) => {
        if (!miniLeagueIds.includes(l.id)) miniLeagueIds.push(l.id);
      });

      // Drop role rows whose club has been soft-deleted so downstream
      // consumers (userRoles derivation, admin gates) don't grant admin
      // powers on a ghost club.
      const activeRoles = roles.filter((r: any) => !r.club_id || activeClubIdSet.has(r.club_id));

      const memberships = {
        teamIds: Array.from(filteredTeamIds),
        clubIds: Array.from(filteredClubIds),
        clubAdminClubIds: Array.from(filteredClubAdmin),
        leagueAdminClubIds: Array.from(filteredLeagueAdmin),
        miniLeagueIds,
        roles: activeRoles as { role: string; club_id: string | null; team_id: string | null }[],
      };

      // Step 3: Filter events client-side
      const clubIdsArr = Array.from(filteredClubIds);
      const nowMs = now.getTime();
      const filtered = ((eventsResult.data || []) as (HomeEvent & { mini_league_id: string | null })[]).filter(event => {
        // Defensive client-side past-date filter. The server query already
        // restricts to event_date >= today, but on iOS the React Query cache
        // (with placeholderData + no window-focus refetch on WebView resume)
        // can keep yesterday's data alive into the next day. Re-filter on
        // render so stale past events never leak into Next Up.
        if (!dependencies.isStillUpcomingForNextUp(event, nowMs)) return false;
        if (event.mini_league_id) {
          return miniLeagueIds.includes(event.mini_league_id);
        } else if (event.team_id) {
          return teamIds.includes(event.team_id);
        } else {
          return clubIdsArr.includes(event.club_id);
        }
      });

      // Limit recurring series to next 3 upcoming occurrences
      const limited = filterRecurringEvents(filtered);

      return { memberships, events: limited as HomeEvent[] };
}
