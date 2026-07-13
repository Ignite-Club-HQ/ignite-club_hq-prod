import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Users,
  Building2,
  Trophy,
  Network,
  ChevronRight,
  ChevronDown,
  Sparkles,
  Mail,
  Search,
  Ticket,
  Inbox,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";


interface SecondaryOption {
  to: string;
  icon: typeof Users;
  title: string;
  subtitle: string;
}

const MORE_OPTIONS: SecondaryOption[] = [
  {
    to: "/teams/new",
    icon: Users,
    title: "Start a Team",
    subtitle: "One team — chat, schedule and RSVPs.",
  },
  {
    to: "/competitions/new",
    icon: Trophy,
    title: "Start a Competition",
    subtitle: "League, twilight comp or tournament.",
  },
  {
    to: "/associations/new",
    icon: Network,
    title: "Start an Association",
    subtitle: "Umbrella body for several clubs.",
  },
];

/**
 * Empty-state welcome for signed-in users who have no clubs and no teams yet.
 * Emphasises joining an existing club — creation flows are secondary.
 */
export function HomeWelcomeGetStarted({
  firstName,
  email,
}: {
  firstName: string;
  email?: string | null;
}) {
  const { data: pendingInvites = [] } = useQuery({
    queryKey: ["home-welcome-pending-invites", email],
    enabled: !!email,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pending_invites")
        .select("id, club_id, team_id, invite_token, role, clubs:club_id(name), teams:team_id(name)")
        .eq("invited_email", email!.toLowerCase())
        .is("accepted_at", null)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) return [];
      return (data || []) as any[];
    },
  });

  const primaryInvite = pendingInvites[0];
  const inviteTarget =
    primaryInvite?.clubs?.name || primaryInvite?.teams?.name || "your club";
  const inviteHref = primaryInvite?.invite_token
    ? `/join/${primaryInvite.invite_token}`
    : primaryInvite?.club_id
    ? `/clubs/${primaryInvite.club_id}`
    : "/notifications";

  const [findOpen, setFindOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <>
      {/* Primary card: Find or Join a Club (or invitation-specific) */}
      {primaryInvite ? (
        <Card className="border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent">
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
                <Mail className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-semibold leading-tight">
                  You've been invited to {inviteTarget}
                </h2>
                <p className="text-sm text-muted-foreground leading-tight">
                  Hi {firstName} — accept your invite to get started.
                </p>
              </div>
            </div>

            <Button asChild className="w-full h-12 text-base font-semibold shadow-lg">
              <Link to={inviteHref}>Join {inviteTarget}</Link>
            </Button>

            <button
              type="button"
              onClick={() => setFindOpen(true)}
              className="w-full text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              Looking for a different club?
            </button>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent">
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
                <Sparkles className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-semibold leading-tight">
                  Let's connect you with your club, {firstName}
                </h2>
                <p className="text-sm text-muted-foreground leading-tight mt-0.5">
                  Search for your club, accept an invitation or enter an invite code.
                </p>
              </div>
            </div>

            <Button
              onClick={() => setFindOpen(true)}
              className="w-full h-12 text-base font-semibold shadow-lg"
            >
              <Search className="h-5 w-5 mr-2" />
              Find or Join a Club
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Secondary: Start a Club (admins) */}
      <Card className="border-border/60">
        <CardContent className="p-5 space-y-3">
          <div>
            <h3 className="text-sm font-semibold">Setting up Ignite for your organisation?</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              For club administrators setting up a new club.
            </p>
          </div>
          <Button asChild variant="outline" className="w-full h-11">
            <Link to="/clubs/new" className="inline-flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              Start a Club
            </Link>
          </Button>
        </CardContent>
      </Card>

      {/* Collapsed: More setup options */}
      <div className="px-1">
        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          aria-expanded={moreOpen}
        >
          More setup options
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${moreOpen ? "rotate-180" : ""}`}
          />
        </button>

        {moreOpen && (
          <div className="mt-3 space-y-2">
            {MORE_OPTIONS.map(({ to, icon: Icon, title, subtitle }) => (
              <Link
                key={to}
                to={to}
                className="flex items-start gap-3 p-3 rounded-xl bg-card hover:bg-accent/40 active:scale-[0.99] transition-all border border-border/60"
              >
                <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium leading-tight text-foreground/90">{title}</p>
                  <p className="text-xs text-muted-foreground leading-snug mt-0.5">
                    {subtitle}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              </Link>
            ))}
          </div>
        )}
      </div>

      <FindOrJoinClubDialog
        open={findOpen}
        onOpenChange={setFindOpen}
        pendingInvites={pendingInvites}
        email={email}
      />
    </>
  );
}

function FindOrJoinClubDialog({
  open,
  onOpenChange,
  pendingInvites,
  email,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pendingInvites: any[];
  email?: string | null;
}) {
  const navigate = useNavigate();
  
  const [code, setCode] = useState("");
  const [query, setQuery] = useState("");

  const trimmedQuery = query.trim();
  const { data: results = [], isFetching } = useQuery({
    queryKey: ["home-welcome-club-search", trimmedQuery],
    enabled: open && trimmedQuery.length >= 2,
    staleTime: 30_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("clubs")
        .select("id, name, sport, logo_url")
        .is("deleted_at", null)
        .ilike("name", `%${trimmedQuery}%`)
        .order("name")
        .limit(10);
      return (data || []) as any[];
    },
  });

  const handleCode = () => {
    const token = code.trim();
    if (!token) return;
    onOpenChange(false);
    // Accept either full-length club invite tokens or team invite tokens.
    navigate(`/join/${encodeURIComponent(token)}`);
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-md">
        <ResponsiveDialogHeader className="text-left p-4 pb-2">
          <ResponsiveDialogTitle className="text-lg font-semibold">
            Find or Join a Club
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <div className="px-4 pb-5 space-y-5">
          {/* Pending invites */}
          {pendingInvites.length > 0 && (
            <section className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Inbox className="h-3.5 w-3.5" />
                Your invitations
              </div>
              <div className="space-y-2">
                {pendingInvites.map((inv) => {
                  const target =
                    inv.clubs?.name || inv.teams?.name || "Pending invite";
                  const href = inv.invite_token
                    ? `/join/${inv.invite_token}`
                    : inv.club_id
                    ? `/clubs/${inv.club_id}`
                    : "/notifications";
                  return (
                    <Link
                      key={inv.id}
                      to={href}
                      onClick={() => onOpenChange(false)}
                      className="flex items-center gap-3 p-3 rounded-xl border border-primary/30 bg-primary/5 hover:bg-primary/10 active:scale-[0.99] transition-all"
                    >
                      <div className="h-9 w-9 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                        <Mail className="h-4 w-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{target}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          Tap to accept invitation
                        </p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

          {/* Search */}
          <section className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
              <Search className="h-3.5 w-3.5" />
              Search for your club
            </label>
            <Input
              placeholder="e.g. Riverside Football Club"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus={false}
            />
            {trimmedQuery.length >= 2 && (
              <div className="rounded-xl border border-border/60 divide-y divide-border/60 overflow-hidden">
                {isFetching && (
                  <div className="p-3 text-xs text-muted-foreground">Searching…</div>
                )}
                {!isFetching && results.length === 0 && (
                  <div className="p-3 text-xs text-muted-foreground">
                    No clubs found. Ask your club admin for an invite code.
                  </div>
                )}
                {results.map((club) => (
                  <Link
                    key={club.id}
                    to={`/clubs/${club.id}`}
                    onClick={() => onOpenChange(false)}
                    className="flex items-center gap-3 p-3 hover:bg-accent/40 active:bg-accent transition-colors"
                  >
                    {club.logo_url ? (
                      <img
                        src={club.logo_url}
                        alt=""
                        className="h-8 w-8 rounded-lg object-cover shrink-0"
                      />
                    ) : (
                      <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <Building2 className="h-4 w-4 text-primary" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{club.name}</p>
                      {club.sport && (
                        <p className="text-xs text-muted-foreground truncate">
                          {club.sport}
                        </p>
                      )}
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* Invite code */}
          <section className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
              <Ticket className="h-3.5 w-3.5" />
              Have an invite code?
            </label>
            <div className="flex gap-2">
              <Input
                placeholder="Paste invite code or link"
                value={code}
                onChange={(e) => {
                  const v = e.target.value;
                  // Accept full URLs by extracting the last path segment.
                  const match = v.match(/([A-Za-z0-9_-]{6,})\s*$/);
                  setCode(match ? match[1] : v);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCode();
                }}
              />
              <Button onClick={handleCode} disabled={!code.trim()}>
                Join
              </Button>
            </div>
            {!email && (
              <p className="text-[11px] text-muted-foreground">
                Tip: invitations sent to your email will appear above automatically.
              </p>
            )}
          </section>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
