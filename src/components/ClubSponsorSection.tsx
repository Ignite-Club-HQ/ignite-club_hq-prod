import { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PrimarySponsorDisplay } from "@/components/PrimarySponsorDisplay";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { writeHomeSponsorHint } from "@/lib/homeSponsorHint";

interface ClubSponsorSectionProps {
  clubId: string | null;
}

interface SponsorItem {
  id: string;
  sponsorId: string;
  entityName: string;
}

export function ClubSponsorSection({ clubId }: ClubSponsorSectionProps) {
  const { user } = useAuth();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);

  // Fetch ALL active sponsors, showing team-allocated ones under team names
  const { data: sponsors = [] } = useQuery({
    queryKey: ["club-section-sponsors", clubId, user?.id],
    queryFn: async () => {
      if (!clubId) return [];

      // Pro-gate: free clubs can configure sponsors in the wizard/dashboard,
      // but they must NOT be displayed on the Home page until the club is on
      // an active Pro plan (or has an admin Pro override).
      const { data: subs } = await supabase
        .from("club_subscriptions")
        .select("is_pro, is_pro_football, admin_pro_override, admin_pro_football_override, expires_at")
        .eq("club_id", clubId)
        .maybeSingle();
      const now = Date.now();
      const notExpired = !subs?.expires_at || new Date(subs.expires_at).getTime() > now;
      const hasPro = !!subs && notExpired && (
        subs.is_pro || subs.is_pro_football || subs.admin_pro_override || subs.admin_pro_football_override
      );
      if (!hasPro) return [];

      // Get club name
      const { data: club } = await supabase
        .from("clubs")
        .select("id, name")
        .eq("id", clubId)
        .single();

      if (!club) return [];

      // Fetch all active sponsors for this club
      const { data: allSponsors } = await supabase
        .from("sponsors")
        .select("id, name, is_active")
        .eq("club_id", clubId)
        .eq("is_active", true)
        .order("name");

      if (!allSponsors || allSponsors.length === 0) return [];


      // Fetch team allocations with team names
      const { data: allocations } = await supabase
        .from("team_sponsor_allocations")
        .select("sponsor_id, team_id, teams!team_sponsor_allocations_team_id_fkey(id, name)")
        .in("sponsor_id", allSponsors.map(s => s.id));

      // Build a map of sponsor_id -> team names
      const sponsorTeamMap = new Map<string, string[]>();
      allocations?.forEach((alloc) => {
        if (alloc.teams?.name) {
          const existing = sponsorTeamMap.get(alloc.sponsor_id) || [];
          existing.push(alloc.teams.name);
          sponsorTeamMap.set(alloc.sponsor_id, existing);
        }
      });

      // Map sponsors: if allocated to teams, show under team name; otherwise show under club
      const result: SponsorItem[] = [];
      allSponsors.forEach((sponsor) => {
        const teamNames = sponsorTeamMap.get(sponsor.id);
        
        if (teamNames && teamNames.length > 0) {
          // Show once per team allocation
          teamNames.forEach((teamName) => {
            result.push({
              id: `club-${club.id}-${sponsor.id}-team-${teamName}`,
              sponsorId: sponsor.id,
              entityName: teamName,
            });
          });
        } else {
          // Club-level sponsor
          result.push({
            id: `club-${club.id}-${sponsor.id}`,
            sponsorId: sponsor.id,
            entityName: club.name,
          });
        }
      });

      return result;
    },
    enabled: !!clubId && !!user?.id,
  });

  // Persist a per-(user, club) hint so the home page can reserve the right
  // amount of vertical space on the next cold load and avoid a shift when
  // this section pops in after other content.
  useEffect(() => {
    if (!user?.id || !clubId) return;
    writeHomeSponsorHint(user.id, clubId, sponsors.length > 0 ? "has" : "none");
  }, [user?.id, clubId, sponsors.length]);


  const [emblaRef, emblaApi] = useEmblaCarousel({ 
    loop: true,
    dragFree: false,
    watchDrag: true,
  });

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setCurrentIndex(emblaApi.selectedScrollSnap());
    setCanScrollPrev(emblaApi.canScrollPrev());
    setCanScrollNext(emblaApi.canScrollNext());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    emblaApi.on("select", onSelect);
    emblaApi.on("reInit", onSelect);
    onSelect();
    return () => {
      emblaApi.off("select", onSelect);
      emblaApi.off("reInit", onSelect);
    };
  }, [emblaApi, onSelect]);

  // Auto-advance every 8 seconds
  useEffect(() => {
    if (sponsors.length <= 1 || !emblaApi) return;

    const interval = setInterval(() => {
      emblaApi.scrollNext();
    }, 8000);

    return () => clearInterval(interval);
  }, [sponsors.length, emblaApi]);

  if (!clubId || sponsors.length === 0) {
    return null;
  }

  // Single sponsor - no carousel needed
  if (sponsors.length === 1) {
    return (
      <section className="space-y-3">
        <PrimarySponsorDisplay
          sponsorId={sponsors[0].sponsorId}
          variant="full"
          context="home_page"
          entityName={sponsors[0].entityName}
        />
      </section>
    );
  }

  // Multiple sponsors - show carousel with navigation
  return (
    <section className="space-y-3">
      <div className="relative group">
        <div className="overflow-hidden cursor-grab active:cursor-grabbing touch-pan-y" ref={emblaRef}>
          <div className="flex">
            {sponsors.map((sponsor) => (
              <div key={sponsor.id} className="flex-[0_0_100%] min-w-0">
                <PrimarySponsorDisplay
                  sponsorId={sponsor.sponsorId}
                  variant="full"
                  context="home_page"
                  entityName={sponsor.entityName}
                />
              </div>
            ))}
          </div>
        </div>
        {/* Navigation arrows */}
        <Button
          variant="ghost"
          size="icon"
          className="absolute left-1 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-background/80 backdrop-blur-sm shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={() => emblaApi?.scrollPrev()}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-background/80 backdrop-blur-sm shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={() => emblaApi?.scrollNext()}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex justify-center gap-1.5">
        {sponsors.map((_, index) => (
          <button
            key={index}
            onClick={() => emblaApi?.scrollTo(index)}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              index === currentIndex
                ? "w-4 bg-primary"
                : "w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/50"
            }`}
            aria-label={`View sponsor ${index + 1}`}
          />
        ))}
      </div>
    </section>
  );
}
