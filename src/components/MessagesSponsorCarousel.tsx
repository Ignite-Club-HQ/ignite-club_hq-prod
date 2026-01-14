import { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PrimarySponsorDisplay } from "@/components/PrimarySponsorDisplay";
import useEmblaCarousel from "embla-carousel-react";

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

  // Fetch only allocated sponsors (club primary sponsors + team sponsor allocations)
  const { data: sponsors = [] } = useQuery({
    queryKey: ["messages-allocated-sponsors", user?.id, activeClubFilter],
    queryFn: async () => {
      const sponsorItems: SponsorItem[] = [];
      const seenSponsorIds = new Set<string>();

      if (activeClubFilter) {
        // Filtered mode: show sponsors allocated to this club and its teams
        
        // 1. Get club primary sponsor
        const { data: club } = await supabase
          .from("clubs")
          .select("id, name, primary_sponsor_id")
          .eq("id", activeClubFilter)
          .maybeSingle();

        if (club?.primary_sponsor_id) {
          seenSponsorIds.add(club.primary_sponsor_id);
          sponsorItems.push({
            id: `club-${club.id}-${club.primary_sponsor_id}`,
            sponsorId: club.primary_sponsor_id,
            entityName: club.name,
          });
        }

        // 2. Get teams in this club that the user belongs to
        const { data: userTeamRoles } = await supabase
          .from("user_roles")
          .select("team_id, teams!user_roles_team_id_fkey(id, name, club_id)")
          .eq("user_id", user!.id)
          .not("team_id", "is", null);

        const teamMap = new Map<string, { teamName: string; clubName: string }>();
        userTeamRoles?.forEach((role) => {
          if (role.teams?.club_id === activeClubFilter) {
            teamMap.set(role.teams.id, { teamName: role.teams.name, clubName: club?.name || "" });
          }
        });

        // 3. Get team sponsor allocations for these teams
        if (teamMap.size > 0) {
          const { data: teamAllocations } = await supabase
            .from("team_sponsor_allocations")
            .select("team_id, sponsor_id, sponsors!inner(is_active)")
            .in("team_id", Array.from(teamMap.keys()));

          teamAllocations?.forEach((allocation: any) => {
            if (allocation.sponsors?.is_active && !seenSponsorIds.has(allocation.sponsor_id)) {
              seenSponsorIds.add(allocation.sponsor_id);
              const teamInfo = teamMap.get(allocation.team_id);
              if (teamInfo) {
                const entityName = teamInfo.clubName ? `${teamInfo.clubName} ${teamInfo.teamName}` : teamInfo.teamName;
                sponsorItems.push({
                  id: `team-${allocation.team_id}-${allocation.sponsor_id}`,
                  sponsorId: allocation.sponsor_id,
                  entityName,
                });
              }
            }
          });
        }
      } else {
        // No filter: show all allocated sponsors from user's clubs and teams
        const { data: roles } = await supabase
          .from("user_roles")
          .select(`
            club_id,
            team_id,
            teams!user_roles_team_id_fkey(id, name, club_id)
          `)
          .eq("user_id", user!.id);

        if (!roles) return [];

        // Collect unique club IDs and team info with club IDs
        const clubIds = new Set<string>();
        const teamMap = new Map<string, { teamName: string; clubId: string }>();

        roles.forEach((role) => {
          if (role.club_id) {
            clubIds.add(role.club_id);
          }
          if (role.team_id && role.teams) {
            teamMap.set(role.teams.id, { teamName: role.teams.name, clubId: role.teams.club_id });
            if (role.teams.club_id) {
              clubIds.add(role.teams.club_id);
            }
          }
        });

        if (clubIds.size === 0) return [];

        // 1. Fetch ALL clubs for name lookup (not just ones with sponsors)
        const { data: allClubs } = await supabase
          .from("clubs")
          .select("id, name, primary_sponsor_id")
          .in("id", Array.from(clubIds));

        // Build a club name lookup for team sponsors
        const clubNameMap = new Map<string, string>();
        allClubs?.forEach((club) => {
          clubNameMap.set(club.id, club.name);
        });

        // Add club primary sponsors
        allClubs?.forEach((club) => {
          if (club.primary_sponsor_id && !seenSponsorIds.has(club.primary_sponsor_id)) {
            seenSponsorIds.add(club.primary_sponsor_id);
            sponsorItems.push({
              id: `club-${club.id}-${club.primary_sponsor_id}`,
              sponsorId: club.primary_sponsor_id,
              entityName: club.name,
            });
          }
        });

        // 2. Fetch team sponsor allocations
        if (teamMap.size > 0) {
          const { data: teamAllocations } = await supabase
            .from("team_sponsor_allocations")
            .select("team_id, sponsor_id, sponsors!inner(is_active)")
            .in("team_id", Array.from(teamMap.keys()));

          teamAllocations?.forEach((allocation: any) => {
            if (allocation.sponsors?.is_active && !seenSponsorIds.has(allocation.sponsor_id)) {
              seenSponsorIds.add(allocation.sponsor_id);
              const teamInfo = teamMap.get(allocation.team_id);
              if (teamInfo) {
                const clubName = clubNameMap.get(teamInfo.clubId) || "";
                const entityName = clubName ? `${clubName} ${teamInfo.teamName}` : teamInfo.teamName;
                sponsorItems.push({
                  id: `team-${allocation.team_id}-${allocation.sponsor_id}`,
                  sponsorId: allocation.sponsor_id,
                  entityName,
                });
              }
            }
          });
        }
      }

      return sponsorItems;
    },
    enabled: !!user?.id,
    staleTime: 300000,
  });

  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: true });

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

  return (
    <section className="space-y-3 mt-6">
      <div className="overflow-hidden cursor-grab active:cursor-grabbing" ref={emblaRef}>
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
      {sponsors.length > 1 && (
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
      )}
    </section>
  );
}
