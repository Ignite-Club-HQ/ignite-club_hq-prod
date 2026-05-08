import { useEffect, useState } from "react";
import {
  isChatVirtualizationEnabled,
  subscribeChatVirtualization,
} from "@/lib/featureFlags/chatVirtualization";

/** Live-reactive read of the chat-virtualisation feature flag. */
export function useChatVirtualizationFlag(): boolean {
  const [enabled, setEnabled] = useState(() => isChatVirtualizationEnabled());
  useEffect(() => {
    return subscribeChatVirtualization(() => setEnabled(isChatVirtualizationEnabled()));
  }, []);
  return enabled;
}
