import { useState, useEffect, lazy, Suspense, useRef } from "react";
import { Share } from "@capacitor/share";
import { createMemberCheckout, listenForPaymentStatus } from "@/lib/memberCheckout";
import { Capacitor } from "@capacitor/core";
import { getShareUrl } from "@/lib/shareUtils";
import { createPortal } from "react-dom";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Clock, MapPin, Users, CheckCircle2, Circle, Loader2, Plus, Trash2, UserPlus, MessageSquare, Baby, Pencil, XCircle, Bell, DollarSign, Check, Share2, Play, Flame, MoreVertical } from "lucide-react";
import { getEventTypeLabel } from "@/lib/eventTypeLabel";
import { RecurringEventActionDialog } from "@/components/RecurringEventActionDialog";
import { CancelEventConfirmDialog } from "@/components/CancelEventConfirmDialog";
import { RecurringCancelEventDialog } from "@/components/RecurringCancelEventDialog";
import { AddDutySheet } from "@/components/AddDutySheet";
import { AssignDutySheet } from "@/components/AssignDutySheet";
import PlayerOfMatchSelector from "@/components/PlayerOfMatchSelector";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { format, parseISO } from "date-fns";
import { GoogleMapEmbed } from "@/components/GoogleMapEmbed";
import { EventSponsorsSection } from "@/components/EventSponsorsSection";
import { EventGuestsManager } from "@/components/EventGuestsManager";
import { EventGroupsManager } from "@/components/EventGroupsManager";
import { EventViewsAdminSection } from "@/components/EventViewsAdminSection";
import { useEventViewTracking } from "@/hooks/useEventViews";
import { awardEarlyRsvpPoints } from "@/lib/earlyRsvpPoints";


// Lazy load PitchBoard for game events
const PitchBoard = lazy(() => import("@/components/pitch/PitchBoard"));

type EventType = "game" | "training" | "social";
type RsvpStatus = "going" | "maybe" | "not_going";
type DutyStatus = "open" | "completed";

const PRESET_DUTIES = ["Canteen", "Linesperson", "Linemarker", "Referee"];

const eventTypeColors: Record<EventType, string> = {
  game: "bg-destructive/20 text-destructive",
  training: "bg-primary/20 text-primary",
  social: "bg-warning/20 text-warning",
};

const rsvpOptions: { value: RsvpStatus; label: string; icon: string }[] = [
  { value: "going", label: "Going", icon: "✅" },
  { value: "maybe", label: "Maybe", icon: "🤔" },
  { value: "not_going", label: "Can't Go", icon: "❌" },
];

// Helper component for attendee display with payment status and admin RSVP controls
const AttendeeCard = ({ 
  rsvp, 
  hasPaid, 
  isAdmin, 
  showPrice, 
  onTogglePayment,
  isPending,
  isMiniLeague,
  onChangeStatus,
  currentStatus,
}: { 
  rsvp: any; 
  hasPaid?: boolean;
  isAdmin?: boolean;
  showPrice?: boolean;
  onTogglePayment?: () => void;
  isPending?: boolean;
  isMiniLeague?: boolean;
  onChangeStatus?: (status: RsvpStatus) => void;
  currentStatus?: RsvpStatus;
}) => {
  const isChildRsvp = !!rsvp.child_id;
  const isMiniLeaguePlayerRsvp = !!rsvp.mini_league_player_id;
  const displayName = isMiniLeaguePlayerRsvp 
    ? rsvp.mini_league_players?.name 
    : isChildRsvp 
      ? rsvp.children?.name 
      : rsvp.profiles?.display_name;
  const avatarInitial = displayName?.charAt(0)?.toUpperCase() || "?";

  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8">
            {!isChildRsvp && !isMiniLeaguePlayerRsvp && <AvatarImage src={rsvp.profiles?.avatar_url || undefined} />}
            <AvatarFallback className={`text-xs ${(isChildRsvp || isMiniLeaguePlayerRsvp) ? 'bg-secondary' : ''}`}>
              {avatarInitial}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium truncate">{displayName}</span>
              {isChildRsvp && !isMiniLeague && (
                <Badge variant="outline" className="text-xs shrink-0">
                  Child
                </Badge>
              )}
              {showPrice && hasPaid && (
                <Badge variant="default" className="text-xs bg-primary shrink-0">
                  <Check className="h-3 w-3 mr-1" />
                  Paid
                </Badge>
              )}
            </div>
            {rsvp.notes && (
              <p className="text-sm text-muted-foreground mt-1 truncate">{rsvp.notes}</p>
            )}
          </div>
          {/* Admin RSVP status change buttons - admins and coaches can override for all events */}
          {isAdmin && onChangeStatus && (
            <div className="flex gap-1 shrink-0">
              {rsvpOptions.filter(opt => opt.value !== currentStatus).map(({ value, icon }) => (
                <Button
                  key={value}
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => onChangeStatus(value)}
                  disabled={isPending}
                  title={`Change to ${value}`}
                >
                  <span className="text-sm">{icon}</span>
                </Button>
              ))}
            </div>
          )}
          {/* Admin-only payment toggle */}
          {isAdmin && showPrice && onTogglePayment && (
            <Button
              variant={hasPaid ? "secondary" : "outline"}
              size="sm"
              onClick={onTogglePayment}
              disabled={isPending}
              className="shrink-0"
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : hasPaid ? (
                <>
                  <Check className="h-4 w-4 mr-1" />
                  Paid
                </>
              ) : (
                <>
                  <DollarSign className="h-4 w-4 mr-1" />
                  Mark Paid
                </>
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user, profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [addDutyOpen, setAddDutyOpen] = useState(false);
  const [newDutyName, setNewDutyName] = useState("");
  const [selectedPresetDuty, setSelectedPresetDuty] = useState<string>("");
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [selectedDutyId, setSelectedDutyId] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [showAllRoles, setShowAllRoles] = useState(false);
  
  // Rich RSVP state
  const [rsvpNotes, setRsvpNotes] = useState("");
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [reminderDialogOpen, setReminderDialogOpen] = useState(false);
  const [showPitchBoard, setShowPitchBoard] = useState(false);
  
  // Mini league player overrides for match generation
  const [playerOverrides, setPlayerOverrides] = useState<Record<string, boolean>>({});
  const isSharingEventRef = useRef(false);

  // Track when user views this event
  useEventViewTracking(id, user?.id);

  const { data: event, isLoading } = useQuery({
    queryKey: ["event", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select(`*, teams (name), clubs (name, is_pro, sport)`)
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: rsvps } = useQuery({
    queryKey: ["event-rsvps", id],
    queryFn: async () => {
      // Fetch rsvps first
      const { data: rsvpData, error: rsvpError } = await supabase
        .from("rsvps")
        .select(`*, mini_league_players (id, name)`)
        .eq("event_id", id!);
      if (rsvpError) throw rsvpError;
      
      // Now fetch related profiles and children separately to avoid FK detection issues
      const userIds = rsvpData.filter(r => r.user_id).map(r => r.user_id);
      const childIds = rsvpData.filter(r => r.child_id).map(r => r.child_id);
      
      let profilesMap: Record<string, { display_name: string | null; avatar_url: string | null }> = {};
      let childrenMap: Record<string, { id: string; name: string }> = {};
      
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, display_name, avatar_url")
          .in("id", userIds);
        if (profiles) {
          profilesMap = Object.fromEntries(profiles.map(p => [p.id, { display_name: p.display_name, avatar_url: p.avatar_url }]));
        }
      }
      
      if (childIds.length > 0) {
        const { data: children } = await supabase
          .from("children")
          .select("id, name")
          .in("id", childIds);
        if (children) {
          childrenMap = Object.fromEntries(children.map(c => [c.id, { id: c.id, name: c.name }]));
        }
      }
      
      // Combine the data
      return rsvpData.map(rsvp => ({
        ...rsvp,
        profiles: rsvp.user_id ? profilesMap[rsvp.user_id] || null : null,
        children: rsvp.child_id ? childrenMap[rsvp.child_id] || null : null,
      }));
    },
    enabled: !!id,
  });

  // Populate form with existing RSVP data
  const myRsvp = rsvps?.find((r) => r.user_id === user?.id && !r.child_id);
  
  useEffect(() => {
    if (myRsvp) {
      setRsvpNotes((myRsvp as any).notes || "");
    }
  }, [myRsvp?.id]);

  const { data: duties } = useQuery({
    queryKey: ["event-duties", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("duties")
        .select(`*, profiles:assigned_to (display_name, avatar_url)`)
        .eq("event_id", id!);
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  // Check if user is app admin (global override)
  const { data: isAppAdmin } = useQuery({
    queryKey: ["is-app-admin", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", user!.id)
        .eq("role", "app_admin")
        .maybeSingle();
      return !!data;
    },
    enabled: !!user,
  });

  // Check if user is admin for this event
  const { data: isAdmin } = useQuery({
    queryKey: ["event-admin-check", id, user?.id, event?.club_id, event?.team_id, event?.mini_league_id],
    queryFn: async () => {
      if (!event) return false;
      
      // First check for club_admin role (always applies to club events)
      const { data: clubAdminData } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .eq("club_id", event.club_id)
        .eq("role", "club_admin")
        .maybeSingle();
      
      if (clubAdminData) return true;
      
      // For team-specific events, also check team_admin/coach roles
      if (event.team_id) {
        const { data: teamRoleData } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user!.id)
          .eq("team_id", event.team_id)
          .in("role", ["team_admin", "coach"]);
        
        if (teamRoleData && teamRoleData.length > 0) return true;
      }
      
      // For mini-league events, also check league_admin/coach roles
      if (event.mini_league_id) {
        const { data: leagueAdminData } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user!.id)
          .eq("club_id", event.club_id)
          .in("role", ["league_admin", "coach"]);
        
        if (leagueAdminData && leagueAdminData.length > 0) return true;
      }
      
      return false;
    },
    enabled: !!user && !!event,
  });

  // Check if team has Pro Football subscription (for pitch board) or club has Pro Football
  const { data: hasProFootball, isLoading: isLoadingTeamPro } = useQuery({
    queryKey: ["team-pro-football-status", event?.team_id, event?.club_id],
    queryFn: async () => {
      if (!event?.team_id) return false;
      
      // Check team-level Pro Football
      const { data: teamSub } = await supabase
        .from("team_subscriptions")
        .select("is_pro_football")
        .eq("team_id", event.team_id)
        .maybeSingle();
      
      if (teamSub?.is_pro_football) return true;
      
      // Check club-level Pro Football
      if (event?.club_id) {
        const { data: clubSub } = await supabase
          .from("club_subscriptions")
          .select("is_pro_football")
          .eq("club_id", event.club_id)
          .maybeSingle();
        
        if (clubSub?.is_pro_football) return true;
      }
      
      return false;
    },
    enabled: !!event?.team_id,
  });
  
  // Check if team/club has Pro subscription (for other features like RSVP reminders)
  const { data: hasTeamPro, isLoading: isLoadingHasTeamPro } = useQuery({
    queryKey: ["team-pro-status", event?.team_id, event?.club_id],
    queryFn: async () => {
      // First check team-level subscription
      if (event?.team_id) {
        const { data: teamSub } = await supabase
          .from("team_subscriptions")
          .select("is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
          .eq("team_id", event.team_id)
          .maybeSingle();
        if (teamSub?.is_pro || teamSub?.is_pro_football || teamSub?.admin_pro_override || teamSub?.admin_pro_football_override) {
          return true;
        }
      }
      
      // Then check club-level subscription
      if (event?.club_id) {
        const { data: clubSub } = await supabase
          .from("club_subscriptions")
          .select("is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
          .eq("club_id", event.club_id)
          .maybeSingle();
        if (clubSub?.is_pro || clubSub?.is_pro_football || clubSub?.admin_pro_override || clubSub?.admin_pro_football_override) {
          return true;
        }
      }
      
      return false;
    },
    enabled: !!event?.team_id || !!event?.club_id,
  });

  // Pro feature check: duty points only for Pro clubs or app_admin
  const canAwardDutyPoints = isAppAdmin || event?.clubs?.is_pro;
  
  // Pro feature check for RSVP reminders - check team OR club subscription
  const canSendReminders = !isLoadingHasTeamPro && hasTeamPro === true;

  // Check if club is soccer/football for pitch board
  const isSoccerClub = event?.clubs?.sport?.toLowerCase().includes('soccer') || 
                       event?.clubs?.sport?.toLowerCase().includes('football');
  
  // Check if user can access pitch board (coach/admin) - requires Pro Football subscription
  const canAccessPitchBoard = !!(isAdmin || isAppAdmin) && event?.type === 'game' && !!event?.team_id && !!isSoccerClub && hasProFootball === true;

  // Fetch team members for pitch board
  const { data: teamMembers } = useQuery({
    queryKey: ["team-members-for-pitch", event?.team_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("user_id, role, profiles:user_id (id, display_name, avatar_url)")
        .eq("team_id", event!.team_id!);
      if (error) throw error;
      return data;
    },
    enabled: !!event?.team_id && !!canAccessPitchBoard,
  });

  // Fetch team subscription for pitch board settings
  const { data: teamSubscription } = useQuery({
    queryKey: ["team-subscription-for-pitch", event?.team_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("team_subscriptions")
        .select("*")
        .eq("team_id", event!.team_id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!event?.team_id && !!canAccessPitchBoard,
  });

  // Fetch team/club members for duty assignment and not responded list (with roles)
  const { data: membersWithRoles } = useQuery({
    queryKey: ["event-members-with-roles", event?.club_id, event?.team_id],
    queryFn: async () => {
      const query = supabase
        .from("user_roles")
        .select("user_id, role, profiles:user_id (id, display_name, avatar_url)");
      
      if (event?.team_id) {
        query.eq("team_id", event.team_id);
      } else {
        query.eq("club_id", event!.club_id);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      
      // Group roles by user_id
      const userRolesMap = new Map<string, { profile: any; roles: string[] }>();
      data.filter(m => m.profiles).forEach(m => {
        const existing = userRolesMap.get(m.user_id);
        if (existing) {
          if (!existing.roles.includes(m.role)) {
            existing.roles.push(m.role);
          }
        } else {
          userRolesMap.set(m.user_id, { profile: m.profiles, roles: [m.role] });
        }
      });
      
      return Array.from(userRolesMap.entries()).map(([userId, data]) => ({
        ...data.profile,
        roles: data.roles,
      }));
    },
    enabled: !!event,
  });

  // Fetch mini-league players for mini-league events (for not responded list)
  const { data: miniLeaguePlayers } = useQuery({
    queryKey: ["mini-league-players-for-event", event?.mini_league_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mini_league_players")
        .select("id, name, parent_user_id, child_id")
        .eq("mini_league_id", event!.mini_league_id!);
      if (error) throw error;
      return data || [];
    },
    enabled: !!event?.mini_league_id,
  });

  // For social events, always show all members; for training/games, use toggle
  const isSocialEvent = event?.type === "social";
  const effectiveShowAll = isSocialEvent ? true : showAllRoles;
  const isMiniLeagueEvent = !!event?.mini_league_id;
  const eventTypeLabel = isMiniLeagueEvent ? "Session" : getEventTypeLabel(event?.type);

  // Filter members based on showAllRoles toggle
  const members = membersWithRoles;
  const playerMembers = membersWithRoles?.filter((m: any) => m.roles?.includes("player")) || [];

  // Fetch mini league duty assignees (RSVP'd parents + club admins + league admins, excluding players)
  const { data: miniLeagueDutyAssignees } = useQuery({
    queryKey: ["mini-league-duty-assignees-session", event?.mini_league_id, id],
    queryFn: async () => {
      const miniLeagueId = event!.mini_league_id!;
      
      // Get mini league to find the club_id
      const { data: league, error: leagueError } = await supabase
        .from("mini_leagues")
        .select("club_id")
        .eq("id", miniLeagueId)
        .single();
      if (leagueError) throw leagueError;
      
      // Get RSVPs for this event (only user RSVPs, not children/players)
      const { data: eventRsvps, error: rsvpError } = await supabase
        .from("rsvps")
        .select("user_id")
        .eq("event_id", id!)
        .eq("status", "going")
        .not("user_id", "is", null);
      if (rsvpError) throw rsvpError;
      
      const rsvpUserIds = new Set(eventRsvps?.map(r => r.user_id).filter(Boolean) as string[]);
      
      // Get all parent user IDs from mini league players who RSVP'd
      const { data: playersData, error: playersError } = await supabase
        .from("mini_league_players")
        .select("parent_user_id")
        .eq("mini_league_id", miniLeagueId)
        .not("parent_user_id", "is", null);
      if (playersError) throw playersError;
      
      // Only include parents who RSVP'd going
      const parentIds = [...new Set(
        (playersData?.map(p => p.parent_user_id).filter(Boolean) as string[])
          .filter(parentId => rsvpUserIds.has(parentId))
      )];
      
      // Get club admins and league admins who RSVP'd
      const { data: adminRoles, error: rolesError } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("club_id", league.club_id)
        .in("role", ["club_admin", "league_admin"]);
      if (rolesError) throw rolesError;
      
      // Only include admins who RSVP'd going
      const adminIds = (adminRoles?.map(r => r.user_id) || [])
        .filter(adminId => rsvpUserIds.has(adminId));
      
      // Combine all unique IDs
      const allUserIds = [...new Set([...parentIds, ...adminIds])];
      
      // Exclude app admins from the list
      const { data: appAdmins } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "app_admin");
      const appAdminIds = new Set(appAdmins?.map(r => r.user_id) || []);
      const filteredUserIds = allUserIds.filter(id => !appAdminIds.has(id));
      if (!filteredUserIds.length) return [];
      
      // Fetch profiles for all these users
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .in("id", filteredUserIds)
        .order("display_name");
      if (profilesError) throw profilesError;
      
      return profiles || [];
    },
    enabled: !!event?.mini_league_id && !!id,
  });

  // Fetch children assigned to this event's team (for parent RSVP)
  const { data: childrenOnTeam } = useQuery({
    queryKey: ["children-on-team", event?.team_id, user?.id],
    queryFn: async () => {
      if (!event?.team_id) return [];
      
      // Get user's children that are assigned to this team
      const { data, error } = await supabase
        .from("children")
        .select(`
          id,
          name,
          child_team_assignments!inner (team_id)
        `)
        .eq("parent_id", user!.id)
        .eq("child_team_assignments.team_id", event.team_id);

      if (error) throw error;
      return data || [];
    },
    enabled: !!user && !!event?.team_id,
  });

  // Fetch ALL children assigned to this event's team (for not responded list)
  const { data: allChildrenOnTeam } = useQuery({
    queryKey: ["all-children-on-team", event?.team_id],
    queryFn: async () => {
      if (!event?.team_id) return [];
      
      const { data, error } = await supabase
        .from("child_team_assignments")
        .select(`
          child_id,
          children (id, name)
        `)
        .eq("team_id", event.team_id);

      if (error) throw error;
      return data?.map(d => d.children).filter(Boolean) || [];
    },
    enabled: !!event?.team_id,
  });

  // Get existing RSVPs for children
  const childRsvps = rsvps?.filter((r) => r.user_id === user?.id && r.child_id) || [];

  // Fetch event payments (admin only)
  const { data: payments } = useQuery({
    queryKey: ["event-payments", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("event_payments")
        .select("user_id")
        .eq("event_id", id!);
      if (error) throw error;
      return data || [];
    },
    enabled: !!id && !!(isAdmin || isAppAdmin),
  });

  // Create set of paid user IDs for quick lookup
  const paidUserIds = new Set(payments?.map(p => p.user_id) || []);

  // Check if event has a price (social events only)
  const eventPrice = event?.type === "social" ? event?.amount : null;
  const showPaymentStatus = eventPrice && eventPrice > 0;

  // Check if user has paid
  const userHasPaid = user ? paidUserIds.has(user.id) : false;

  // Payment checkout state
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);

  const handlePayNow = async () => {
    if (!event || !user || !eventPrice) return;
    
    setIsProcessingPayment(true);
    try {
      const amountCents = Math.round(eventPrice * 100);
      const isNative = Capacitor.isNativePlatform();

      const result = await createMemberCheckout({
        club_id: event.club_id,
        title: event.title,
        amount_cents: amountCents,
        type: "event",
        payer_email: user.email || undefined,
        description: `Event payment: ${event.title}`,
        success_url: isNative
          ? "igniteclubhq://payment-success"
          : `${window.location.origin}/events/${event.id}?payment=success`,
        cancel_url: isNative
          ? "igniteclubhq://payment-cancel"
          : `${window.location.origin}/events/${event.id}?payment=cancelled`,
        metadata: {
          event_id: event.id,
          club_id: event.club_id,
          ...(event.team_id ? { team_id: event.team_id } : {}),
        },
      });

      if (result.error) {
        throw new Error(result.error);
      }

      if (result.url) {
        listenForPaymentStatus(result.payment_id, async (status) => {
          if (status === "paid") {
            try {
              await supabase.functions.invoke("confirm-event-payment", {
                body: {
                  event_id: event.id,
                  amount: eventPrice,
                  payment_id: result.payment_id,
                },
              });
            } catch (err) {
              console.error("Failed to confirm event payment server-side:", err);
            }
            queryClient.invalidateQueries({ queryKey: ["event-payments", id] });
            toast({ title: "Payment successful!" });
          } else {
            toast({ title: "Payment failed", variant: "destructive" });
          }
        });

        if (isNative) {
          import("@/lib/safeOpenUrl").then(({ safeOpenUrl }) => safeOpenUrl(result.url));
        } else {
          window.location.href = result.url;
        }
      } else {
        throw new Error("No checkout URL returned");
      }
    } catch (error: any) {
      console.error('Payment error:', error);
      toast({
        title: "Payment Error",
        description: error.message || "Failed to start payment process",
        variant: "destructive",
      });
    } finally {
      setIsProcessingPayment(false);
    }
  };

  // Check for payment success/cancel from URL params
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const paymentStatus = urlParams.get('payment');
    
    if (paymentStatus === 'success') {
      toast({
        title: "Payment Successful!",
        description: "Your payment has been processed. Thank you!",
      });
      // Remove the query param from URL
      window.history.replaceState({}, '', `/events/${id}`);
      // Refetch payments
      queryClient.invalidateQueries({ queryKey: ["event-payments", id] });
    } else if (paymentStatus === 'cancelled') {
      toast({
        title: "Payment Cancelled",
        description: "Your payment was cancelled.",
        variant: "destructive",
      });
      window.history.replaceState({}, '', `/events/${id}`);
    }
  }, [id, toast, queryClient]);


  const rsvpMutation = useMutation({
    mutationFn: async (status: RsvpStatus) => {
      let rsvpId: string | null = null;
      
      if (myRsvp) {
        const { error } = await supabase
          .from("rsvps")
          .update({ 
            status,
            notes: rsvpNotes || null,
          })
          .eq("id", myRsvp.id);
        if (error) throw error;
        rsvpId = myRsvp.id;
      } else {
        const { data: newRsvp, error } = await supabase.from("rsvps").insert({
          event_id: id!,
          user_id: user!.id,
          status,
          notes: rsvpNotes || null,
        }).select("id").single();
        if (error) throw error;
        rsvpId = newRsvp?.id || null;
      }

      // Award early RSVP points if going and event is 3+ days away
      if (status === "going" && rsvpId && event) {
        await awardEarlyRsvpPoints({
          userId: user!.id,
          eventDate: event.event_date,
          rsvpId,
          clubId: event.club_id,
          clubName: event.clubs?.name || "Your club",
        });
      }

      // Notify event managers about RSVP change
      if (event) {
        const memberName = profile?.display_name || "A member";
        const statusLabel = status === "going" ? "is going" : status === "maybe" ? "might go" : "can't go";
        
        // Get admins/coaches for this team/event
        const roleQuery = event.team_id 
          ? supabase.from("user_roles").select("user_id").eq("team_id", event.team_id).in("role", ["team_admin", "coach"])
          : supabase.from("user_roles").select("user_id").eq("club_id", event.club_id).eq("role", "club_admin");
        
        const { data: managers } = await roleQuery;
        
        if (managers && managers.length > 0) {
          const notifications = managers
            .filter(m => m.user_id !== user?.id)
            .map(m => ({
              user_id: m.user_id,
              type: "rsvp_update",
              message: `${memberName} ${statusLabel} to ${event.title}`,
              related_id: id,
            }));
          
          if (notifications.length > 0) {
            await supabase.from("notifications").insert(notifications);
          }
        }
      }
    },
    onSuccess: (_data, status) => {
      queryClient.invalidateQueries({ queryKey: ["event-rsvps", id] });
      queryClient.invalidateQueries({ queryKey: ["event-rsvps-going", id] });
      queryClient.invalidateQueries({ queryKey: ["event-groups", id] });
      toast({ title: "RSVP updated!" });

      // Auto-trigger payment for paid social events when RSVPing "going"
      if (
        status === "going" &&
        showPaymentStatus &&
        !userHasPaid &&
        !isProcessingPayment
      ) {
        // Small delay so user sees the RSVP confirmation first
        setTimeout(() => {
          handlePayNow();
        }, 600);
      }
    },
  });

  // Child RSVP mutation
  const childRsvpMutation = useMutation({
    mutationFn: async ({ childId, status, childName }: { childId: string; status: RsvpStatus; childName?: string }) => {
      const existingRsvp = childRsvps.find((r) => r.child_id === childId);
      
      if (existingRsvp) {
        const { error } = await supabase
          .from("rsvps")
          .update({ status })
          .eq("id", existingRsvp.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("rsvps").insert({
          event_id: id!,
          user_id: user!.id,
          child_id: childId,
          status,
        });
        if (error) throw error;
      }

      // Notify event managers about child RSVP change
      if (event) {
        const displayName = childName || "A child";
        const statusLabel = status === "going" ? "is going" : status === "maybe" ? "might go" : "can't go";
        
        const roleQuery = event.team_id 
          ? supabase.from("user_roles").select("user_id").eq("team_id", event.team_id).in("role", ["team_admin", "coach"])
          : supabase.from("user_roles").select("user_id").eq("club_id", event.club_id).eq("role", "club_admin");
        
        const { data: managers } = await roleQuery;
        
        if (managers && managers.length > 0) {
          const notifications = managers
            .filter(m => m.user_id !== user?.id)
            .map(m => ({
              user_id: m.user_id,
              type: "rsvp_update",
              message: `${displayName} ${statusLabel} to ${event.title}`,
              related_id: id,
            }));
          
          if (notifications.length > 0) {
            await supabase.from("notifications").insert(notifications);
          }
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event-rsvps", id] });
      queryClient.invalidateQueries({ queryKey: ["event-rsvps-going", id] });
      queryClient.invalidateQueries({ queryKey: ["event-groups", id] });
      toast({ title: "Child RSVP updated!" });
    },
  });

  // Admin RSVP mutation for mini-league players (club/league admins can change player RSVPs)
  const adminRsvpMutation = useMutation({
    mutationFn: async ({ 
      playerId, 
      playerName, 
      childId, 
      parentUserId,
      status 
    }: { 
      playerId: string; 
      playerName: string;
      childId: string | null;
      parentUserId: string | null;
      status: RsvpStatus;
    }) => {
      // For mini-league players, we need to find or create an RSVP
      // Priority: child_id > mini_league_player_id (always use player ID when no child link)
      if (childId) {
        // Check for existing RSVP for this child
        const { data: existingRsvp } = await supabase
          .from("rsvps")
          .select("id")
          .eq("event_id", id!)
          .eq("child_id", childId)
          .maybeSingle();
        
        if (existingRsvp) {
          const { error } = await supabase
            .from("rsvps")
            .update({ status })
            .eq("id", existingRsvp.id);
          if (error) throw error;
        } else if (parentUserId) {
          // Create new RSVP for this child
          const { error } = await supabase.from("rsvps").insert({
            event_id: id!,
            user_id: parentUserId,
            child_id: childId,
            status,
          });
          if (error) throw error;
        } else {
          throw new Error("Cannot create RSVP: no parent user linked to this player");
        }
      } else {
        // Player without child_id — always use mini_league_player_id to avoid
        // conflicting with the parent's own personal RSVP
        const { data: existingRsvp } = await supabase
          .from("rsvps")
          .select("id")
          .eq("event_id", id!)
          .eq("mini_league_player_id", playerId)
          .maybeSingle();
        
        if (existingRsvp) {
          const { error } = await supabase
            .from("rsvps")
            .update({ status })
            .eq("id", existingRsvp.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("rsvps").insert({
            event_id: id!,
            mini_league_player_id: playerId,
            status,
          });
          if (error) throw error;
        }
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["event-rsvps", id] });
      queryClient.invalidateQueries({ queryKey: ["event-rsvps-going", id] });
      queryClient.invalidateQueries({ queryKey: ["event-groups", id] });
      toast({ title: `${variables.playerName}'s RSVP updated!` });
    },
    onError: (error) => {
      toast({ 
        title: "Failed to update RSVP", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  // Admin mutation to update existing RSVP status by RSVP ID
  const adminUpdateRsvpMutation = useMutation({
    mutationFn: async ({ rsvpId, status, playerName }: { rsvpId: string; status: RsvpStatus; playerName: string }) => {
      const { error } = await supabase
        .from("rsvps")
        .update({ status })
        .eq("id", rsvpId);
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["event-rsvps", id] });
      queryClient.invalidateQueries({ queryKey: ["event-rsvps-going", id] });
      queryClient.invalidateQueries({ queryKey: ["event-groups", id] });
      toast({ title: `${variables.playerName}'s RSVP updated!` });
    },
    onError: (error) => {
      toast({ 
        title: "Failed to update RSVP", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  // Admin mutation to create RSVP for a member who hasn't responded (for team/club events)
  const rsvpForMemberMutation = useMutation({
    mutationFn: async ({ memberId, memberName, status }: { memberId: string; memberName: string; status: RsvpStatus }) => {
      // Check if RSVP already exists
      const { data: existingRsvp } = await supabase
        .from("rsvps")
        .select("id")
        .eq("event_id", id!)
        .eq("user_id", memberId)
        .maybeSingle();
      
      if (existingRsvp) {
        // Update existing RSVP
        const { error } = await supabase
          .from("rsvps")
          .update({ status })
          .eq("id", existingRsvp.id);
        if (error) throw error;
      } else {
        // Create new RSVP
        const { error } = await supabase
          .from("rsvps")
          .insert({ event_id: id!, user_id: memberId, status });
        if (error) throw error;
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["event-rsvps", id] });
      queryClient.invalidateQueries({ queryKey: ["event-rsvps-going", id] });
      toast({ title: `${variables.memberName}'s RSVP set to ${variables.status}!` });
    },
    onError: (error) => {
      toast({ 
        title: "Failed to set RSVP", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  // Admin mutation to create RSVP for a child who hasn't responded (for team events)
  const rsvpForChildMutation = useMutation({
    mutationFn: async ({ childId, childName, parentUserId, status }: { childId: string; childName: string; parentUserId: string; status: RsvpStatus }) => {
      // Check if RSVP already exists for this child
      const { data: existingRsvp } = await supabase
        .from("rsvps")
        .select("id")
        .eq("event_id", id!)
        .eq("child_id", childId)
        .maybeSingle();
      
      if (existingRsvp) {
        // Update existing RSVP
        const { error } = await supabase
          .from("rsvps")
          .update({ status })
          .eq("id", existingRsvp.id);
        if (error) throw error;
      } else {
        // Create new RSVP for child
        const { error } = await supabase
          .from("rsvps")
          .insert({ event_id: id!, user_id: parentUserId, child_id: childId, status });
        if (error) throw error;
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["event-rsvps", id] });
      queryClient.invalidateQueries({ queryKey: ["event-rsvps-going", id] });
      toast({ title: `${variables.childName}'s RSVP set to ${variables.status}!` });
    },
    onError: (error) => {
      toast({ 
        title: "Failed to set RSVP", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  // Toggle payment status mutation
  const togglePaymentMutation = useMutation({
    mutationFn: async ({ userId, isPaid }: { userId: string; isPaid: boolean }) => {
      if (isPaid) {
        // Remove payment record
        const { error } = await supabase
          .from("event_payments")
          .delete()
          .eq("event_id", id!)
          .eq("user_id", userId);
        if (error) throw error;
      } else {
        // Add payment record
        const { error } = await supabase
          .from("event_payments")
          .insert({
            event_id: id!,
            user_id: userId,
            amount: event?.amount || 0,
            payment_status: "paid",
            paid_at: new Date().toISOString(),
          });
        if (error) throw error;
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["event-payments", id] });
      toast({ title: variables.isPaid ? "Payment removed" : "Marked as paid" });
    },
    onError: (error) => {
      toast({ 
        title: "Failed to update payment", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  // Add duty mutation
  const addDutyMutation = useMutation({
    mutationFn: async (dutyName: string) => {
      const { error } = await supabase
        .from("duties")
        .insert({ event_id: id!, name: dutyName });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event-duties", id] });
      setNewDutyName("");
      setSelectedPresetDuty("");
      setAddDutyOpen(false);
      toast({ title: "Duty added" });
    },
    onError: (error) => {
      toast({ 
        title: "Failed to add duty", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  // Claim duty mutation
  const claimDutyMutation = useMutation({
    mutationFn: async (dutyId: string) => {
      const { error } = await supabase
        .from("duties")
        .update({ assigned_to: user?.id })
        .eq("id", dutyId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event-duties", id] });
      toast({ title: "Duty claimed!" });
    },
    onError: (error) => {
      toast({ 
        title: "Failed to claim duty", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  // Complete duty mutation
  const completeDutyMutation = useMutation({
    mutationFn: async (dutyId: string) => {
      // Get duty details before updating
      const duty = duties?.find(d => d.id === dutyId);
      
      const { error } = await supabase
        .from("duties")
        .update({ status: "completed" as DutyStatus, completed_at: new Date().toISOString() })
        .eq("id", dutyId);
      if (error) throw error;

      // Notify team/club admins and coaches about duty completion
      if (event && duty) {
        const memberName = profile?.display_name || "A member";
        
        // Get admins/coaches for this team/event
        const roleQuery = event.team_id 
          ? supabase.from("user_roles").select("user_id").eq("team_id", event.team_id).in("role", ["team_admin", "coach", "club_admin"])
          : supabase.from("user_roles").select("user_id").eq("club_id", event.club_id).eq("role", "club_admin");
        
        const { data: admins } = await roleQuery;
        
        if (admins && admins.length > 0) {
          const notifications = admins
            .filter(a => a.user_id !== user?.id)
            .map(a => ({
              user_id: a.user_id,
              type: "duty_completed",
              message: `${memberName} completed ${duty.name} for ${event.title}`,
              related_id: id,
            }));
          
          if (notifications.length > 0) {
            await supabase.from("notifications").insert(notifications);
          }
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event-duties", id] });
      toast({ title: "Duty completed!" });
    },
    onError: (error) => {
      toast({ 
        title: "Failed to complete duty", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  const deleteDutyMutation = useMutation({
    mutationFn: async (dutyId: string) => {
      const { error } = await supabase.from("duties").delete().eq("id", dutyId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event-duties", id] });
      toast({ title: "Duty removed" });
    },
  });

  const assignDutyMutation = useMutation({
    mutationFn: async (userId: string | null) => {
      if (!selectedDutyId) return;
      
      // Get the duty to check if it was previously unassigned
      const { data: dutyBefore } = await supabase
        .from("duties")
        .select("assigned_to")
        .eq("id", selectedDutyId)
        .single();
      
      const { error } = await supabase
        .from("duties")
        .update({ assigned_to: userId })
        .eq("id", selectedDutyId);
      if (error) throw error;

      // Points are now awarded 24 hours after the game via scheduled job
      // Just notify the assigned user about the duty assignment
      if (userId && (!dutyBefore?.assigned_to || dutyBefore.assigned_to !== userId)) {
        await supabase.from("notifications").insert({
          user_id: userId,
          type: "duty_assigned",
          message: "You've been assigned a duty. Points will be awarded 24 hours after the game! 🔥",
          related_id: id,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event-duties", id] });
      setAssignDialogOpen(false);
      setSelectedDutyId(null);
      setSelectedUserId("");
      toast({ title: "Duty assigned" });
    },
  });

  const [pendingDeleteTimeout, setPendingDeleteTimeout] = useState<NodeJS.Timeout | null>(null);
  const [pendingDeleteType, setPendingDeleteType] = useState<'single' | 'series' | null>(null);

  const performActualDelete = async (deleteType: 'single' | 'series') => {
    if (deleteType === 'series' && event?.parent_event_id) {
      await supabase.from("events").delete().eq("parent_event_id", event.parent_event_id);
      await supabase.from("events").delete().eq("id", event.parent_event_id);
    } else if (deleteType === 'series' && event?.is_recurring) {
      await supabase.from("events").delete().eq("parent_event_id", id!);
      await supabase.from("events").delete().eq("id", id!);
    } else {
      await supabase.from("events").delete().eq("id", id!);
    }
  };

  const handleDeleteWithUndo = (deleteType: 'single' | 'series') => {
    // Navigate away immediately
    navigate(-1);
    
    // Set pending delete type
    setPendingDeleteType(deleteType);
    
    // Show toast with undo option
    const timeoutId = setTimeout(async () => {
      await performActualDelete(deleteType);
      setPendingDeleteTimeout(null);
      setPendingDeleteType(null);
    }, 6000);
    
    setPendingDeleteTimeout(timeoutId);
    
    toast({
      title: "Event deleted",
      description: deleteType === 'series' ? "Entire series deleted" : "Event deleted",
      action: (
        <ToastAction
          altText="Undo deletion"
          onClick={() => {
            if (pendingDeleteTimeout) {
              clearTimeout(pendingDeleteTimeout);
            }
            clearTimeout(timeoutId);
            setPendingDeleteTimeout(null);
            setPendingDeleteType(null);
            // Navigate back to the event
            navigate(`/events/${id}`);
            toast({ title: "Deletion cancelled" });
          }}
        >
          Undo
        </ToastAction>
      ),
      duration: 6000,
    });
  };

  const deleteEventMutation = useMutation({
    mutationFn: async (deleteType: 'single' | 'series') => {
      handleDeleteWithUndo(deleteType);
    },
  });

  const cancelEventMutation = useMutation({
    mutationFn: async ({ cancelType, customMessage, sendPushNotification }: { cancelType: 'single' | 'series'; customMessage?: string; sendPushNotification?: boolean }) => {
      console.log("[CancelEvent] Starting cancel mutation", { cancelType, eventId: id, miniLeagueId: event?.mini_league_id });
      
      if (cancelType === 'series' && event?.parent_event_id) {
        // Cancel parent and all children
        const { error: err1 } = await supabase.from("events").update({ is_cancelled: true }).eq("parent_event_id", event.parent_event_id);
        const { error: err2 } = await supabase.from("events").update({ is_cancelled: true }).eq("id", event.parent_event_id);
        if (err1) { console.error("[CancelEvent] Error cancelling children:", err1); throw err1; }
        if (err2) { console.error("[CancelEvent] Error cancelling parent:", err2); throw err2; }
      } else if (cancelType === 'series' && event?.is_recurring) {
        // This is the parent - cancel all children and this event
        const { error: err1 } = await supabase.from("events").update({ is_cancelled: true }).eq("parent_event_id", id!);
        const { error: err2 } = await supabase.from("events").update({ is_cancelled: true }).eq("id", id!);
        if (err1) { console.error("[CancelEvent] Error cancelling children:", err1); throw err1; }
        if (err2) { console.error("[CancelEvent] Error cancelling this event:", err2); throw err2; }
      } else {
        // Just cancel this single event
        console.log("[CancelEvent] Cancelling single event:", id);
        const { data, error } = await supabase.from("events").update({ is_cancelled: true }).eq("id", id!);
        console.log("[CancelEvent] Update result:", { data, error });
        if (error) {
          console.error("[CancelEvent] Error cancelling event:", error);
          throw error;
        }
      }

      // Get member count for notifications - handle mini-league events differently
      let uniqueMembers: string[] = [];
      
      if (event?.mini_league_id) {
        // Get mini league to find the club_id
        const { data: league } = await supabase
          .from("mini_leagues")
          .select("club_id")
          .eq("id", event.mini_league_id)
          .single();
        
        if (league) {
          // Get all parent user IDs from mini league players
          const { data: playersData } = await supabase
            .from("mini_league_players")
            .select("parent_user_id")
            .eq("mini_league_id", event.mini_league_id)
            .not("parent_user_id", "is", null);
          
          const parentIds = (playersData?.map(p => p.parent_user_id).filter(Boolean) as string[]) || [];
          
          // Get club admins, league admins, and coaches
          const { data: adminRoles } = await supabase
            .from("user_roles")
            .select("user_id")
            .eq("club_id", league.club_id)
            .in("role", ["club_admin", "league_admin", "coach"]);
          
          const adminIds = adminRoles?.map(r => r.user_id) || [];
          
          uniqueMembers = [...new Set([...parentIds, ...adminIds])];
        }
      } else {
        let memberQuery = supabase.from("user_roles").select("user_id");
        if (event?.team_id) {
          memberQuery = memberQuery.eq("team_id", event.team_id);
        } else if (event?.club_id) {
          memberQuery = memberQuery.eq("club_id", event.club_id);
        }
        const { data: members } = await memberQuery;
        uniqueMembers = [...new Set(members?.map(m => m.user_id) || [])];
      }

      // Always post cancellation message to team, club, or mini-league chat
      if (user && event) {
        const eventPath = `/events/${event.id}`;
        const cancellationMessage = customMessage 
          ? `📢 Event Cancelled: "${event.title}"\n\n${customMessage}\n\nView event: ${eventPath}`
          : `📢 Event Cancelled: "${event.title}"\n\nView event: ${eventPath}`;

        if (event.mini_league_id) {
          // Post to mini-league chat group
          const { data: chatGroup } = await supabase
            .from("chat_groups")
            .select("id")
            .eq("mini_league_id", event.mini_league_id)
            .maybeSingle();
          
          if (chatGroup) {
            const { error: msgError } = await supabase.from("group_messages").insert({
              group_id: chatGroup.id,
              author_id: user.id,
              text: cancellationMessage,
            });
            if (msgError) {
              console.error("Failed to post cancellation to league chat:", msgError);
            }
          }
        } else if (event.team_id) {
          const { error: msgError } = await supabase.from("team_messages").insert({
            team_id: event.team_id,
            author_id: user.id,
            text: cancellationMessage,
          });
          if (msgError) {
            console.error("Failed to post cancellation to team chat:", msgError);
          }
        } else if (event.club_id) {
          const { error: msgError } = await supabase.from("club_messages").insert({
            club_id: event.club_id,
            author_id: user.id,
            text: cancellationMessage,
          });
          if (msgError) {
            console.error("Failed to post cancellation to club chat:", msgError);
          }
        }
      }

      // Notifications are created automatically by the on_event_cancelled DB trigger
      // No need to manually insert them here - that was causing duplicates

      return uniqueMembers.length;
    },
    onSuccess: () => {
      console.log("[CancelEvent] Success - event cancelled");
      setCancelDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["event", id] });
      toast({ title: "Event cancelled", description: "A message has been posted to the chat" });
    },
    onError: (error) => {
      console.error("[CancelEvent] Mutation error:", error);
      toast({ 
        title: "Failed to cancel event", 
        description: error.message || "An unexpected error occurred",
        variant: "destructive" 
      });
    },
  });

  const remindMutation = useMutation({
    mutationFn: async () => {
      // Get all RSVPs for this event
      const { data: existingRsvps } = await supabase
        .from("rsvps")
        .select("user_id")
        .eq("event_id", id!);
      
      const rsvpUserIds = existingRsvps?.map(r => r.user_id) || [];
      
      // Get all members who should RSVP - handle mini-league events differently
      let allMemberIds: string[] = [];
      
      if (event?.mini_league_id) {
        // Get mini league to find the club_id
        const { data: league } = await supabase
          .from("mini_leagues")
          .select("club_id")
          .eq("id", event.mini_league_id)
          .single();
        
        if (league) {
          // Get all parent user IDs from mini league players
          const { data: playersData } = await supabase
            .from("mini_league_players")
            .select("parent_user_id")
            .eq("mini_league_id", event.mini_league_id)
            .not("parent_user_id", "is", null);
          
          const parentIds = (playersData?.map(p => p.parent_user_id).filter(Boolean) as string[]) || [];
          
          // Get club admins, league admins, and coaches
          const { data: adminRoles } = await supabase
            .from("user_roles")
            .select("user_id")
            .eq("club_id", league.club_id)
            .in("role", ["club_admin", "league_admin", "coach"]);
          
          const adminIds = adminRoles?.map(r => r.user_id) || [];
          
          allMemberIds = [...new Set([...parentIds, ...adminIds])];
        }
      } else {
        let memberQuery = supabase.from("user_roles").select("user_id");
        if (event?.team_id) {
          memberQuery = memberQuery.eq("team_id", event.team_id);
        } else if (event?.club_id) {
          memberQuery = memberQuery.eq("club_id", event.club_id);
        }
        
        const { data: allMembers } = await memberQuery;
        allMemberIds = [...new Set(allMembers?.map(m => m.user_id) || [])];
      }
      
      // Find members who haven't RSVPed
      const nonRsvpMembers = allMemberIds.filter(memberId => !rsvpUserIds.includes(memberId));
      
      if (nonRsvpMembers.length === 0) {
        throw new Error("Everyone has already RSVPed!");
      }
      
      // Check for existing notifications to avoid duplicates
      const { data: existingNotifications } = await supabase
        .from("notifications")
        .select("user_id")
        .eq("type", "event_reminder")
        .eq("related_id", id!)
        .in("user_id", nonRsvpMembers);
      
      const existingNotificationUserIds = existingNotifications?.map(n => n.user_id) || [];
      const membersToNotify = nonRsvpMembers.filter(memberId => !existingNotificationUserIds.includes(memberId));
      
      if (membersToNotify.length === 0) {
        throw new Error("All members have already been reminded!");
      }
      
      // Create notifications for members who haven't been reminded
      const notifications = membersToNotify.map(userId => ({
        user_id: userId,
        type: "event_reminder",
        message: `Reminder: Please RSVP for "${event?.title}"`,
        related_id: id,
      }));
      
      const { error } = await supabase.from("notifications").insert(notifications);
      if (error) throw error;
      
      // Send push notifications to all members being reminded
      for (const userId of membersToNotify) {
        supabase.functions.invoke("send-push-notification", {
          body: {
            userId,
            title: "RSVP Reminder",
            body: `Please RSVP for "${event?.title}"`,
            url: `/events/${id}`,
          },
        }).catch(console.error);
      }
      
      return membersToNotify.length;
    },
    onSuccess: (count) => {
      toast({ 
        title: "Reminders sent", 
        description: `${count} member${count !== 1 ? 's' : ''} have been reminded to RSVP` 
      });
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Failed to send reminders", variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="py-6 space-y-4">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!event) {
    const roastMessages = [
      "🚫 Nice try, but you're not on the guest list. This event is more exclusive than your playlist.",
      "🔒 Whoa there! You don't have access to this event. Maybe try making some friends first?",
      "🙅 Access denied! This event is invitation-only, and clearly... you weren't invited.",
      "😬 Awkward... You're trying to crash a party you weren't invited to. Bold move.",
      "🫣 Plot twist: you need to actually be a member to see this. Wild concept, right?",
      "🏟️ You can't just walk into any event like you own the place. Get invited first!",
      "🚷 Hold up! This area is members-only. No ticket, no entry, no exceptions.",
    ];
    const roast = roastMessages[Math.floor(Math.random() * roastMessages.length)];
    return (
      <div className="py-12 text-center space-y-4 px-6">
        <div className="text-5xl">🚫</div>
        <h2 className="text-xl font-bold text-foreground">No Access</h2>
        <p className="text-muted-foreground max-w-sm mx-auto">{roast}</p>
        <Button variant="outline" onClick={() => navigate('/')} className="mt-4">
          Go Home
        </Button>
      </div>
    );
  }

  return (
    <div className="py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="shrink-0" onClick={() => {
          navigate('/events');
        }}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <Badge className={eventTypeColors[event.type as EventType]} variant="secondary">
          {eventTypeLabel}
        </Badge>
        
        <div className="flex-1" />

        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={async () => {
            if (isSharingEventRef.current) return;
            isSharingEventRef.current = true;

            const shareUrl = getShareUrl("event", id!);
            

            try {
              if (Capacitor.isNativePlatform()) {
                await Share.share({
                  url: shareUrl,
                  dialogTitle: 'Share Event',
                });
              } else if (navigator.share) {
                await navigator.share({
                  url: shareUrl,
                });
              } else {
                await navigator.clipboard.writeText(shareUrl);
                toast({ title: "Link copied to clipboard!" });
              }
            } catch (err) {
              if ((err as Error).name !== 'AbortError') {
                await navigator.clipboard.writeText(shareUrl);
                toast({ title: "Link copied to clipboard!" });
              }
            } finally {
              isSharingEventRef.current = false;
            }
          }}
        >
          <Share2 className="h-5 w-5" />
        </Button>

        {/* Admin actions dropdown */}
        {(isAdmin || isAppAdmin) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="shrink-0">
                <MoreVertical className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-popover">
              {!event.is_cancelled && (
                <>
                  <DropdownMenuItem onClick={() => navigate(`/events/${id}/edit`)}>
                    <Pencil className="h-4 w-4 mr-2" />
                    Edit {eventTypeLabel}
                  </DropdownMenuItem>
                  {canSendReminders ? (
                    <DropdownMenuItem onClick={() => {
                      // Open reminder confirmation
                      setReminderDialogOpen(true);
                    }}>
                      <Bell className="h-4 w-4 mr-2 text-primary" />
                      Send Reminders
                    </DropdownMenuItem>
                  ) : !isLoadingHasTeamPro && (
                    <DropdownMenuItem disabled>
                      <Bell className="h-4 w-4 mr-2" />
                      Send Reminders
                      <Badge variant="secondary" className="ml-auto text-[10px] h-4 px-1">Pro</Badge>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem 
                    onClick={() => setCancelDialogOpen(true)}
                    className="text-warning focus:text-warning"
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    Cancel {eventTypeLabel}
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuItem 
                onClick={() => setDeleteDialogOpen(true)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete {eventTypeLabel}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Reminder Dialog */}
        <AlertDialog open={reminderDialogOpen} onOpenChange={setReminderDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Send RSVP Reminders?</AlertDialogTitle>
              <AlertDialogDescription>
                This will send a notification to all team members who haven't responded to this event yet.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction 
                onClick={() => remindMutation.mutate()}
                disabled={remindMutation.isPending}
              >
                {remindMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Sending...
                  </>
                ) : (
                  "Send Reminders"
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Cancel Dialog - handles both single and recurring */}
        {(event.is_recurring || event.parent_event_id) ? (
          <RecurringCancelEventDialog
            open={cancelDialogOpen}
            onOpenChange={setCancelDialogOpen}
            eventTitle={event.title}
            teamId={event.team_id}
            clubId={event.club_id}
            miniLeagueId={event.mini_league_id}
            eventType={event.type}
            onSingleAction={(customMessage, sendPushNotification) => 
              cancelEventMutation.mutate({ cancelType: 'single', customMessage, sendPushNotification })
            }
            onSeriesAction={(customMessage, sendPushNotification) => 
              cancelEventMutation.mutate({ cancelType: 'series', customMessage, sendPushNotification })
            }
            isPending={cancelEventMutation.isPending}
          />
        ) : (
          <CancelEventConfirmDialog
            open={cancelDialogOpen}
            onOpenChange={setCancelDialogOpen}
            eventId={event.id}
            eventTitle={event.title}
            teamId={event.team_id}
            clubId={event.club_id}
            miniLeagueId={event.mini_league_id}
            eventType={event.type}
            onConfirm={(customMessage, sendPushNotification) => 
              cancelEventMutation.mutate({ cancelType: 'single', customMessage, sendPushNotification })
            }
            isPending={cancelEventMutation.isPending}
          />
        )}

        {/* Delete Dialog - handles both single and recurring */}
        {(event.is_recurring || event.parent_event_id) ? (
          <RecurringEventActionDialog
            open={deleteDialogOpen}
            onOpenChange={setDeleteDialogOpen}
            title={`Delete ${eventTypeLabel}?`}
            description={`This will permanently delete the ${eventTypeLabel.toLowerCase()}(s) and all RSVPs. This action cannot be undone.`}
            actionLabel="Delete"
            actionVariant="destructive"
            onSingleAction={() => deleteEventMutation.mutate('single')}
            onSeriesAction={() => deleteEventMutation.mutate('series')}
            isPending={deleteEventMutation.isPending}
          />
        ) : (
          <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {eventTypeLabel}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete this {eventTypeLabel.toLowerCase()} and all RSVPs. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction 
                  onClick={() => deleteEventMutation.mutate('single')} 
                  className="bg-destructive text-destructive-foreground"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {/* Event Info */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">{event.title}</h1>
          {event.is_cancelled && (
            <Badge variant="destructive">Cancelled</Badge>
          )}
        </div>
        <p className="text-muted-foreground">{event.clubs?.name}</p>
        {event.teams?.name && (
          <Badge variant="outline">{event.teams.name}</Badge>
        )}
      </div>

      {/* Details Card */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-3">
            <Clock className="h-5 w-5 text-primary" />
            <span>{format(parseISO(event.event_date), "EEEE, MMMM d 'at' h:mm a")}</span>
          </div>
          {event.address && (
            <div className="flex items-start gap-3">
              <MapPin className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div>
                <p>{event.address}</p>
                <p className="text-muted-foreground">
                  {[event.suburb, event.state, event.postcode].filter(Boolean).join(", ")}
                </p>
              </div>
            </div>
          )}
          {event.type === "game" && event.opponent && (
            <div className="flex items-center gap-3">
              <Users className="h-5 w-5 text-primary" />
              <span>vs {event.opponent}</span>
            </div>
          )}
          <div className="flex items-center gap-3">
            <Users className="h-5 w-5 text-primary" />
            <span>{rsvps?.filter(r => r.status === "going").length || 0} attending</span>
          </div>
          {/* Price for social events */}
          {event.type === "social" && eventPrice && eventPrice > 0 && (
            <div className="flex items-center gap-3">
              <DollarSign className="h-5 w-5 text-primary" />
              <span>${Number(eventPrice).toFixed(2)} per person</span>
            </div>
          )}
          {/* Pitch Board / Start Game button for game events */}
          {canAccessPitchBoard && teamMembers && (() => {
            const eventTime = parseISO(event.event_date);
            const now = new Date();
            const minutesUntilKickoff = (eventTime.getTime() - now.getTime()) / (1000 * 60);
            const isWithin120Min = minutesUntilKickoff <= 120;
            const hasStarted = minutesUntilKickoff <= 0;
            const isPastGame = hasStarted && minutesUntilKickoff < -180; // more than 3 hours ago
            
            // Don't show any pitch board button for past games
            if (isPastGame) return null;
            
            return isWithin120Min ? (
              <Button
                variant="default"
                size="lg"
                className="w-full mt-2 h-14 text-lg font-bold gap-3"
                onClick={() => setShowPitchBoard(true)}
              >
                <Play className="h-5 w-5" />
                {hasStarted ? "Open Match" : "Start Game"}
              </Button>
            ) : (
              <Button
                variant="outline"
                className="w-full mt-2"
                onClick={() => setShowPitchBoard(true)}
              >
                <Play className="h-4 w-4 mr-2" />
                Open Pitch Board
              </Button>
            );
          })()}
        </CardContent>
      </Card>

      {/* Map */}
      {event.address && (
        <GoogleMapEmbed
          address={event.address}
          className="w-full h-48 rounded-lg border"
        />
      )}

      {/* Event Sponsors (Pro only) */}
      <EventSponsorsSection eventId={id!} clubId={event.club_id} />

      {/* Event Views Admin Section - shows who has/hasn't seen the event (Pro only) */}
      {(isAdmin || isAppAdmin) && hasTeamPro && (
        <EventViewsAdminSection
          eventId={id!}
          teamId={event.team_id}
          clubId={event.club_id}
          miniLeagueId={event.mini_league_id}
        />
      )}

      {event.description && (
        <p className="text-muted-foreground">{event.description}</p>
      )}

      {/* RSVP Section */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Your RSVP</h2>
        <div className="grid grid-cols-3 gap-2">
          {rsvpOptions.map(({ value, label, icon }) => (
            <Button
              key={value}
              variant={myRsvp?.status === value ? "default" : "outline"}
              className="flex flex-col h-auto py-3"
              onClick={() => rsvpMutation.mutate(value)}
              disabled={rsvpMutation.isPending}
            >
              <span className="text-lg">{icon}</span>
              <span className="text-xs mt-1">{label}</span>
            </Button>
          ))}
        </div>
        
        {/* Rich RSVP Options */}
        <Card className="border-dashed">
          <CardContent className="p-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="rsvpNotes" className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4" />
                Notes / Comments
              </Label>
              <Textarea
                id="rsvpNotes"
                placeholder="Any notes for the organizer (e.g., arriving late, bringing equipment)..."
                value={rsvpNotes}
                onChange={(e) => setRsvpNotes(e.target.value)}
                rows={2}
              />
            </div>
          </CardContent>
        </Card>

        {/* Payment Section for Social Events */}
        {showPaymentStatus && myRsvp?.status === "going" && (
          <Card className={userHasPaid ? "border-green-500/30 bg-green-500/5" : "border-warning/30 bg-warning/5"}>
            <CardContent className="p-4">
              {userHasPaid ? (
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-full bg-green-500/20">
                    <Check className="h-5 w-5 text-green-600" />
                  </div>
                  <div>
                    <p className="font-medium text-green-600">Payment Complete</p>
                    <p className="text-sm text-muted-foreground">You've paid ${Number(eventPrice).toFixed(2)} for this event</p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-full bg-warning/20">
                      <DollarSign className="h-5 w-5 text-warning" />
                    </div>
                    <div>
                      <p className="font-medium">Payment Required</p>
                      <p className="text-sm text-muted-foreground">${Number(eventPrice).toFixed(2)} per person</p>
                    </div>
                  </div>
                  <Button 
                    onClick={handlePayNow}
                    disabled={isProcessingPayment}
                    className="shrink-0"
                  >
                    {isProcessingPayment ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <DollarSign className="h-4 w-4 mr-2" />
                        Pay Now
                      </>
                    )}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </section>

      {/* Guest Management Section - only for social events with guests enabled */}
      {event.type === "social" && event.allow_guests && myRsvp?.status === "going" && (
        <EventGuestsManager
          eventId={event.id}
          clubId={event.club_id}
          maxGuestsPerMember={event.max_guests_per_member || 2}
          isAdmin={isAdmin || isAppAdmin}
        />
      )}

      {/* Child RSVP Section - for parents with children on this team */}
      {childrenOnTeam && childrenOnTeam.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Baby className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">RSVP for Children</h2>
          </div>
          <div className="space-y-3">
            {childrenOnTeam.map((child: any) => {
              const childRsvp = childRsvps.find((r) => r.child_id === child.id);
              return (
                <Card key={child.id} className="border-dashed">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="bg-secondary text-secondary-foreground text-sm">
                            {child.name.charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span className="font-medium">{child.name}</span>
                      </div>
                      {childRsvp && (
                        <Badge variant={childRsvp.status === "going" ? "default" : "secondary"}>
                          {childRsvp.status === "going" ? "Going" : childRsvp.status === "maybe" ? "Maybe" : "Not Going"}
                        </Badge>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {rsvpOptions.map(({ value, label, icon }) => (
                        <Button
                          key={value}
                          variant={childRsvp?.status === value ? "default" : "outline"}
                          size="sm"
                          className="flex flex-col h-auto py-2"
                          onClick={() => childRsvpMutation.mutate({ childId: child.id, status: value, childName: child.name })}
                          disabled={childRsvpMutation.isPending}
                        >
                          <span>{icon}</span>
                          <span className="text-xs">{label}</span>
                        </Button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      <Separator />

      {/* Attendees by Status */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Responses</h2>
          {/* Only show filter for training and game events, not social */}
          {!isSocialEvent && (
            <div className="flex items-center gap-2">
              <Checkbox 
                id="showAllRoles" 
                checked={showAllRoles} 
                onCheckedChange={(checked) => setShowAllRoles(checked === true)}
              />
              <Label htmlFor="showAllRoles" className="text-sm cursor-pointer">Show all</Label>
            </div>
          )}
        </div>
        
        {(() => {
          // Get player user IDs for filtering
          const playerUserIds = new Set(playerMembers?.map((m: any) => m.id) || []);
          
          // Filter RSVPs based on effectiveShowAll (social events always show all)
          const filterRsvp = (rsvp: any) => {
            if (effectiveShowAll) return true;
            // Mini-league events: show all RSVPs (scoped to league members)
            if (isMiniLeagueEvent) return true;
            // Show mini-league player RSVPs 
            if (rsvp.mini_league_player_id) return true;
            // Show child RSVPs (they are always players)
            if (rsvp.child_id) return true;
            // Only show if user has player role
            return playerUserIds.has(rsvp.user_id);
          };
          
          const goingRsvps = rsvps?.filter((r) => r.status === "going" && filterRsvp(r)) || [];
          const maybeRsvps = rsvps?.filter((r) => r.status === "maybe" && filterRsvp(r)) || [];
          const notGoingRsvps = rsvps?.filter((r) => r.status === "not_going" && filterRsvp(r)) || [];
          
          // Not responded - filter members based on effectiveShowAll
          // For mini-league events, use mini-league players instead of team members
          const respondedUserIds = new Set(rsvps?.filter(r => !r.child_id).map(r => r.user_id) || []);
          const respondedChildIds = new Set(rsvps?.filter(r => r.child_id).map(r => r.child_id) || []);
          const respondedMiniLeaguePlayerIds = new Set(
            rsvps?.filter(r => r.mini_league_player_id).map(r => r.mini_league_player_id) || []
          );
          
          let notResponded: any[] = [];
          let notRespondedChildren: any[] = [];
          
          if (isMiniLeagueEvent && miniLeaguePlayers) {
            // For mini-league events, show players who haven't had a response
            notRespondedChildren = miniLeaguePlayers.filter((player: any) => {
              // Check if this player has an RSVP via mini_league_player_id
              if (respondedMiniLeaguePlayerIds.has(player.id)) return false;
              // Check if this player's child_id has an RSVP
              if (player.child_id && respondedChildIds.has(player.child_id)) return false;
              // Check if parent has RSVP'd for this player
              if (player.parent_user_id && respondedUserIds.has(player.parent_user_id)) return false;
              return true;
            });
          } else {
            // For regular events, use team members
            const membersToShow = effectiveShowAll ? members : playerMembers;
            notResponded = membersToShow?.filter((m: any) => !respondedUserIds.has(m.id)) || [];
            // Get children who haven't responded (children are always treated as players)
            notRespondedChildren = allChildrenOnTeam?.filter((child: any) => !respondedChildIds.has(child.id)) || [];
          }
          
          const totalNotResponded = isMiniLeagueEvent 
            ? notRespondedChildren.length 
            : notResponded.length + notRespondedChildren.length;
          
          return (
            <>
              {/* Going */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-primary">
                  <span>✅</span>
                  <span>Going ({goingRsvps.length})</span>
                </div>
                {goingRsvps.length === 0 ? (
                  <p className="text-muted-foreground text-sm pl-6">No one yet</p>
                ) : (
                  <div className="space-y-1 pl-6">
                    {goingRsvps.map((rsvp: any) => (
                      <AttendeeCard 
                        key={rsvp.id} 
                        rsvp={rsvp}
                        hasPaid={rsvp.child_id ? paidUserIds.has(rsvp.user_id) : paidUserIds.has(rsvp.user_id)}
                        isAdmin={isAdmin || isAppAdmin}
                        showPrice={!!showPaymentStatus}
                        onTogglePayment={() => togglePaymentMutation.mutate({ 
                          userId: rsvp.user_id, 
                          isPaid: paidUserIds.has(rsvp.user_id) 
                        })}
                        isPending={togglePaymentMutation.isPending || adminUpdateRsvpMutation.isPending}
                        isMiniLeague={isMiniLeagueEvent}
                        currentStatus="going"
                        onChangeStatus={(status) => adminUpdateRsvpMutation.mutate({
                          rsvpId: rsvp.id,
                          status,
                          playerName: rsvp.mini_league_player_id ? rsvp.mini_league_players?.name : (rsvp.child_id ? rsvp.children?.name : rsvp.profiles?.display_name)
                        })}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Maybe */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-warning">
                  <span>🤔</span>
                  <span>Maybe ({maybeRsvps.length})</span>
                </div>
                {maybeRsvps.length === 0 ? (
                  <p className="text-muted-foreground text-sm pl-6">No one</p>
                ) : (
                  <div className="space-y-1 pl-6">
                    {maybeRsvps.map((rsvp: any) => (
                      <AttendeeCard 
                        key={rsvp.id} 
                        rsvp={rsvp}
                        hasPaid={paidUserIds.has(rsvp.user_id)}
                        isAdmin={isAdmin || isAppAdmin}
                        showPrice={!!showPaymentStatus}
                        onTogglePayment={() => togglePaymentMutation.mutate({ 
                          userId: rsvp.user_id, 
                          isPaid: paidUserIds.has(rsvp.user_id) 
                        })}
                        isPending={togglePaymentMutation.isPending || adminUpdateRsvpMutation.isPending}
                        isMiniLeague={isMiniLeagueEvent}
                        currentStatus="maybe"
                        onChangeStatus={(status) => adminUpdateRsvpMutation.mutate({
                          rsvpId: rsvp.id,
                          status,
                          playerName: rsvp.mini_league_player_id ? rsvp.mini_league_players?.name : (rsvp.child_id ? rsvp.children?.name : rsvp.profiles?.display_name)
                        })}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Not Going */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                  <span>❌</span>
                  <span>Can't Go ({notGoingRsvps.length})</span>
                </div>
                {notGoingRsvps.length === 0 ? (
                  <p className="text-muted-foreground text-sm pl-6">No one</p>
                ) : (
                  <div className="space-y-1 pl-6">
                    {notGoingRsvps.map((rsvp: any) => (
                      <AttendeeCard 
                        key={rsvp.id} 
                        rsvp={rsvp}
                        isAdmin={isAdmin || isAppAdmin}
                        isPending={adminUpdateRsvpMutation.isPending}
                        isMiniLeague={isMiniLeagueEvent}
                        currentStatus="not_going"
                        onChangeStatus={(status) => adminUpdateRsvpMutation.mutate({
                          rsvpId: rsvp.id,
                          status,
                          playerName: rsvp.mini_league_player_id ? rsvp.mini_league_players?.name : (rsvp.child_id ? rsvp.children?.name : rsvp.profiles?.display_name)
                        })}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Not Responded */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <span>⏳</span>
                  <span>Not Responded ({totalNotResponded})</span>
                </div>
                {totalNotResponded === 0 ? (
                  <p className="text-muted-foreground text-sm pl-6">
                    {(rsvps?.length || 0) > 0 ? "Everyone has responded" : "No members to respond"}
                  </p>
                ) : (
                  <div className="space-y-1 pl-6">
                    {/* Mini-league players or Children (treated as players) */}
                    {notRespondedChildren.map((child: any) => (
                      <Card key={`child-${child.id}`}>
                        <CardContent className="p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <Avatar className="h-8 w-8">
                                <AvatarFallback className="text-xs bg-secondary">
                                  {child.name?.charAt(0)?.toUpperCase() || "?"}
                                </AvatarFallback>
                              </Avatar>
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{child.name || "Unknown"}</span>
                                {!isMiniLeagueEvent && <Badge variant="outline" className="text-xs">Child</Badge>}
                              </div>
                            </div>
                            {/* Admin RSVP controls for all events */}
                            {(isAdmin || isAppAdmin) && (
                              <div className="flex gap-1">
                                {rsvpOptions.map(({ value, icon }) => (
                                  <Button
                                    key={value}
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 w-8 p-0"
                                    onClick={() => {
                                      if (isMiniLeagueEvent) {
                                        // For mini-league events, use adminRsvpMutation
                                        adminRsvpMutation.mutate({
                                          playerId: child.id,
                                          playerName: child.name,
                                          childId: child.child_id,
                                          parentUserId: child.parent_user_id,
                                          status: value,
                                        });
                                      } else {
                                        // For team events, use rsvpForChildMutation
                                        rsvpForChildMutation.mutate({
                                          childId: child.id,
                                          childName: child.name,
                                          parentUserId: child.parent_id,
                                          status: value,
                                        });
                                      }
                                    }}
                                    disabled={adminRsvpMutation.isPending || rsvpForChildMutation.isPending}
                                    title={`Set ${child.name} to ${value}`}
                                  >
                                    <span className="text-sm">{icon}</span>
                                  </Button>
                                ))}
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                    {/* Members (for non-mini-league events) */}
                    {!isMiniLeagueEvent && notResponded.map((member: any) => (
                      <Card key={member.id}>
                        <CardContent className="p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <Avatar className="h-8 w-8">
                                <AvatarImage src={member.avatar_url || undefined} />
                                <AvatarFallback className="text-xs">
                                  {member.display_name?.charAt(0)?.toUpperCase() || "?"}
                                </AvatarFallback>
                              </Avatar>
                              <span className="font-medium">{member.display_name || "Unknown"}</span>
                            </div>
                            {/* Admin RSVP controls for team/club events */}
                            {(isAdmin || isAppAdmin) && (
                              <div className="flex gap-1">
                                {rsvpOptions.map(({ value, icon }) => (
                                  <Button
                                    key={value}
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 w-8 p-0"
                                    onClick={() => rsvpForMemberMutation.mutate({
                                      memberId: member.id,
                                      memberName: member.display_name,
                                      status: value,
                                    })}
                                    disabled={rsvpForMemberMutation.isPending}
                                    title={`Set ${member.display_name} to ${value}`}
                                  >
                                    <span className="text-sm">{icon}</span>
                                  </Button>
                                ))}
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </>
          );
        })()}
        
      </section>

      {/* Mini League Breakout Groups (only for mini league events) */}
      {event.mini_league_id && (
        <>
          <Separator />
          <section className="space-y-3">
            <EventGroupsManager
              eventId={id!}
              miniLeagueId={event.mini_league_id}
              isAdmin={isAdmin || isAppAdmin || false}
              playerOverrides={playerOverrides}
            />
          </section>
        </>
      )}

      {/* Player of Match Section (only for games) */}
      {event.type === "game" && event.team_id && (
        <>
          <Separator />
          <PlayerOfMatchSelector
            eventId={id!}
            clubId={event.club_id}
            teamId={event.team_id}
            isAdmin={isAdmin || isAppAdmin || false}
            rsvps={rsvps || []}
            childrenOnTeam={childrenOnTeam}
          />
        </>
      )}

      {/* Duties Section (only for non-mini-league games — mini league duties are auto-created via Quick Setup) */}
      {event.type === "game" && !isMiniLeagueEvent && (
        <>
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Duty Roster</h2>
              {isAdmin && (
                <Button size="sm" variant="outline" onClick={() => setAddDutyOpen(true)}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add Duty
                </Button>
              )}
            </div>
            
            <AddDutySheet
              open={addDutyOpen}
              onOpenChange={setAddDutyOpen}
              onAddDuty={(dutyName) => addDutyMutation.mutate(dutyName)}
              isPending={addDutyMutation.isPending}
              isMiniLeague={!!event?.mini_league_id}
              context="session"
            />
            {duties?.length === 0 ? (
              <p className="text-muted-foreground text-sm">No duties assigned for this event</p>
            ) : (
              <div className="space-y-2">
                {duties?.map((duty) => (
                  <Card key={duty.id} className={duty.status === "completed" ? "opacity-60" : ""}>
                    <CardContent className="p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {duty.status === "completed" ? (
                          <CheckCircle2 className="h-5 w-5 text-primary" />
                        ) : (
                          <Circle className="h-5 w-5 text-muted-foreground" />
                        )}
                        <div>
                          <p className="font-medium">{duty.name}</p>
                          {duty.profiles ? (
                            <p className="text-sm text-muted-foreground">
                              {duty.profiles.display_name}
                            </p>
                          ) : (
                            <p className="text-sm text-muted-foreground">Unassigned</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {isAdmin && duty.status === "open" && (
                          <>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => {
                                setSelectedDutyId(duty.id);
                                setSelectedUserId(duty.assigned_to || "");
                                setAssignDialogOpen(true);
                              }}
                            >
                              <UserPlus className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => deleteDutyMutation.mutate(duty.id)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </>
                        )}
                        {duty.status === "open" && !duty.assigned_to && !isAdmin && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => claimDutyMutation.mutate(duty.id)}
                            disabled={claimDutyMutation.isPending}
                          >
                            Claim
                          </Button>
                        )}
                        {duty.status === "open" && (duty.assigned_to === user?.id || isAdmin) && (
                          <Button
                            size="sm"
                            onClick={() => completeDutyMutation.mutate(duty.id)}
                            disabled={completeDutyMutation.isPending}
                          >
                            {completeDutyMutation.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              "Complete"
                            )}
                          </Button>
                        )}
                        {duty.status === "completed" && (
                          <Badge variant="secondary" className="bg-primary/20 text-primary">
                            Done
                          </Badge>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {/* Assign Duty Sheet */}
      <AssignDutySheet
        open={assignDialogOpen}
        onOpenChange={setAssignDialogOpen}
        dutyName={duties?.find(d => d.id === selectedDutyId)?.name || "Duty"}
        currentAssignee={selectedUserId || null}
        members={
          isMiniLeagueEvent
            ? (miniLeagueDutyAssignees?.map((m: any) => ({
                id: m.id,
                display_name: m.display_name,
                avatar_url: m.avatar_url,
              })) || [])
            : (members?.map((m: any) => ({
                id: m.id,
                display_name: m.display_name,
                avatar_url: m.avatar_url,
              })) || [])
        }
        onAssign={(userId) => assignDutyMutation.mutate(userId)}
        isPending={assignDutyMutation.isPending}
      />

      {/* Pitch Board Modal */}
      {showPitchBoard && canAccessPitchBoard && teamMembers && event?.team_id && createPortal(
        <Suspense fallback={
          <div className="fixed inset-0 top-0 left-0 right-0 bottom-0 w-screen h-screen flex items-center justify-center" style={{ backgroundColor: '#2d5a27', zIndex: 999999 }}>
            <div className="flex flex-col items-center gap-4">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-primary">
                  <Flame className="h-8 w-8 text-primary-foreground" />
                </div>
                <span className="text-4xl">⚽</span>
              </div>
              <Loader2 className="h-6 w-6 animate-spin text-white" />
              <p className="text-sm text-white/80">Loading pitch board...</p>
            </div>
          </div>
        }>
          <PitchBoard
            teamId={event.team_id}
            teamName={event.teams?.name || "Team"}
            members={teamMembers.map(m => ({
              id: m.user_id,
              user_id: m.user_id,
              role: m.role,
              profiles: m.profiles
            }))}
            onClose={() => setShowPitchBoard(false)}
            disableAutoSubs={teamSubscription?.disable_auto_subs || false}
            initialRotationSpeed={teamSubscription?.rotation_speed || 2}
            initialDisablePositionSwaps={teamSubscription?.disable_position_swaps || false}
            initialDisableBatchSubs={teamSubscription?.disable_batch_subs || false}
            initialRotateGkAtHalftime={teamSubscription?.rotate_gk_at_halftime ?? true}
            initialMinutesPerHalf={teamSubscription?.minutes_per_half || 10}
            initialTeamSize={teamSubscription?.team_size}
            initialFormation={teamSubscription?.formation || undefined}
            initialLinkedEventId={id}
            initialShowMatchHeader={teamSubscription?.show_match_header ?? true}
            initialShowLineupPicker={teamSubscription?.show_lineup_picker || false}
          />
        </Suspense>,
        document.body
      )}
    </div>
  );
}
