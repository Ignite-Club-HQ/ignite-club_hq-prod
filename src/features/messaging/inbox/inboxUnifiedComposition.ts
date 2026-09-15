import {
  buildBroadcastInboxConversation,
  buildClubAdminInboxConversation,
  buildClubInboxConversation,
  buildDirectMessageInboxConversation,
  buildGroupInboxConversation,
  buildSupportInboxConversation,
  buildTeamInboxConversation,
} from "./inboxConversationBuilders";
import {
  attachInboxDrafts,
  resolveClubProEntitlement,
  resolveGroupUnreadCount,
  type InboxConversation,
  type InboxDraft,
  type InboxPreviewMessage,
} from "./inboxReadModel";

interface NamedRow {
  id: string;
  name: string;
  logo_url?: string | null;
}

interface TeamRow extends NamedRow {
  clubs?: { logo_url?: string | null } | null;
}

interface GroupRow extends NamedRow {
  club_id?: string | null;
  team_id?: string | null;
  mini_league_id?: string | null;
  allowed_roles?: string[] | null;
  category?: string | null;
  clubs?: { logo_url?: string | null } | null;
}

interface DirectMessageRow {
  id: string;
  updated_at?: string | null;
  other_user?: { id?: string | null; display_name?: string | null; avatar_url?: string | null } | null;
  last_message?: { text: string; created_at: string; author_id?: string | null; image_url?: string | null } | null;
}

interface AdminConversationRow {
  id: string;
  updated_at: string;
  member_name: string;
  member_avatar?: string | null;
  club_name?: string | null;
  last_text?: string | null;
  last_image?: string | null;
  last_created_at?: string | null;
  last_author_id?: string | null;
}

interface UnreadCounts {
  broadcast?: number;
  clubs: Record<string, number | undefined>;
  teams: Record<string, number | undefined>;
  groups: Record<string, number | undefined>;
  dms: Record<string, number | undefined>;
}

interface MutedScopes {
  clubs: ReadonlySet<string>;
  teams: ReadonlySet<string>;
  groups: ReadonlySet<string>;
}

export function buildUnifiedInboxConversations(options: {
  showBroadcast: boolean;
  latestBroadcast?: { text: string; created_at: string; image_url?: string | null; profiles?: { display_name?: string | null } | null } | null;
  clubs: readonly NamedRow[];
  teams: readonly TeamRow[];
  leagueChats: readonly GroupRow[];
  chatGroups: readonly GroupRow[];
  directMessages: readonly DirectMessageRow[];
  adminConversations: readonly AdminConversationRow[];
  latestClubMessages?: Record<string, InboxPreviewMessage | undefined> | null;
  latestTeamMessages?: Record<string, InboxPreviewMessage | undefined> | null;
  latestGroupMessages?: Record<string, InboxPreviewMessage | undefined> | null;
  unreadCounts?: UnreadCounts | null;
  realtimeGroupUnread?: Record<string, number | undefined> | null;
  muted?: MutedScopes | null;
  clubProStatuses?: Record<string, boolean>;
  isClubProLoading: boolean;
  isClubProFetching: boolean;
  isAppAdmin: boolean;
  query: string;
  currentUserId?: string;
  showSupport: boolean;
  systemMessage?: { text: string; created_at: string } | null;
  drafts: Readonly<Record<string, InboxDraft>>;
  isSupportUser: (userId?: string | null) => boolean;
}): InboxConversation[] {
  const rows: InboxConversation[] = [];

  if (options.showBroadcast) {
    rows.push(buildBroadcastInboxConversation({
      message: options.latestBroadcast,
      unreadCount: options.unreadCounts?.broadcast || 0,
    }));
  }

  options.clubs.forEach((club) => {
    const entitlement = resolveClubProEntitlement({
      clubId: club.id,
      statuses: options.clubProStatuses,
      isLoading: options.isClubProLoading,
      isFetching: options.isClubProFetching,
    });
    rows.push(buildClubInboxConversation({
      club,
      lastMessage: options.latestClubMessages?.[club.id],
      unreadCount: options.unreadCounts?.clubs[club.id] || 0,
      isMuted: options.muted?.clubs.has(club.id) || false,
      proStatusKnown: entitlement.known,
      hasProAccess: entitlement.hasAccess,
    }));
  });

  options.teams.forEach((team) => rows.push(buildTeamInboxConversation({
    team,
    lastMessage: options.latestTeamMessages?.[team.id],
    unreadCount: options.unreadCounts?.teams[team.id] || 0,
    isMuted: options.muted?.teams.has(team.id) || false,
  })));

  options.leagueChats.forEach((group) => rows.push(buildGroupInboxConversation({
    type: "league",
    group,
    avatarUrl: group.clubs?.logo_url ?? null,
    lastMessage: options.latestGroupMessages?.[group.id],
    unreadCount: resolveGroupUnreadCount(options.realtimeGroupUnread?.[group.id], options.unreadCounts?.groups[group.id]),
    isMuted: options.muted?.groups.has(group.id) || false,
  })));

  options.chatGroups.forEach((group) => {
    const isPersonal = !group.club_id && !group.team_id && !group.mini_league_id;
    const isClubRoleGroup = !!group.club_id && !group.team_id && !group.mini_league_id &&
      (group.allowed_roles || []).some((role) => ["coach", "team_admin", "committee_member", "club_admin"].includes(role));
    const entitlement = group.club_id
      ? resolveClubProEntitlement({
          clubId: group.club_id,
          statuses: options.clubProStatuses,
          isLoading: options.isClubProLoading,
          isFetching: options.isClubProFetching,
        })
      : { known: false, hasAccess: true };
    const isLocked = isClubRoleGroup && entitlement.known && !entitlement.hasAccess && !options.isAppAdmin;
    rows.push(buildGroupInboxConversation({
      type: "group",
      group,
      lastMessage: options.latestGroupMessages?.[group.id],
      unreadCount: resolveGroupUnreadCount(options.realtimeGroupUnread?.[group.id], options.unreadCounts?.groups[group.id]),
      isMuted: options.muted?.groups.has(group.id) || false,
      canHide: isPersonal,
      isLocked,
      lockedLink: `/clubs/${group.club_id}/upgrade`,
    }));
  });

  options.directMessages.forEach((conversation) => rows.push(buildDirectMessageInboxConversation({
    conversation,
    currentUserId: options.currentUserId,
    unreadCount: options.unreadCounts?.dms[conversation.id] || 0,
    isSupport: options.isSupportUser(conversation.other_user?.id),
  })));

  const adminRows = options.query
    ? options.adminConversations.filter((conversation) =>
        (conversation.member_name?.toLowerCase() || "").includes(options.query) ||
        (conversation.club_name?.toLowerCase() || "").includes(options.query) ||
        (conversation.last_text?.toLowerCase() || "").includes(options.query))
    : options.adminConversations;
  adminRows.forEach((conversation) => rows.push(buildClubAdminInboxConversation({
    conversation,
    currentUserId: options.currentUserId,
  })));

  const supportAlreadyPresent = options.directMessages.some((conversation) =>
    options.isSupportUser(conversation.other_user?.id));
  if (options.showSupport && options.systemMessage && !supportAlreadyPresent) {
    rows.push(buildSupportInboxConversation(options.systemMessage));
  }

  return attachInboxDrafts(rows, options.drafts);
}
