import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAdAnalytics } from "@/hooks/useAdAnalytics";
import { useSponsorAnalytics } from "@/hooks/useSponsorAnalytics";
import { safeOpenUrl } from "@/lib/safeOpenUrl";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

// HARD RESTRICTION: Pilot to Riverside FC only for now.
const RIVERSIDE_CLUB_ID = "36231b76-5313-478e-b8d5-23ac4f5e8b10";

const DISMISS_TTL_MS = 24 * 60 * 60 * 1000;
const dismissKey = (userId: string | undefined, clubId: string) =>
  `ignite_events_header_sponsor_dismissed_${userId || "anon"}_${clubId}`;

type SponsorTier = "platinum" | "gold" | "silver" | "bronze" | null;

interface SponsorLite {
  id: string;
  name: string;
  logo_url: string | null;
  website_url: string | null;
  tier: SponsorTier;
}

interface AppAdLite {
  id: string;
  name: string;
  image_url: string | null;
  link_url: string | null;
  ad_type: "image" | "logo_text";
  logo_url: string | null;
  headline: string | null;
}

const TIER_WEIGHT: Record<Exclude<SponsorTier, null> | "default", number> = {
  platinum: 6, gold: 4, silver: 2, bronze: 1, default: 2,
};
const TIER_DURATION_MS: Record<Exclude<SponsorTier, null> | "default", number> = {
  platinum: 20_000, gold: 18_000, silver: 12_000, bronze: 8_000, default: 12_000,
};
const tierKey = (t: SponsorTier): keyof typeof TIER_WEIGHT =>
  t && t in TIER_WEIGHT ? (t as keyof typeof TIER_WEIGHT) : "default";

/**
 * Slim sponsor / ad strip rendered at the top of the Schedule (events list)
 * and Event Detail pages. Mirrors the Messages/Media header strip style.
 *
 * `activeClubFilter` may be null (no filter). When null, the strip resolves
 * to the pilot club if the current user is a member of it.
 */
export function EventsHeaderSponsorStrip({
  activeClubFilter,
}: {
  activeClubFilter: string | null | undefined;
}) {
  const { user } = useAuth();
  const { trackView: trackSponsorView, trackClick: trackSponsorClick } = useSponsorAnalytics();
  const { trackView: trackAdView, trackClick: trackAdClick } = useAdAnalytics();
  const [dismissed, setDismissed] = useState(false);
  const [adIndex, setAdIndex] = useState(0);
  const [playlistPos, setPlaylistPos] = useState(0);

  // Resolve the effective club: pilot only, and only if user is a member.
  const { data: resolved } = useQuery({
    queryKey: ["events-header-strip-resolve", activeClubFilter, user?.id],
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      if (activeClubFilter && activeClubFilter !== RIVERSIDE_CLUB_ID) {
        return { clubId: null as string | null };
      }
      if (!activeClubFilter) {
        const { data: roles } = await supabase
          .from("user_roles")
          .select("club_id, team_id")
          .eq("user_id", user!.id);
        const clubIds = new Set<string>();
        (roles ?? []).forEach((r: any) => r.club_id && clubIds.add(r.club_id));
        const teamIds = (roles ?? []).map((r: any) => r.team_id).filter(Boolean);
        if (teamIds.length) {
          const { data: teams } = await supabase
            .from("teams").select("club_id").in("id", teamIds);
          (teams ?? []).forEach((t: any) => t.club_id && clubIds.add(t.club_id));
        }
        if (!clubIds.has(RIVERSIDE_CLUB_ID)) return { clubId: null };
      }
      const { data } = await supabase
        .from("clubs")
        .select("events_sponsor_strip_enabled")
        .eq("id", RIVERSIDE_CLUB_ID)
        .maybeSingle();
      if (!(data as any)?.events_sponsor_strip_enabled) return { clubId: null };
      return { clubId: RIVERSIDE_CLUB_ID };
    },
  });
  const clubId = resolved?.clubId ?? null;

  useEffect(() => {
    if (!clubId) return;
    try {
      const raw = localStorage.getItem(dismissKey(user?.id, clubId));
      if (!raw) { setDismissed(false); return; }
      const ts = parseInt(raw, 10);
      if (Number.isFinite(ts) && Date.now() - ts < DISMISS_TTL_MS) setDismissed(true);
      else { localStorage.removeItem(dismissKey(user?.id, clubId)); setDismissed(false); }
    } catch { setDismissed(false); }
  }, [clubId, user?.id]);

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!clubId) return;
    try { localStorage.setItem(dismissKey(user?.id, clubId), String(Date.now())); } catch {}
    setDismissed(true);
  };

  const { data: isProClub } = useQuery({
    queryKey: ["club-is-pro", clubId],
    enabled: !!clubId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("club_subscriptions")
        .select("is_pro")
        .eq("club_id", clubId!)
        .eq("is_pro", true)
        .limit(1)
        .maybeSingle();
      return !!data?.is_pro;
    },
  });

  const { data: sponsors = [] } = useQuery({
    queryKey: ["events-header-sponsors", clubId],
    enabled: !!clubId && isProClub === true,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("sponsors")
        .select("id, name, logo_url, website_url, tier")
        .eq("club_id", clubId!)
        .eq("is_active", true)
        .order("name");
      return (data || []) as SponsorLite[];
    },
  });

  const { data: placementSettings } = useQuery({
    queryKey: ["app-ad-settings", "events"],
    enabled: !!clubId && isProClub === false,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("app_ad_settings")
        .select("is_enabled")
        .eq("location", "events")
        .maybeSingle();
      return data;
    },
  });
  const freePlacementEnabled = !!placementSettings?.is_enabled;

  const { data: appAds = [] } = useQuery({
    queryKey: ["events-header-app-ads"],
    enabled: !!clubId && isProClub === false && freePlacementEnabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("app_ads")
        .select("id, name, image_url, link_url, ad_type, logo_url, headline")
        .eq("is_active", true)
        .order("display_order", { ascending: true });
      return (data || []) as AppAdLite[];
    },
  });

  const sponsorPlaylist = useMemo(() => {
    const out: number[] = [];
    sponsors.forEach((s, i) => {
      const w = TIER_WEIGHT[tierKey(s.tier)];
      for (let k = 0; k < w; k++) out.push(i);
    });
    return out;
  }, [sponsors]);

  useEffect(() => { setPlaylistPos(0); }, [sponsorPlaylist.length]);

  const sponsorIndex = sponsorPlaylist.length > 0 ? sponsorPlaylist[playlistPos % sponsorPlaylist.length] : 0;
  const activeSponsor = useMemo(
    () => (sponsors.length > 0 && isProClub ? sponsors[sponsorIndex] : null),
    [sponsors, isProClub, sponsorIndex],
  );

  useEffect(() => {
    if (!activeSponsor || sponsorPlaylist.length <= 1) return;
    const duration = TIER_DURATION_MS[tierKey(activeSponsor.tier)];
    const id = setTimeout(() => setPlaylistPos((p) => (p + 1) % sponsorPlaylist.length), duration);
    return () => clearTimeout(id);
  }, [activeSponsor, sponsorPlaylist.length, playlistPos]);

  useEffect(() => {
    if (isProClub !== false || appAds.length <= 1) return;
    const id = setInterval(() => setAdIndex((i) => (i + 1) % appAds.length), 12_000);
    return () => clearInterval(id);
  }, [isProClub, appAds.length]);

  const activeAd = useMemo(
    () => (isProClub === false && appAds.length > 0 ? appAds[adIndex % appAds.length] : null),
    [isProClub, appAds, adIndex],
  );

  useEffect(() => {
    if (activeSponsor && user?.id) trackSponsorView(activeSponsor.id, "events_page");
  }, [activeSponsor?.id, user?.id, trackSponsorView]);
  useEffect(() => {
    if (activeAd && user?.id) trackAdView(activeAd.id, "events_page");
  }, [activeAd?.id, user?.id, trackAdView]);

  if (!clubId) return null;
  if (isProClub === undefined) return null;
  if (!activeSponsor && !activeAd) return null;
  if (activeSponsor && dismissed) return null;

  if (activeSponsor) {
    const clickable = !!activeSponsor.website_url;
    return (
      <div className="rounded-lg border bg-card flex items-center">
        <button
          type="button"
          onClick={() => {
            if (!clickable) return;
            trackSponsorClick(activeSponsor.id, "events_page");
            safeOpenUrl(activeSponsor.website_url!);
          }}
          disabled={!clickable}
          className={`flex-1 min-w-0 flex items-center gap-2 px-3 py-2 text-left ${
            clickable ? "hover:bg-muted/50 transition-colors cursor-pointer" : "cursor-default"
          }`}
        >
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium shrink-0">
            Club Sponsor
          </span>
          <Avatar className="h-6 w-6 shrink-0">
            <AvatarImage src={activeSponsor.logo_url || undefined} />
            <AvatarFallback className="text-[10px] bg-secondary">
              {activeSponsor.name.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="text-sm font-medium truncate flex-1 min-w-0">{activeSponsor.name}</span>
          {clickable && <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss club sponsor"
          className="shrink-0 p-2 mr-1 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-md transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  if (activeAd) {
    const clickable = !!activeAd.link_url;
    return (
      <div className="rounded-lg border bg-card">
        <button
          type="button"
          onClick={() => {
            if (!clickable) return;
            trackAdClick(activeAd.id, "events_page");
            safeOpenUrl(activeAd.link_url!);
          }}
          disabled={!clickable}
          className={`w-full flex items-center gap-2 px-3 py-2 text-left ${
            clickable ? "hover:bg-muted/50 transition-colors cursor-pointer" : "cursor-default"
          }`}
        >
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium shrink-0">
            Sponsor
          </span>
          <Avatar className="h-6 w-6 rounded-md shrink-0">
            <AvatarImage src={activeAd.logo_url || activeAd.image_url || undefined} className="object-cover" />
            <AvatarFallback className="text-[10px] bg-secondary rounded-md">
              {(activeAd.headline || activeAd.name).charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="text-sm font-medium truncate flex-1 min-w-0">{activeAd.headline || activeAd.name}</span>
          {clickable && <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
        </button>
      </div>
    );
  }

  return null;
}
