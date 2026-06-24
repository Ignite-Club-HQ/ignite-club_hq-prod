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

  // Resolve the owning club for this scope so we can honour the club-level
  // "AI Catch Me Up" admin toggle. Direct messages have no single club, so
  // they're never disabled by this flag.
  const { data: clubDisabled } = useQuery({
    queryKey: ["club-ai-catchup-flag", scope_type, scope_id],
    enabled: !!scope_id && scope_type !== "direct",
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      let clubId: string | null = null;
      if (scope_type === "club") clubId = scope_id!;
      else if (scope_type === "team") {
        const { data } = await supabase.from("teams").select("club_id").eq("id", scope_id!).maybeSingle();
        clubId = (data?.club_id as string) ?? null;
      } else if (scope_type === "group") {
        const { data } = await supabase.from("chat_groups").select("club_id").eq("id", scope_id!).maybeSingle();
        clubId = (data?.club_id as string) ?? null;
      } else if (scope_type === "club_admin") {
        const { data } = await supabase.from("club_admin_conversations").select("club_id").eq("id", scope_id!).maybeSingle();
        clubId = (data?.club_id as string) ?? null;
      }
      if (!clubId) return false;
      const { data: club } = await supabase
        .from("clubs")
        .select("ai_catch_up_enabled")
        .eq("id", clubId)
        .maybeSingle();
      return (club as any)?.ai_catch_up_enabled === false;
    },
  });

  // Honour the per-user preference. Defaults to true if missing.
  const { data: userDisabled } = useQuery({
    queryKey: ["user-ai-catchup-pref"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) return false;
      const { data } = await supabase
        .from("profiles")
        .select("ai_catch_up_enabled")
        .eq("id", uid)
        .maybeSingle();
      return (data as any)?.ai_catch_up_enabled === false;
    },
  });

  const featureDisabled = clubDisabled === true || userDisabled === true;

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
      if (featureDisabled) {
        toast.info("AI Catch Me Up has been turned off for this club");
        return;
      }
      if (proLocked) {
        if (upgradeHref) navigate(upgradeHref);
        return;
      }
      openSheet();
    });
  }, [registerTrigger, proLocked, featureDisabled, upgradeHref, navigate, openSheet]);

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
