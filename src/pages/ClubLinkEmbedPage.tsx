import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import LegalPageEmbed from "@/components/LegalPageEmbed";
import { Button } from "@/components/ui/button";

/**
 * Renders a club-managed link inside the app (native in-app web view).
 * Falls back to a plain redirect on web, matching LegalPageEmbed behaviour.
 */
export default function ClubLinkEmbedPage() {
  const { linkId } = useParams<{ linkId: string }>();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ["club-link", linkId],
    enabled: !!linkId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("club_links")
        .select("id, title, url")
        .eq("id", linkId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data?.url) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background p-6 text-center">
        <p className="text-sm text-muted-foreground">This link is no longer available.</p>
        <Button variant="outline" onClick={() => navigate(-1)}>
          Go back
        </Button>
      </div>
    );
  }

  return <LegalPageEmbed title={data.title} websiteUrl={data.url} />;
}
