import { useLayoutEffect, useRef, type ReactNode } from "react";
import { debugLogMeasure, debugTrackRender, type ChatRowType } from "./chatVirtDebug";

/** Mounted only when chat virtualization diagnostics are explicitly enabled. */
export function ChatVirtuosoDebugProbe({
  messageId,
  estimated,
  rowType,
  children,
}: {
  messageId: string;
  estimated: number | undefined;
  rowType: ChatRowType;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  debugTrackRender(messageId);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    debugLogMeasure(messageId, estimated, element.offsetHeight, rowType);
  }, [messageId, estimated, rowType]);
  return (
    <div ref={ref} data-debug-probe={messageId} data-row-type={rowType}>
      {children}
    </div>
  );
}
