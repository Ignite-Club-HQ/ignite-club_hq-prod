import { memo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  Plus,
  Copy,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Film,
  X,
} from "lucide-react";
import type { DrillFrame } from "./types";
import { FrameThumbnail } from "./FrameThumbnail";

interface FrameStripProps {
  frames: DrillFrame[];
  currentIndex: number;
  onSelect: (index: number) => void;
  onAdd: () => void;
  onDuplicate: (index: number) => void;
  onDelete: (index: number) => void;
  onReorder: (from: number, to: number) => void;
  /** Close the entire edit panel (frame strip + toolbar + playback bar)
   *  and return to the drill's read-only preview view. */
  onExitEdit?: () => void;
  disabled?: boolean;
}

function FrameStripImpl({
  frames,
  currentIndex,
  onSelect,
  onAdd,
  onDuplicate,
  onDelete,
  onReorder,
  onExitEdit,
  disabled,
}: FrameStripProps) {
  // Collapsed state lets coaches hide the frame strip once frames are
  // arranged so the pitch isn't crowded by thumbnails. A slim header with
  // a chevron toggle stays pinned so it can always be re-opened.
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div
      className={cn(
        "w-full bg-background/95 backdrop-blur border-t border-border shrink-0",
        disabled && "opacity-60 pointer-events-none"
      )}
    >
      {/* Header — always visible. Click body to collapse/expand the
          thumbnails; the trailing X closes the entire edit panel. */}
      <div className="w-full flex items-center justify-between px-3 py-1.5 text-xs font-medium text-muted-foreground">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Show frame strip" : "Hide frame strip"}
          className="flex-1 flex items-center justify-between gap-2 hover:text-foreground transition-colors"
        >
          <span className="inline-flex items-center gap-1.5">
            <Film className="h-3.5 w-3.5" />
            <span>
              Frames{" "}
              <span className="tabular-nums text-foreground/80">
                {currentIndex + 1} / {frames.length}
              </span>
            </span>
          </span>
          {collapsed ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>
        {onExitEdit && (
          <button
            type="button"
            onClick={onExitEdit}
            aria-label="Close edit panel"
            title="Close edit panel"
            className="ml-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-foreground/80 hover:text-foreground hover:bg-muted/60 transition-colors"
          >
            <X className="h-3.5 w-3.5" />
            <span className="text-[11px]">Close</span>
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="px-2 pb-2">
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
            {frames.map((frame, idx) => {
              const isActive = idx === currentIndex;
              return (
                <div key={frame.id} className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => onSelect(idx)}
                    aria-label={`Frame ${idx + 1}`}
                    aria-current={isActive}
                    className={cn(
                      "relative rounded-md overflow-hidden border-2 transition-all bg-pitch-green",
                      "h-16 w-24",
                      isActive
                        ? "border-primary shadow-md scale-105"
                        : "border-border hover:border-foreground/40"
                    )}
                  >
                    <FrameThumbnail frame={frame} className="w-full h-full block" />
                    <span className="absolute top-0.5 left-1 text-[10px] font-bold text-white drop-shadow">
                      {idx + 1}
                    </span>
                  </button>
                  {/* Reorder controls visible only on active frame to keep UI clean */}
                  {isActive && (
                    <div className="flex flex-col gap-0.5">
                      <button
                        type="button"
                        onClick={() => onReorder(idx, idx - 1)}
                        disabled={idx === 0}
                        aria-label="Move frame left"
                        className="h-4 w-5 flex items-center justify-center rounded bg-muted text-muted-foreground hover:text-foreground disabled:opacity-30"
                      >
                        <ChevronLeft className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onReorder(idx, idx + 1)}
                        disabled={idx === frames.length - 1}
                        aria-label="Move frame right"
                        className="h-4 w-5 flex items-center justify-center rounded bg-muted text-muted-foreground hover:text-foreground disabled:opacity-30"
                      >
                        <ChevronRight className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            <div className="w-px h-12 bg-border shrink-0" />

            <button
              type="button"
              onClick={onAdd}
              aria-label="Add frame"
              className="h-16 w-16 rounded-md border-2 border-dashed border-border flex flex-col items-center justify-center text-muted-foreground hover:text-foreground hover:border-foreground/40 shrink-0"
            >
              <Plus className="h-5 w-5" />
              <span className="text-[10px] mt-0.5">Add</span>
            </button>

            <button
              type="button"
              onClick={() => onDuplicate(currentIndex)}
              aria-label="Duplicate frame"
              className="h-16 w-16 rounded-md border border-border flex flex-col items-center justify-center text-muted-foreground hover:text-foreground shrink-0"
            >
              <Copy className="h-5 w-5" />
              <span className="text-[10px] mt-0.5">Copy</span>
            </button>

            <button
              type="button"
              onClick={() => onDelete(currentIndex)}
              disabled={frames.length <= 1}
              aria-label="Delete frame"
              className="h-16 w-16 rounded-md border border-border flex flex-col items-center justify-center text-destructive hover:bg-destructive/10 disabled:opacity-30 shrink-0"
            >
              <Trash2 className="h-5 w-5" />
              <span className="text-[10px] mt-0.5">Delete</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export const FrameStrip = memo(FrameStripImpl);
