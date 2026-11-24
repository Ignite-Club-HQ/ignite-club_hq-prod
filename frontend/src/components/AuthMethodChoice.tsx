import { Fingerprint, Mail } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface AuthMethodChoiceProps {
  value: "supabase" | "icp";
  onChange: (value: "supabase" | "icp") => void;
  disabled?: boolean;
}

/** A deliberate account switch, never an account merge or migration. */
export function AuthMethodChoice({ value, onChange, disabled }: AuthMethodChoiceProps) {
  const [open, setOpen] = useState(false);
  const choose = (next: "supabase" | "icp") => {
    if (disabled) return;
    setOpen(false);
    onChange(next);
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button type="button" variant="link" className="min-h-11 text-xs text-muted-foreground" disabled={disabled} onClick={() => setOpen(true)}>Use a different sign-in method</Button>
      <DialogContent className="max-w-sm rounded-lg">
        <DialogHeader>
          <DialogTitle>Choose your sign-in method</DialogTitle>
          <DialogDescription>Use the method you used to create your account. Email and Internet Identity open separate accounts; switching does not move your memberships.</DialogDescription>
        </DialogHeader>
        <Button className="h-12 rounded-lg" disabled={disabled} onClick={() => choose("icp")}><Fingerprint aria-hidden="true" />{value === "icp" ? "Stay with secure sign-in" : "Continue securely"}</Button>
        <Button variant="outline" className="h-12 rounded-lg" disabled={disabled} onClick={() => choose("supabase")}><Mail aria-hidden="true" />Sign in with email</Button>
      </DialogContent>
    </Dialog>
  );
}
