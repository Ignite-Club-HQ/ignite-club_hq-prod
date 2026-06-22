import { Building2, Check, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useClubTheme } from "@/hooks/useClubTheme";
import igniteIcon from "@/assets/ignite-icon.png";

/**
 * Club switcher.
 *
 * Every club the user belongs to is selectable, regardless of plan. Picking a
 * club always sets it as the active club context (for content filtering).
 * Whether the club's custom colours are applied is decided centrally inside
 * `useClubTheme` (the resolver only paints custom colours when the club has
 * Pro entitlement). Free clubs render with a subtle lock badge and helper
 * text so users understand custom colours are a Pro feature — the row itself
 * stays tappable.
 */
export function ClubThemeToggle() {
  const { availableClubThemes, activeClubTheme, setActiveClubTheme, isLoading } = useClubTheme();

  if (isLoading || availableClubThemes.length === 0) {
    return null;
  }

  const activeTheme = availableClubThemes.find(t => t.clubId === activeClubTheme);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
        >
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
            <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-primary" />
          )}
          <span className="sr-only">Active club</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <div className="px-2 py-1.5">
          <p className="text-sm font-medium">Active Club</p>
          <p className="text-xs text-muted-foreground">Switch club context</p>
        </div>
        <DropdownMenuSeparator />

        {/* No active club — default Ignite theme + no club filter */}
        <DropdownMenuItem
          onClick={() => setActiveClubTheme(null)}
          className="flex items-center gap-3 py-2"
        >
          <img
            src={igniteIcon}
            alt="Ignite"
            className="h-8 w-8 rounded-full object-contain"
          />
          <div className="flex-1">
            <p className="text-sm font-medium">All clubs</p>
            <p className="text-xs text-muted-foreground">Default Ignite theme</p>
          </div>
          {!activeClubTheme && <Check className="h-4 w-4 text-primary" />}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {availableClubThemes.map((theme) => {
          const locked = !theme.isProTheme;
          return (
            <DropdownMenuItem
              key={theme.clubId}
              onClick={() => setActiveClubTheme(theme.clubId)}
              className="flex items-center gap-3 py-2"
            >
              <Avatar className="h-8 w-8">
                <AvatarImage src={theme.logoUrl || undefined} />
                <AvatarFallback
                  className="text-xs"
                  style={{
                    backgroundColor: !locked && theme.primary
                      ? `hsl(${theme.primary.h}, ${theme.primary.s}%, ${theme.primary.l}%)`
                      : undefined,
                    color: !locked && theme.primary && theme.primary.l > 50 ? '#1a1a1a' : undefined,
                  }}
                >
                  {theme.clubName.charAt(0)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-medium truncate">{theme.clubName}</p>
                  {locked && (
                    <Lock className="h-3 w-3 text-muted-foreground shrink-0" aria-label="Pro" />
                  )}
                </div>
                {locked ? (
                  <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">
                    Custom club colours are available on Pro
                  </p>
                ) : theme.primary ? (
                  <div className="flex gap-1 mt-0.5">
                    <div
                      className="h-3 w-3 rounded-full border border-border"
                      style={{ backgroundColor: `hsl(${theme.primary.h}, ${theme.primary.s}%, ${theme.primary.l}%)` }}
                    />
                    {theme.secondary && (
                      <div
                        className="h-3 w-3 rounded-full border border-border"
                        style={{ backgroundColor: `hsl(${theme.secondary.h}, ${theme.secondary.s}%, ${theme.secondary.l}%)` }}
                      />
                    )}
                    {theme.accent && (
                      <div
                        className="h-3 w-3 rounded-full border border-border"
                        style={{ backgroundColor: `hsl(${theme.accent.h}, ${theme.accent.s}%, ${theme.accent.l}%)` }}
                      />
                    )}
                  </div>
                ) : null}
              </div>
              {activeClubTheme === theme.clubId && <Check className="h-4 w-4 text-primary shrink-0" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
