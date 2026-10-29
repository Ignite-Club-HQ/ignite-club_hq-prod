import { useQuery } from "@tanstack/react-query";
import { fetchProfilesWithCache } from "@/lib/profileCache";

const REQUESTER_TOKEN = /\{u:([a-z0-9-]+)\}/g;

/** Principals referenced by "{u:<principal>}" tokens in an ICP notification body. */
export function notificationRequesterIds(message: string): string[] {
  return [...new Set([...message.matchAll(REQUESTER_TOKEN)].map((m) => m[1]))];
}

/** Replace requester tokens with names (falls back to "Someone"). */
export function renderNotificationMessage(message: string, names: Map<string, string | null | undefined>): string {
  return message.replace(REQUESTER_TOKEN, (_, id: string) => names.get(id)?.trim() || "Someone");
}

/**
 * Notification text with requester names unlocked in the browser — the
 * notification queue only stores a principal token, never a plaintext name.
 */
export function NotificationMessageText({ message }: { message: string }) {
  const ids = notificationRequesterIds(message ?? "");
  const { data } = useQuery({
    queryKey: ["notification-requester-names", ids],
    queryFn: async () => {
      const profiles = await fetchProfilesWithCache(ids, { allowStale: true });
      return new Map(ids.map((id) => [id, profiles.get(id)?.display_name ?? null]));
    },
    enabled: ids.length > 0,
    staleTime: 10 * 60_000,
  });
  if (ids.length === 0) return <>{message}</>;
  return <>{renderNotificationMessage(message, data ?? new Map())}</>;
}
