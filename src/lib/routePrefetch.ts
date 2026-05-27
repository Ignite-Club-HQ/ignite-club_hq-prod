// Route chunk prefetcher. Triggered on bottom-tab `pointerdown` so the JS
// chunk for the destination route starts downloading ~50–150ms before the
// click event fires. Purely additive; on failure the normal lazy import in
// App.tsx runs as usual.

type Loader = () => Promise<unknown>;

const loaders: Record<string, Loader> = {
  "/": () => import("@/pages/Index"),
  "/messages": () => import("@/pages/MessagesPage"),
  "/events": () => import("@/pages/EventsPage"),
  "/media": () => import("@/pages/MediaPage"),
};

const started = new Set<string>();

export function prefetchRoute(path: string) {
  const loader = loaders[path];
  if (!loader || started.has(path)) return;
  started.add(path);
  // Fire-and-forget; ignore failures (network offline, etc.) — the normal
  // lazy import will retry when the user actually navigates.
  loader().catch(() => {
    started.delete(path);
  });
}
