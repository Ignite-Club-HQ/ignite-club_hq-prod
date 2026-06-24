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

// Pro club sponsor strip dismissal — 24h hide, user+club scoped.
// Free clubs (app ads) cannot dismiss.
const DISMISS_TTL_MS = 24 * 60 * 60 * 1000;
const dismissKey = (userId: string | undefined, clubId: string) =>
  `ignite_chat_sponsor_dismissed_${userId || "anon"}_${clubId}`;

interface ChatThreadSponsorStripProps {
  /** The club this chat thread belongs to. Pass `null` for DMs / unscoped chats — strip will hide. */
  clubId: string | null | undefined;
}

type SponsorTier = "platinum" | "gold" | "silver" | "bronze" | null;

interface SponsorLite {
  id: string;
  name: string;
  logo_url: string | null;
  website_url: string | null;
  tier: SponsorTier;
}

// Tier-based rotation weights & on-screen durations.
// Higher tier = appears more often AND stays visible longer.
const TIER_WEIGHT: Record<Exclude<SponsorTier, null> | "default", number> = {
  platinum: 6,
  gold: 4,
  silver: 2,
  bronze: 1,
  default: 2, // untiered sponsors behave like silver
};
const TIER_DURATION_MS: Record<Exclude<SponsorTier, null> | "default", number> = {
  platinum: 20_000,
  gold: 18_000,
  silver: 12_000,
  bronze: 8_000,
  default: 12_000,
};
const tierKey = (t: SponsorTier): keyof typeof TIER_WEIGHT =>
  t && t in TIER_WEIGHT ? (t as keyof typeof TIER_WEIGHT) : "default";

interface AppAdLite {
  id: string;
  name: string;
  image_url: string | null;
  link_url: string | null;
  description: string | null;
  ad_type: "image" | "logo_text";
  logo_url: string | null;
  headline: string | null;
}

/**
 * Slim sponsor/ad strip rendered at the top of a chat thread.
 *
 * - Renders nothing unless:
 *   1. A `clubId` is provided.
 *   2. The owning club has `chat_thread_ads_enabled = true`.
 *   3. The app-level `app_ad_settings` row for `chat-thread` is enabled.
 *   4. There's a sponsor (Pro club) or app ad (Free club) to show.
 *
 * Pro club  → shows one of the club's active sponsors (compact row).
 * Free club → shows the next active app ad (compact row).
 *
 * Lives as a sibling ABOVE the Virtuoso scroller — never inside it, never sticky,
 * never blurred. Zero impact on chat virtualisation.
 */
export function ChatThreadSponsorStrip({ clubId }: ChatThreadSponsorStripProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { trackView: trackSponsorView, trackClick: trackSponsorClick } = useSponsorAnalytics();
  const { trackView: trackAdView, trackClick: trackAdClick } = useAdAnalytics();
  const [adIndex, setAdIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  // Load dismissal state (Pro-only feature, but we read it whenever clubId/user changes)
  useEffect(() => {
    if (!clubId) return;
    try {
      const raw = localStorage.getItem(dismissKey(user?.id, clubId));
      if (!raw) {
        setDismissed(false);
        return;
      }
      const ts = parseInt(raw, 10);
      if (Number.isFinite(ts) && Date.now() - ts < DISMISS_TTL_MS) {
        setDismissed(true);
      } else {
        localStorage.removeItem(dismissKey(user?.id, clubId));
        setDismissed(false);
      }
    } catch {
      setDismissed(false);
    }
  }, [clubId, user?.id]);

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!clubId) return;
    try {
      localStorage.setItem(dismissKey(user?.id, clubId), String(Date.now()));
    } catch {
      // ignore quota errors
    }
    setDismissed(true);
  };

  // 1. Club-level opt-in
  const { data: clubFlag } = useQuery({
    queryKey: ["club-chat-thread-ads-enabled", clubId],
    enabled: !!clubId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clubs")
        .select("id, chat_thread_ads_enabled")
        .eq("id", clubId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const clubEnabled = !!clubFlag?.chat_thread_ads_enabled;

  // 2. App-level placement enabled?
  const { data: placementSettings } = useQuery({
    queryKey: ["app-ad-settings", "chat-thread"],
    enabled: clubEnabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_ad_settings")
        .select("is_enabled")
        .eq("location", "chat-thread")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const placementEnabled = !!placementSettings?.is_enabled;

  // 3. Is this club Pro?
  const { data: isProClub } = useQuery({
    queryKey: ["club-is-pro", clubId],
    enabled: clubEnabled && placementEnabled && !!clubId,
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

  // 4a. Pro path — fetch this club's active sponsors (with tier for weighted rotation)
  const { data: sponsors = [] } = useQuery({
    queryKey: ["chat-thread-strip-sponsors", clubId],
    enabled: clubEnabled && placementEnabled && isProClub === true,
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

  // 4b. Free path — fetch active app ads
  const { data: appAds = [] } = useQuery({
    queryKey: ["chat-thread-strip-app-ads"],
    enabled: clubEnabled && placementEnabled && isProClub === false,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_ads")
        .select("id, name, image_url, link_url, description, ad_type, logo_url, headline")
        .eq("is_active", true)
        .order("display_order", { ascending: true });
      if (error) throw error;
      return (data || []) as AppAdLite[];
    },
  });

  // Build a tier-weighted playlist of sponsor indices (higher tier appears more times).
  // Example: 1 gold + 1 bronze → [0,0,0,0,1] → gold shows 4× as often as bronze.
  const sponsorPlaylist = useMemo(() => {
    const out: number[] = [];
    sponsors.forEach((s, i) => {
      const w = TIER_WEIGHT[tierKey(s.tier)];
      for (let k = 0; k < w; k++) out.push(i);
    });
    return out;
  }, [sponsors]);

  // Pro rotation: weighted playlist + per-tier duration
  const [playlistPos, setPlaylistPos] = useState(0);
  useEffect(() => {
    setPlaylistPos(0);
  }, [sponsorPlaylist.length]);

  const sponsorIndex = sponsorPlaylist.length > 0
    ? sponsorPlaylist[playlistPos % sponsorPlaylist.length]
    : 0;
  const activeSponsor = useMemo(
    () => (isProClub && sponsors.length > 0 ? sponsors[sponsorIndex] : null),
    [isProClub, sponsors, sponsorIndex],
  );

  useEffect(() => {
    if (!isProClub || sponsorPlaylist.length <= 1 || !activeSponsor) return;
    const duration = TIER_DURATION_MS[tierKey(activeSponsor.tier)];
    const id = setTimeout(() => {
      setPlaylistPos((p) => (p + 1) % sponsorPlaylist.length);
    }, duration);
    return () => clearTimeout(id);
  }, [isProClub, sponsorPlaylist.length, playlistPos, activeSponsor]);

  // Free app-ad rotation: simple 12s
  useEffect(() => {
    if (isProClub !== false || appAds.length <= 1) return;
    const id = setInterval(() => {
      setAdIndex((i) => (i + 1) % appAds.length);
    }, 12_000);
    return () => clearInterval(id);
  }, [isProClub, appAds.length]);

  const activeAd = useMemo(
    () => (isProClub === false && appAds.length > 0 ? appAds[adIndex % appAds.length] : null),
    [isProClub, appAds, adIndex],
  );

  // Track impressions
  useEffect(() => {
    if (activeSponsor && user?.id) {
      trackSponsorView(activeSponsor.id, "messages_page");
    }
  }, [activeSponsor?.id, user?.id, trackSponsorView]);

  useEffect(() => {
    if (activeAd && user?.id) {
      trackAdView(activeAd.id, "messages_page");
    }
  }, [activeAd?.id, user?.id, trackAdView]);

  // Gate
  if (!clubId || !clubEnabled || !placementEnabled) return null;
  if (isProClub === undefined) return null; // still loading
  if (!activeSponsor && !activeAd) return null;
  // Pro clubs can dismiss the strip; free clubs cannot (app ads always show).
  if (isProClub && dismissed) return null;

  // Pro club: sponsor row
  if (activeSponsor) {
    const clickable = !!activeSponsor.website_url;
    const onClick = () => {
      if (!clickable) return;
      trackSponsorClick(activeSponsor.id, "messages_page");
      safeOpenUrl(activeSponsor.website_url!);
    };
    return (
      <div className="shrink-0 border-b bg-card flex items-center">
        <button
          type="button"
          onClick={onClick}
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

  // Free club: app ad row
  if (activeAd) {
    const clickable = !!activeAd.link_url;
    const onClick = () => {
      if (!clickable) return;
      trackAdClick(activeAd.id, "messages_page");
      openAdLink(activeAd.link_url, navigate, { clubId });
    };
    return (
      <div className="shrink-0 border-b bg-card">
        <button
          type="button"
          onClick={onClick}
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
