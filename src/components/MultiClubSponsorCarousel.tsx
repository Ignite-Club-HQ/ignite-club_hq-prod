import { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PrimarySponsorDisplay } from "@/components/PrimarySponsorDisplay";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { writeHomeSponsorHint } from "@/lib/homeSponsorHint";

interface SponsorItem {
  id: string;
  sponsorId: string;
  entityName: string; // Club name or "Club Name Team Name"
}

export function MultiClubSponsorCarousel() {
  const { user } = useAuth();
  const [currentIndex, setCurrentIndex] = useState(0);

  // Fetch ALL active sponsors, showing team-allocated ones under team names
  const { data: allSponsors = [] } = useQuery({
    queryKey: ["user-all-sponsors", user?.id],
    queryFn: async () => {
      // Get all club IDs the user is linked to
      const { data: roles, error: rolesError } = await supabase
        .from("user_roles")
        .select(`
          club_id,
          team_id,
          teams!user_roles_team_id_fkey(id, name, club_id)
        `)
        .eq("user_id", user!.id);

      if (rolesError) throw rolesError;

      // Collect unique club IDs
      const clubIds = new Set<string>();
      roles?.forEach((role) => {
        if (role.club_id) clubIds.add(role.club_id);
        if (role.teams?.club_id) clubIds.add(role.teams.club_id);
      });

      if (clubIds.size === 0) return [];

      // Only include sponsors from clubs on an active Pro plan.
      // Free-plan clubs can configure sponsors but they must not display.
      const { data: subs } = await supabase
        .from("club_subscriptions")
        .select("club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override, expires_at")
        .in("club_id", Array.from(clubIds));

      const now = Date.now();
      const proClubIds = new Set<string>(
        (subs ?? [])
          .filter((s: any) => {
            const notExpired = !s.expires_at || new Date(s.expires_at).getTime() > now;
            return notExpired && (s.is_pro || s.is_pro_football || s.admin_pro_override || s.admin_pro_football_override);
          })
          .map((s: any) => s.club_id),
      );

      if (proClubIds.size === 0) return [];

      // Fetch all clubs for name lookup (Pro clubs only)
      const { data: clubs } = await supabase
        .from("clubs")
        .select("id, name")
        .in("id", Array.from(proClubIds));

      const clubNameMap = new Map<string, string>();
      clubs?.forEach((club) => clubNameMap.set(club.id, club.name));

      // Fetch ALL active sponsors for Pro clubs only
      const { data: sponsors } = await supabase
        .from("sponsors")
        .select("id, name, club_id, is_active")
        .in("club_id", Array.from(proClubIds))
        .eq("is_active", true)
        .order("name");

      if (!sponsors || sponsors.length === 0) return [];

      // Fetch team allocations with team names
      const { data: allocations } = await supabase
        .from("team_sponsor_allocations")
        .select("sponsor_id, team_id, teams!team_sponsor_allocations_team_id_fkey(id, name)")
        .in("sponsor_id", sponsors.map(s => s.id));

      // Build a map of sponsor_id -> team names (a sponsor can be allocated to multiple teams)
      const sponsorTeamMap = new Map<string, string[]>();
      allocations?.forEach((alloc) => {
        if (alloc.teams?.name) {
          const existing = sponsorTeamMap.get(alloc.sponsor_id) || [];
          existing.push(alloc.teams.name);
          sponsorTeamMap.set(alloc.sponsor_id, existing);
        }
      });

      // Map sponsors: if allocated to teams, show under each team; otherwise show under club
      const result: SponsorItem[] = [];
      sponsors.forEach((sponsor) => {
        const teamNames = sponsorTeamMap.get(sponsor.id);
        const clubName = clubNameMap.get(sponsor.club_id) || "";
        
        if (teamNames && teamNames.length > 0) {
          // Show once per team allocation
          teamNames.forEach((teamName) => {
            result.push({
              id: `sponsor-${sponsor.id}-team-${teamName}`,
              sponsorId: sponsor.id,
              entityName: teamName,
            });
          });
        } else {
          // Club-level sponsor
          result.push({
            id: `sponsor-${sponsor.id}`,
            sponsorId: sponsor.id,
            entityName: clubName,
          });
        }
      });

      return result;
    },
    enabled: !!user?.id,
  });

  // Persist a hint so the home page can reserve the right amount of vertical
  // space on the *next* cold load — prevents this tile from popping in later
  // and pushing surrounding sections down.
  useEffect(() => {
    if (!user?.id) return;
    writeHomeSponsorHint(user.id, null, allSponsors.length > 0 ? "has" : "none");
  }, [user?.id, allSponsors.length]);

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
    if (allSponsors.length <= 1 || !emblaApi) return;

    const interval = setInterval(() => {
      emblaApi.scrollNext();
    }, 8000);

    return () => clearInterval(interval);
  }, [allSponsors.length, emblaApi]);

  if (allSponsors.length === 0) {
    return null;
  }

  // Single sponsor - no navigation needed
  if (allSponsors.length === 1) {
    return (
      <section className="space-y-3">
        <PrimarySponsorDisplay
          sponsorId={allSponsors[0].sponsorId}
          variant="full"
          context="home_page"
          entityName={allSponsors[0].entityName}
        />
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div className="relative group">
        <div className="overflow-hidden cursor-grab active:cursor-grabbing touch-pan-y" ref={emblaRef}>
          <div className="flex">
            {allSponsors.map((sponsor) => (
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
        {allSponsors.map((_, index) => (
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
