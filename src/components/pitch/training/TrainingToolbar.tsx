import { memo } from "react";
import { cn } from "@/lib/utils";
import {
  Hand,
  User,
  Circle as ConeIcon,
  Goal,
  Volleyball,
  ArrowRight,
  Square,
  Type,
  Hash,
  Copy,
  Trash2,
  Eraser,
} from "lucide-react";
import type { TrainingTool } from "./types";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface TrainingToolbarProps {
  activeTool: TrainingTool;
  onToolChange: (tool: TrainingTool) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClear: () => void;
  hasSelection: boolean;
}

interface ToolDef {
  tool: TrainingTool;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const OBJECT_TOOLS: ToolDef[] = [
  { tool: "player", label: "Player", icon: User },
  { tool: "ball", label: "Ball", icon: Volleyball },
  { tool: "cone", label: "Cone", icon: ConeIcon },
  { tool: "mini-goal", label: "Mini Goal", icon: Goal },
  { tool: "full-goal", label: "Full Goal", icon: Goal },
];

const ANNOTATION_TOOLS: ToolDef[] = [
  { tool: "arrow-solid", label: "Movement", icon: ArrowRight },
  { tool: "arrow-dashed", label: "Pass", icon: ArrowRight },
  { tool: "zone", label: "Zone", icon: Square },
  { tool: "text", label: "Text", icon: Type },
  { tool: "step-marker", label: "Step", icon: Hash },
];

function ToolButton({
  def,
  active,
  onClick,
}: {
  def: ToolDef;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = def.icon;
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onClick}
            aria-label={def.label}
            aria-pressed={active}
            className={cn(
              "h-11 w-11 rounded-md flex items-center justify-center transition-colors shrink-0",
              "border",
              active
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background border-border text-foreground hover:bg-muted"
            )}
          >
            <Icon className="h-5 w-5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{def.label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function TrainingToolbarImpl({
  activeTool,
  onToolChange,
  onDuplicate,
  onDelete,
  onClear,
  hasSelection,
}: TrainingToolbarProps) {
  return (
    <div className="w-full bg-background/95 backdrop-blur border-t border-border px-2 py-2 shrink-0">
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
        {/* Select / Move */}
        <ToolButton
          def={{ tool: "select", label: "Select / Move", icon: Hand }}
          active={activeTool === "select"}
          onClick={() => onToolChange("select")}
        />

        <div className="w-px h-8 bg-border shrink-0" />

        {/* Objects */}
        {OBJECT_TOOLS.map((def) => (
          <ToolButton
            key={def.tool}
            def={def}
            active={activeTool === def.tool}
            onClick={() => onToolChange(def.tool)}
          />
        ))}

        <div className="w-px h-8 bg-border shrink-0" />

        {/* Annotations */}
        {ANNOTATION_TOOLS.map((def) => (
          <ToolButton
            key={def.tool}
            def={def}
            active={activeTool === def.tool}
            onClick={() => onToolChange(def.tool)}
          />
        ))}

        <div className="w-px h-8 bg-border shrink-0" />

        {/* Actions */}
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={onDuplicate}
          disabled={!hasSelection}
          aria-label="Duplicate"
          className="h-11 w-11 shrink-0"
        >
          <Copy className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={onDelete}
          disabled={!hasSelection}
          aria-label="Delete"
          className="h-11 w-11 shrink-0 text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={onClear}
          aria-label="Clear board"
          className="h-11 w-11 shrink-0"
        >
          <Eraser className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export const TrainingToolbar = memo(TrainingToolbarImpl);
