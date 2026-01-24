import { useState } from "react";
import { Fingerprint, User, X, Loader2, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { PasskeyAccount } from "@/hooks/usePasskey";

interface PasskeyAccountSelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: PasskeyAccount[];
  onSelectAccount: (email: string) => Promise<void>;
  onRemoveAccount?: (email: string) => void;
  loading?: boolean;
  selectedEmail?: string | null;
}

export function PasskeyAccountSelector({
  open,
  onOpenChange,
  accounts,
  onSelectAccount,
  onRemoveAccount,
  loading = false,
  selectedEmail = null,
}: PasskeyAccountSelectorProps) {
  const [authenticatingEmail, setAuthenticatingEmail] = useState<string | null>(null);

  const handleSelectAccount = async (email: string) => {
    setAuthenticatingEmail(email);
    try {
      await onSelectAccount(email);
    } finally {
      setAuthenticatingEmail(null);
    }
  };

  const handleRemoveAccount = (e: React.MouseEvent, email: string) => {
    e.stopPropagation();
    onRemoveAccount?.(email);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Fingerprint className="h-5 w-5 text-primary" />
            Select Account
          </DialogTitle>
          <DialogDescription>
            Choose which account to sign in with using biometrics
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[300px]">
          <div className="space-y-2 px-1 py-1">
            {accounts.map((account) => {
              const isAuthenticating = authenticatingEmail === account.email;
              const isDisabled = loading || (authenticatingEmail !== null && !isAuthenticating);

              return (
                <button
                  key={account.email}
                  onClick={() => handleSelectAccount(account.email)}
                  disabled={isDisabled}
                  className={cn(
                    "w-full flex items-center gap-3 p-4 rounded-lg border-2 transition-all",
                    "hover:bg-accent hover:border-primary/50",
                    "focus:outline-none",
                    isAuthenticating 
                      ? "border-primary bg-primary/10" 
                      : "border-border bg-card",
                    isDisabled && !isAuthenticating && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <div className="flex-shrink-0 h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                    {isAuthenticating ? (
                      <Loader2 className="h-5 w-5 text-primary animate-spin" />
                    ) : (
                      <User className="h-5 w-5 text-primary" />
                    )}
                  </div>
                  <div className="flex-1 text-left min-w-0">
                    {account.displayName && account.displayName !== account.email && (
                      <p className="font-medium text-foreground truncate">
                        {account.displayName}
                      </p>
                    )}
                    <p className={cn(
                      "text-sm truncate",
                      account.displayName && account.displayName !== account.email
                        ? "text-muted-foreground"
                        : "font-medium text-foreground"
                    )}>
                      {account.email}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {isAuthenticating && (
                      <span className="text-xs text-primary font-medium">
                        Authenticating...
                      </span>
                    )}
                    {onRemoveAccount && !isAuthenticating && (
                      <button
                        onClick={(e) => handleRemoveAccount(e, account.email)}
                        className="p-1.5 rounded-full hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                        title="Remove account"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </ScrollArea>

        <div className="flex justify-end pt-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading || authenticatingEmail !== null}
          >
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
