import { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PrimarySponsorDisplay } from "@/components/PrimarySponsorDisplay";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

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

  // Fetch sponsors for this club (club primary sponsor + team allocations)
  const { data: sponsors = [] } = useQuery({
    queryKey: ["club-section-sponsors", clubId, user?.id],
    queryFn: async () => {
      if (!clubId) return [];

      const sponsorItems: SponsorItem[] = [];
      const seenSponsorIds = new Set<string>();

      // 1. Get club name and primary sponsor
      const { data: club } = await supabase
        .from("clubs")
        .select("id, name, primary_sponsor_id")
        .eq("id", clubId)
        .single();

      if (!club) return [];

      if (club.primary_sponsor_id) {
        seenSponsorIds.add(club.primary_sponsor_id);
        sponsorItems.push({
          id: `club-${club.id}-${club.primary_sponsor_id}`,
          sponsorId: club.primary_sponsor_id,
          entityName: club.name,
        });
      }

      // 2. Get user's teams in this club
      const { data: userTeamRoles } = await supabase
        .from("user_roles")
        .select("team_id, teams!user_roles_team_id_fkey(id, name, club_id)")
        .eq("user_id", user!.id)
        .not("team_id", "is", null);

      const teamMap = new Map<string, string>(); // teamId -> teamName
      userTeamRoles?.forEach((role) => {
        if (role.teams?.club_id === clubId) {
          teamMap.set(role.teams.id, role.teams.name);
        }
      });

      // 3. Get team sponsor allocations for user's teams in this club
      if (teamMap.size > 0) {
        const { data: teamAllocations } = await supabase
          .from("team_sponsor_allocations")
          .select("team_id, sponsor_id, sponsors!inner(is_active)")
          .in("team_id", Array.from(teamMap.keys()));

        teamAllocations?.forEach((allocation: any) => {
          if (allocation.sponsors?.is_active && !seenSponsorIds.has(allocation.sponsor_id)) {
            seenSponsorIds.add(allocation.sponsor_id);
            const teamName = teamMap.get(allocation.team_id);
            if (teamName) {
              sponsorItems.push({
                id: `team-${allocation.team_id}-${allocation.sponsor_id}`,
                sponsorId: allocation.sponsor_id,
                entityName: `${club.name} ${teamName}`,
              });
            }
          }
        });
      }

      return sponsorItems;
    },
    enabled: !!clubId && !!user?.id,
  });

  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: true });

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
        <div className="overflow-hidden cursor-grab active:cursor-grabbing" ref={emblaRef}>
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
