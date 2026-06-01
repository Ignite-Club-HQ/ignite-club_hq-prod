import { Skeleton } from "@/components/ui/skeleton";

const CHAT_LOADING_SKELETON_ROWS = [82, 64, 96, 72, 88, 60, 78];

export function ChatLoadingSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-1 flex-col justify-end gap-3 px-4 pb-6">
      {CHAT_LOADING_SKELETON_ROWS.map((width, i) => (
        <div
          key={i}
          className="flex"
          style={{ justifyContent: i % 2 === 0 ? "flex-start" : "flex-end" }}
        >
          <Skeleton className="h-10 rounded-2xl" style={{ width: `${width}%`, maxWidth: "75%" }} />
        </div>
      ))}
    </div>
  );
}

// Module-level Sets to track which chat threads have been opened in this session.
// Keys are scoped per user+thread so a re-login starts fresh.
const openedThreadsByScope: Record<string, Set<string>> = {
  group: new Set(),
  team: new Set(),
  club: new Set(),
  dm: new Set(),
  clubAdmin: new Set(),
  broadcast: new Set(),
};

export function hasOpenedChatThread(scope: keyof typeof openedThreadsByScope, key: string | null): boolean {
  if (!key) return false;
  return openedThreadsByScope[scope]?.has(key) ?? false;
}

export function markChatThreadOpened(scope: keyof typeof openedThreadsByScope, key: string | null): void {
  if (!key) return;
  openedThreadsByScope[scope]?.add(key);
}
