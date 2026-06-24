import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CatchMeUpCard } from "./CatchMeUpCard";
import { CatchMeUpSheet } from "./CatchMeUpSheet";
import { useChatCatchUp, type ChatScopeType } from "@/hooks/useChatCatchUp";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ChatCatchUpProps {
  scope_type: ChatScopeType;
  scope_id: string | null | undefined;
  unreadCount: number;
  latestMessageId?: string | null;
  /** When true, hide the inline card and show a Pro upsell when triggered from the menu. */
  proLocked?: boolean;
  /** Where to send the user when they tap "Upgrade to Pro" from the error state. */
  upgradeHref?: string;
  /**
   * Called once with a function that opens the summary sheet. Pass that function
   * to `<ChatHeaderMenu onSummarizeMessages={...} />` so the manual entry works.
   */
  registerTrigger?: (open: () => void) => void;
}

/**
 * Drop-in panel that renders the AI "Catch me up" card (when eligible) and the
 * bottom-sheet summary view. Designed to be lightweight and optional —
 * the card only appears when the user has 10+ unread, 24h+ since last open,
 * or an admin/coach broadcast has multiple replies.
 */
export function ChatCatchUp({
  scope_type,
  scope_id,
  unreadCount,
  latestMessageId = null,
  proLocked = false,
  upgradeHref,
  registerTrigger,
}: ChatCatchUpProps) {
  const navigate = useNavigate();
  const {
    eligible, loading, error, result, sheetOpen, setSheetOpen,
    summarize, openSheet, dismissCard,
  } = useChatCatchUp({
    scope_type,
    scope_id,
    unreadCount,
    cardEnabled: !proLocked,
    latestMessageId,
  });

  // Expose the manual trigger to the parent (for the overflow menu entry).
  useEffect(() => {
    if (!registerTrigger) return;
    registerTrigger(() => {
      if (proLocked) {
        if (upgradeHref) navigate(upgradeHref);
        return;
      }
      openSheet();
    });
  }, [registerTrigger, proLocked, upgradeHref, navigate, openSheet]);

  if (!scope_id) return null;

  return (
    <>
      {eligible && !proLocked && (
        <CatchMeUpCard
          unreadCount={unreadCount}
          teaser={result?.summary?.headline ?? null}
          loading={loading && !result}
          onView={openSheet}
          onDismiss={dismissCard}
        />
      )}

      <CatchMeUpSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        loading={loading}
        error={error}
        result={result}
        unreadCount={unreadCount}
        onRegenerate={() => void summarize({ force: true })}
        onUpgrade={upgradeHref ? () => navigate(upgradeHref) : undefined}
      />
    </>
  );
}
