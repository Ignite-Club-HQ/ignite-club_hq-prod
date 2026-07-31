import { Button } from "@/components/ui/button";
import { WifiOff, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface ChatUnreachableProps {
  /** What the user was trying to open, e.g. "chat group", "conversation". */
  label?: string;
  onRetry: () => void;
  retrying?: boolean;
}

/**
 * Shown when a chat's metadata request failed or was paused (offline / dropped
 * connection). Deliberately does NOT claim the chat was deleted — see
 * `src/lib/chatMetadataGate.ts`.
 */
export function ChatUnreachable({ label = "chat", onRetry, retrying }: ChatUnreachableProps) {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-4 px-6 text-center">
      <WifiOff className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
      <p className="text-muted-foreground">
        Couldn&apos;t load this {label}. Your connection looks unstable — it hasn&apos;t been removed.
      </p>
      <div className="flex gap-2">
        <Button onClick={onRetry} disabled={retrying}>
          <RefreshCw className={`h-4 w-4 mr-2 ${retrying ? "animate-spin" : ""}`} aria-hidden="true" />
          {retrying ? "Retrying…" : "Try again"}
        </Button>
        <Button variant="outline" onClick={() => navigate("/messages")}>
          Back to Messages
        </Button>
      </div>
    </div>
  );
}
