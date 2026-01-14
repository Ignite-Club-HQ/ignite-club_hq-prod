import { useState, useEffect } from "react";
import { ArrowLeft, CreditCard, CheckCircle2, XCircle, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAuth } from "@/hooks/useAuth";

export default function AppStripeSettingsPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  
  const [secretKey, setSecretKey] = useState("");
  const [publishableKey, setPublishableKey] = useState("");
  const [isEnabled, setIsEnabled] = useState(true);
  const [showSecretKey, setShowSecretKey] = useState(false);

  // Check if user is app admin
  const { data: isAppAdmin, isLoading: isCheckingAdmin } = useQuery({
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

  // Fetch existing app Stripe config
  const { data: stripeConfig, isLoading } = useQuery({
    queryKey: ['app-stripe-config'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('app_stripe_config')
        .select('*')
        .maybeSingle();
      if (error && error.code !== 'PGRST116') throw error;
      return data;
    },
    enabled: isAppAdmin === true,
  });

  // Populate form with existing config
  useEffect(() => {
    if (stripeConfig) {
      setSecretKey(stripeConfig.stripe_secret_key);
      setPublishableKey(stripeConfig.stripe_publishable_key);
      setIsEnabled(stripeConfig.is_enabled);
    }
  }, [stripeConfig]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      const configData = {
        stripe_secret_key: secretKey.trim(),
        stripe_publishable_key: publishableKey.trim(),
        is_enabled: isEnabled,
        updated_at: new Date().toISOString()
      };

      if (stripeConfig) {
        // Update existing config
        const { error } = await supabase
          .from('app_stripe_config')
          .update(configData)
          .eq('id', stripeConfig.id);
        if (error) throw error;
      } else {
        // Insert new config
        const { error } = await supabase
          .from('app_stripe_config')
          .insert(configData);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['app-stripe-config'] });
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
        .from('app_stripe_config')
        .delete()
        .eq('id', stripeConfig.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['app-stripe-config'] });
      setSecretKey("");
      setPublishableKey("");
      setIsEnabled(true);
      toast({ title: "Stripe configuration removed" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to remove configuration", description: error.message, variant: "destructive" });
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

  if (isCheckingAdmin) {
    return (
      <div className="py-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!isAppAdmin) {
    return (
      <div className="py-6">
        <p className="text-muted-foreground">You don't have permission to access this page.</p>
      </div>
    );
  }

  return (
    <div className="py-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/profile")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">App Payment Settings</h1>
          <p className="text-sm text-muted-foreground">Platform-level Stripe configuration</p>
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
            Configure Stripe API keys to receive payments for app subscriptions and premium features.
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
                  Your secret key is stored securely and only accessible to app admins.
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
    </div>
  );
}
