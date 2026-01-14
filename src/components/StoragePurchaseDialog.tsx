import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HardDrive, Loader2, Check, Crown, Package, Ticket, Minus, AlertTriangle, Calendar, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const STORAGE_PACKS = [
  { id: '10gb', gb: 10, priceMonthly: 2, priceAnnual: 20, popular: false },
  { id: '50gb', gb: 50, priceMonthly: 10, priceAnnual: 100, popular: true },
];

interface StoragePurchaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clubId: string;
  clubName: string;
  currentStorageLimit: number; // in bytes
  purchasedStorageGb: number;
  scheduledDowngradeGb?: number | null;
  storageDowngradeAt?: string | null;
}

export function StoragePurchaseDialog({
  open,
  onOpenChange,
  clubId,
  clubName,
  currentStorageLimit,
  purchasedStorageGb,
  scheduledDowngradeGb,
  storageDowngradeAt,
}: StoragePurchaseDialogProps) {
  const [selectedPack, setSelectedPack] = useState<string | null>(null);
  const [isAnnual, setIsAnnual] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [showDowngradeConfirm, setShowDowngradeConfirm] = useState(false);
  const [downgradeTarget, setDowngradeTarget] = useState<number>(0);
  const queryClient = useQueryClient();

  // Check if Stripe is configured
  const { data: hasStripeConfig } = useQuery({
    queryKey: ["has-stripe-config", clubId],
    queryFn: async () => {
      // Check club-level config first
      const { data: clubConfig } = await supabase
        .from("club_stripe_configs")
        .select("is_enabled")
        .eq("club_id", clubId)
        .eq("is_enabled", true)
        .maybeSingle();

      if (clubConfig) return true;

      // Fall back to app-level config
      const { data: appConfig } = await supabase
        .from("app_stripe_config")
        .select("is_enabled")
        .eq("is_enabled", true)
        .maybeSingle();

      return !!appConfig;
    },
    enabled: open,
  });

  const purchaseMutation = useMutation({
    mutationFn: async (packType: string) => {
      const { data, error } = await supabase.functions.invoke('create-storage-checkout', {
        body: {
          clubId,
          packType,
          isAnnual,
          successUrl: `${window.location.origin}/vault?success=storage`,
          cancelUrl: `${window.location.origin}/vault?cancelled=true`,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      if (data?.url) {
        window.location.href = data.url;
      }
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to start checkout");
    },
  });

  const applyPromoMutation = useMutation({
    mutationFn: async (code: string) => {
      // Validate promo code
      const { data: promoData, error: promoError } = await supabase
        .from("promo_codes")
        .select("id, is_active, expires_at, access_level, club_id, storage_gb")
        .ilike("code", code.trim())
        .maybeSingle();

      if (promoError) throw promoError;
      if (!promoData) throw new Error("Invalid promo code");
      if (!promoData.is_active) throw new Error("This promo code is no longer active");
      if (promoData.expires_at && new Date(promoData.expires_at) < new Date()) {
        throw new Error("This promo code has expired");
      }
      if (promoData.access_level !== "storage" && !promoData.storage_gb) {
        throw new Error("This promo code is not valid for storage");
      }
      if (promoData.club_id && promoData.club_id !== clubId) {
        throw new Error("This promo code is not valid for this club");
      }

      const storageGb = promoData.storage_gb || 0;
      if (storageGb <= 0) throw new Error("This promo code does not grant storage");

      // Apply storage to club subscription
      const { data: subscription, error: subError } = await supabase
        .from("club_subscriptions")
        .select("storage_purchased_gb")
        .eq("club_id", clubId)
        .maybeSingle();

      if (subError) throw subError;

      const currentStorage = subscription?.storage_purchased_gb || 0;
      const newStorage = currentStorage + storageGb;

      const { error: updateError } = await supabase
        .from("club_subscriptions")
        .update({ storage_purchased_gb: newStorage })
        .eq("club_id", clubId);

      if (updateError) throw updateError;

      // Increment uses count
      await supabase
        .from("promo_codes")
        .update({ uses_count: (promoData as any).uses_count + 1 })
        .eq("id", promoData.id);

      return { storageGb, newTotal: newStorage };
    },
    onSuccess: (data) => {
      toast.success(`Added ${data.storageGb}GB storage! Total: ${data.newTotal}GB`);
      setPromoCode("");
      queryClient.invalidateQueries({ queryKey: ["purchased-storage", clubId] });
      queryClient.invalidateQueries({ queryKey: ["club-subscription", clubId] });
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to apply promo code");
    },
  });

  const downgradeMutation = useMutation({
    mutationFn: async (newStorageGb: number) => {
      // Schedule downgrade for end of billing period (approximately 1 month from now)
      const downgradeDate = new Date();
      downgradeDate.setMonth(downgradeDate.getMonth() + 1);
      
      const { error } = await supabase
        .from("club_subscriptions")
        .update({ 
          scheduled_storage_downgrade_gb: newStorageGb,
          storage_downgrade_at: downgradeDate.toISOString()
        })
        .eq("club_id", clubId);

      if (error) throw error;
      return { newStorageGb, downgradeDate };
    },
    onSuccess: ({ newStorageGb, downgradeDate }) => {
      const formattedDate = downgradeDate.toLocaleDateString();
      toast.success(newStorageGb === 0 
        ? `Storage downgrade to base (5GB) scheduled for ${formattedDate}` 
        : `Storage downgrade to ${newStorageGb}GB scheduled for ${formattedDate}`
      );
      setShowDowngradeConfirm(false);
      queryClient.invalidateQueries({ queryKey: ["purchased-storage", clubId] });
      queryClient.invalidateQueries({ queryKey: ["club-subscription", clubId] });
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to schedule storage downgrade");
    },
  });

  const cancelDowngradeMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("club_subscriptions")
        .update({ 
          scheduled_storage_downgrade_gb: null,
          storage_downgrade_at: null
        })
        .eq("club_id", clubId);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Scheduled downgrade cancelled");
      queryClient.invalidateQueries({ queryKey: ["purchased-storage", clubId] });
      queryClient.invalidateQueries({ queryKey: ["club-subscription", clubId] });
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to cancel downgrade");
    },
  });

  const handlePurchase = () => {
    if (!selectedPack) {
      toast.error("Please select a storage pack");
      return;
    }
    purchaseMutation.mutate(selectedPack);
  };

  const handleApplyPromo = async () => {
    if (!promoCode.trim()) {
      toast.error("Please enter a promo code");
      return;
    }
    try {
      await applyPromoMutation.mutateAsync(promoCode);
    } catch {
      // Clear the promo code on failure
      setPromoCode("");
    }
  };

  const handleDowngrade = (targetGb: number) => {
    setDowngradeTarget(targetGb);
    // Close the main dialog first to prevent overlay conflicts
    onOpenChange(false);
    // Small delay to let the main dialog close, then show confirmation
    setTimeout(() => {
      setShowDowngradeConfirm(true);
    }, 100);
  };

  const confirmDowngrade = () => {
    downgradeMutation.mutate(downgradeTarget);
  };

  const handleCancelDowngrade = () => {
    setShowDowngradeConfirm(false);
    // Reopen the main dialog
    setTimeout(() => {
      onOpenChange(true);
    }, 100);
  };

  const baseStorageGb = 5; // Base Pro storage
  const totalStorageGb = baseStorageGb + purchasedStorageGb;

  const formatPrice = (monthly: number, annual: number) => {
    if (isAnnual) {
      const savedAmount = monthly * 12 - annual;
      return (
        <div className="text-right">
          <span className="text-lg font-bold">${annual}/yr</span>
          <p className="text-xs text-green-500">Save ${savedAmount}</p>
        </div>
      );
    }
    return <span className="text-lg font-bold">${monthly}/mo</span>;
  };

  // Generate downgrade options
  const downgradeOptions = [];
  if (purchasedStorageGb > 0) {
    downgradeOptions.push({ gb: 0, label: "Reset to Base (5GB)" });
    if (purchasedStorageGb > 10) {
      downgradeOptions.push({ gb: 10, label: "Reduce to +10GB" });
    }
    if (purchasedStorageGb > 25) {
      downgradeOptions.push({ gb: 25, label: "Reduce to +25GB" });
    }
    if (purchasedStorageGb > 50) {
      downgradeOptions.push({ gb: 50, label: "Reduce to +50GB" });
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" />
              Manage Storage
            </DialogTitle>
            <DialogDescription>
              Manage storage capacity for {clubName}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Current storage info */}
            <div className="bg-muted/50 rounded-lg p-3 space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Base Pro Storage</span>
                <span className="font-medium">{baseStorageGb}GB</span>
              </div>
              {purchasedStorageGb > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Purchased Add-ons</span>
                  <span className="font-medium text-primary">+{purchasedStorageGb}GB</span>
                </div>
              )}
              <div className="flex items-center justify-between text-sm border-t pt-1 mt-1">
                <span className="font-medium">Total Storage</span>
                <span className="font-bold">{totalStorageGb}GB</span>
              </div>
            </div>

            {/* Promo Code Section */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Ticket className="h-4 w-4" />
                Redeem Promo Code
              </Label>
              <div className="flex gap-2">
                <Input
                  placeholder="Enter code"
                  value={promoCode}
                  onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                  className="uppercase"
                />
                <Button 
                  onClick={handleApplyPromo}
                  disabled={!promoCode.trim() || applyPromoMutation.isPending}
                >
                  {applyPromoMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Apply"
                  )}
                </Button>
              </div>
            </div>

            <Separator />

            {/* Scheduled Downgrade Banner */}
            {scheduledDowngradeGb != null && storageDowngradeAt && (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2 text-amber-600">
                  <Calendar className="h-4 w-4" />
                  <span className="text-sm font-medium">Downgrade Scheduled</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Storage will reduce to {scheduledDowngradeGb === 0 ? "base 5GB" : `${scheduledDowngradeGb}GB`} on {new Date(storageDowngradeAt).toLocaleDateString()}
                </p>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => cancelDowngradeMutation.mutate()}
                  disabled={cancelDowngradeMutation.isPending}
                >
                  {cancelDowngradeMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <X className="h-4 w-4 mr-2" />
                  )}
                  Cancel Downgrade
                </Button>
              </div>
            )}

            {/* Downgrade Section - only show if no downgrade is scheduled */}
            {purchasedStorageGb > 0 && scheduledDowngradeGb == null && (
              <>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Minus className="h-4 w-4" />
                    Schedule Storage Reduction
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Schedule a storage reduction for the end of your billing period. The change will take effect at your next renewal date.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {downgradeOptions.map((option) => (
                      <Button
                        key={option.gb}
                        variant="outline"
                        size="sm"
                        onClick={() => handleDowngrade(option.gb)}
                        disabled={downgradeMutation.isPending}
                      >
                        {option.label}
                      </Button>
                    ))}
                  </div>
                </div>
                <Separator />
              </>
            )}

            {/* Billing toggle */}
            <div className="flex items-center justify-between">
              <Label htmlFor="annual-billing" className="text-sm">Annual billing</Label>
              <div className="flex items-center gap-2">
                <Switch
                  id="annual-billing"
                  checked={isAnnual}
                  onCheckedChange={setIsAnnual}
                />
                {isAnnual && (
                  <Badge variant="secondary" className="text-xs bg-green-500/20 text-green-600">
                    Save 17%
                  </Badge>
                )}
              </div>
            </div>

            {/* Storage packs */}
            <div className="space-y-2">
              {STORAGE_PACKS.map((pack) => (
                <Card
                  key={pack.id}
                  className={`cursor-pointer transition-all ${
                    selectedPack === pack.id
                      ? "ring-2 ring-primary border-primary"
                      : "hover:border-primary/50"
                  }`}
                  onClick={() => setSelectedPack(pack.id)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${selectedPack === pack.id ? 'bg-primary/20' : 'bg-muted'}`}>
                          <HardDrive className={`h-5 w-5 ${selectedPack === pack.id ? 'text-primary' : 'text-muted-foreground'}`} />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">{pack.gb}GB Pack</span>
                            {pack.popular && (
                              <Badge variant="secondary" className="text-xs">Popular</Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Additional storage for your club
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {formatPrice(pack.priceMonthly, pack.priceAnnual)}
                        {selectedPack === pack.id && (
                          <Check className="h-5 w-5 text-primary" />
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Not configured message */}
            {hasStripeConfig === false && (
              <p className="text-sm text-muted-foreground text-center">
                Payment is not configured for this club. Please contact an administrator.
              </p>
            )}

            {/* Purchase button */}
            <Button
              className="w-full"
              size="lg"
              onClick={handlePurchase}
              disabled={!selectedPack || !hasStripeConfig || purchaseMutation.isPending}
            >
              {purchaseMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Crown className="h-4 w-4 mr-2" />
                  Purchase Storage
                </>
              )}
            </Button>

            <p className="text-xs text-center text-muted-foreground">
              Storage add-ons are billed as recurring subscriptions and can be cancelled anytime.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Downgrade Confirmation Dialog */}
      <AlertDialog 
        open={showDowngradeConfirm} 
        onOpenChange={(open) => {
          if (!downgradeMutation.isPending && !open) {
            handleCancelDowngrade();
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Confirm Storage Reduction
            </AlertDialogTitle>
            <AlertDialogDescription>
              {downgradeTarget === 0 
                ? "This will schedule your storage to reset to the base 5GB Pro allocation at the end of your current billing period."
                : `This will schedule your storage reduction to ${downgradeTarget}GB (${baseStorageGb + downgradeTarget}GB total) at the end of your current billing period.`
              }
              <br /><br />
              <strong>The downgrade will take effect at your next renewal date.</strong> Any files exceeding the new limit may become inaccessible after the downgrade.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              variant="outline"
              onClick={handleCancelDowngrade}
              disabled={downgradeMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDowngrade}
              disabled={downgradeMutation.isPending}
            >
              {downgradeMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Schedule Downgrade
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}