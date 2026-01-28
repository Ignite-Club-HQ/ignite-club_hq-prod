import { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PrimarySponsorDisplay } from "@/components/PrimarySponsorDisplay";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface MessagesSponsorCarouselProps {
  activeClubFilter: string | null;
}

interface SponsorItem {
  id: string;
  sponsorId: string;
  entityName: string; // Club name or "Club Name Team Name"
}

export function MessagesSponsorCarousel({ activeClubFilter }: MessagesSponsorCarouselProps) {
  const { user } = useAuth();
  const [currentIndex, setCurrentIndex] = useState(0);

  // Fetch ALL active sponsors, showing team-allocated ones under team names
  const { data: sponsors = [] } = useQuery({
    queryKey: ["messages-all-sponsors", user?.id, activeClubFilter],
    queryFn: async () => {
      if (activeClubFilter) {
        // Filtered mode: show all active sponsors for this specific club
        const { data: club } = await supabase
          .from("clubs")
          .select("id, name")
          .eq("id", activeClubFilter)
          .maybeSingle();

        if (!club) return [];

        const { data: clubSponsors } = await supabase
          .from("sponsors")
          .select("id, name, is_active")
          .eq("club_id", activeClubFilter)
          .eq("is_active", true)
          .order("name");

        if (!clubSponsors || clubSponsors.length === 0) return [];

        // Fetch team allocations
        const { data: allocations } = await supabase
          .from("team_sponsor_allocations")
          .select("sponsor_id, team_id, teams!team_sponsor_allocations_team_id_fkey(id, name)")
          .in("sponsor_id", clubSponsors.map(s => s.id));

        const sponsorTeamMap = new Map<string, string[]>();
        allocations?.forEach((alloc) => {
          if (alloc.teams?.name) {
            const existing = sponsorTeamMap.get(alloc.sponsor_id) || [];
            existing.push(alloc.teams.name);
            sponsorTeamMap.set(alloc.sponsor_id, existing);
          }
        });

        const result: SponsorItem[] = [];
        clubSponsors.forEach((sponsor) => {
          const teamNames = sponsorTeamMap.get(sponsor.id);
          if (teamNames && teamNames.length > 0) {
            teamNames.forEach((teamName) => {
              result.push({
                id: `club-${club.id}-${sponsor.id}-team-${teamName}`,
                sponsorId: sponsor.id,
                entityName: teamName,
              });
            });
          } else {
            result.push({
              id: `club-${club.id}-${sponsor.id}`,
              sponsorId: sponsor.id,
              entityName: club.name,
            });
          }
        });

        return result;
      } else {
        // No filter: show all active sponsors from all user's clubs
        const { data: roles } = await supabase
          .from("user_roles")
          .select(`
            club_id,
            team_id,
            teams!user_roles_team_id_fkey(id, name, club_id)
          `)
          .eq("user_id", user!.id);

        if (!roles) return [];

        // Collect unique club IDs
        const clubIds = new Set<string>();
        roles.forEach((role) => {
          if (role.club_id) clubIds.add(role.club_id);
          if (role.teams?.club_id) clubIds.add(role.teams.club_id);
        });

        if (clubIds.size === 0) return [];

        // Fetch all clubs for name lookup
        const { data: clubs } = await supabase
          .from("clubs")
          .select("id, name")
          .in("id", Array.from(clubIds));

        const clubNameMap = new Map<string, string>();
        clubs?.forEach((club) => clubNameMap.set(club.id, club.name));

        // Fetch ALL active sponsors for these clubs
        const { data: allSponsors } = await supabase
          .from("sponsors")
          .select("id, name, club_id, is_active")
          .in("club_id", Array.from(clubIds))
          .eq("is_active", true)
          .order("name");

        if (!allSponsors || allSponsors.length === 0) return [];

        // Fetch team allocations
        const { data: allocations } = await supabase
          .from("team_sponsor_allocations")
          .select("sponsor_id, team_id, teams!team_sponsor_allocations_team_id_fkey(id, name)")
          .in("sponsor_id", allSponsors.map(s => s.id));

        const sponsorTeamMap = new Map<string, string[]>();
        allocations?.forEach((alloc) => {
          if (alloc.teams?.name) {
            const existing = sponsorTeamMap.get(alloc.sponsor_id) || [];
            existing.push(alloc.teams.name);
            sponsorTeamMap.set(alloc.sponsor_id, existing);
          }
        });

        const result: SponsorItem[] = [];
        allSponsors.forEach((sponsor) => {
          const teamNames = sponsorTeamMap.get(sponsor.id);
          const clubName = clubNameMap.get(sponsor.club_id) || "";
          
          if (teamNames && teamNames.length > 0) {
            teamNames.forEach((teamName) => {
              result.push({
                id: `sponsor-${sponsor.id}-team-${teamName}`,
                sponsorId: sponsor.id,
                entityName: teamName,
              });
            });
          } else {
            result.push({
              id: `sponsor-${sponsor.id}`,
              sponsorId: sponsor.id,
              entityName: clubName,
            });
          }
        });

        return result;
      }
    },
    enabled: !!user?.id,
    staleTime: 300000,
  });

  const [emblaRef, emblaApi] = useEmblaCarousel({ 
    loop: true,
    dragFree: false,
    watchDrag: true,
  });

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setCurrentIndex(emblaApi.selectedScrollSnap());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    emblaApi.on("select", onSelect);
    return () => {
      emblaApi.off("select", onSelect);
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

  if (sponsors.length === 0) {
    return null;
  }

  // Single sponsor - no navigation needed
  if (sponsors.length === 1) {
    return (
      <section className="space-y-3 mt-6">
        <PrimarySponsorDisplay
          sponsorId={sponsors[0].sponsorId}
          variant="full"
          context="messages_page"
          entityName={sponsors[0].entityName}
        />
      </section>
    );
  }

  return (
    <section className="space-y-3 mt-6">
      <div className="relative group">
        <div className="overflow-hidden cursor-grab active:cursor-grabbing touch-pan-y" ref={emblaRef}>
          <div className="flex">
            {sponsors.map((sponsor) => (
              <div key={sponsor.id} className="flex-[0_0_100%] min-w-0">
                <PrimarySponsorDisplay
                  sponsorId={sponsor.sponsorId}
                  variant="full"
                  context="messages_page"
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
