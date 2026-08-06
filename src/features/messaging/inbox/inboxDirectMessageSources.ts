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
