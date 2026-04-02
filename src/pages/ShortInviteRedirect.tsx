import { useEffect, useState } from "react";
import { useParams, Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import igniteIcon from "@/assets/ignite-icon.png";

export default function ShortInviteRedirect() {
  const { code } = useParams<{ code: string }>();
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!code) {
      setNotFound(true);
      return;
    }

    const resolve = async () => {
      const { data, error } = await supabase
        .from("pending_invites")
        .select("invite_token")
        .eq("short_code", code)
        .maybeSingle();

      if (error || !data?.invite_token) {
        setNotFound(true);
        return;
      }

      setInviteToken(data.invite_token);
    };

    resolve();
  }, [code]);

  if (notFound) {
    return <Navigate to="/auth" replace />;
  }

  if (inviteToken) {
    return <Navigate to={`/join/p/${inviteToken}`} replace />;
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4">
      <img src={igniteIcon} alt="Ignite" className="h-32 w-32 rounded-[2rem]" />
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">Loading invite...</p>
    </div>
  );
}
