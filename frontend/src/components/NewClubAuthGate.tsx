import type { ReactNode } from "react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { setAuthMethodChoice } from "@/live/authBackendMode";
import { buildAuthPathWithIntent } from "@/lib/authRedirectStorage";
import { Button } from "@/components/ui/button";
import { Fingerprint, Loader2 } from "lucide-react";

/** Changing sign-in requires a tap; never reuse an email identity on ICP. */
export function NewClubAuthGate({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (user?.app_metadata?.provider === "icp") return <>{children}</>;
  const proceed = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (user) await signOut();
      setAuthMethodChoice("icp");
      navigate(buildAuthPathWithIntent({ next: "/clubs/new", mode: "signup" }));
    } catch {
      setError("We couldn't switch sign-in methods. Please try again.");
      setBusy(false);
    }
  };
  return <main className="min-h-[100dvh] flex flex-col items-center justify-center gap-5 px-6 text-center bg-background">
    <Fingerprint className="h-12 w-12 text-primary" />
    <h1 className="text-2xl font-semibold">Create a new club</h1>
    <p className="max-w-md text-muted-foreground">New clubs use Internet Identity. Your existing email account and club memberships will stay unchanged.</p>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <Button onClick={() => void proceed()} disabled={busy}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Fingerprint className="mr-2 h-4 w-4" />}Continue with Internet Identity</Button>
    <Button variant="ghost" onClick={() => navigate(-1)} disabled={busy}>Back</Button>
  </main>;
}