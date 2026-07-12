import { Link } from "react-router-dom";
import { Users, Building2, Trophy, Network, ChevronRight, Sparkles, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface Option {
  to: string;
  icon: typeof Users;
  title: string;
  subtitle: string;
}

const SECONDARY_OPTIONS: Option[] = [
  {
    to: "/teams/new",
    icon: Users,
    title: "Start a Team",
    subtitle: "Quickest path — one team, chat, schedule and RSVPs.",
  },
  {
    to: "/competitions/new",
    icon: Trophy,
    title: "Start a Competition",
    subtitle: "League, twilight comp or tournament across clubs.",
  },
  {
    to: "/associations/new",
    icon: Network,
    title: "Start an Association",
    subtitle: "Federation or umbrella body for several clubs.",
  },
];

/**
 * Empty-state welcome for signed-in users who have no clubs and no teams yet.
 * If a pending invite matches the user's email, shows an invitee-first variant
 * so they're not funnelled into creating a duplicate club.
 */
export function HomeWelcomeGetStarted({
  firstName,
  email,
}: {
  firstName: string;
  email?: string | null;
}) {
  const { data: pendingInvite } = useQuery({
    queryKey: ["home-welcome-pending-invite", email],
    enabled: !!email,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pending_invites")
        .select("id, club_id, team_id, invite_token, role, clubs:club_id(name), teams:team_id(name)")
        .eq("invited_email", email!.toLowerCase())
        .is("accepted_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return null;
      return data as any;
    },
  });

  if (pendingInvite) {
    const target =
      pendingInvite.clubs?.name ||
      pendingInvite.teams?.name ||
      "a club";
    const href = pendingInvite.invite_token
      ? `/join/${pendingInvite.invite_token}`
      : pendingInvite.club_id
      ? `/clubs/${pendingInvite.club_id}`
      : "/notifications";
    return (
      <Card className="border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
              <Mail className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold leading-tight">
                You've been invited, {firstName}!
              </h2>
              <p className="text-sm text-muted-foreground leading-tight">
                Join <span className="font-medium text-foreground">{target}</span> to get started.
              </p>
            </div>
          </div>

          <Button asChild className="w-full h-12 text-base font-semibold shadow-lg">
            <Link to={href}>Accept invite</Link>
          </Button>

          <p className="text-xs text-muted-foreground text-center">
            Not expecting an invite? You can also{" "}
            <Link to="/start" className="text-primary font-medium hover:underline">
              start your own club
            </Link>
            .
          </p>
        </CardContent>
      </Card>
    );
  }


  return (
    <Card className="border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold leading-tight">
              Welcome to Ignite, {firstName}!
            </h2>
            <p className="text-sm text-muted-foreground leading-tight">
              Ready to set up your club?
            </p>
          </div>
        </div>

        <Button asChild className="w-full h-12 text-base font-semibold shadow-lg">
          <Link to="/start" className="inline-flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Start a Club
          </Link>
        </Button>

        <div className="space-y-2">
          {SECONDARY_OPTIONS.map(({ to, icon: Icon, title, subtitle }) => (
            <Link
              key={to}
              to={to}
              className="flex items-start gap-3 p-3 rounded-xl bg-background/60 hover:bg-background active:scale-[0.99] transition-all border border-border/60"
            >
              <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Icon className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold leading-tight">{title}</p>
                <p className="text-xs text-muted-foreground leading-snug mt-0.5">
                  {subtitle}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
            </Link>
          ))}
        </div>

        <p className="text-xs text-muted-foreground text-center">
          Already invited? Check your email — or ask your club admin to resend your invite.
        </p>
      </CardContent>
    </Card>
  );
}
