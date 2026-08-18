import type { CSSProperties, ReactNode, TouchEventHandler } from "react";

interface ChatPageFrameProps {
  height: CSSProperties["height"];
  children: ReactNode;
  onTouchStart: TouchEventHandler<HTMLDivElement>;
  onTouchEnd: TouchEventHandler<HTMLDivElement>;
}

/** Native-safe outer viewport shared by every full-page chat surface. */
export function ChatPageFrame({
  height,
  children,
  onTouchStart,
  onTouchEnd,
}: ChatPageFrameProps) {
  return (
    <div
      className="flex min-h-0 flex-col overflow-hidden overscroll-none"
      style={{ height }}
      data-lock-keyboard-scroll="true"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {children}
    </div>
  );
}
