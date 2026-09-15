import { forwardRef, type ComponentProps } from "react";

export type ChatVirtuosoContext = {
  topPadding: number;
  bottomPadding: number | string;
};

/** Stable component identities prevent padding changes from remounting rows. */
export const ChatVirtuosoHeader = ({ context }: { context?: ChatVirtuosoContext }) => (
  <div style={{ height: context?.topPadding ?? 0, overflowAnchor: "none" }} />
);

export const ChatVirtuosoFooter = ({ context }: { context?: ChatVirtuosoContext }) => (
  <div style={{ height: context?.bottomPadding ?? 0 }} />
);

type VirtuosoDivProps = ComponentProps<"div"> & { context?: ChatVirtuosoContext };

export const ChatVirtuosoScroller = forwardRef<HTMLDivElement, VirtuosoDivProps>(
  ({ context: _context, style, className, ...props }, ref) => (
    <div
      {...props}
      ref={ref}
      data-chat-scroll-lock="true"
      data-chat-virtualized="true"
      className={`${className ?? ""} scrollbar-hide`}
      style={{
        ...style,
        overscrollBehaviorY: "contain",
        WebkitOverflowScrolling: "touch",
      }}
    />
  ),
);
ChatVirtuosoScroller.displayName = "ChatVirtuosoScroller";

export const ChatVirtuosoItem = forwardRef<HTMLDivElement, VirtuosoDivProps>(
  ({ context: _context, style, ...props }, ref) => (
    <div
      {...props}
      ref={ref}
      data-chat-virtuoso-item="true"
      style={{ ...style, contain: "layout style" }}
    />
  ),
);
ChatVirtuosoItem.displayName = "ChatVirtuosoItem";
