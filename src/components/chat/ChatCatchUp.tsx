import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { CatchMeUpCard } from "./CatchMeUpCard";
import { CatchMeUpSheet } from "./CatchMeUpSheet";
import { useChatCatchUp, type ChatScopeType } from "@/hooks/useChatCatchUp";
import { useAICatchUpAvailability } from "@/hooks/useAICatchUpAvailability";
import { toast } from "sonner";

  const { clubDisabled, userDisabled, featureDisabled } = useAICatchUpAvailability(scope_type, scope_id);

  const {
    eligible, loading, error, result, sheetOpen, setSheetOpen,
    summarize, openSheet, dismissCard,
  } = useChatCatchUp({
    scope_type,
    scope_id,
    unreadCount,
    cardEnabled: !proLocked && !featureDisabled,
    latestMessageId,
  });

  // Expose the manual trigger to the parent (for the overflow menu entry).
  useEffect(() => {
    if (!registerTrigger) return;
    registerTrigger(() => {
      if (clubDisabled) {
        toast.info("AI Catch Me Up has been turned off for this club");
        return;
      }
      if (userDisabled) {
        toast.info("AI Catch Me Up is turned off in your settings");
        return;
      }
      if (proLocked) {
        if (upgradeHref) navigate(upgradeHref);
        return;
      }
      openSheet();
    });
  }, [registerTrigger, proLocked, clubDisabled, userDisabled, upgradeHref, navigate, openSheet]);

  if (!scope_id) return null;

  return (
    <>
      {eligible && !proLocked && !featureDisabled && (
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
