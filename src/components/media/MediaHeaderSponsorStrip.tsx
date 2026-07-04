import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ExternalLink, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAdAnalytics } from "@/hooks/useAdAnalytics";
import { useSponsorAnalytics } from "@/hooks/useSponsorAnalytics";
import { safeOpenUrl } from "@/lib/safeOpenUrl";
import { openAdLink } from "@/lib/adLinkNavigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { readStripHint, writeStripHint } from "@/lib/stripContentHint";

const STRIP_KEY = "media_header";
const RESERVED_CLASS = "min-h-[44px]";

// Pro sponsor strip: any Pro club that opts in via clubs.media_header_sponsors_enabled.
// Defaults to OFF (column default false); toggled in Club settings.

// Pro dismiss — 24h, user+club scoped. Free clubs cannot dismiss (same as chat).
const DISMISS_TTL_MS = 24 * 60 * 60 * 1000;
const dismissKey = (userId: string | undefined, clubId: string) =>
  `ignite_media_header_sponsor_dismissed_${userId || "anon"}_${clubId}`;

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
 * Slim sponsor / ad strip rendered above the Media feed.
 *
 * Render rules (triple-checked):
 *   Pro path  → ONLY when clubId === RIVERSIDE && clubs.media_header_sponsors_enabled === true.
 *               Dismissible for 24h per user+club.
 *   Free path → Any free club, always on (mirrors messages strip). Not dismissible.
 *
 * If `clubId` is null/undefined (multi-club view), renders nothing.
 */
export function MediaHeaderSponsorStrip({ clubId }: { clubId: string | null | undefined }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { trackView: trackSponsorView, trackClick: trackSponsorClick } = useSponsorAnalytics();
  const { trackView: trackAdView, trackClick: trackAdClick } = useAdAnalytics();
  const [dismissed, setDismissed] = useState(false);
  const [adIndex, setAdIndex] = useState(0);
  const [playlistPos, setPlaylistPos] = useState(0);

  // Dismiss state (Pro Riverside only)
  useEffect(() => {
    if (!clubId) return;
    try {
      const raw = localStorage.getItem(dismissKey(user?.id, clubId));
      if (!raw) { setDismissed(false); return; }
      const ts = parseInt(raw, 10);
      if (Number.isFinite(ts) && Date.now() - ts < DISMISS_TTL_MS) {
        setDismissed(true);
      } else {
        localStorage.removeItem(dismissKey(user?.id, clubId));
        setDismissed(false);
      }
    } catch { setDismissed(false); }
  }, [clubId, user?.id]);

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!clubId) return;
    try { localStorage.setItem(dismissKey(user?.id, clubId), String(Date.now())); } catch {}
    setDismissed(true);
  };

  // Is club Pro? (drives Pro vs Free path)
  const { data: isProClub, isSuccess: isProClubOk } = useQuery({
    queryKey: ["club-is-pro", clubId],
    enabled: !!clubId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("club_subscriptions")
        .select("is_pro")
        .eq("club_id", clubId!)
        .eq("is_pro", true)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return !!data?.is_pro;
    },
  });

  // Pro toggle — any Pro club that has opted in
  const { data: clubFlag, isSuccess: clubFlagOk } = useQuery({
    queryKey: ["media-header-sponsors-enabled", clubId],
    enabled: !!clubId && isProClub === true,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clubs")
        .select("id, media_header_sponsors_enabled")
        .eq("id", clubId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const proEnabled = !!clubFlag?.media_header_sponsors_enabled;

  // Pro sponsors
  const { data: sponsors = [], isSuccess: sponsorsOk } = useQuery({
    queryKey: ["media-header-sponsors", clubId],
    enabled: proEnabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sponsors")
        .select("id, name, logo_url, website_url, tier")
        .eq("club_id", clubId!)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data || []) as SponsorLite[];
    },
  });

  // Free app-ad placement gate — controlled by app admin in /admin/ads
  const { data: placementSettings, isSuccess: placementOk } = useQuery({
    queryKey: ["app-ad-settings", "media-header"],
    enabled: isProClub === false,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_ad_settings")
        .select("is_enabled")
        .eq("location", "media-header")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const freePlacementEnabled = !!placementSettings?.is_enabled;

  // Free app ads
  const { data: appAds = [], isSuccess: appAdsOk } = useQuery({
    queryKey: ["media-header-app-ads"],
    enabled: isProClub === false && freePlacementEnabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_ads")
        .select("id, name, image_url, link_url, ad_type, logo_url, headline")
        .eq("is_active", true)
        .order("display_order", { ascending: true });
      if (error) throw error;
      return (data || []) as AppAdLite[];
    },
  });

  // Tier-weighted Pro playlist
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
    () => (proEnabled && sponsors.length > 0 ? sponsors[sponsorIndex] : null),
    [proEnabled, sponsors, sponsorIndex],
  );

  useEffect(() => {
    if (!activeSponsor || sponsorPlaylist.length <= 1) return;
    const duration = TIER_DURATION_MS[tierKey(activeSponsor.tier)];
    const id = setTimeout(() => setPlaylistPos((p) => (p + 1) % sponsorPlaylist.length), duration);
    return () => clearTimeout(id);
  }, [activeSponsor, sponsorPlaylist.length, playlistPos]);

  // Free ad rotation
  useEffect(() => {
    if (isProClub !== false || appAds.length <= 1) return;
    const id = setInterval(() => setAdIndex((i) => (i + 1) % appAds.length), 12_000);
    return () => clearInterval(id);
  }, [isProClub, appAds.length]);

  const activeAd = useMemo(
    () => (isProClub === false && appAds.length > 0 ? appAds[adIndex % appAds.length] : null),
    [isProClub, appAds, adIndex],
  );

  // Impression tracking
  useEffect(() => {
    if (activeSponsor && user?.id) trackSponsorView(activeSponsor.id, "messages_page");
  }, [activeSponsor?.id, user?.id, trackSponsorView]);
  useEffect(() => {
    if (activeAd && user?.id) trackAdView(activeAd.id, "messages_page");
  }, [activeAd?.id, user?.id, trackAdView]);

  // Resolution / hint bookkeeping — see events strip for rationale.
  const decisionResolved =
    !clubId
      ? true
      : isProClubOk &&
        (isProClub === true
          ? clubFlagOk && (!proEnabled || sponsorsOk)
          : placementOk && (!freePlacementEnabled || appAdsOk));

  const hasContent = !!activeSponsor || !!activeAd;

  useEffect(() => {
    if (!decisionResolved) return;
    writeStripHint(STRIP_KEY, user?.id, clubId, hasContent);
  }, [decisionResolved, hasContent, user?.id, clubId]);

  const [reserveOnLoad] = useState(() => {
    const hint = readStripHint(STRIP_KEY, user?.id, clubId ?? null);
    return hint !== false;
  });

  const renderReserved = () =>
    reserveOnLoad ? <div className={RESERVED_CLASS} aria-hidden="true" /> : null;

  // Gates
  if (!clubId) return null;
  if (!decisionResolved) return renderReserved();
  if (!hasContent) return null;
  if (activeSponsor && dismissed) return null;

  // Pro Riverside: dismissible club-sponsor row
  if (activeSponsor) {
    const clickable = !!activeSponsor.website_url;
    return (
      <div className="rounded-lg border bg-card flex items-center">
        <button
          type="button"
          onClick={() => {
            if (!clickable) return;
            trackSponsorClick(activeSponsor.id, "messages_page");
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

  // Free: app ad row (always on)
  if (activeAd) {
    const clickable = !!activeAd.link_url;
    return (
      <div className="rounded-lg border bg-card">
        <button
          type="button"
          onClick={() => {
            if (!clickable) return;
            trackAdClick(activeAd.id, "messages_page");
            openAdLink(activeAd.link_url, navigate, { clubId });
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
