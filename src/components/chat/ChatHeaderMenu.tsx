import { MoreVertical, RefreshCw, Pencil, Trash2, Search, Pin, EyeOff, Eye, Crown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface ChatHeaderMenuProps {
  onRefresh?: () => Promise<void>;
  isRefreshing?: boolean;
  onEditGroup?: () => void;
  onDeleteGroup?: () => void;
  onSearch?: () => void;
  /** Open the pinned-vault management sheet (admins only). */
  onManagePinnedVault?: () => void;
  /** When a pinned vault row exists, show a quick toggle to show/hide it for everyone. */
  pinnedVaultEnabled?: boolean | null;
  onTogglePinnedVault?: (enabled: boolean) => void;
  /** When true, show Pinned vault as a Pro-locked entry (Crown + Pro badge). Toggle is hidden. */
  pinnedVaultLocked?: boolean;
}

export function ChatHeaderMenu({
  onRefresh,
  isRefreshing = false,
  onEditGroup,
  onDeleteGroup,
  onSearch,
  onManagePinnedVault,
  pinnedVaultEnabled,
  onTogglePinnedVault,
}: ChatHeaderMenuProps) {
  const hasAnyAction =
    !!onRefresh
    || !!onEditGroup
    || !!onDeleteGroup
    || !!onSearch
    || !!onManagePinnedVault;
  if (!hasAnyAction) return null;

  // If refresh is the only action, render it as a direct button instead of a dropdown.
  const isRefreshOnly =
    !!onRefresh
    && !onEditGroup
    && !onDeleteGroup
    && !onSearch
    && !onManagePinnedVault;
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
      <DropdownMenuContent align="end" className="bg-popover min-w-[180px]">
        {onSearch && (
          <DropdownMenuItem onClick={onSearch}>
            <Search className="h-4 w-4 mr-2" />
            Search messages
          </DropdownMenuItem>
        )}

        {(onEditGroup || onDeleteGroup) && (
          <>
            {onSearch && <DropdownMenuSeparator />}
            {onEditGroup && (
              <DropdownMenuItem onClick={onEditGroup}>
                <Pencil className="h-4 w-4 mr-2" />
                Edit group
              </DropdownMenuItem>
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
          </>
        )}

        {onManagePinnedVault && (
          <>
            {(onSearch || onEditGroup || onDeleteGroup) && <DropdownMenuSeparator />}
            <DropdownMenuItem onClick={onManagePinnedVault}>
              <Pin className="h-4 w-4 mr-2" />
              Pinned vault…
            </DropdownMenuItem>
            {typeof pinnedVaultEnabled === "boolean" && onTogglePinnedVault && (
              <DropdownMenuItem onClick={() => onTogglePinnedVault(!pinnedVaultEnabled)}>
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

        {onRefresh && (
          <>
            {(onEditGroup || onDeleteGroup || onSearch || onManagePinnedVault) && <DropdownMenuSeparator />}
            <DropdownMenuItem
              onClick={() => void onRefresh()}
              disabled={isRefreshing}
            >
              <RefreshCw className={cn("h-4 w-4 mr-2", isRefreshing && "animate-spin")} />
              Refresh messages
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
