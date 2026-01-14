import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { LogOut, Flame, Trophy, Users, Settings, ChevronRight, ChevronDown, Baby, Loader2, Ticket, Crown, CreditCard, MessageSquare, ClipboardList, Calendar, CheckCircle2, Building2, ShieldCheck, UserCog, FileText, Gift, MinusCircle, FileArchive, BarChart3, Lock, Video, Plus, Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import RewardRedemptionCard from "@/components/RewardRedemptionCard";
import { getSportEmoji } from "@/lib/sportEmojis";
import { useClubTheme } from "@/hooks/useClubTheme";
import { useTheme } from "next-themes";
import igniteIcon from "@/assets/ignite-icon.png";
import igniteIconLight from "@/assets/ignite-icon-light.png";

export default function ProfilePage() {
  const { user, profile, signOut } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  const [showAllDuties, setShowAllDuties] = useState(false);
  const [pointsHistoryOpen, setPointsHistoryOpen] = useState(true);
  const [clubPlansOpen, setClubPlansOpen] = useState(true);
  const [teamPlansOpen, setTeamPlansOpen] = useState(true);
  const [myClubsTeamsOpen, setMyClubsTeamsOpen] = useState(true);
  
  // Get active club filter from theme context
  const { activeClubFilter, activeClubTeamIds, activeThemeData } = useClubTheme();
  const { resolvedTheme } = useTheme();

  const { data: isAppAdmin } = useQuery({
    queryKey: ["is-app-admin", user?.id],
    queryFn: async () => {
      if (!user?.id) return false;
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "app_admin")
        .maybeSingle();
      if (error) {
        console.error("Error checking app_admin role:", error);
        return false;
      }
      return !!data;
    },
    enabled: !!user?.id,
    staleTime: 0, // Always check fresh on mount
    refetchOnMount: true,
  });

  // Check if user is team admin or coach
  const { data: isTeamAdminOrCoach } = useQuery({
    queryKey: ["is-team-admin-coach", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .in("role", ["team_admin", "coach"])
        .not("team_id", "is", null)
        .limit(1);
      return data && data.length > 0;
    },
    enabled: !!user,
  });

  // Check if user has pro access through any club (or active club if filter set)
  const { data: hasProAccess } = useQuery({
    queryKey: ["has-pro-access", user?.id, activeClubFilter],
    queryFn: async () => {
      // If active club filter, only check that club
      if (activeClubFilter) {
        const { data: subscription } = await supabase
          .from("club_subscriptions")
          .select("is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
          .eq("club_id", activeClubFilter)
          .maybeSingle();

        return !!(subscription?.is_pro || subscription?.is_pro_football || 
                  subscription?.admin_pro_override || subscription?.admin_pro_football_override);
      }

      // Get all clubs user belongs to
      const { data: roles } = await supabase
        .from("user_roles")
        .select("club_id, team_id")
        .eq("user_id", user!.id);

      if (!roles || roles.length === 0) return false;

      // Get unique club IDs from direct roles
      const directClubIds = roles.map(r => r.club_id).filter(Boolean) as string[];
      
      // Get club IDs from team memberships
      const teamIds = roles.map(r => r.team_id).filter(Boolean) as string[];
      let teamClubIds: string[] = [];
      
      if (teamIds.length > 0) {
        const { data: teams } = await supabase
          .from("teams")
          .select("club_id")
          .in("id", teamIds);
        teamClubIds = (teams || []).map(t => t.club_id).filter(Boolean) as string[];
      }

      const allClubIds = [...new Set([...directClubIds, ...teamClubIds])];
      if (allClubIds.length === 0) return false;

      // Check if any club has pro access
      const { data: subscriptions } = await supabase
        .from("club_subscriptions")
        .select("is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
        .in("club_id", allClubIds);

      return (subscriptions || []).some(sub => 
        sub.is_pro || sub.is_pro_football || sub.admin_pro_override || sub.admin_pro_football_override
      );
    },
    enabled: !!user,
  });

  // Fetch user's clubs and teams for "My Clubs and Teams" section
  const { data: myClubsAndTeams } = useQuery({
    queryKey: ["my-clubs-teams", user?.id, activeClubFilter],
    queryFn: async () => {
      // Get user's roles
      const { data: roles } = await supabase
        .from("user_roles")
        .select("club_id, team_id")
        .eq("user_id", user!.id);

      if (!roles || roles.length === 0) return { clubs: [], teams: [] };

      // Get unique club and team IDs
      const directClubIds = [...new Set(roles.map(r => r.club_id).filter(Boolean))] as string[];
      const teamIds = [...new Set(roles.map(r => r.team_id).filter(Boolean))] as string[];

      // Fetch teams with their club info
      let teams: any[] = [];
      if (teamIds.length > 0) {
        const { data: teamsData } = await supabase
          .from("teams")
          .select("id, name, club_id, clubs (id, name, sport)")
          .in("id", teamIds);
        teams = teamsData || [];
      }

      // Get club IDs from team memberships
      const teamClubIds = teams.map(t => t.club_id).filter(Boolean) as string[];
      const allClubIds = [...new Set([...directClubIds, ...teamClubIds])];

      // Fetch clubs
      let clubs: any[] = [];
      if (allClubIds.length > 0) {
        const { data: clubsData } = await supabase
          .from("clubs")
          .select("id, name, sport, logo_url")
          .in("id", allClubIds);
        clubs = clubsData || [];
      }

      // Filter by active club if set
      if (activeClubFilter) {
        clubs = clubs.filter(c => c.id === activeClubFilter);
        teams = teams.filter(t => t.club_id === activeClubFilter);
      }

      return { clubs, teams };
    },
    enabled: !!user,
  });

  const { data: dutyHistory, isLoading: dutiesLoading } = useQuery({
    queryKey: ["duty-history", user?.id, activeClubFilter],
    queryFn: async () => {
      let query = supabase
        .from("duties")
        .select(`
          id,
          name,
          status,
          points_awarded,
          created_at,
          events (
            id,
            title,
            event_date,
            club_id,
            team_id,
            teams (name),
            clubs (name)
          )
        `)
        .eq("assigned_to", user!.id)
        .order("created_at", { ascending: false });
      
      const { data, error } = await query;
      if (error) throw error;
      
      // Filter by active club if set
      if (activeClubFilter && data) {
        return data.filter((duty: any) => {
          const event = duty.events;
          if (!event) return false;
          // Match if event belongs to active club or to a team in the active club
          return event.club_id === activeClubFilter || activeClubTeamIds.includes(event.team_id);
        });
      }
      
      return data || [];
    },
    enabled: !!user,
  });

  // Fetch reward redemptions for the user (filtered by active club if set)
  const { data: redemptionHistory, isLoading: redemptionsLoading } = useQuery({
    queryKey: ["redemption-history", user?.id, activeClubFilter],
    queryFn: async () => {
      let query = supabase
        .from("reward_redemptions")
        .select(`
          id,
          points_spent,
          status,
          redeemed_at,
          created_at,
          club_id,
          club_rewards (name),
          clubs (name)
        `)
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      
      // Filter by active club if set
      if (activeClubFilter) {
        query = query.eq("club_id", activeClubFilter);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  // Combine duties and redemptions into unified points history
  const pointsHistory = useMemo(() => {
    const items: Array<{
      id: string;
      type: 'earned' | 'spent';
      points: number;
      name: string;
      context: string;
      date: string;
      eventId?: string;
    }> = [];

    // Add duties that awarded points
    if (dutyHistory) {
      dutyHistory.forEach((duty: any) => {
        if (duty.points_awarded && duty.points) {
          const event = duty.events;
          items.push({
            id: duty.id,
            type: 'earned',
            points: duty.points,
            name: duty.name,
            context: event?.teams?.name || event?.clubs?.name || 'Event',
            date: duty.created_at,
            eventId: event?.id,
          });
        }
      });
    }

    // Add redemptions
    if (redemptionHistory) {
      redemptionHistory.forEach((redemption: any) => {
        items.push({
          id: redemption.id,
          type: 'spent',
          points: redemption.points_spent,
          name: redemption.club_rewards?.name || 'Reward',
          context: redemption.clubs?.name || 'Club',
          date: redemption.redeemed_at || redemption.created_at,
        });
      });
    }

    // Sort by date descending
    items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return items;
  }, [dutyHistory, redemptionHistory]);

  // Calculate totals
  const pointsEarned = useMemo(() => {
    return pointsHistory.filter(p => p.type === 'earned').reduce((sum, p) => sum + p.points, 0);
  }, [pointsHistory]);

  const pointsSpent = useMemo(() => {
    return pointsHistory.filter(p => p.type === 'spent').reduce((sum, p) => sum + p.points, 0);
  }, [pointsHistory]);

  // Fetch clubs where user is club_admin or app_admin (can manage club subscriptions)
  // Filter by active club if set
  const { data: upgradableClubs } = useQuery({
    queryKey: ["upgradable-clubs", user?.id, activeClubFilter],
    queryFn: async () => {
      // Check if user is app_admin
      const { data: appAdminRole } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .eq("role", "app_admin")
        .maybeSingle();

      const isAppAdmin = !!appAdminRole;

      // Get club_admin roles
      const { data: roles } = await supabase
        .from("user_roles")
        .select("club_id")
        .eq("user_id", user!.id)
        .eq("role", "club_admin")
        .not("club_id", "is", null);

      let clubIds: string[] = [];

      if (isAppAdmin && !activeClubFilter) {
        // App admins can manage all clubs - fetch all clubs (only when no filter)
        const { data: allClubs } = await supabase
          .from("clubs")
          .select("id, name, sport");
        
        if (!allClubs || allClubs.length === 0) return [];
        
        // Fetch subscriptions separately to ensure fresh data
        const { data: subscriptions } = await supabase
          .from("club_subscriptions")
          .select("club_id, is_pro, is_pro_football, plan, team_limit, expires_at, storage_purchased_gb")
          .in("club_id", allClubs.map(c => c.id));
        
        // Merge subscriptions into clubs
        return allClubs.map(club => ({
          ...club,
          subscription: subscriptions?.find(s => s.club_id === club.id) || null
        }));
      }

      // If active club filter, only show that club (if user has admin access)
      if (activeClubFilter) {
        const hasAccess = isAppAdmin || (roles?.some(r => r.club_id === activeClubFilter));
        if (!hasAccess) return [];
        
        const { data: club } = await supabase
          .from("clubs")
          .select("id, name, sport")
          .eq("id", activeClubFilter)
          .single();
        
        if (!club) return [];
        
        const { data: subscription } = await supabase
          .from("club_subscriptions")
          .select("club_id, is_pro, is_pro_football, plan, team_limit, expires_at, storage_purchased_gb")
          .eq("club_id", activeClubFilter)
          .maybeSingle();
        
        return [{ ...club, subscription: subscription || null }];
      }

      if (!roles || roles.length === 0) return [];

      clubIds = roles.map(r => r.club_id).filter(Boolean) as string[];
      
      const { data: clubs } = await supabase
        .from("clubs")
        .select("id, name, sport")
        .in("id", clubIds);

      if (!clubs || clubs.length === 0) return [];

      // Fetch subscriptions separately to ensure fresh data
      const { data: subscriptions } = await supabase
        .from("club_subscriptions")
        .select("club_id, is_pro, is_pro_football, plan, team_limit, expires_at, storage_purchased_gb")
        .in("club_id", clubIds);

      // Merge subscriptions into clubs
      return clubs.map(club => ({
        ...club,
        subscription: subscriptions?.find(s => s.club_id === club.id) || null
      }));
    },
    enabled: !!user,
    staleTime: 0, // Always fetch fresh data
  });

  // Fetch teams where user is admin/coach (can upgrade)
  // Filter by active club if set
  const { data: upgradableTeams } = useQuery({
    queryKey: ["upgradable-teams", user?.id, activeClubFilter],
    queryFn: async () => {
      // Get user's admin roles
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role, team_id, club_id")
        .eq("user_id", user!.id)
        .in("role", ["team_admin", "coach", "club_admin"]);

      if (!roles || roles.length === 0) return [];

      // Get team IDs where user is team_admin or coach
      let directTeamIds = roles
        .filter(r => r.team_id && (r.role === "team_admin" || r.role === "coach"))
        .map(r => r.team_id);

      // Get club IDs where user is club_admin
      let adminClubIds = roles
        .filter(r => r.club_id && r.role === "club_admin")
        .map(r => r.club_id);

      // If active club filter, only include teams from that club
      if (activeClubFilter) {
        directTeamIds = directTeamIds.filter(teamId => activeClubTeamIds.includes(teamId!));
        adminClubIds = adminClubIds.filter(clubId => clubId === activeClubFilter);
      }

      // Fetch teams with basic info
      let teamsQuery = supabase
        .from("teams")
        .select(`
          id,
          name,
          club_id,
          clubs (name, sport),
          team_subscriptions (is_pro, is_pro_football)
        `);

      // Apply active club filter if set
      if (activeClubFilter) {
        teamsQuery = teamsQuery.eq("club_id", activeClubFilter);
      }

      // Build OR condition for teams
      if (directTeamIds.length > 0 && adminClubIds.length > 0) {
        teamsQuery = teamsQuery.or(`id.in.(${directTeamIds.join(',')}),club_id.in.(${adminClubIds.join(',')})`);
      } else if (directTeamIds.length > 0) {
        teamsQuery = teamsQuery.in("id", directTeamIds);
      } else if (adminClubIds.length > 0) {
        teamsQuery = teamsQuery.in("club_id", adminClubIds);
      } else {
        return [];
      }

      const { data: teams } = await teamsQuery;
      if (!teams || teams.length === 0) return [];

      // Get unique club IDs from the teams
      const clubIds = [...new Set(teams.map(t => t.club_id).filter(Boolean))];
      
      // Fetch club subscriptions separately for reliable data
      const { data: clubSubs } = await supabase
        .from("club_subscriptions")
        .select("club_id, is_pro, is_pro_football, plan")
        .in("club_id", clubIds);

      // Merge club subscription data into teams
      const clubSubMap = new Map(clubSubs?.map(cs => [cs.club_id, cs]) || []);
      
      return teams.map(team => ({
        ...team,
        clubSubscription: clubSubMap.get(team.club_id) || null
      }));
    },
    enabled: !!user,
  });

  const handleSignOut = async () => {
    setSigningOut(true);
    await signOut();
    toast({ title: "Signed out successfully" });
    navigate("/auth");
  };

  return (
    <div className="py-6 space-y-6">
      {/* Profile Header */}
      <div className="flex items-center gap-4">
        <Avatar className="h-20 w-20 border-4 border-primary/20">
          <AvatarImage src={profile?.avatar_url || undefined} />
          <AvatarFallback className="p-0">
            <img src={resolvedTheme === 'light' ? igniteIconLight : igniteIcon} alt="Profile" className="h-full w-full object-cover rounded-full" />
          </AvatarFallback>
        </Avatar>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{profile?.display_name}</h1>
          <p className="text-sm text-muted-foreground">{user?.email}</p>
        </div>
      </div>

      {/* Ignite Points & Rewards Card */}
      <RewardRedemptionCard />

      {/* My Clubs and Teams Section */}
      <Collapsible open={myClubsTeamsOpen} onOpenChange={setMyClubsTeamsOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="pb-3 cursor-pointer hover:bg-muted/50 transition-colors">
              <CardTitle className="text-lg flex items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" />
                My Clubs and Teams
                <ChevronDown className={`h-4 w-4 ml-auto transition-transform ${myClubsTeamsOpen ? "rotate-180" : ""}`} />
              </CardTitle>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0 space-y-4">
              {/* Clubs */}
              {myClubsAndTeams?.clubs && myClubsAndTeams.clubs.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">Clubs</p>
                  {myClubsAndTeams.clubs.map((club: any) => (
                    <div
                      key={club.id}
                      className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/50 cursor-pointer transition-colors"
                      onClick={() => navigate(`/clubs/${club.id}`)}
                    >
                      {club.logo_url ? (
                        <img src={club.logo_url} alt={club.name} className="h-10 w-10 rounded-lg object-cover" />
                      ) : (
                        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                          <Building2 className="h-5 w-5 text-primary" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{club.name}</p>
                        {club.sport && (
                          <p className="text-xs text-muted-foreground">{getSportEmoji(club.sport)} {club.sport}</p>
                        )}
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    </div>
                  ))}
                </div>
              )}

              {/* Teams */}
              {myClubsAndTeams?.teams && myClubsAndTeams.teams.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">Teams</p>
                  {myClubsAndTeams.teams.map((team: any) => (
                    <div
                      key={team.id}
                      className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/50 cursor-pointer transition-colors"
                      onClick={() => navigate(`/teams/${team.id}`)}
                    >
                      <div className="h-10 w-10 rounded-lg bg-secondary/50 flex items-center justify-center">
                        <Users className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{team.name}</p>
                        {team.clubs && (
                          <p className="text-xs text-muted-foreground truncate">
                            {getSportEmoji(team.clubs.sport)} {team.clubs.name}
                          </p>
                        )}
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    </div>
                  ))}
                </div>
              )}

              {/* Empty state or create/join options */}
              {(!myClubsAndTeams?.clubs?.length && !myClubsAndTeams?.teams?.length) && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  You're not a member of any clubs or teams yet.
                </p>
              )}

              {/* Create/Join Button */}
              <Button
                variant="outline"
                className="w-full"
                onClick={() => navigate("/clubs")}
              >
                <Plus className="h-4 w-4 mr-2" />
                Discover or Create Club
              </Button>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      <div className="space-y-2">
        <MenuCard 
          icon={Baby} 
          label="Manage Children" 
          onClick={() => navigate("/children")}
        />
        <MenuCard 
          icon={Users} 
          label="My Roles" 
          onClick={() => navigate("/roles")}
        />
        <MenuCard 
          icon={Settings} 
          label="Edit Profile" 
          onClick={() => navigate("/edit-profile")}
        />
        {isTeamAdminOrCoach && (
          <MenuCard 
            icon={FileText} 
            label="Player Stats Reports" 
            onClick={() => navigate("/reports/player-stats")}
          />
        )}
        {isAppAdmin && (
          <>
            <MenuCard 
              icon={Ticket} 
              label="Manage Promo Codes" 
              onClick={() => navigate("/admin/promo-codes")}
            />
            <MenuCard 
              icon={CreditCard} 
              label="Stripe Settings" 
              onClick={() => navigate("/admin/stripe")}
            />
            <MenuCard 
              icon={MessageSquare} 
              label="Manage Feedback" 
              onClick={() => navigate("/admin/feedback")}
            />
            <MenuCard 
              icon={UserCog} 
              label="User Management" 
              onClick={() => navigate("/admin/users")}
            />
            <MenuCard 
              icon={FileArchive} 
              label="Club Backups" 
              onClick={() => navigate("/admin/backups")}
            />
            <MenuCard 
              icon={BarChart3} 
              label="Sponsor Analytics" 
              onClick={() => navigate("/admin/sponsor-analytics")}
            />
            <MenuCard 
              icon={Megaphone} 
              label="Manage Ads" 
              onClick={() => navigate("/admin/ads")}
            />
          </>
        )}
      </div>

      {/* Points History Section */}
      {hasProAccess ? (
        <Collapsible open={pointsHistoryOpen} onOpenChange={setPointsHistoryOpen}>
          <Card>
            <CollapsibleTrigger asChild>
              <CardHeader className="pb-3 cursor-pointer hover:bg-muted/50 transition-colors">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Flame className="h-5 w-5 text-primary" />
                  Points History
                  <ChevronDown className={`h-4 w-4 ml-auto transition-transform ${pointsHistoryOpen ? '' : '-rotate-90'}`} />
                </CardTitle>
              </CardHeader>
            </CollapsibleTrigger>
            
            {/* Summary - Always visible */}
            <CardContent className="pt-0 pb-3">
              <div className="grid grid-cols-3 gap-2">
                <div className="text-center p-3 bg-muted rounded-lg">
                  <div className="text-2xl font-bold text-green-600">+{pointsEarned}</div>
                  <div className="text-xs text-muted-foreground">Earned</div>
                </div>
                <div className="text-center p-3 bg-muted rounded-lg">
                  <div className="text-2xl font-bold text-red-500">{pointsSpent}</div>
                  <div className="text-xs text-muted-foreground">Spent</div>
                </div>
                <div className="text-center p-3 bg-muted rounded-lg">
                  <div className="text-2xl font-bold text-primary">{profile?.ignite_points || 0}</div>
                  <div className="text-xs text-muted-foreground">Balance</div>
                </div>
              </div>
            </CardContent>

            <CollapsibleContent>
              <CardContent className="space-y-3 pt-0">
                {(dutiesLoading || redemptionsLoading) ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : pointsHistory.length > 0 ? (
                  <>
                    {/* Points List */}
                    <div className="space-y-2">
                      {(showAllDuties ? pointsHistory : pointsHistory.slice(0, 5)).map((item) => {
                        const isEarned = item.type === 'earned';
                        
                        return (
                          <div 
                            key={item.id}
                            className={`flex items-start gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors ${item.eventId ? 'cursor-pointer' : ''}`}
                            onClick={() => item.eventId && navigate(`/events/${item.eventId}`)}
                          >
                            <div className={`p-2 rounded-full ${isEarned ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
                              {isEarned ? (
                                <CheckCircle2 className="h-4 w-4 text-green-600" />
                              ) : (
                                <Gift className="h-4 w-4 text-red-500" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium truncate">{item.name}</span>
                                <Badge 
                                  variant="secondary" 
                                  className={`text-xs shrink-0 ${isEarned ? 'bg-green-500/20 text-green-700' : 'bg-red-500/20 text-red-600'}`}
                                >
                                  {isEarned ? '+' : ''}{item.points} pts
                                </Badge>
                              </div>
                              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                                <span>{item.context}</span>
                                <span>•</span>
                                <span>{format(new Date(item.date), "d MMM yyyy")}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    
                    {pointsHistory.length > 5 && (
                      <Button 
                        variant="ghost" 
                        className="w-full text-sm"
                        onClick={() => setShowAllDuties(!showAllDuties)}
                      >
                        {showAllDuties ? "Show less" : `Show all ${pointsHistory.length} entries`}
                      </Button>
                    )}
                  </>
                ) : (
                  <div className="text-center py-6 text-muted-foreground">
                    <ClipboardList className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No points activity yet</p>
                    <p className="text-xs">Complete duties at events to earn Ignite points!</p>
                  </div>
                )}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      ) : (
        <Card className="opacity-75">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Flame className="h-5 w-5 text-muted-foreground" />
              Points History
              <div className="ml-auto flex items-center gap-1.5">
                <Lock className="h-4 w-4 text-muted-foreground" />
                <Badge variant="secondary" className="text-xs">Pro Only</Badge>
              </div>
            </CardTitle>
          </CardHeader>
        </Card>
      )}

      {/* Manage Plans Section - Moved to bottom */}
      {((upgradableClubs && upgradableClubs.length > 0) || (upgradableTeams && upgradableTeams.length > 0)) && (
        <div id="manage-plans-section" className="space-y-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Crown className="h-5 w-5 text-primary" />
            Manage Plans
          </h2>
          
          {/* Club Subscriptions */}
          {upgradableClubs && upgradableClubs.length > 0 && (
            <Collapsible open={clubPlansOpen} onOpenChange={setClubPlansOpen}>
              <CollapsibleTrigger className="flex items-center gap-1 w-full text-sm text-muted-foreground hover:text-foreground transition-colors">
                <Building2 className="h-4 w-4" />
                <span>Club Plans ({upgradableClubs.length})</span>
                <ChevronDown className={`h-4 w-4 ml-auto transition-transform ${clubPlansOpen ? '' : '-rotate-90'}`} />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-2 mt-2">
                {upgradableClubs.map((club: any) => {
                  const subscription = club.subscription;
                  const isPro = subscription?.is_pro === true;
                  const isProFootball = subscription?.is_pro_football === true;
                  const plan = subscription?.plan || "starter";
                  const planDisplay = plan.charAt(0).toUpperCase() + plan.slice(1);
                  const sport = club.sport?.toLowerCase() || "";
                  const isSoccerClub = sport.includes("soccer") || sport.includes("football") || sport.includes("futsal");
                  
                  // Determine current plan display
                  let currentPlan = "Free";
                  let planBadgeVariant: "default" | "outline" = "outline";
                  
                  if (isProFootball) {
                    currentPlan = `Pro Football - ${planDisplay}`;
                    planBadgeVariant = "default";
                  } else if (isPro) {
                    currentPlan = `Pro - ${planDisplay}`;
                    planBadgeVariant = "default";
                  }
                  
                  const hasActivePlan = isPro || isProFootball;
                  const isHighestTier = isProFootball; // Pro Football is highest
                  
                  return (
                    <Card 
                      key={club.id}
                      className="cursor-pointer hover:border-primary/50 transition-colors"
                      onClick={() => navigate(`/clubs/${club.id}/upgrade`)}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex-1">
                            <span className="font-medium">{club.name}</span>
                            <p className="text-sm text-muted-foreground flex items-center gap-1">
                              <span>{getSportEmoji(club.sport)}</span>
                              <span className="capitalize">{club.sport || "Sport not set"}</span>
                            </p>
                          </div>
                          <ChevronRight className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge 
                            variant={planBadgeVariant}
                            className={currentPlan === "Free" ? "text-muted-foreground" : ""}
                          >
                            {currentPlan === "Free" ? "No Plan" : currentPlan}
                          </Badge>
                          {/* Only show upgrade options if no active plan */}
                          {!hasActivePlan && (
                            <>
                              <Badge variant="outline" className="text-primary border-primary">
                                Upgrade
                              </Badge>
                            </>
                          )}
                          {/* Show upgrade to Pro Football if only on Pro (not highest tier) */}
                          {isPro && !isProFootball && isSoccerClub && (
                            <Badge variant="outline" className="text-primary border-primary">
                              Upgrade to Pro Football
                            </Badge>
                          )}
                          {/* Show downgrade option if has active plan */}
                          {hasActivePlan && (
                            <Badge variant="outline" className="text-destructive border-destructive">
                              {isHighestTier ? "Downgrade" : "Manage Plan"}
                            </Badge>
                          )}
                          {subscription?.storage_purchased_gb > 0 && (
                            <Badge variant="secondary" className="text-xs">
                              +{subscription.storage_purchased_gb}GB Storage
                            </Badge>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* Team Subscriptions */}
          {upgradableTeams && upgradableTeams.length > 0 && (
            <Collapsible open={teamPlansOpen} onOpenChange={setTeamPlansOpen}>
              <CollapsibleTrigger className="flex items-center gap-1 w-full text-sm text-muted-foreground hover:text-foreground transition-colors">
                <Users className="h-4 w-4" />
                <span>Team Plans ({upgradableTeams.length})</span>
                <ChevronDown className={`h-4 w-4 ml-auto transition-transform ${teamPlansOpen ? '' : '-rotate-90'}`} />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-2 mt-2">
                {upgradableTeams.map((team: any) => {
                  const subscription = team.team_subscriptions?.[0];
                  const teamIsPro = subscription?.is_pro;
                  const teamIsProFootball = subscription?.is_pro_football;
                  const sport = team.clubs?.sport?.toLowerCase() || "";
                  const isSoccerTeam = sport.includes("soccer") || sport.includes("football") || sport.includes("futsal");
                  
                  // Use the clubSubscription we fetched separately (more reliable)
                  const clubSub = team.clubSubscription;
                  const clubHasPro = clubSub?.is_pro === true;
                  const clubHasProFootball = clubSub?.is_pro_football === true;
                  
                  // Effective plan considering club inheritance
                  // If club has Pro Football, team is effectively Pro Football
                  // If club has Pro, team is effectively Pro
                  const effectiveIsProFootball = teamIsProFootball || clubHasProFootball;
                  const effectiveIsPro = teamIsPro || clubHasPro || clubHasProFootball; // Pro Football includes Pro
                  
                  let currentPlan = "Free";
                  let planSource = "";
                  if (effectiveIsProFootball) {
                    currentPlan = "Pro Football";
                    planSource = (clubHasProFootball && !teamIsProFootball) ? " (via Club)" : "";
                  } else if (effectiveIsPro) {
                    currentPlan = "Pro";
                    planSource = ((clubHasPro || clubHasProFootball) && !teamIsPro) ? " (via Club)" : "";
                  }
                  
                  // Check if access is from club (team shouldn't show individual upgrade/downgrade)
                  const hasClubAccess = clubHasPro || clubHasProFootball;
                  
                  return (
                    <Card 
                      key={team.id}
                      className="cursor-pointer hover:border-primary/50 transition-colors"
                      onClick={() => navigate(`/teams/${team.id}/upgrade`)}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex-1">
                            <span className="font-medium">{team.name}</span>
                            <p className="text-sm text-muted-foreground">{team.clubs?.name}</p>
                          </div>
                          <ChevronRight className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge 
                            variant={currentPlan === "Free" ? "outline" : "default"}
                            className={currentPlan === "Free" ? "text-muted-foreground" : ""}
                          >
                            {currentPlan}{planSource}
                          </Badge>
                          {/* Only show upgrade options if no club access */}
                          {!hasClubAccess && currentPlan === "Free" && (
                            <>
                              <Badge variant="outline" className="text-primary border-primary">
                                Pro $25/mo
                              </Badge>
                              {isSoccerTeam && (
                                <Badge variant="outline" className="text-primary border-primary">
                                  Pro Football $40/mo
                                </Badge>
                              )}
                            </>
                          )}
                          {/* Can upgrade to Pro Football if team has Pro but not Pro Football, and club doesn't have Pro Football */}
                          {!hasClubAccess && currentPlan === "Pro" && isSoccerTeam && !teamIsProFootball && (
                            <Badge variant="outline" className="text-primary border-primary">
                              Upgrade to Pro Football
                            </Badge>
                          )}
                          {/* Show downgrade only for team's own subscription, not club-inherited */}
                          {!hasClubAccess && (teamIsPro || teamIsProFootball) && (
                            <Badge variant="outline" className="text-destructive border-destructive">
                              Downgrade
                            </Badge>
                          )}
                          {/* Show managed by club notice */}
                          {hasClubAccess && (
                            <Badge variant="outline" className="text-muted-foreground">
                              Managed via Club
                            </Badge>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
      )}

      <Separator />

      {/* Sign Out */}
      <Button 
        variant="destructive" 
        className="w-full" 
        onClick={handleSignOut}
        disabled={signingOut}
      >
        {signingOut ? (
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
        ) : (
          <LogOut className="h-4 w-4 mr-2" />
        )}
        Sign Out
      </Button>
    </div>
  );
}

function MenuCard({ 
  icon: Icon, 
  label, 
  onClick 
}: { 
  icon: React.ElementType; 
  label: string; 
  onClick: () => void;
}) {
  return (
    <Card 
      className="cursor-pointer hover:border-primary/50 transition-colors"
      onClick={onClick}
    >
      <CardContent className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <span className="font-medium">{label}</span>
        </div>
        <ChevronRight className="h-5 w-5 text-muted-foreground" />
      </CardContent>
    </Card>
  );
}
