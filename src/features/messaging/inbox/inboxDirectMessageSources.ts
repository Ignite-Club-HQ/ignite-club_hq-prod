export interface CachedDirectMessagePreview {
  text?: string | null;
  image_url?: string | null;
  created_at: string;
  author?: string | null;
}

export interface CachedDirectMessageRow {
  id: string;
  created_at?: string | null;
  updated_at?: string | null;
  created_by?: string | null;
  other_user?: { id?: string | null } | null;
  [key: string]: unknown;
}

export type HydratedDirectMessageRow<T extends CachedDirectMessageRow> = T & {
  created_at: string | null;
  created_by: string | null;
  last_message: {
    text: string | null;
    image_url: string | null;
    created_at: string;
    author_id: string;
  } | null;
};

export interface DirectMessagePeerProfile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  [key: string]: unknown;
}

export interface DirectMessageConversationIdentitySource {
  other_user?: DirectMessagePeerProfile | null;
}

export function buildPreviousDirectMessagePeerMap(options: {
  live?: readonly DirectMessageConversationIdentitySource[] | null;
  cached?: readonly DirectMessageConversationIdentitySource[] | null;
}): Map<string, DirectMessagePeerProfile> {
  const peers = new Map<string, DirectMessagePeerProfile>();
  for (const conversation of options.live ?? []) {
    const peer = conversation.other_user;
    if (peer?.id && peer.display_name) peers.set(peer.id, peer);
  }
  for (const conversation of options.cached ?? []) {
    const peer = conversation.other_user;
    if (peer?.id && peer.display_name && !peers.has(peer.id)) peers.set(peer.id, peer);
  }
  return peers;
}

export function resolveDirectMessagePeerProfile(options: {
  otherUserId: string;
  fetched?: DirectMessagePeerProfile | null;
  previous?: DirectMessagePeerProfile | null;
  globalCached?: DirectMessagePeerProfile | null;
}): DirectMessagePeerProfile | null {
  const { otherUserId, fetched, previous, globalCached } = options;

  if (fetched?.display_name) {
    return {
      id: otherUserId,
      display_name: fetched.display_name,
      avatar_url: fetched.avatar_url ?? previous?.avatar_url ?? globalCached?.avatar_url ?? null,
    };
  }
  if (previous?.display_name) return previous;
  if (globalCached) {
    return {
      id: otherUserId,
      display_name: globalCached.display_name,
      avatar_url: globalCached.avatar_url ?? null,
    };
  }
  if (fetched) {
    return {
      id: otherUserId,
      display_name: null,
      avatar_url: fetched.avatar_url ?? null,
    };
  }
  return null;
}

export function hydrateCachedDirectMessages<T extends CachedDirectMessageRow>(options: {
  conversations?: readonly T[] | null;
  latestMessages?: Record<string, CachedDirectMessagePreview | null | undefined> | null;
  currentUserId?: string | null;
}): HydratedDirectMessageRow<T>[] {
  const { conversations, latestMessages, currentUserId } = options;
  if (!conversations?.length) return [];

  return conversations.map((conversation) => {
    const preview = latestMessages?.[conversation.id];
    return {
      ...conversation,
      created_at: conversation.created_at || conversation.updated_at || null,
      created_by: conversation.created_by || null,
      last_message: preview
        ? {
            text: preview.text ?? null,
            image_url: preview.image_url || null,
            created_at: preview.created_at,
            author_id: preview.author === "You"
              ? currentUserId || ""
              : conversation.other_user?.id || "",
          }
        : null,
    };
  });
}

export function resolveEffectiveDirectMessages<T>(options: {
  sticky?: readonly T[] | null;
  offlineCached?: readonly T[] | null;
  isOnline: boolean;
}): readonly T[] {
  const { sticky, offlineCached, isOnline } = options;
  if (sticky?.length) return sticky;
  if (!isOnline && offlineCached?.length) return offlineCached;
  return sticky ?? [];
}
