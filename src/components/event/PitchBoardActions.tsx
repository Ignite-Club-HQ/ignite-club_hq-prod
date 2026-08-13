import { Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PitchBoardPrimaryAction } from "@/features/events/pitchBoardActionPolicy";

export function PitchBoardActions({ showLoading, primary, showReadOnly, onOpen }: {
  showLoading: boolean;
  primary: PitchBoardPrimaryAction;
  showReadOnly: boolean;
  onOpen: () => void;
}) {
  return <>
    {showLoading && <Button variant="outline" className="w-full mt-2" disabled>
      <Loader2 className="h-4 w-4 mr-2 animate-spin" />Checking match access…
    </Button>}
    {primary && <Button
      variant={primary === "prepare" ? "outline" : "default"}
      size={primary === "prepare" ? "default" : "lg"}
      className={primary === "prepare" ? "w-full mt-2" : "w-full mt-2 h-14 text-lg font-bold gap-3"}
      onClick={onOpen}
    >
      <Play className={primary === "prepare" ? "h-4 w-4 mr-2" : "h-5 w-5"} />
      {primary === "prepare" ? "Prepare Lineup & Auto-Subs" : primary === "start" ? "Start Game" : "Open Match"}
    </Button>}
    {showReadOnly && <Button variant="default" size="lg" className="w-full mt-2 h-14 text-lg font-bold gap-3" onClick={onOpen}>
      <Play className="h-5 w-5" />Open Pitch Board
    </Button>}
  </>;
}
