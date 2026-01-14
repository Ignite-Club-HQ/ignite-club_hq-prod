import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ExternalLink } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useSponsorAnalytics } from "@/hooks/useSponsorAnalytics";

interface Sponsor {
  id: string;
  name: string;
  logo_url: string | null;
  website_url: string | null;
  description: string | null;
}

interface PrimarySponsorDisplayProps {
  sponsorId: string | null;
  variant?: "compact" | "full";
  context?: "club_page" | "team_page" | "club_card" | "event_page" | "event_card" | "home_page" | "messages_page";
  entityName?: string;
}

export function PrimarySponsorDisplay({ sponsorId, variant = "compact", context = "club_page", entityName }: PrimarySponsorDisplayProps) {
  const { trackView, trackClick } = useSponsorAnalytics();
  
  const { data: sponsor, isLoading } = useQuery({
    queryKey: ["sponsor", sponsorId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sponsors")
        .select("id, name, logo_url, website_url, description")
        .eq("id", sponsorId!)
        .single();
      if (error) throw error;
      return data as Sponsor;
    },
    enabled: !!sponsorId,
  });

  // Track view when sponsor is displayed
  useEffect(() => {
    if (sponsor?.id) {
      trackView(sponsor.id, context);
    }
  }, [sponsor?.id, context, trackView]);

  if (!sponsorId || isLoading || !sponsor) {
    return null;
  }

  const handleClick = () => {
    trackClick(sponsor.id, context);
  };

  if (variant === "compact") {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 border">
        <span className="text-xs text-muted-foreground">
          {entityName ? `Proud sponsor of ${entityName}` : "Sponsored by"}
        </span>
        <Avatar className="h-5 w-5">
          <AvatarImage src={sponsor.logo_url || undefined} />
          <AvatarFallback className="text-[10px] bg-secondary">
            {sponsor.name.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <span className="text-sm font-medium">{sponsor.name}</span>
        {sponsor.website_url && (
          <a 
            href={sponsor.website_url}
            onClick={(e) => { e.stopPropagation(); handleClick(); }}
            target="_blank" 
            rel="noopener noreferrer"
            className="ml-auto text-muted-foreground hover:text-primary transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="p-4 rounded-xl bg-gradient-to-r from-primary/5 to-primary/10 border border-primary/20">
      <div className="flex items-center gap-4">
        <Avatar className="h-14 w-14 border-2 border-primary/20">
          <AvatarImage src={sponsor.logo_url || undefined} />
          <AvatarFallback className="text-lg bg-primary/10 text-primary">
            {sponsor.name.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
            {entityName ? `Proud Sponsor of ${entityName}` : "Proud Sponsor"}
          </p>
          <h3 className="font-semibold text-lg truncate">{sponsor.name}</h3>
          {sponsor.description && (
            <p className="text-sm text-muted-foreground line-clamp-1 mt-0.5">{sponsor.description}</p>
          )}
        </div>
        {sponsor.website_url && (
          <a 
            href={sponsor.website_url} 
            target="_blank" 
            rel="noopener noreferrer"
            className="shrink-0 p-2 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
            onClick={(e) => { e.stopPropagation(); handleClick(); }}
          >
            <ExternalLink className="h-5 w-5" />
          </a>
        )}
      </div>
    </div>
  );
}
