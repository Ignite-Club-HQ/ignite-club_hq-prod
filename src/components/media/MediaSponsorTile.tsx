import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useSponsorAnalytics } from "@/hooks/useSponsorAnalytics";
import { safeOpenUrl } from "@/lib/safeOpenUrl";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";

// HARD RESTRICTION: only Riverside FC for this MVP.
// Triple-checked: gated here AND by the club admin toggle below AND by RLS on sponsors.
const RIVERSIDE_CLUB_ID = "36231b76-5313-478e-b8d5-23ac4f5e8b10";

type SponsorTier = "platinum" | "gold" | "silver" | "bronze" | null;

interface SponsorLite {
  id: string;
  name: string;
  logo_url: string | null;
  website_url: string | null;
  tier: SponsorTier;
}

const TIER_WEIGHT: Record<Exclude<SponsorTier, null> | "default", number> = {
  platinum: 6,
  gold: 4,
  silver: 2,
  bronze: 1,
  default: 2,
};
const tierKey = (t: SponsorTier): keyof typeof TIER_WEIGHT =>
  t && t in TIER_WEIGHT ? (t as keyof typeof TIER_WEIGHT) : "default";

/**
 * A photo-card-shaped sponsor tile injected into the Media feed.
 *
 * Restrictions (all must be true to render):
 *   1. Club is Riverside FC (hard-coded constant)
 *   2. clubs.media_sponsors_enabled === true (admin toggle, defaults to FALSE)
 *   3. At least one active sponsor exists for that club
 *
 * Selection is tier-weighted (platinum 6 > gold 4 > silver 2 > bronze 1).
 * One sponsor is chosen per render seed (stable per `seed` prop so the same
 * slot keeps the same sponsor on re-renders).
 */
export function MediaSponsorTile({ seed }: { seed: number }) {
  const { user } = useAuth();
  const { trackView, trackClick } = useSponsorAnalytics();

  // 1. Club-level opt-in toggle (defaults to FALSE in DB).
  const { data: clubFlag } = useQuery({
    queryKey: ["riverside-media-sponsors-enabled"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clubs")
        .select("id, media_sponsors_enabled")
        .eq("id", RIVERSIDE_CLUB_ID)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const enabled = !!clubFlag?.media_sponsors_enabled;

  // 2. Sponsors fetched only when toggle is on.
  const { data: sponsors = [] } = useQuery({
    queryKey: ["riverside-media-sponsors"],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sponsors")
        .select("id, name, logo_url, website_url, tier")
        .eq("club_id", RIVERSIDE_CLUB_ID)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data || []) as SponsorLite[];
    },
  });

  // Weighted random pick, stable per seed.
  const sponsor = useMemo<SponsorLite | null>(() => {
    if (sponsors.length === 0) return null;
    const playlist: number[] = [];
    sponsors.forEach((s, i) => {
      const w = TIER_WEIGHT[tierKey(s.tier)];
      for (let k = 0; k < w; k++) playlist.push(i);
    });
    if (playlist.length === 0) return sponsors[0];
    return sponsors[playlist[seed % playlist.length]];
  }, [sponsors, seed]);

  const [viewed, setViewed] = useState<string | null>(null);
  useEffect(() => {
    if (!sponsor || !user?.id) return;
    if (viewed === sponsor.id) return;
    trackView(sponsor.id, "messages_page");
    setViewed(sponsor.id);
  }, [sponsor, user?.id, viewed, trackView]);

  if (!enabled || !sponsor) return null;

  const clickable = !!sponsor.website_url;
  const handleClick = () => {
    if (!clickable) return;
    trackClick(sponsor.id, "messages_page");
    safeOpenUrl(sponsor.website_url!);
  };

  return (
    <Card className="overflow-hidden cv-auto-card border-x-0 sm:border-x rounded-none sm:rounded-lg">
      <button
        type="button"
        onClick={handleClick}
        disabled={!clickable}
        className={`w-full text-left ${clickable ? "cursor-pointer" : "cursor-default"}`}
      >
        <div className="flex items-center gap-2 px-3 pt-2 pb-1.5">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
            Club Sponsor
          </span>
        </div>
        <div className="flex items-center gap-3 px-3 pb-3">
          <Avatar className="h-14 w-14 shrink-0 rounded-md">
            <AvatarImage src={sponsor.logo_url || undefined} className="object-contain" />
            <AvatarFallback className="rounded-md bg-secondary text-base">
              {sponsor.name.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">{sponsor.name}</p>
            <p className="text-xs text-muted-foreground truncate">Proudly supporting Riverside FC</p>
          </div>
          {clickable && <ExternalLink className="h-4 w-4 text-muted-foreground shrink-0" />}
        </div>
      </button>
    </Card>
  );
}
