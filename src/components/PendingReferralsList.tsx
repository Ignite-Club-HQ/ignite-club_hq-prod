import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X, Loader2, UserPlus, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

interface PendingReferralsListProps {
  teamId: string;
  isAdmin: boolean;
}

export default function PendingReferralsList({ teamId, isAdmin }: PendingReferralsListProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: referrals = [] } = useQuery({
    queryKey: ["pending-referrals", teamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("member_referrals" as any)
        .select("*")
        .eq("team_id", teamId)
        .eq("status", "pending")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data || []) as any[];
    },
  });

  // Fetch referrer names
  const referrerIds = [...new Set(referrals.map((r: any) => r.referred_by))];
  const { data: referrerProfiles = [] } = useQuery({
    queryKey: ["referrer-profiles", referrerIds],
    enabled: referrerIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", referrerIds);
      return data || [];
    },
  });

  const referrerNameMap = Object.fromEntries(
    referrerProfiles.map((p: any) => [p.id, p.display_name || "Unknown"])
  );

  const approveMutation = useMutation({
    mutationFn: async (referralId: string) => {
      const { error } = await supabase
        .from("member_referrals" as any)
        .update({
          status: "approved",
          reviewed_by: user!.id,
          reviewed_at: new Date().toISOString(),
        } as any)
        .eq("id", referralId);
      if (error) throw error;
    },
    onSuccess: (_, referralId) => {
      const referral = referrals.find((r: any) => r.id === referralId);
      toast({ title: `Approved referral for ${referral?.referred_name || "member"}` });
      queryClient.invalidateQueries({ queryKey: ["pending-referrals", teamId] });
    },
    onError: () => {
      toast({ title: "Failed to approve referral", variant: "destructive" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (referralId: string) => {
      const { error } = await supabase
        .from("member_referrals" as any)
        .update({
          status: "rejected",
          reviewed_by: user!.id,
          reviewed_at: new Date().toISOString(),
        } as any)
        .eq("id", referralId);
      if (error) throw error;
    },
    onSuccess: (_, referralId) => {
      const referral = referrals.find((r: any) => r.id === referralId);
      toast({ title: `Declined referral for ${referral?.referred_name || "member"}` });
      queryClient.invalidateQueries({ queryKey: ["pending-referrals", teamId] });
    },
    onError: () => {
      toast({ title: "Failed to decline referral", variant: "destructive" });
    },
  });

  if (referrals.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <UserPlus className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Member Referrals</h3>
        <Badge variant="secondary" className="text-xs">
          {referrals.length}
        </Badge>
      </div>
      {referrals.map((referral: any) => (
        <Card key={referral.id} className="border-primary/20 bg-primary/[0.03]">
          <CardContent className="p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{referral.referred_name}</p>
                {referral.referred_email && (
                  <p className="text-xs text-muted-foreground truncate">{referral.referred_email}</p>
                )}
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                  <Clock className="h-3 w-3" />
                  Referred by {referrerNameMap[referral.referred_by] || "a member"}
                </p>
              </div>
              {isAdmin && (
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => rejectMutation.mutate(referral.id)}
                    disabled={rejectMutation.isPending || approveMutation.isPending}
                  >
                    {rejectMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                  </Button>
                  <Button
                    size="sm"
                    className="h-8 px-3"
                    onClick={() => approveMutation.mutate(referral.id)}
                    disabled={approveMutation.isPending || rejectMutation.isPending}
                  >
                    {approveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
                    Approve
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
