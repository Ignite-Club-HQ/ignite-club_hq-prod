import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { deriveActiveMutedChats, type ActiveMutedChats } from "./inboxReadModel";

type IgniteSupabaseClient = SupabaseClient<Database>;

export async function fetchInboxEventTitleMap(
  eventIds: readonly string[],
  client: IgniteSupabaseClient = supabase,
): Promise<Record<string, string>> {
  if (eventIds.length === 0) return {};

  const { data, error } = await client
    .from("events")
    .select("id, title")
    .in("id", [...eventIds]);

  if (error) throw error;
  const titles: Record<string, string> = {};
  for (const event of data ?? []) {
    if (event.id && event.title) titles[event.id.toLowerCase()] = event.title;
  }
  return titles;
}

export async function fetchInboxVaultFolderNameMap(
  folderIds: readonly string[],
  client: IgniteSupabaseClient = supabase,
): Promise<Record<string, string>> {
  if (folderIds.length === 0) return {};

  const { data, error } = await client
    .from("vault_folders")
    .select("id, name")
    .in("id", [...folderIds]);

  if (error) throw error;
  const names: Record<string, string> = {};
  for (const folder of data ?? []) {
    if (folder.id && folder.name) names[folder.id.toLowerCase()] = folder.name;
  }
  return names;
}

export async function fetchInboxVaultFileNameMap(
  fileIds: readonly string[],
  client: IgniteSupabaseClient = supabase,
): Promise<Record<string, string>> {
  if (fileIds.length === 0) return {};

  const { data, error } = await client
    .from("vault_files")
    .select("id, name")
    .in("id", [...fileIds]);

  if (error) throw error;
  const names: Record<string, string> = {};
  for (const file of data ?? []) {
    if (file.id && file.name) names[file.id.toLowerCase()] = file.name;
  }
  return names;
}

export interface InboxClubScopeFilterData {
  groupMembersMap: Map<string, string[]>;
  usersInClub: Set<string>;
}

export async function fetchInboxClubScopeFilter(options: {
  userId: string;
  clubId: string;
  personalGroupIds: readonly string[];
  dmOtherUserIds: readonly string[];
  client?: IgniteSupabaseClient;
}): Promise<InboxClubScopeFilterData> {
  const client = options.client ?? supabase;
  const groupMembersMap = new Map<string, string[]>();

  if (options.personalGroupIds.length > 0) {
    const { data: groupMembers, error: groupMembersError } = await client
      .from("group_members")
      .select("group_id, user_id")
      .in("group_id", [...options.personalGroupIds]);

    if (groupMembersError) throw groupMembersError;
    for (const row of groupMembers ?? []) {
      const members = groupMembersMap.get(row.group_id) ?? [];
      members.push(row.user_id);
      groupMembersMap.set(row.group_id, members);
    }
  }

  const userIdsToCheck = new Set(options.dmOtherUserIds);
  for (const members of groupMembersMap.values()) {
    for (const memberId of members) {
      if (memberId && memberId !== options.userId) userIdsToCheck.add(memberId);
    }
  }

  const usersInClub = new Set<string>();
  if (userIdsToCheck.size > 0) {
    const { data: roles, error: rolesError } = await client
      .from("user_roles")
      .select("user_id")
      .eq("club_id", options.clubId)
      .in("user_id", [...userIdsToCheck]);

    if (rolesError) throw rolesError;
    for (const role of roles ?? []) {
      if (role.user_id) usersInClub.add(role.user_id);
    }
  }

  return { groupMembersMap, usersInClub };
}

export async function fetchInboxAdminTeamIds(
  userId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<string[]> {
  const { data, error } = await client
    .from("user_roles")
    .select("team_id, club_id, role")
    .eq("user_id", userId)
    .in("role", ["team_admin", "coach", "committee_member"]);

  if (error) throw error;
  return (data ?? [])
    .map((role) => role.team_id)
    .filter((teamId): teamId is string => !!teamId);
}

export async function fetchInboxCommitteeMemberStatus(
  userId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<boolean> {
  const { data, error } = await client
    .from("user_roles")
    .select("id")
    .eq("user_id", userId)
    .eq("role", "committee_member")
    .maybeSingle();

  if (error) throw error;
  return !!data;
}

export async function fetchInboxUserRoles(
  userId: string,
  client: IgniteSupabaseClient = supabase,
) {
  const { data, error } = await client
    .from("user_roles")
    .select("role, club_id, team_id")
    .eq("user_id", userId);

  if (error) throw error;
  return data ?? [];
}

export async function fetchInboxUserLeagueIds(
  userId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<Set<string>> {
  const { data: primaryChildren, error: primaryChildrenError } = await client
    .from("children")
    .select("id")
    .eq("parent_id", userId);

  if (primaryChildrenError) throw primaryChildrenError;

  const childIds = (primaryChildren ?? []).map((child) => child.id);
  const { data: guardianLinks, error: guardianLinksError } = await client
    .from("child_guardians")
    .select("child_id")
    .eq("guardian_id", userId);

  if (guardianLinksError) throw guardianLinksError;

  for (const link of guardianLinks ?? []) {
    if (!childIds.includes(link.child_id)) childIds.push(link.child_id);
  }

  if (childIds.length === 0) return new Set<string>();

  const { data: assignments, error: assignmentsError } = await client
    .from("child_mini_league_assignments")
    .select("mini_league_id")
    .in("child_id", childIds);

  if (assignmentsError) throw assignmentsError;
  return new Set((assignments ?? []).map((assignment) => assignment.mini_league_id));
}

export async function fetchInboxAppAdminStatus(
  userId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<boolean> {
  const { data, error } = await client
    .from("user_roles")
    .select("id")
    .eq("user_id", userId)
    .eq("role", "app_admin")
    .maybeSingle();

  if (error) throw error;
  return !!data;
}

export async function fetchInboxClubProStatus(
  clubIds: readonly string[],
  options: {
    client?: IgniteSupabaseClient;
    now?: number;
  } = {},
): Promise<Record<string, boolean>> {
  if (clubIds.length === 0) return {};

  const client = options.client ?? supabase;
  const { data: subscriptions, error } = await client
    .from("club_subscriptions")
    .select("club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override, expires_at")
    .in("club_id", [...clubIds]);

  if (error) throw error;

  const statusByClub: Record<string, boolean> = {};
  for (const clubId of clubIds) {
    const subscription = subscriptions?.find((item) => item.club_id === clubId);
    const hasProFlag = !!subscription && (
      subscription.is_pro ||
      subscription.is_pro_football ||
      subscription.admin_pro_override ||
      subscription.admin_pro_football_override
    );
    const isCurrent =
      !!subscription &&
      (
        !subscription.expires_at ||
        new Date(subscription.expires_at).getTime() > (options.now ?? Date.now())
      );
    statusByClub[clubId] = hasProFlag && isCurrent;
  }

  return statusByClub;
}

export async function fetchInboxCompetitionClubMap(
  competitionIds: readonly string[],
  client: IgniteSupabaseClient = supabase,
): Promise<Record<string, Set<string>>> {
  if (competitionIds.length === 0) return {};

  const { data, error } = await client
    .from("competition_entries")
    .select("competition_id, teams:team_id(club_id)")
    .in("competition_id", [...competitionIds]);

  if (error) throw error;

  const clubIdsByCompetition: Record<string, Set<string>> = {};
  for (const row of data ?? []) {
    const clubId = row.teams?.club_id;
    if (!clubId) continue;
    (clubIdsByCompetition[row.competition_id] ||= new Set()).add(clubId);
  }
  return clubIdsByCompetition;
}

export async function fetchInboxMutedChats(
  userId: string,
  options: {
    client?: IgniteSupabaseClient;
    now?: number;
  } = {},
): Promise<ActiveMutedChats> {
  const client = options.client ?? supabase;
  const { data, error } = await client
    .from("chat_mute_preferences")
    .select("chat_id, chat_type, muted_until")
    .eq("user_id", userId);

  if (error) throw error;
  return deriveActiveMutedChats(data ?? [], options.now ?? Date.now());
}

export async function fetchInboxHiddenDirectMessages(
  userId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<Map<string, string>> {
  const { data, error } = await client
    .from("hidden_dm_conversations")
    .select("conversation_id, hidden_at")
    .eq("user_id", userId);

  if (error) throw error;
  const hiddenByConversation = new Map<string, string>();
  for (const row of data ?? []) {
    hiddenByConversation.set(row.conversation_id, row.hidden_at);
  }
  return hiddenByConversation;
}

export async function fetchInboxHiddenGroups(
  userId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<Map<string, string>> {
  const { data, error } = await client
    .from("hidden_chat_groups")
    .select("group_id, hidden_at")
    .eq("user_id", userId);

  if (error) throw error;
  const hiddenByGroup = new Map<string, string>();
  for (const row of data ?? []) {
    hiddenByGroup.set(row.group_id, row.hidden_at);
  }
  return hiddenByGroup;
}
