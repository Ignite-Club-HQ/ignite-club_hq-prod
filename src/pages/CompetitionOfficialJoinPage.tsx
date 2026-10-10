import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertCircle, CheckCircle2, Loader2, Trophy } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { safeSessionSet, buildAuthPathWithIntent } from "@/lib/authRedirectStorage";

const LABEL: Record<string, string> = { referee: "referee", committee: "committee member" };

/** Landing page for a referee / committee join link or QR code. */
export default function CompetitionOfficialJoinPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const { user, loading: authLoading } = useAuth() as any;
  const navigate = useNavigate();
  const [info, setInfo] = useState<{ competition_id: string; competition_name: string; role: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any).rpc("get_competition_role_link_info", { p_token: token });
      setInfo((data as any[])?.[0] ?? null);
      setLoading(false);
    })();
  }, [token]);

  const nextPath = `/competitions/officials/join?token=${token}`;

  const join = async () => {
    if (!user) {
      safeSessionSet("redirectAfterAuth", nextPath);
      navigate(buildAuthPathWithIntent({ next: nextPath, mode: "signup" }));
      return;
    }
    setJoining(true);
    const { data, error: err } = await (supabase as any).rpc("claim_competition_role_link", { p_token: token });
    setJoining(false);
    if (err) {
      setError(err.message?.includes("invalid_token") ? "This link is no longer valid." : "Something went wrong. Please try again.");
      return;
    }
    setDone(true);
    setTimeout(() => navigate(`/competitions/${data}`), 1200);
  };

  if (loading || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardContent className="py-8 flex flex-col items-center text-center gap-4">
          {!info ? (
            <>
              <AlertCircle className="h-10 w-10 text-destructive" />
              <p className="font-semibold">This link is no longer valid</p>
              <p className="text-sm text-muted-foreground">Ask the competition organisers for a new one.</p>
            </>
          ) : done ? (
            <>
              <CheckCircle2 className="h-10 w-10 text-primary" />
              <p className="font-semibold">You're in!</p>
              <p className="text-sm text-muted-foreground">
                You're now a {LABEL[info.role]} for {info.competition_name}.
              </p>
            </>
          ) : (
            <>
              <Trophy className="h-10 w-10 text-primary" />
              <div>
                <p className="font-semibold text-lg">{info.competition_name}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  You've been invited to join as a {LABEL[info.role]}. You'll also be added to the{" "}
                  {info.role === "referee" ? "referees" : "committee"} chat.
                </p>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button className="w-full" onClick={join} disabled={joining}>
                {joining ? <Loader2 className="h-4 w-4 animate-spin" /> : user ? `Join as ${LABEL[info.role]}` : "Sign up or sign in to join"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
