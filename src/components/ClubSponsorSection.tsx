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

  // Fetch ALL active sponsors for this club
  const { data: sponsors = [] } = useQuery({
    queryKey: ["club-section-sponsors", clubId, user?.id],
    queryFn: async () => {
      if (!clubId) return [];

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

      return (allSponsors || []).map((sponsor) => ({
        id: `club-${club.id}-${sponsor.id}`,
        sponsorId: sponsor.id,
        entityName: club.name,
      }));
    },
    enabled: !!clubId && !!user?.id,
  });

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
