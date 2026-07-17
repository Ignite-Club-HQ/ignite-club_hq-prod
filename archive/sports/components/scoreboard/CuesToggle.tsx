import { memo, useEffect, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getCuesEnabled, setCuesEnabled } from "@/lib/gameCues";

/**
 * Tiny mute/unmute control for the audio + haptic game cues.
 * Persists per device via localStorage (see gameCues.ts).
 */
const CuesToggle = memo(function CuesToggle({ className }: { className?: string }) {
  const [enabled, setEnabled] = useState<boolean>(() => getCuesEnabled());

  // Sync across tabs/instances so the netball + basketball toggles agree.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "ignite-game-cues-enabled") setEnabled(getCuesEnabled());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    setCuesEnabled(next);
  };

  return (
    <Button
      size="icon"
      variant="ghost"
      className={`h-7 w-7 ${className ?? ""}`}
      onClick={toggle}
      aria-label={enabled ? "Mute game cues" : "Enable game cues"}
      title={enabled ? "Mute cues" : "Enable cues"}
    >
      {enabled ? (
        <Volume2 className="h-3.5 w-3.5" />
      ) : (
        <VolumeX className="h-3.5 w-3.5 text-muted-foreground" />
      )}
    </Button>
  );
});

export default CuesToggle;
