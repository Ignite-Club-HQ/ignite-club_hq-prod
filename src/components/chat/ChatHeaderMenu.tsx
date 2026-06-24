import {
  MoreVertical,
  RefreshCw,
  Pencil,
  Trash2,
  Search,
  Pin,
  EyeOff,
  Eye,
  Crown,
  CalendarClock,
  Sparkles,
  Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuPortal,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface ChatHeaderMenuProps {
  onRefresh?: () => Promise<void>;
  isRefreshing?: boolean;
  onEditGroup?: () => void;
  onDeleteGroup?: () => void;
  onSearch?: () => void;
  /** Open the schedule-message dialog for the current conversation. */
  onScheduleMessage?: () => void;
  /** When true, show Schedule message as a Pro-locked entry (Crown + Pro badge). */
  scheduleMessageLocked?: boolean;
  /** Open the pinned-vault management sheet (admins only). */
  onManagePinnedVault?: () => void;
  /** When a pinned vault row exists, show a quick toggle to show/hide it for everyone. */
  pinnedVaultEnabled?: boolean | null;
  onTogglePinnedVault?: (enabled: boolean) => void;
  /** When true, show Pinned vault as a Pro-locked entry (Crown + Pro badge). Toggle is hidden. */
  pinnedVaultLocked?: boolean;
  /**
   * Trigger an AI "Catch me up" summary of recent messages.
   * Only pass this when AI is actually available to the user — it renders as
   * a first-class header action (Sparkles button), NOT inside the overflow.
   */
  onSummarizeMessages?: () => void;
}

export function ChatHeaderMenu({
  onRefresh,
  isRefreshing = false,
  onEditGroup,
  onDeleteGroup,
  onSearch,
  onScheduleMessage,
  scheduleMessageLocked = false,
  onManagePinnedVault,
  pinnedVaultEnabled,
  onTogglePinnedVault,
  pinnedVaultLocked = false,
  onSummarizeMessages,
}: ChatHeaderMenuProps) {
  const hasMoreActions = !!onManagePinnedVault || !!onEditGroup || !!onDeleteGroup;
  const hasDropdownAction =
    !!onRefresh || !!onScheduleMessage || hasMoreActions;
  const hasAnyAction = hasDropdownAction || !!onSummarizeMessages || !!onSearch;
  if (!hasAnyAction) return null;

  // If refresh is the only action (no AI, no search, no others), render directly.
  const isRefreshOnly =
    !!onRefresh
    && !onEditGroup
    && !onDeleteGroup
    && !onSearch
    && !onScheduleMessage
    && !onManagePinnedVault
    && !onSummarizeMessages;
  if (isRefreshOnly) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9 shrink-0 transition-transform active:scale-95"
        onClick={() => void onRefresh!()}
        disabled={isRefreshing}
        aria-label="Refresh messages"
      >
        <RefreshCw className={cn("h-[18px] w-[18px]", isRefreshing && "animate-spin")} />
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-0.5">
      {onSummarizeMessages && (
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 text-primary transition-transform active:scale-95"
          onClick={onSummarizeMessages}
          aria-label="AI summary of recent messages"
        >
          <Sparkles className="h-[18px] w-[18px]" />
        </Button>
      )}

      {hasDropdownAction && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              aria-label="More options"
            >
              <MoreVertical className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="bg-popover min-w-[200px]">
            {onRefresh && (
              <DropdownMenuItem
                onClick={() => void onRefresh()}
                disabled={isRefreshing}
              >
                <RefreshCw className={cn("h-4 w-4 mr-2", isRefreshing && "animate-spin")} />
                Refresh messages
              </DropdownMenuItem>
            )}

            {onScheduleMessage && (
              <DropdownMenuItem onClick={onScheduleMessage}>
                <CalendarClock className="h-4 w-4 mr-2" />
                <span className="flex-1">Schedule message</span>
                {scheduleMessageLocked && (
                  <span className="ml-2 inline-flex items-center gap-1 bg-primary/10 text-primary px-1.5 py-0.5 rounded-full text-[10px] font-medium">
                    <Crown className="h-3 w-3" />
                    Pro
                  </span>
                )}
              </DropdownMenuItem>
            )}

            {hasMoreActions && (
              <>
                {(onRefresh || onScheduleMessage) && <DropdownMenuSeparator />}
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Settings2 className="h-4 w-4 mr-2" />
                    More actions
                  </DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent className="bg-popover min-w-[200px]">
                      {onManagePinnedVault && (
                        <>
                          <DropdownMenuItem onClick={onManagePinnedVault}>
                            <Pin className="h-4 w-4 mr-2" />
                            <span className="flex-1">Pinned vault…</span>
                            {pinnedVaultLocked && (
                              <span className="ml-2 inline-flex items-center gap-1 bg-primary/10 text-primary px-1.5 py-0.5 rounded-full text-[10px] font-medium">
                                <Crown className="h-3 w-3" />
                                Pro
                              </span>
                            )}
                          </DropdownMenuItem>
                          {!pinnedVaultLocked
                            && typeof pinnedVaultEnabled === "boolean"
                            && onTogglePinnedVault && (
                              <DropdownMenuItem
                                onClick={() => onTogglePinnedVault(!pinnedVaultEnabled)}
                              >
                                {pinnedVaultEnabled ? (
                                  <>
                                    <EyeOff className="h-4 w-4 mr-2" />
                                    Hide pinned vault
                                  </>
                                ) : (
                                  <>
                                    <Eye className="h-4 w-4 mr-2" />
                                    Show pinned vault
                                  </>
                                )}
                              </DropdownMenuItem>
                            )}
                        </>
                      )}
                      {onEditGroup && (
                        <>
                          {onManagePinnedVault && <DropdownMenuSeparator />}
                          <DropdownMenuItem onClick={onEditGroup}>
                            <Pencil className="h-4 w-4 mr-2" />
                            Edit group
                          </DropdownMenuItem>
                        </>
                      )}
                      {onDeleteGroup && (
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={onDeleteGroup}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete group
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
