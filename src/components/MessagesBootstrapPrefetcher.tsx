import { useAuth } from "@/hooks/useAuth";
import { useMessagesPageBootstrap } from "@/hooks/useMessagesPageBootstrap";

/**
 * Mount once at the app shell so the messages-page bootstrap RPC is in the
 * react-query cache by the time the user navigates to /messages. Same query
 * key as MessagesPage, so react-query dedupes — zero extra round trips.
 * Honours the same `?bootstrap=off` kill switch.
 */
export function MessagesBootstrapPrefetcher() {
  const { user, initialized } = useAuth();
  useMessagesPageBootstrap(user?.id, initialized);
  return null;
}
