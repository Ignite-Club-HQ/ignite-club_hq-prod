import { useNavigate } from "react-router-dom";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatBackButton } from "@/components/chat/ChatBackButton";

/**
 * Replaces an empty thread when the server refuses to open the chat's messages
 * for this person. Both backends hide the messages silently, which previously
 * read as "nobody has posted yet" — the point of this screen is to name the
 * real reason and offer the way out.
 */
export function ChatAccessDenied({
  chatName,
  onBack,
}: {
  chatName?: string | null;
  onBack?: () => void;
}) {
  const navigate = useNavigate();
  const goBack = onBack ?? (() => navigate("/messages"));

  return (
    <div className="flex flex-col h-[100dvh] bg-background">
      <header className="flex items-center gap-2 px-3 py-2 border-b border-border bg-background pt-[max(env(safe-area-inset-top),0.5rem)]">
        <ChatBackButton />
        <div className="min-w-0">
          <h1 className="font-semibold truncate text-sm">{chatName || "This chat"}</h1>
        </div>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
        <Lock className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <div className="space-y-1">
          <p className="text-base font-medium text-foreground">
            You don&apos;t have access to this chat
          </p>
          <p className="text-sm text-muted-foreground max-w-sm">
            Only members of this chat can read its messages. Ask a club admin to
            add you if you need to be here.
          </p>
        </div>
        <Button variant="outline" onClick={goBack}>
          Back to Messages
        </Button>
      </div>
    </div>
  );
}
