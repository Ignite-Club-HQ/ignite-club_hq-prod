export type InboxConversationType =
  | "club"
  | "team"
  | "group"
  | "league"
  | "dm"
  | "broadcast"
  | "support"
  | "admin_group";

export type InboxTypeFilter = "all" | "teams" | "groups" | "dms";

export interface InboxConversation {
  type: InboxConversationType;
  id: string;
  key: string;
  name: string;
  avatarUrl?: string | null;
  link: string;
  lastActivity: string;
  lastMessage?: {
    text: string;
    author: string;
    created_at: string;
    image_url?: string | null;
    is_announcement?: boolean;
  };
  unreadCount: number;
  isMuted: boolean;
  isLocked?: boolean;
  canManage?: boolean;
  canHide?: boolean;
  dmData?: unknown;
  draftText?: string;
  category?: string | null;
}

export interface OperationalDisclosureOptions {
  now: number;
  showAll: boolean;
  typeFilter: InboxTypeFilter;
  hasSearchQuery: boolean;
  staleAfterDays?: number;
  collapseThreshold?: number;
  visibleWhenCollapsed?: number;
}

export function normalizeInboxTypeFilter(value: string): InboxTypeFilter {
  if (value === "club" || value === "league") return "groups";
  if (value === "teams" || value === "groups" || value === "dms") return value;
  return "all";
}

export function filterInboxConversations(
  conversations: readonly InboxConversation[],
  typeFilter: InboxTypeFilter,
): InboxConversation[] {
  if (typeFilter === "all") return [...conversations];

  return conversations.filter((conversation) => {
    if (conversation.type === "support") return true;

    switch (typeFilter) {
      case "teams":
        return conversation.type === "team" || conversation.type === "league";
      case "groups":
        return (
          conversation.type === "group" ||
          conversation.type === "club" ||
          conversation.type === "admin_group"
        );
      case "dms":
        return conversation.type === "dm";
    }
  });
}

export function sortInboxByActivityDesc(
  conversations: readonly InboxConversation[],
): InboxConversation[] {
  return [...conversations].sort((left, right) => {
    if (!left.lastActivity && !right.lastActivity) return 0;
    if (!left.lastActivity) return 1;
    if (!right.lastActivity) return -1;
    return new Date(right.lastActivity).getTime() - new Date(left.lastActivity).getTime();
  });
}

export function partitionInboxByReadState(
  conversations: readonly InboxConversation[],
): { unread: InboxConversation[]; recent: InboxConversation[] } {
  return {
    unread: sortInboxByActivityDesc(
      conversations.filter((conversation) => conversation.unreadCount > 0),
    ),
    recent: sortInboxByActivityDesc(
      conversations.filter((conversation) => conversation.unreadCount === 0),
    ),
  };
}

export function resolveOperationalConversationDisclosure(
  recent: readonly InboxConversation[],
  options: OperationalDisclosureOptions,
): { visibleRecent: InboxConversation[]; hiddenOps: InboxConversation[] } {
  const staleAfterDays = options.staleAfterDays ?? 30;
  const collapseThreshold = options.collapseThreshold ?? 6;
  const visibleWhenCollapsed = options.visibleWhenCollapsed ?? 2;
  const cutoff = options.now - staleAfterDays * 24 * 60 * 60 * 1000;
  const stale = recent.filter((conversation) =>
    (conversation.type === "group" || conversation.type === "league") &&
    conversation.unreadCount === 0 &&
    !conversation.draftText &&
    (!conversation.lastActivity || new Date(conversation.lastActivity).getTime() < cutoff),
  );

  if (
    stale.length <= collapseThreshold ||
    options.showAll ||
    options.typeFilter !== "all" ||
    options.hasSearchQuery
  ) {
    return { visibleRecent: [...recent], hiddenOps: [] };
  }

  const hiddenOps = stale.slice(visibleWhenCollapsed);
  const hiddenKeys = new Set(hiddenOps.map((conversation) => conversation.key));

  return {
    visibleRecent: recent.filter((conversation) => !hiddenKeys.has(conversation.key)),
    hiddenOps,
  };
}
