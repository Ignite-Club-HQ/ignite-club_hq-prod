/**
 * Authoritative membership snapshot for Realtime fail-closed filtering.
 *
 * Callers use this in Realtime callbacks to decide whether an incoming payload
 * belongs to a scope the current user is still allowed to see. The contract is
 * strictly fail-closed:
 *
 *   const { status, clubIds, teamIds, groupIds } = useAuthorizedScopes();
 *   channel.on('postgres_changes', {...}, (payload) => {
 *     if (status !== 'ready') return;              // drop while loading/failed
 *     if (!teamIds.has(payload.new.team_id)) return; // drop unknown scope
 *     // …safe to process
 *   });
 *
 * `ready` + empty set means "user has no memberships of that kind" — payloads
 * MUST be dropped. This is the inverse of the previous
 * `if (ids.size && !ids.has(x)) return;` guard which fails open on empty.
 *
 * Membership changes (role revoked, kicked, left) trigger a re-fetch and, via
 * `syncMembershipRevocations`, tear down any Realtime channels for scopes the
 * user has lost.
 */

import { useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { revokeScope } from "@/lib/realtimeChannelRegistry";

export type AuthorizedScopesStatus = "loading" | "ready" | "failed";

export interface AuthorizedScopes {
  status: AuthorizedScopesStatus;
  userId: string | null;
  clubIds: ReadonlySet<string>;
  teamIds: ReadonlySet<string>;
  groupIds: ReadonlySet<string>;
  /** Direct-message conversation ids the user is a participant in. */
  dmConversationIds: ReadonlySet<string>;
}

const EMPTY: ReadonlySet<string> = new Set();

interface MembershipRow {
  clubIds: string[];
  teamIds: string[];
  groupIds: string[];
  dmConversationIds: string[];
}

async function fetchMemberships(userId: string): Promise<MembershipRow> {
  const [clubs, teams, groups, dms] = await Promise.all([
    supabase.from("club_members").select("club_id").eq("user_id", userId),
    supabase.from("team_members").select("team_id").eq("user_id", userId),
    supabase.from("chat_group_members").select("group_id").eq("user_id", userId),
    supabase.from("dm_participants").select("conversation_id").eq("user_id", userId),
  ]);

  // Fail-closed: if any query errored, surface as failure. Callers will treat
  // `failed` the same as `loading` and drop payloads.
  if (clubs.error || teams.error || groups.error || dms.error) {
    throw clubs.error || teams.error || groups.error || dms.error;
  }

  return {
    clubIds: (clubs.data ?? []).map((r: { club_id: string }) => r.club_id),
    teamIds: (teams.data ?? []).map((r: { team_id: string }) => r.team_id),
    groupIds: (groups.data ?? []).map((r: { group_id: string }) => r.group_id),
    dmConversationIds: (dms.data ?? []).map((r: { conversation_id: string }) => r.conversation_id),
  };
}

export function useAuthorizedScopes(): AuthorizedScopes {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["authorized-scopes", userId],
    queryFn: () => fetchMemberships(userId as string),
    enabled: !!userId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const prevRef = useRef<MembershipRow | null>(null);

  const snapshot = useMemo<AuthorizedScopes>(() => {
    if (!userId) {
      return { status: "loading", userId: null, clubIds: EMPTY, teamIds: EMPTY, groupIds: EMPTY, dmConversationIds: EMPTY };
    }
    if (query.isError) {
      return { status: "failed", userId, clubIds: EMPTY, teamIds: EMPTY, groupIds: EMPTY, dmConversationIds: EMPTY };
    }
    if (!query.data) {
      return { status: "loading", userId, clubIds: EMPTY, teamIds: EMPTY, groupIds: EMPTY, dmConversationIds: EMPTY };
    }
    return {
      status: "ready",
      userId,
      clubIds: new Set(query.data.clubIds),
      teamIds: new Set(query.data.teamIds),
      groupIds: new Set(query.data.groupIds),
      dmConversationIds: new Set(query.data.dmConversationIds),
    };
  }, [userId, query.isError, query.data]);

  // Detect scopes the user has *lost* since the previous snapshot and revoke
  // Realtime channels for them. Runs whenever fresh membership data arrives.
  useEffect(() => {
    if (!userId || !query.data) return;
    const prev = prevRef.current;
    prevRef.current = query.data;
    if (!prev) return;

    const diff = (before: string[], after: string[]) => {
      const afterSet = new Set(after);
      return before.filter((id) => !afterSet.has(id));
    };

    for (const id of diff(prev.clubIds, query.data.clubIds)) {
      revokeScope(userId, { kind: "club", id });
    }
    for (const id of diff(prev.teamIds, query.data.teamIds)) {
      revokeScope(userId, { kind: "team", id });
    }
    for (const id of diff(prev.groupIds, query.data.groupIds)) {
      revokeScope(userId, { kind: "group", id });
    }
    for (const id of diff(prev.dmConversationIds, query.data.dmConversationIds)) {
      revokeScope(userId, { kind: "dm", id });
    }
  }, [userId, query.data, queryClient]);

  return snapshot;
}

/**
 * Force a membership refresh. Call after any client-side action that mutates
 * membership (leave club, decline invite, admin removes user) so that
 * `useAuthorizedScopes` observes the change without waiting for staleTime.
 */
export function invalidateAuthorizedScopes(queryClient: ReturnType<typeof useQueryClient>, userId: string | null): void {
  if (!userId) return;
  queryClient.invalidateQueries({ queryKey: ["authorized-scopes", userId] });
}
