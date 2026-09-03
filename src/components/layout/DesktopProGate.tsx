import { Capacitor } from "@capacitor/core";
import { Smartphone, Sparkles } from "lucide-react";
import { LogoImage } from "@/components/ui/logo-image";
import { useUserHasAnyClubPro } from "@/hooks/useUserHasAnyClubPro";
import { useClubProAccess } from "@/hooks/useClubProAccess";
import { useClubTheme } from "@/hooks/useClubTheme";
import igniteIcon from "@/assets/ignite-icon.png";

/**
 * Desktop access is a Pro feature, scoped to the ACTIVE club.
 *
 * Renders a full-screen blocking overlay on desktop web (lg+ breakpoint only)
 * when the club currently selected in the club switcher has no active Pro
 * access. This matches every other Pro gate in the app: being a member of a
 * different Pro club no longer unlocks desktop while viewing a free club.
 *
 * When no club is selected (personal / no-club context) we fall back to the
 * user-level "any club Pro" lookup so users without a club filter aren't
 * locked out unexpectedly.
 *
 * Mobile/tablet widths and native (Capacitor) builds are never affected —
 * the overlay itself is `hidden lg:flex`, so below lg it doesn't exist visually.
 *
 * Entitlement is unknown-safe: while either Pro lookup is loading or errored,
 * we render nothing (no lock).
 */
export function DesktopProGate() {
  const { activeThemeData, activeClubFilter } = useClubTheme();
  const activeClubId = activeClubFilter ?? null;

  const anyClub = useUserHasAnyClubPro();
  const activeClub = useClubProAccess(activeClubId, { enabled: !!activeClubId });

  if (Capacitor.isNativePlatform()) return null;

  if (activeClubId) {
    if (activeClub.isLoading || activeClub.hasPro) return null;
  } else {
    if (anyClub.isLoading || anyClub.hasAnyClubPro) return null;
  }

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
        your phone or tablet — Pro can be purchased from the club upgrade screen in the mobile app.
      </p>

      <p className="mt-8 flex items-center gap-2 text-xs text-muted-foreground">
        <Smartphone className="h-3.5 w-3.5" aria-hidden="true" />
        Everything still works as normal on mobile.
      </p>
    </div>
  );
}
