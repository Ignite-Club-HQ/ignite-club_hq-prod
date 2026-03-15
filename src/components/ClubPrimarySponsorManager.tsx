import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Building2, RefreshCw, Check, Loader2 } from "lucide-react";
import { SponsorTier, TIER_CONFIG, selectWeightedSponsor } from "@/lib/sponsorTiers";

interface Sponsor {
  id: string;
  name: string;
  logo_url: string | null;
  is_active: boolean;
  tier: SponsorTier | null;
  exposure_percentage: number | null;
}

interface ClubPrimarySponsorManagerProps {
  clubId: string;
  currentPrimarySponsorId: string | null;
  onUpdate?: () => void;
}

export function ClubPrimarySponsorManager({ 
  clubId, 
  currentPrimarySponsorId,
  onUpdate 
}: ClubPrimarySponsorManagerProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [autoRotate, setAutoRotate] = useState(false);

  // Fetch available sponsors for this club
  const { data: sponsors = [], isLoading } = useQuery({
    queryKey: ["sponsors", clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sponsors")
        .select("id, name, logo_url, is_active, tier, exposure_percentage")
        .eq("club_id", clubId)
        .eq("is_active", true)
        .order("display_order", { ascending: true });
      
      if (error) throw error;
      return data as Sponsor[];
    },
  });

  const updatePrimarySponsorMutation = useMutation({
    mutationFn: async (sponsorId: string | null) => {
      const { error } = await supabase
        .from("clubs")
        .update({ primary_sponsor_id: sponsorId })
        .eq("id", clubId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      // Invalidate all sponsor-related queries so home page updates immediately
      queryClient.invalidateQueries({ queryKey: ["club", clubId] });
      queryClient.invalidateQueries({ queryKey: ["user-allocated-sponsors"] });
      queryClient.invalidateQueries({ queryKey: ["club-section-sponsors", clubId] });
      queryClient.invalidateQueries({ queryKey: ["user-has-sponsors"] });
      queryClient.invalidateQueries({ queryKey: ["sponsor"] });
      onUpdate?.();
      toast({ title: "Primary sponsor updated" });
    },
    onError: (error) => {
      toast({ title: "Failed to update sponsor", description: error.message, variant: "destructive" });
    },
  });

  const rotateSponsor = () => {
    if (sponsors.length === 0) return;
    
    // Use weighted selection, excluding current primary
    const candidates = sponsors.filter(s => s.id !== currentPrimarySponsorId);
    if (candidates.length === 0) return;
    
    const selected = selectWeightedSponsor(candidates);
    if (selected) {
      updatePrimarySponsorMutation.mutate(selected.id);
    }
  };

  // Auto-rotate on mount if enabled (simulates rotation on page load)
  useEffect(() => {
    if (autoRotate && sponsors.length > 1) {
      rotateSponsor();
    }
  }, [autoRotate]);

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
          <p>No active sponsors available</p>
          <p className="text-xs">Add sponsors in the Sponsors section first</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            Primary Club Sponsor
          </CardTitle>
          {sponsors.length > 1 && (
            <Button
              variant="outline"
              size="sm"
              onClick={rotateSponsor}
              disabled={updatePrimarySponsorMutation.isPending}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${updatePrimarySponsorMutation.isPending ? 'animate-spin' : ''}`} />
              Rotate
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!currentPrimarySponsorId && (
          <p className="text-sm text-muted-foreground mb-2">
            Select a sponsor to display prominently on the club page
          </p>
        )}
        
        {sponsors.map((sponsor) => {
          const isSelected = sponsor.id === currentPrimarySponsorId;
          return (
            <div 
              key={sponsor.id} 
              className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                isSelected 
                  ? "border-primary bg-primary/5 ring-1 ring-primary" 
                  : "border-border hover:border-primary/50 hover:bg-muted/50"
              }`}
              onClick={() => updatePrimarySponsorMutation.mutate(isSelected ? null : sponsor.id)}
            >
              <Avatar className="h-10 w-10">
                <AvatarImage src={sponsor.logo_url || undefined} />
                <AvatarFallback className="bg-secondary text-sm">
                  {sponsor.name.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="font-medium flex-1">{sponsor.name}</span>
              {sponsor.tier && (
                <Badge 
                  variant="outline" 
                  className={`text-[10px] rounded-md ${TIER_CONFIG[sponsor.tier].bgColor} ${TIER_CONFIG[sponsor.tier].textColor} border-transparent`}
                >
                  {TIER_CONFIG[sponsor.tier].label}
                </Badge>
              )}
              {isSelected && (
                <Badge variant="default" className="gap-1">
                  <Check className="h-3 w-3" />
                  Active
                </Badge>
              )}
            </div>
          );
        })}

        {sponsors.length > 1 && (
          <div className="flex items-center justify-between pt-3 border-t">
            <Label htmlFor="auto-rotate" className="text-sm text-muted-foreground">
              Auto-rotate on page load
            </Label>
            <Switch
              id="auto-rotate"
              checked={autoRotate}
              onCheckedChange={setAutoRotate}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
