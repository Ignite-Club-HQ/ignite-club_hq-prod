import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Building2 } from "lucide-react";
import { useSponsorAnalytics } from "@/hooks/useSponsorAnalytics";
import { SponsorTier, TIER_CONFIG, sortSponsorsByTier } from "@/lib/sponsorTiers";

interface Sponsor {
  id: string;
  name: string;
  logo_url: string | null;
  description: string | null;
  website_url: string | null;
  tier: SponsorTier | null;
  display_order: number;
}

interface EventSponsorsSectionProps {
  eventId: string;
  clubId: string;
}

export function EventSponsorsSection({ eventId, clubId }: EventSponsorsSectionProps) {
  const { trackView, trackClick } = useSponsorAnalytics();

  // Check if club has Pro access
  const { data: hasPro } = useQuery({
    queryKey: ["club-pro-status", clubId],
    queryFn: async () => {
      const { data } = await supabase
        .from("club_subscriptions")
        .select("is_pro, is_pro_football, expires_at")
        .eq("club_id", clubId)
        .single();
      
      if (!data) return false;
      return (data.is_pro || data.is_pro_football) && 
        (!data.expires_at || new Date(data.expires_at) > new Date());
    },
  });

  // Fetch event sponsors
  const { data: eventSponsors } = useQuery({
    queryKey: ["event-sponsors", eventId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("event_sponsors")
        .select(`
          sponsor_id,
          display_order,
          sponsors:sponsor_id (
            id,
            name,
            logo_url,
            description,
            website_url,
            tier,
            display_order
          )
        `)
        .eq("event_id", eventId)
        .order("display_order", { ascending: true });
      
      if (error) throw error;
      const sponsors = data?.map(es => es.sponsors).filter(Boolean) as Sponsor[];
      return sortSponsorsByTier(sponsors);
    },
    enabled: !!hasPro,
  });

  // Track views for all sponsors when displayed
  useEffect(() => {
    if (eventSponsors?.length) {
      eventSponsors.forEach(sponsor => {
        trackView(sponsor.id, "event_page");
      });
    }
  }, [eventSponsors, trackView]);

  // If no Pro access or no sponsors, don't render
  if (!hasPro || !eventSponsors?.length) {
    return null;
  }

  const handleSponsorClick = (sponsorId: string) => {
    trackClick(sponsorId, "event_page");
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Building2 className="h-4 w-4" />
          Sponsored by
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {eventSponsors.map((sponsor) => (
          <div key={sponsor.id} className="flex items-center gap-3">
            <Avatar className="h-10 w-10">
              <AvatarImage src={sponsor.logo_url || undefined} />
              <AvatarFallback className="bg-secondary text-sm">
                {sponsor.name.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">{sponsor.name}</p>
              {sponsor.description && (
                <p className="text-xs text-muted-foreground line-clamp-1">
                  {sponsor.description}
                </p>
              )}
            </div>
            {sponsor.website_url && (
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0"
                onClick={() => {
                  handleSponsorClick(sponsor.id);
                  import("@/lib/safeOpenUrl").then(({ safeOpenUrl }) => safeOpenUrl(sponsor.website_url!));
                }}
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
