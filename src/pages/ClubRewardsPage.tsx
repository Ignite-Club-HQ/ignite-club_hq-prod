import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import ClubRewardsManager from "@/components/ClubRewardsManager";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export default function ClubRewardsPage() {
  const { clubId } = useParams<{ clubId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  // Fetch club subscription
  const { data: clubSubscription, isLoading: isLoadingSub } = useQuery({
    queryKey: ["club-subscription", clubId],
    queryFn: async () => {
      const { data } = await supabase
        .from("club_subscriptions")
        .select("*")
        .eq("club_id", clubId!)
        .maybeSingle();
      return data;
    },
    enabled: !!clubId,
  });

  // Check if app admin
  const { data: isAppAdmin } = useQuery({
    queryKey: ["is-app-admin", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .eq("role", "app_admin")
        .maybeSingle();
      return !!data;
    },
    enabled: !!user,
  });

  const hasPro = isAppAdmin || clubSubscription?.is_pro || clubSubscription?.is_pro_football || 
                 clubSubscription?.admin_pro_override || clubSubscription?.admin_pro_football_override;

  if (!clubId) {
    return null;
  }

  // Show locked state for non-Pro users
  if (!isLoadingSub && !hasPro) {
    return (
      <div className="container max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(`/clubs/${clubId}`)}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-semibold">Manage Rewards</h1>
        </div>
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <div className="p-4 rounded-full bg-muted mb-4">
              <Lock className="h-8 w-8 text-muted-foreground" />
            </div>
            <h2 className="text-lg font-semibold mb-2">Pro Feature</h2>
            <p className="text-muted-foreground mb-4 max-w-sm">
              Rewards management is available with a Pro subscription. Upgrade to unlock this feature.
            </p>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">Pro Only</Badge>
            </div>
            <Button 
              className="mt-4"
              onClick={() => navigate(`/clubs/${clubId}/upgrade`)}
            >
              Upgrade to Pro
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container max-w-2xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate(`/clubs/${clubId}`)}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-xl font-semibold">Manage Rewards</h1>
      </div>
      <ClubRewardsManager clubId={clubId} />
    </div>
  );
}
