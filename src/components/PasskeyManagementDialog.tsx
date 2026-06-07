import { useState } from "react";
import { Capacitor } from "@capacitor/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fingerprint, Smartphone, Monitor, Tablet, Trash2, Loader2, Plus } from "lucide-react";
import { format } from "date-fns";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
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
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePasskey } from "@/hooks/usePasskey";

interface Passkey {
  id: string;
  device_type: string | null;
  created_at: string;
  last_used_at: string | null;
}

interface PasskeyManagementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function getDeviceIcon(deviceType: string | null) {
  switch (deviceType?.toLowerCase()) {
    case 'ios':
    case 'android':
      return Smartphone;
    case 'macos':
    case 'windows':
      return Monitor;
    case 'ipad':
      return Tablet;
    default:
      return Fingerprint;
  }
}

function getDeviceName(deviceType: string | null) {
  switch (deviceType?.toLowerCase()) {
    case 'ios':
      return 'iPhone';
    case 'android':
      return 'Android Device';
    case 'macos':
      return 'Mac';
    case 'windows':
      return 'Windows PC';
    case 'ipad':
      return 'iPad';
    default:
      return 'Unknown Device';
  }
}

export function PasskeyManagementDialog({ open, onOpenChange }: PasskeyManagementDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { registerPasskey, removeAccount, loading: registerLoading } = usePasskey();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const { data: passkeys, isLoading } = useQuery({
    queryKey: ["user-passkeys", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_passkeys")
        .select("id, device_type, created_at, last_used_at")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as Passkey[];
    },
    enabled: !!user && open,
  });

  const handleDelete = async (passkeyId: string) => {
    // Close the confirmation dialog first to prevent UI freeze
    setConfirmDeleteId(null);
    setDeletingId(passkeyId);
    
    try {
      const { error } = await supabase
        .from("user_passkeys")
        .delete()
        .eq("id", passkeyId)
        .eq("user_id", user!.id);

      if (error) throw error;

      // Check if this was the last passkey for this user
      const remainingPasskeys = passkeys?.filter(p => p.id !== passkeyId) || [];
      if (remainingPasskeys.length === 0 && user?.email) {
        // Remove from local storage if no passkeys left
        removeAccount(user.email);
      }

      toast({
        title: "Passkey removed",
        description: "The passkey has been deleted from your account.",
      });

      await queryClient.invalidateQueries({ queryKey: ["user-passkeys"] });
    } catch (error: any) {
      toast({
        title: "Failed to remove passkey",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setDeletingId(null);
    }
  };

  const handleAddPasskey = async () => {
    const result = await registerPasskey();
    if (result.success) {
      toast({
        title: "Passkey added!",
        description: "You can now sign in with this device's biometrics.",
      });
      queryClient.invalidateQueries({ queryKey: ["user-passkeys"] });
    } else {
      toast({
        title: "Failed to add passkey",
        description: result.error || "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleConfirmDelete = () => {
    if (confirmDeleteId) {
      handleDelete(confirmDeleteId);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Fingerprint className="h-5 w-5" />
              Manage Passkeys
            </DialogTitle>
            <DialogDescription>
              View and manage your registered biometric login devices.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : passkeys && passkeys.length > 0 ? (
              <div className="space-y-3">
                {passkeys.map((passkey) => {
                  const DeviceIcon = getDeviceIcon(passkey.device_type);
                  const isDeleting = deletingId === passkey.id;
                  
                  return (
                    <Card key={passkey.id} className="relative">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                              <DeviceIcon className="h-5 w-5 text-muted-foreground" />
                            </div>
                            <div>
                              <p className="font-medium">
                                {getDeviceName(passkey.device_type)}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Added {format(new Date(passkey.created_at), "MMM d, yyyy")}
                              </p>
                              {passkey.last_used_at && (
                                <p className="text-xs text-muted-foreground">
                                  Last used {format(new Date(passkey.last_used_at), "MMM d, yyyy")}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {passkey.device_type && (
                              <Badge variant="secondary" className="text-xs">
                                {passkey.device_type}
                              </Badge>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={() => setConfirmDeleteId(passkey.id)}
                              disabled={isDeleting}
                            >
                              {isDeleting ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8">
                <Fingerprint className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground">
                  No passkeys registered yet.
                </p>
              </div>
            )}

            <Button
              onClick={handleAddPasskey}
              disabled={registerLoading}
              className="w-full"
            >
              {registerLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Setting up...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Add New Passkey
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Separate AlertDialog outside the main Dialog to prevent conflicts */}
      <AlertDialog open={!!confirmDeleteId} onOpenChange={(open) => !open && setConfirmDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Passkey?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the passkey from your account. You won't be able to use this device's biometrics to sign in until you add it again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmDeleteId(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
