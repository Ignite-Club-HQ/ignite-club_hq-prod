import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, CreditCard, X, Loader2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

interface Member {
  profile: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
  roles: { id: string; role: string }[];
}

interface MemberSubscriptionPaymentsManagerProps {
  clubId: string;
  teamId?: string;
  members: Record<string, Member>;
  isAdmin?: boolean;
}

export default function MemberSubscriptionPaymentsManager({
  clubId,
  teamId,
  members,
  isAdmin = false,
}: MemberSubscriptionPaymentsManagerProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [selectedMember, setSelectedMember] = useState<{
    userId: string;
    displayName: string;
  } | null>(null);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [paymentPeriod, setPaymentPeriod] = useState(new Date().getFullYear().toString());
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [deletePaymentId, setDeletePaymentId] = useState<string | null>(null);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);

  // Get current year for default period
  const currentYear = new Date().getFullYear();

  // Fetch payments for all members in this context
  const memberIds = Object.keys(members);
  
  const { data: payments = [], isLoading: isPaymentsLoading } = useQuery({
    queryKey: ["member-subscription-payments", clubId, memberIds.join(","), paymentPeriod],
    queryFn: async () => {
      if (memberIds.length === 0) return [];
      const { data, error } = await supabase
        .from("member_subscription_payments")
        .select("*")
        .eq("club_id", clubId)
        .eq("payment_period", paymentPeriod)
        .in("user_id", memberIds);
      if (error) throw error;
      return data || [];
    },
    enabled: memberIds.length > 0,
  });

  // Fetch club subscription for member payment settings
  const { data: clubSubscription } = useQuery({
    queryKey: ["club-subscription", clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("club_subscriptions")
        .select("member_payments_enabled, member_subscription_amount")
        .eq("club_id", clubId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Check if current user has paid
  const currentUserPayment = payments.find(p => p.user_id === user?.id);
  const canPayOnline = clubSubscription?.member_payments_enabled && 
    clubSubscription?.member_subscription_amount && 
    clubSubscription.member_subscription_amount > 0;

  // Create a map of user_id -> payment record for quick lookup
  const paymentMap = payments.reduce((acc, payment) => {
    acc[payment.user_id] = payment;
    return acc;
  }, {} as Record<string, typeof payments[0]>);

  const markPaidMutation = useMutation({
    mutationFn: async () => {
      if (!selectedMember) return;
      const { error } = await supabase.from("member_subscription_payments").insert({
        user_id: selectedMember.userId,
        club_id: clubId,
        payment_period: paymentPeriod,
        amount: amount ? parseFloat(amount) : null,
        notes: notes.trim() || null,
        marked_by: user!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["member-subscription-payments", clubId] });
      setPaymentDialogOpen(false);
      setSelectedMember(null);
      setAmount("");
      setNotes("");
      toast({ title: "Payment marked" });
    },
    onError: (error: any) => {
      if (error.code === "23505") {
        toast({ title: "Already marked as paid for this period", variant: "destructive" });
      } else {
        toast({ title: "Failed to mark payment", variant: "destructive" });
      }
    },
  });

  const deletePaymentMutation = useMutation({
    mutationFn: async (paymentId: string) => {
      const { error } = await supabase
        .from("member_subscription_payments")
        .delete()
        .eq("id", paymentId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["member-subscription-payments", clubId] });
      setDeletePaymentId(null);
      toast({ title: "Payment record removed" });
    },
    onError: () => {
      toast({ title: "Failed to remove payment", variant: "destructive" });
    },
  });

  const handleMemberClick = (userId: string, displayName: string) => {
    if (!isAdmin) return;
    
    const existingPayment = paymentMap[userId];
    if (existingPayment) {
      // Show option to remove payment
      setDeletePaymentId(existingPayment.id);
    } else {
      // Open dialog to mark as paid
      setSelectedMember({ userId, displayName });
      setPaymentDialogOpen(true);
    }
  };

  const handlePayOnline = async () => {
    if (!user || !canPayOnline) return;
    
    setIsProcessingPayment(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-member-payment-checkout", {
        body: {
          clubId,
          paymentPeriod,
          successUrl: `${window.location.origin}/teams/${teamId || ""}?payment=success`,
          cancelUrl: `${window.location.origin}/teams/${teamId || ""}?payment=cancelled`,
        },
      });

      if (error) throw error;
      if (data?.url) {
        window.location.href = data.url;
      } else {
        throw new Error("No checkout URL returned");
      }
    } catch (error: any) {
      toast({ 
        title: "Failed to start payment", 
        description: error.message || "Please try again",
        variant: "destructive" 
      });
    } finally {
      setIsProcessingPayment(false);
    }
  };

  // Filter to only show players and parents (not admins/coaches for payment tracking)
  const payableMembers = Object.entries(members).filter(([_, member]) => {
    const roles = member.roles?.map(r => r.role) || [];
    return roles.some(r => ["player", "parent"].includes(r));
  });

  const paidCount = payableMembers.filter(([userId]) => paymentMap[userId]).length;
  const unpaidCount = payableMembers.length - paidCount;

  // Check if current user is in payable members
  const isPayableMember = user && payableMembers.some(([userId]) => userId === user.id);
  const hasCurrentUserPaid = !!currentUserPayment;

  if (payableMembers.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <CreditCard className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No players or parents to track payments for</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Period Selector and Summary */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Label htmlFor="payment-period" className="text-sm text-muted-foreground whitespace-nowrap">
            Period:
          </Label>
          <Input
            id="payment-period"
            value={paymentPeriod}
            onChange={(e) => setPaymentPeriod(e.target.value)}
            placeholder={currentYear.toString()}
            className="w-32"
          />
        </div>
        <div className="flex gap-2">
          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/30">
            {paidCount} Paid
          </Badge>
          <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/30">
            {unpaidCount} Unpaid
          </Badge>
        </div>
      </div>

      {/* Pay Online Button for current user */}
      {isPayableMember && !hasCurrentUserPaid && canPayOnline && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <p className="font-medium">Pay Your Subscription</p>
                <p className="text-sm text-muted-foreground">
                  ${clubSubscription.member_subscription_amount} for {paymentPeriod}
                </p>
              </div>
              <Button 
                onClick={handlePayOnline}
                disabled={isProcessingPayment}
              >
                {isProcessingPayment ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Processing...
                  </>
                ) : (
                  <>
                    <CreditCard className="h-4 w-4 mr-2" />
                    Pay Now
                    <ExternalLink className="h-3 w-3 ml-1" />
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isPayableMember && hasCurrentUserPaid && (
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="p-4 flex items-center gap-3">
            <Check className="h-5 w-5 text-emerald-500" />
            <div>
              <p className="font-medium text-emerald-500">Your subscription is paid for {paymentPeriod}</p>
              {currentUserPayment.notes && (
                <p className="text-sm text-muted-foreground">{currentUserPayment.notes}</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Members List */}
      {isPaymentsLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-2">
          {payableMembers.map(([userId, member]) => {
            const payment = paymentMap[userId];
            const isPaid = !!payment;
            
            return (
              <Card 
                key={userId}
                className={`transition-colors ${
                  isAdmin ? "cursor-pointer hover:bg-muted/50" : ""
                } ${
                  isPaid ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30"
                }`}
                onClick={() => handleMemberClick(userId, member.profile?.display_name || "Unknown")}
              >
                <CardContent className="p-3 flex items-center gap-3">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={member.profile?.avatar_url || undefined} />
                    <AvatarFallback className="bg-primary/20 text-primary text-sm">
                      {member.profile?.display_name?.charAt(0)?.toUpperCase() || "?"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">
                      {member.profile?.display_name || "Unknown User"}
                      {userId === user?.id && <span className="text-muted-foreground"> (You)</span>}
                    </p>
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {member.roles?.map((roleItem) => {
                        const roleLabels: Record<string, string> = {
                          player: "Player",
                          parent: "Parent",
                        };
                        if (!["player", "parent"].includes(roleItem.role)) return null;
                        return (
                          <Badge key={roleItem.id} variant="secondary" className="text-xs">
                            {roleLabels[roleItem.role] || roleItem.role}
                          </Badge>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isPaid ? (
                      <div className="flex items-center gap-1 text-emerald-500">
                        <Check className="h-5 w-5" />
                        <span className="text-xs font-medium">Paid</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-amber-500">
                        <X className="h-5 w-5" />
                        <span className="text-xs font-medium">Unpaid</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Mark as Paid Dialog */}
      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark Subscription as Paid</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              Mark <span className="font-medium text-foreground">{selectedMember?.displayName}</span> as having paid their club subscription for <span className="font-medium text-foreground">{paymentPeriod}</span>.
            </p>
            <div className="space-y-2">
              <Label htmlFor="amount">Amount (optional)</Label>
              <Input
                id="amount"
                type="number"
                step="0.01"
                placeholder="e.g., 150.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea
                id="notes"
                placeholder="Any additional notes..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              onClick={() => markPaidMutation.mutate()}
              disabled={markPaidMutation.isPending}
            >
              {markPaidMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Check className="h-4 w-4 mr-2" />
              )}
              Mark as Paid
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove Payment Confirmation */}
      <AlertDialog open={!!deletePaymentId} onOpenChange={(open) => !open && setDeletePaymentId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Payment Record?</AlertDialogTitle>
            <AlertDialogDescription>
              This will mark this member as unpaid for this period. You can mark them as paid again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletePaymentId && deletePaymentMutation.mutate(deletePaymentId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}