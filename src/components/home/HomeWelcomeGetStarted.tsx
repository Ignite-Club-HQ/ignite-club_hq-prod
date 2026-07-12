import { Link } from "react-router-dom";
import { Users, Building2, Trophy, Network, ChevronRight, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface Option {
  to: string;
  icon: typeof Users;
  title: string;
  subtitle: string;
}

const OPTIONS: Option[] = [
  {
    to: "/teams/new",
    icon: Users,
    title: "Start a Team",
    subtitle: "Quickest path — one team, chat, schedule and RSVPs.",
  },
  {
    to: "/clubs/new",
    icon: Building2,
    title: "Start a Club",
    subtitle: "Multiple teams, committee, branding and club-wide chat.",
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
 * Sits at the top of the home feed and gives them the four canonical entry points.
 */
export function HomeWelcomeGetStarted({ firstName }: { firstName: string }) {
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
              What would you like to set up first?
            </p>
          </div>
        </div>

        <div className="space-y-2">
          {OPTIONS.map(({ to, icon: Icon, title, subtitle }) => (
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
