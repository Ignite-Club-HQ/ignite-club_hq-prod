import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { Building2, Loader2 } from "lucide-react";
import { Label } from "@/components/ui/label";

interface Sponsor {
  id: string;
  name: string;
  logo_url: string | null;
}

interface TeamSponsorAllocatorProps {
  teamId: string;
  clubId: string;
}

export function TeamSponsorAllocator({ teamId, clubId }: TeamSponsorAllocatorProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch all active sponsors for the club
  const { data: sponsors = [], isLoading: loadingSponsors } = useQuery({
    queryKey: ["sponsors", clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sponsors")
        .select("id, name, logo_url")
        .eq("club_id", clubId)
        .eq("is_active", true)
        .order("display_order", { ascending: true });
      
      if (error) throw error;
      return data as Sponsor[];
    },
  });

  // Fetch current allocations for this team
  const { data: allocations = [], isLoading: loadingAllocations } = useQuery({
    queryKey: ["team-sponsor-allocations", teamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("team_sponsor_allocations")
        .select("sponsor_id")
        .eq("team_id", teamId);
      
      if (error) throw error;
      return data.map(a => a.sponsor_id);
    },
  });

  const toggleAllocationMutation = useMutation({
    mutationFn: async ({ sponsorId, allocated }: { sponsorId: string; allocated: boolean }) => {
      if (allocated) {
        // Add allocation
        const { error } = await supabase
          .from("team_sponsor_allocations")
          .insert({ team_id: teamId, sponsor_id: sponsorId });
        if (error) throw error;
      } else {
        // Remove allocation
        const { error } = await supabase
          .from("team_sponsor_allocations")
          .delete()
          .eq("team_id", teamId)
          .eq("sponsor_id", sponsorId);
        if (error) throw error;
        
        // If this was the active sponsor, clear it
        const { data: team } = await supabase
          .from("teams")
          .select("sponsor_id")
          .eq("id", teamId)
          .single();
        
        if (team?.sponsor_id === sponsorId) {
          await supabase
            .from("teams")
            .update({ sponsor_id: null })
            .eq("id", teamId);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-sponsor-allocations", teamId] });
      queryClient.invalidateQueries({ queryKey: ["team", teamId] });
      toast({ title: "Sponsor allocation updated" });
    },
    onError: (error) => {
      toast({ title: "Failed to update allocation", description: error.message, variant: "destructive" });
    },
  });

  const isLoading = loadingSponsors || loadingAllocations;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (sponsors.length === 0) {
    return (
      <Card>
        <CardContent className="py-4 text-center text-muted-foreground text-sm">
          <Building2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>No sponsors available</p>
          <p className="text-xs">Add sponsors in the club settings first</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Building2 className="h-4 w-4" />
          Allocate Sponsors to Team
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Select which sponsors the team admin can choose from
        </p>
        
        {sponsors.map((sponsor) => {
          const isAllocated = allocations.includes(sponsor.id);
          return (
            <div 
              key={sponsor.id} 
              className="flex items-center gap-3 p-3 rounded-lg border border-border"
            >
              <Checkbox
                id={`sponsor-${sponsor.id}`}
                checked={isAllocated}
                onCheckedChange={(checked) => 
                  toggleAllocationMutation.mutate({ 
                    sponsorId: sponsor.id, 
                    allocated: checked === true 
                  })
                }
                disabled={toggleAllocationMutation.isPending}
              />
              <Avatar className="h-10 w-10">
                <AvatarImage src={sponsor.logo_url || undefined} />
                <AvatarFallback className="bg-secondary text-sm">
                  {sponsor.name.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <Label 
                htmlFor={`sponsor-${sponsor.id}`}
                className="font-medium flex-1 cursor-pointer"
              >
                {sponsor.name}
              </Label>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
