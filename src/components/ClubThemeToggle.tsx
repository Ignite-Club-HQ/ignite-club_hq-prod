import { Building2, Check, Lock, Sparkles, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useClubTheme } from "@/hooks/useClubTheme";
import igniteIcon from "@/assets/ignite-icon.png";
import { cn } from "@/lib/utils";

/**
 * Club switcher.
 *
 * Every club the user belongs to is selectable, regardless of plan, and each
 * appears exactly once. The active club is pinned at the top with a strong
 * selected state. Free clubs are selectable (for content filtering) but
 * surface a subtle "Free" hint; custom branding is only applied for clubs
 * with Pro entitlement (resolved centrally in `useClubTheme`).
 */
export function ClubThemeToggle() {
  const navigate = useNavigate();
  const { availableClubThemes, activeClubTheme, setActiveClubTheme, isLoading } = useClubTheme();

  if (isLoading || availableClubThemes.length === 0) {
    return null;
  }

  // Deduplicate defensively by clubId (hook already dedupes by name).
  const uniqueClubs = Array.from(
    new Map(availableClubThemes.map((t) => [t.clubId, t])).values()
  );

  const activeTheme = uniqueClubs.find((t) => t.clubId === activeClubTheme) ?? null;
  const otherClubs = uniqueClubs.filter((t) => t.clubId !== activeClubTheme);
  const hasFreeClub = uniqueClubs.some((t) => !t.canUseCustomTheme);

  const renderSwatches = (theme: typeof uniqueClubs[number]) => {
    if (!theme.canUseCustomTheme || !theme.hasCustomTheme || !theme.primary) return null;
    const stops = [theme.primary, theme.secondary, theme.accent].filter(Boolean) as NonNullable<typeof theme.primary>[];
    return (
      <div className="flex gap-1">
        {stops.map((c, i) => (
          <span
            key={i}
            className="h-2.5 w-2.5 rounded-full border border-border/60"
            style={{ backgroundColor: `hsl(${c.h}, ${c.s}%, ${c.l}%)` }}
          />
        ))}
      </div>
    );
  };

  const ClubRow = ({
    theme,
    selected,
    onSelect,
  }: {
    theme: typeof uniqueClubs[number];
    selected: boolean;
    onSelect: () => void;
  }) => {
    const isFree = !theme.canUseCustomTheme;
    return (
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors",
          selected
            ? "bg-primary/10 ring-1 ring-primary/40"
            : "hover:bg-muted/60 active:bg-muted"
        )}
      >
        <Avatar className="h-9 w-9 shrink-0">
          <AvatarImage src={theme.logoUrl || undefined} />
          <AvatarFallback
            className="text-xs font-semibold"
            style={{
              backgroundColor:
                !isFree && theme.primary
                  ? `hsl(${theme.primary.h}, ${theme.primary.s}%, ${theme.primary.l}%)`
                  : undefined,
              color:
                !isFree && theme.primary && theme.primary.l > 50 ? "#1a1a1a" : undefined,
            }}
          >
            {theme.clubName.charAt(0)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-medium truncate">{theme.clubName}</p>
            {selected && (
              <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-medium">
                Current
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            {isFree ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Lock className="h-3 w-3" />
                Default theme
              </span>
            ) : (
              renderSwatches(theme) ?? (
                <span className="text-[11px] text-muted-foreground">Custom theme</span>
              )
            )}
          </div>
        </div>
        {selected && (
          <div className="h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0">
            <Check className="h-3.5 w-3.5" strokeWidth={3} />
          </div>
        )}
      </button>
    );
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          {activeTheme ? (
            <Avatar className="h-5 w-5">
              <AvatarImage src={activeTheme.logoUrl || undefined} />
              <AvatarFallback className="text-[8px] bg-primary text-primary-foreground">
                {activeTheme.clubName.charAt(0)}
              </AvatarFallback>
            </Avatar>
          ) : (
            <Building2 className="h-5 w-5" />
          )}
          {activeClubTheme && (
            <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-background" />
          )}
          <span className="sr-only">Active club</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-[20rem] p-2 max-h-[80vh] overflow-y-auto"
      >
        <div className="px-2 pt-1 pb-2">
          <p className="text-sm font-semibold">Switch club</p>
          <p className="text-xs text-muted-foreground">
            Choose which club's content and branding to view
          </p>
        </div>

        {/* Active club — pinned at top */}
        {activeTheme && (
          <>
            <p className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Current
            </p>
            <ClubRow theme={activeTheme} selected onSelect={() => {}} />
          </>
        )}

        {/* All clubs (no club selected) */}
        <p className="px-2 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {activeTheme ? "Switch to" : "Current"}
        </p>

        <button
          type="button"
          onClick={() => setActiveClubTheme(null)}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors",
            !activeClubTheme
              ? "bg-primary/10 ring-1 ring-primary/40"
              : "hover:bg-muted/60 active:bg-muted"
          )}
        >
          <img
            src={igniteIcon}
            alt="Ignite"
            className="h-9 w-9 rounded-full object-contain bg-muted shrink-0"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-medium">All clubs</p>
              {!activeClubTheme && (
                <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-medium">
                  Current
                </Badge>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              See updates from all your clubs in one place
            </p>
          </div>
          {!activeClubTheme && (
            <div className="h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0">
              <Check className="h-3.5 w-3.5" strokeWidth={3} />
            </div>
          )}
        </button>

        {/* Other clubs — each appears exactly once, selectable regardless of plan */}
        <div className="mt-1 space-y-0.5">
          {otherClubs.map((theme) => (
            <ClubRow
              key={theme.clubId}
              theme={theme}
              selected={false}
              onSelect={() => setActiveClubTheme(theme.clubId)}
            />
          ))}
        </div>

        {/* Single Pro upsell — replaces per-club locked duplicates */}
        {hasFreeClub && (
          <button
            type="button"
            onClick={() => {
              const freeClub = uniqueClubs.find((t) => !t.canUseCustomTheme);
              if (freeClub) navigate(`/clubs/${freeClub.clubId}/upgrade`);
            }}
            className="mt-3 w-full rounded-lg p-3 text-left bg-gradient-to-br from-primary/15 via-primary/10 to-accent/10 ring-1 ring-primary/30 hover:ring-primary/50 transition-all group"
          >
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                <Sparkles className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">Unlock club themes</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                  Bring your club colours, logo and branded experience to every screen with Pro.
                </p>
                <div className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-primary group-hover:gap-1.5 transition-all">
                  Upgrade to Pro
                  <ChevronRight className="h-3 w-3" />
                </div>
              </div>
            </div>
          </button>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
