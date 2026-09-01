import { Capacitor } from "@capacitor/core";
import { Link } from "react-router-dom";
import { Monitor, Smartphone, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LogoImage } from "@/components/ui/logo-image";
import { useUserHasAnyClubPro } from "@/hooks/useUserHasAnyClubPro";
import { useClubTheme } from "@/hooks/useClubTheme";
import igniteIcon from "@/assets/ignite-icon.png";

/**
 * Desktop access is a Pro feature.
 *
 * Renders a full-screen blocking overlay on desktop web (lg+ breakpoint only)
 * when the signed-in user has no active Pro access on any of their clubs.
 * Mobile/tablet widths and native (Capacitor) builds are never affected —
 * the overlay itself is `hidden lg:flex`, so below lg it doesn't exist visually.
 *
 * Entitlement is unknown-safe: while the Pro lookup is loading or errored,
 * `useUserHasAnyClubPro` reports `isLoading`, and we render nothing (no lock).
 */
export function DesktopProGate() {
  const { hasAnyClubPro, isLoading } = useUserHasAnyClubPro();
  const { activeThemeData } = useClubTheme();

  if (Capacitor.isNativePlatform()) return null;
  if (isLoading || hasAnyClubPro) return null;

  return (
    <div
      className="hidden lg:flex fixed inset-0 z-[100] flex-col items-center justify-center bg-background px-8 text-center"
      role="dialog"
      aria-modal="true"
      aria-label="Desktop access requires Pro"
    >
      <LogoImage
        src={activeThemeData?.logoUrl || igniteIcon}
        alt="Ignite"
        className="h-16 w-16 rounded-2xl mb-6"
        imgClassName="object-cover"
      />

      <div className="flex items-center gap-2 text-primary mb-3">
        <Sparkles className="h-4 w-4" aria-hidden="true" />
        <span className="text-xs font-semibold uppercase tracking-wide">Pro feature</span>
      </div>

      <h1 className="text-2xl font-bold text-foreground max-w-lg">
        Desktop access is available on Pro
      </h1>
      <p className="mt-3 max-w-md text-sm text-muted-foreground">
        Your club is on the free plan, so Ignite is mobile-only for now. Upgrade your
        club to Pro to unlock the full desktop experience, or keep using the app on
        your phone or tablet.
      </p>

      <div className="mt-8 flex flex-col sm:flex-row items-center gap-3">
        <Button asChild>
          <Link to="/account">
            <Monitor className="h-4 w-4 mr-2" aria-hidden="true" />
            See Pro plans
          </Link>
        </Button>
      </div>

      <p className="mt-8 flex items-center gap-2 text-xs text-muted-foreground">
        <Smartphone className="h-3.5 w-3.5" aria-hidden="true" />
        Everything still works as normal on mobile.
      </p>
    </div>
  );
}
