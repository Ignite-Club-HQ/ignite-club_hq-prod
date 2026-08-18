const ROW_WIDTHS = [82, 64, 96, 72, 88, 60, 78] as const;

/** Non-interactive cover used while an exact-message jump settles. */
export function ChatJumpHydrationSkeleton({ visible = true }: { visible?: boolean }) {
  return (
    <div
      aria-hidden="true"
      data-chat-jump-hydration="true"
      className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-end gap-3 px-4 pb-6"
      style={{
        background: "hsl(var(--background))",
        opacity: visible ? 1 : 0,
        transition: "opacity 260ms ease-out",
      }}
    >
      {ROW_WIDTHS.map((width, index) => (
        <div
          key={width}
          data-chat-jump-skeleton-row="true"
          className="flex"
          style={{ justifyContent: index % 2 === 0 ? "flex-start" : "flex-end" }}
        >
          <div
            className="h-10 rounded-2xl bg-muted animate-pulse"
            style={{ width: `${width}%`, maxWidth: "75%" }}
          />
        </div>
      ))}
    </div>
  );
}
