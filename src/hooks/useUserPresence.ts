import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Global Realtime presence tracker.
 *
 * A single shared Supabase Realtime channel ("app-presence") tracks which
 * users currently have the app open. Every consumer reads from the same
 * in-memory set so we only ever maintain one channel per tab.
 *
 * Usage:
 *   const isOnline = useIsUserOnline(otherUserId);
 */

type Listener = (online: Set<string>) => void;

const PRESENCE_CHANNEL = "app-presence";

let channel: ReturnType<typeof supabase.channel> | null = null;
let onlineUsers: Set<string> = new Set();
const listeners = new Set<Listener>();
let currentUserId: string | null = null;
let initPromise: Promise<void> | null = null;

function notify() {
  // Pass a fresh Set so React state comparisons work.
  const snapshot = new Set(onlineUsers);
  onlineUsers = snapshot;
  for (const l of listeners) l(snapshot);
}

function rebuildFromState(state: Record<string, Array<{ user_id?: string }>>) {
  const next = new Set<string>();
  for (const key of Object.keys(state)) {
    const presences = state[key] || [];
    for (const p of presences) {
      if (p?.user_id) next.add(p.user_id);
    }
  }
  onlineUsers = next;
  notify();
}

async function ensureChannel(userId: string) {
  if (channel && currentUserId === userId) return;

  // Tear down any previous channel (e.g. after sign-out / user switch).
  if (channel) {
    try {
      await supabase.removeChannel(channel);
    } catch {
      /* ignore */
    }
    channel = null;
    onlineUsers = new Set();
    notify();
  }

  currentUserId = userId;

  const ch = supabase.channel(PRESENCE_CHANNEL, {
    config: { presence: { key: userId } },
  });

  ch.on("presence", { event: "sync" }, () => {
    rebuildFromState(ch.presenceState() as any);
  });
  ch.on("presence", { event: "join" }, () => {
    rebuildFromState(ch.presenceState() as any);
  });
  ch.on("presence", { event: "leave" }, () => {
    rebuildFromState(ch.presenceState() as any);
  });

  initPromise = new Promise<void>((resolve) => {
    ch.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await ch.track({ user_id: userId, online_at: new Date().toISOString() });
        resolve();
      }
    });
  });

  channel = ch;
  await initPromise;
}

async function teardown() {
  if (!channel) return;
  try {
    await channel.untrack();
    await supabase.removeChannel(channel);
  } catch {
    /* ignore */
  }
  channel = null;
  currentUserId = null;
  onlineUsers = new Set();
  notify();
}

/**
 * Subscribe the current user to the global presence channel.
 * Safe to call from many components — only one channel will be created.
 */
export function useTrackPresence(userId: string | null | undefined) {
  useEffect(() => {
    if (!userId) {
      teardown();
      return;
    }
    let cancelled = false;
    ensureChannel(userId).catch(() => {
      /* ignore; will retry on next mount */
    });
    return () => {
      if (cancelled) return;
      cancelled = true;
      // Don't tear down on unmount — other components may still be listening.
      // The channel is torn down when the user changes or signs out.
    };
  }, [userId]);
}

/** Reactive: returns true if the given user is currently online. */
export function useIsUserOnline(userId: string | null | undefined): boolean {
  const [online, setOnline] = useState<boolean>(() =>
    userId ? onlineUsers.has(userId) : false,
  );

  useEffect(() => {
    if (!userId) {
      setOnline(false);
      return;
    }
    const handler: Listener = (set) => setOnline(set.has(userId));
    listeners.add(handler);
    // Sync initial value in case state changed between render and effect.
    setOnline(onlineUsers.has(userId));
    return () => {
      listeners.delete(handler);
    };
  }, [userId]);

  return online;
}