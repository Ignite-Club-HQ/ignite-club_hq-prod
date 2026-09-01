import { Home, Calendar, MessageCircle, Image as ImageIcon } from "lucide-react";
import { NavLink } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { LogoImage } from "@/components/ui/logo-image";
import { useClubTheme } from "@/hooks/useClubTheme";
import igniteIcon from "@/assets/ignite-icon.png";

const railItems = [
  { to: "/", icon: Home, label: "Home" },
  { to: "/messages", icon: MessageCircle, label: "Messages" },
  { to: "/events", icon: Calendar, label: "Schedule" },
  { to: "/media", icon: ImageIcon, label: "Media" },
];

/**
 * Desktop-only left icon rail (the "three-column dashboard" desktop shell).
 * Renders nothing on native platforms or below the lg breakpoint — mobile
 * keeps the existing BottomNav untouched.
 */
export function DesktopNavRail() {
  const { unreadMessagesCount, profile } = useAuth();
  const { activeThemeData } = useClubTheme();

  if (Capacitor.isNativePlatform()) return null;

  const initials = (profile?.display_name || "?")
    .split(" ")
    .map((p) => p.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <aside
      className="hidden lg:flex fixed left-0 top-0 bottom-0 z-40 w-20 flex-col items-center bg-primary text-primary-foreground py-6 gap-2"
      aria-label="Primary navigation"
    >
      <NavLink
        to="/"
        aria-label="Ignite home"
        className="mb-4 block h-10 w-10 rounded-xl overflow-hidden bg-primary-foreground/10"
      >
        <LogoImage
          src={activeThemeData?.logoUrl || igniteIcon}
          alt="Ignite"
          className="h-10 w-10"
          imgClassName="object-cover"
        />
      </NavLink>

      <nav className="flex flex-col items-center gap-3" aria-label="Main">
        {railItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            title={label}
            aria-label={label}
            className={({ isActive }) =>
              cn(
                "relative flex h-12 w-12 items-center justify-center rounded-full transition-colors",
                isActive
                  ? "bg-primary-foreground/20 text-primary-foreground"
                  : "text-primary-foreground/70 hover:bg-primary-foreground/10 hover:text-primary-foreground"
              )
            }
          >
            <Icon className="h-6 w-6" aria-hidden="true" />
            {label === "Messages" && unreadMessagesCount > 0 && (
              <span
                className="absolute top-1 right-1 flex items-center justify-center rounded-full bg-[hsl(0_72%_55%)] text-white text-[9px] font-semibold leading-none tabular-nums ring-2 ring-primary min-w-[16px] h-[15px] px-1"
                aria-label={`${unreadMessagesCount} unread messages`}
              >
                {unreadMessagesCount > 9 ? "9+" : unreadMessagesCount}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      <NavLink
        to="/account"
        title="Account"
        aria-label="Account"
        className="mt-auto mb-2 block rounded-full ring-2 ring-primary-foreground/20 hover:ring-primary-foreground/40 transition-shadow"
      >
        <Avatar className="h-10 w-10">
          <AvatarImage src={profile?.avatar_url || undefined} alt={profile?.display_name || "Account"} />
          <AvatarFallback className="bg-primary-foreground/15 text-primary-foreground text-xs font-semibold">
            {initials}
          </AvatarFallback>
        </Avatar>
      </NavLink>
    </aside>
  );
}
