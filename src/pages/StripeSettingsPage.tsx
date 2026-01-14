import { useState, useEffect } from "react";
import { ArrowLeft, CreditCard, CheckCircle2, XCircle, Eye, EyeOff, Users, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useNavigate, useParams } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";

export default function StripeSettingsPage() {
  const { clubId } = useParams<{ clubId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [secretKey, setSecretKey] = useState("");
  const [publishableKey, setPublishableKey] = useState("");
  const [isEnabled, setIsEnabled] = useState(true);
  const [showSecretKey, setShowSecretKey] = useState(false);
  
  // Member payment settings state
  const [memberPaymentsEnabled, setMemberPaymentsEnabled] = useState(false);
  const [memberSubscriptionAmount, setMemberSubscriptionAmount] = useState("");

  // Fetch club details
  const { data: club } = useQuery({
    queryKey: ['club', clubId],
    queryFn: async () => {
      if (!clubId) return null;
      const { data, error } = await supabase
        .from('clubs')
        .select('id, name')
        .eq('id', clubId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!clubId
  });

  // Fetch existing Stripe config using secure decryption function
  const { data: stripeConfig, isLoading } = useQuery({
    queryKey: ['club-stripe-config', clubId],
    queryFn: async () => {
      if (!clubId) return null;
      const { data, error } = await supabase
        .rpc('get_club_stripe_config', { p_club_id: clubId });
      if (error) throw error;
      // RPC returns an array, get first item or null
      return data && data.length > 0 ? data[0] : null;
    },
    enabled: !!clubId
  });

  // Fetch club subscription for member payment settings
  const { data: clubSubscription } = useQuery({
    queryKey: ['club-subscription', clubId],
    queryFn: async () => {
      if (!clubId) return null;
      const { data, error } = await supabase
        .from('club_subscriptions')
        .select('*')
        .eq('club_id', clubId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!clubId
  });

  // Populate form with existing config
  useEffect(() => {
    if (stripeConfig) {
      setSecretKey(stripeConfig.stripe_secret_key);
      setPublishableKey(stripeConfig.stripe_publishable_key);
      setIsEnabled(stripeConfig.is_enabled);
    }
  }, [stripeConfig]);

  // Populate member payment settings
  useEffect(() => {
    if (clubSubscription) {
      setMemberPaymentsEnabled(clubSubscription.member_payments_enabled || false);
      setMemberSubscriptionAmount(clubSubscription.member_subscription_amount?.toString() || "");
    }
  }, [clubSubscription]);

  // Save mutation for Stripe config
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!clubId) throw new Error("Club ID is required");
      
      const configData = {
        club_id: clubId,
        stripe_secret_key: secretKey.trim(),
        stripe_publishable_key: publishableKey.trim(),
        is_enabled: isEnabled,
        updated_at: new Date().toISOString()
      };

      if (stripeConfig) {
        // Update existing config
        const { error } = await supabase
          .from('club_stripe_configs')
          .update(configData)
          .eq('id', stripeConfig.id);
        if (error) throw error;
      } else {
        // Insert new config
        const { error } = await supabase
          .from('club_stripe_configs')
          .insert(configData);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['club-stripe-config', clubId] });
      toast({ title: "Stripe configuration saved successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save configuration", description: error.message, variant: "destructive" });
    }
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!stripeConfig?.id) throw new Error("No configuration to delete");
      const { error } = await supabase
        .from('club_stripe_configs')
        .delete()
        .eq('id', stripeConfig.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['club-stripe-config', clubId] });
      setSecretKey("");
      setPublishableKey("");
      setIsEnabled(true);
      toast({ title: "Stripe configuration removed" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to remove configuration", description: error.message, variant: "destructive" });
    }
  });

  // Save member payment settings mutation
  const saveMemberPaymentSettingsMutation = useMutation({
    mutationFn: async () => {
      if (!clubId) throw new Error("Club ID is required");
      
      const amount = memberSubscriptionAmount ? parseFloat(memberSubscriptionAmount) : null;
      
      // Check if club subscription exists
      if (clubSubscription) {
        const { error } = await supabase
          .from('club_subscriptions')
          .update({
            member_payments_enabled: memberPaymentsEnabled,
            member_subscription_amount: amount,
          })
          .eq('club_id', clubId);
        if (error) throw error;
      } else {
        // Create a new subscription record if it doesn't exist
        const { error } = await supabase
          .from('club_subscriptions')
          .insert({
            club_id: clubId,
            member_payments_enabled: memberPaymentsEnabled,
            member_subscription_amount: amount,
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['club-subscription', clubId] });
      toast({ title: "Member payment settings saved" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save settings", description: error.message, variant: "destructive" });
    }
  });

  const handleSave = () => {
    if (!secretKey.trim()) {
      toast({ title: "Please enter a Stripe secret key", variant: "destructive" });
      return;
    }
    if (!publishableKey.trim()) {
      toast({ title: "Please enter a Stripe publishable key", variant: "destructive" });
      return;
    }
    if (!secretKey.startsWith('sk_')) {
      toast({ title: "Invalid secret key format", description: "Secret key should start with 'sk_'", variant: "destructive" });
      return;
    }
    if (!publishableKey.startsWith('pk_')) {
      toast({ title: "Invalid publishable key format", description: "Publishable key should start with 'pk_'", variant: "destructive" });
      return;
    }
    saveMutation.mutate();
  };

  const handleSaveMemberPaymentSettings = () => {
    if (memberPaymentsEnabled && !memberSubscriptionAmount) {
      toast({ title: "Please enter a subscription amount", variant: "destructive" });
      return;
    }
    if (memberPaymentsEnabled && parseFloat(memberSubscriptionAmount) <= 0) {
      toast({ title: "Subscription amount must be greater than 0", variant: "destructive" });
      return;
    }
    saveMemberPaymentSettingsMutation.mutate();
  };

  if (!clubId) {
    return (
      <div className="py-6">
        <p className="text-muted-foreground">Club not found</p>
      </div>
    );
  }

  const hasStripeConfig = !!stripeConfig || (secretKey && publishableKey);

  return (
    <div className="py-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(`/clubs/${clubId}`)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Payment Settings</h1>
          {club && <p className="text-sm text-muted-foreground">{club.name}</p>}
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-primary" />
              <CardTitle>Stripe Configuration</CardTitle>
            </div>
            {stripeConfig && (
              <div className="flex items-center gap-2">
                {stripeConfig.is_enabled ? (
                  <span className="flex items-center gap-1 text-sm text-green-600">
                    <CheckCircle2 className="h-4 w-4" /> Active
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-sm text-muted-foreground">
                    <XCircle className="h-4 w-4" /> Disabled
                  </span>
                )}
              </div>
            )}
          </div>
          <CardDescription>
            Configure your Stripe API keys to accept payments for social events. Payments go directly to your Stripe account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <>
              <Alert>
                <AlertDescription>
                  Get your API keys from the{" "}
                  <a 
                    href="https://dashboard.stripe.com/apikeys" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-primary underline font-medium"
                  >
                    Stripe Dashboard
                  </a>. Use test keys (sk_test_*, pk_test_*) for testing.
                </AlertDescription>
              </Alert>

              <div className="space-y-2">
                <Label htmlFor="publishable-key">Publishable Key</Label>
                <Input
                  id="publishable-key"
                  type="text"
                  placeholder="pk_live_... or pk_test_..."
                  value={publishableKey}
                  onChange={(e) => setPublishableKey(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="secret-key">Secret Key</Label>
                <div className="relative">
                  <Input
                    id="secret-key"
                    type={showSecretKey ? "text" : "password"}
                    placeholder="sk_live_... or sk_test_..."
                    value={secretKey}
                    onChange={(e) => setSecretKey(e.target.value)}
                    className="pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full"
                    onClick={() => setShowSecretKey(!showSecretKey)}
                  >
                    {showSecretKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Your secret key is stored securely and only accessible to club admins.
                </p>
              </div>

              {stripeConfig && (
                <div className="flex items-center justify-between">
                  <Label htmlFor="enabled">Enable payments</Label>
                  <Switch
                    id="enabled"
                    checked={isEnabled}
                    onCheckedChange={setIsEnabled}
                  />
                </div>
              )}

              <div className="flex gap-3">
                <Button 
                  onClick={handleSave} 
                  disabled={saveMutation.isPending} 
                  className="flex-1"
                >
                  {saveMutation.isPending ? "Saving..." : stripeConfig ? "Update Configuration" : "Save Configuration"}
                </Button>
                {stripeConfig && (
                  <Button 
                    variant="outline" 
                    onClick={() => deleteMutation.mutate()}
                    disabled={deleteMutation.isPending}
                  >
                    {deleteMutation.isPending ? "Removing..." : "Remove"}
                  </Button>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Member Subscription Payments Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            <CardTitle>Member Subscription Payments</CardTitle>
          </div>
          <CardDescription>
            Allow club members to pay their subscription fees online via Stripe.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {!hasStripeConfig && (
            <Alert>
              <AlertDescription>
                Configure your Stripe API keys above before enabling member payments.
              </AlertDescription>
            </Alert>
          )}

          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="member-payments-enabled" className="font-medium">Enable Online Payments</Label>
              <p className="text-sm text-muted-foreground">
                Members can pay their subscription fees via Stripe
              </p>
            </div>
            <Switch
              id="member-payments-enabled"
              checked={memberPaymentsEnabled}
              onCheckedChange={setMemberPaymentsEnabled}
              disabled={!hasStripeConfig}
            />
          </div>

          {memberPaymentsEnabled && (
            <div className="space-y-2">
              <Label htmlFor="subscription-amount">Subscription Fee Amount ($)</Label>
              <Input
                id="subscription-amount"
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g., 150.00"
                value={memberSubscriptionAmount}
                onChange={(e) => setMemberSubscriptionAmount(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                The amount members will pay for their club subscription
              </p>
            </div>
          )}

          <Button
            onClick={handleSaveMemberPaymentSettings}
            disabled={saveMemberPaymentSettingsMutation.isPending || (!hasStripeConfig && memberPaymentsEnabled)}
            className="w-full"
          >
            {saveMemberPaymentSettingsMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Saving...
              </>
            ) : (
              "Save Member Payment Settings"
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
