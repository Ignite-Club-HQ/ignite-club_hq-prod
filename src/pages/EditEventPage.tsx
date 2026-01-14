import { useState, useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2, MapPin, Bell, Calendar, FileText, DollarSign, ChevronDown, ClipboardList, Plus, X, Repeat, Users, Building2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { GoogleMapEmbed } from "@/components/GoogleMapEmbed";
import { AddressAutocomplete, SavedLocation } from "@/components/AddressAutocomplete";
import { MobileCardSelect } from "@/components/MobileCardSelect";
import { OpponentInput } from "@/components/OpponentInput";
import { DutyMemberSelect } from "@/components/DutyMemberSelect";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { EventSponsorSelector } from "@/components/EventSponsorSelector";

type EventType = "game" | "training" | "social";
type RecurrencePattern = "daily" | "weekly" | "biweekly" | "monthly";

const DAYS_OF_WEEK = [
  { value: 0, label: "S" },
  { value: 1, label: "M" },
  { value: 2, label: "T" },
  { value: 3, label: "W" },
  { value: 4, label: "T" },
  { value: 5, label: "F" },
  { value: 6, label: "S" },
];

const EVENT_TYPES = [
  { value: "training", label: "Training", icon: "🏃" },
  { value: "game", label: "Game", icon: "⚽" },
  { value: "social", label: "Social", icon: "🎉" },
];

export default function EditEventPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const editSeries = searchParams.get('series') === 'true';
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [title, setTitle] = useState("");
  const [type, setType] = useState<EventType>("training");
  const [eventDateTime, setEventDateTime] = useState("");
  const [address, setAddress] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [showSeriesDialog, setShowSeriesDialog] = useState(false);
  
  // Team/Club selection
  const [selectedClubId, setSelectedClubId] = useState<string>("");
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");
  
  // Reminder settings
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [reminderHours, setReminderHours] = useState(24);
  
  // Price for social events
  const [price, setPrice] = useState("");

  // Recurring event state (for converting single event to recurring)
  const [enableRecurring, setEnableRecurring] = useState(false);
  const [recurrencePattern, setRecurrencePattern] = useState<RecurrencePattern>("weekly");
  const [recurrenceInterval, setRecurrenceInterval] = useState(1);
  const [recurrenceDays, setRecurrenceDays] = useState<number[]>([]);
  const [recurrenceEndDate, setRecurrenceEndDate] = useState("");

  // Duties for game events
  const [duties, setDuties] = useState<{ id?: string; name: string; assignedTo: string | null }[]>([]);
  const [newDutyName, setNewDutyName] = useState("");
  const [dutiesToDelete, setDutiesToDelete] = useState<string[]>([]);

  // Opponent for game events
  const [opponent, setOpponent] = useState("");

  // Collapsible sections state
  const [openSections, setOpenSections] = useState({
    details: true,
    schedule: true,
    assignment: false,
    duties: false,
    location: false,
    options: false,
  });

  const toggleSection = (section: keyof typeof openSections) => {
    setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const addDuty = () => {
    const trimmed = newDutyName.trim();
    if (trimmed && !duties.some(d => d.name === trimmed)) {
      setDuties(prev => [...prev, { name: trimmed, assignedTo: null }]);
      setNewDutyName("");
    }
  };

  const removeDuty = (dutyName: string, dutyId?: string) => {
    setDuties(prev => prev.filter(d => d.name !== dutyName));
    if (dutyId) {
      setDutiesToDelete(prev => [...prev, dutyId]);
    }
  };

  const assignDuty = (dutyName: string, userId: string | null) => {
    setDuties(prev => prev.map(d => 
      d.name === dutyName ? { ...d, assignedTo: userId } : d
    ));
  };

  const toggleRecurrenceDay = (day: number) => {
    setRecurrenceDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const generateRecurringDates = (startDate: Date, endDate: Date): Date[] => {
    const dates: Date[] = [new Date(startDate)];
    let currentDate = new Date(startDate);

    while (currentDate < endDate) {
      if (recurrencePattern === "daily") {
        currentDate = new Date(currentDate.setDate(currentDate.getDate() + recurrenceInterval));
      } else if (recurrencePattern === "weekly") {
        if (recurrenceDays.length > 0) {
          let found = false;
          for (let i = 1; i <= 7 * recurrenceInterval && !found; i++) {
            const nextDate = new Date(currentDate);
            nextDate.setDate(nextDate.getDate() + i);
            if (recurrenceDays.includes(nextDate.getDay())) {
              currentDate = nextDate;
              found = true;
            }
          }
          if (!found) break;
        } else {
          currentDate = new Date(currentDate.setDate(currentDate.getDate() + 7 * recurrenceInterval));
        }
      } else if (recurrencePattern === "biweekly") {
        currentDate = new Date(currentDate.setDate(currentDate.getDate() + 14 * recurrenceInterval));
      } else if (recurrencePattern === "monthly") {
        currentDate = new Date(currentDate.setMonth(currentDate.getMonth() + recurrenceInterval));
      }

      if (currentDate <= endDate) {
        dates.push(new Date(currentDate));
      }
    }

    return dates;
  };

  const { data: event, isLoading } = useQuery({
    queryKey: ["event-edit", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("*, teams (name), clubs (name)")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  // Check if this is a recurring event
  const isRecurring = event?.is_recurring || event?.parent_event_id;

  // Check if user has permission to edit
  const { data: canEdit } = useQuery({
    queryKey: ["can-edit-event", id, user?.id, event?.club_id, event?.team_id],
    queryFn: async () => {
      if (!event) return false;
      
      // Check for app_admin
      const { data: appAdmin } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", user!.id)
        .eq("role", "app_admin")
        .maybeSingle();
      
      if (appAdmin) return true;

      // Check for club_admin role (always applies to club events)
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
      
      return false;
    },
    enabled: !!user && !!event,
  });

  // Check if club has Pro subscription (for sponsor feature)
  const { data: clubSubscription } = useQuery({
    queryKey: ["club-subscription-edit", event?.club_id],
    queryFn: async () => {
      const { data } = await supabase
        .from("club_subscriptions")
        .select("is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
        .eq("club_id", event!.club_id)
        .maybeSingle();
      return data;
    },
    enabled: !!event?.club_id,
  });

  const isPro = clubSubscription?.is_pro || 
    clubSubscription?.is_pro_football || 
    clubSubscription?.admin_pro_override || 
    clubSubscription?.admin_pro_football_override;

  // Fetch existing duties for this event
  const { data: existingDuties } = useQuery({
    queryKey: ["event-duties", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("duties")
        .select("id, name, assigned_to, status")
        .eq("event_id", id!);
      return data || [];
    },
    enabled: !!id,
  });

  // Fetch members for duty assignment
  const { data: members } = useQuery({
    queryKey: ["event-members-for-duty", event?.club_id, event?.team_id],
    queryFn: async () => {
      // Get members from team if selected, otherwise from club
      const targetId = event?.team_id || event?.club_id;
      const idColumn = event?.team_id ? "team_id" : "club_id";
      
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id, profiles!inner(id, display_name, avatar_url)")
        .eq(idColumn, targetId!);

      if (!roles) return [];
      
      // Deduplicate by user_id
      const seen = new Set<string>();
      return roles.filter(r => {
        if (seen.has(r.user_id)) return false;
        seen.add(r.user_id);
        return true;
      }).map(r => ({
        id: r.user_id,
        display_name: (r.profiles as any)?.display_name || "Unknown",
        avatar_url: (r.profiles as any)?.avatar_url,
      }));
    },
    enabled: !!event?.club_id,
  });

  // Fetch saved locations from previous events for the club
  const { data: savedLocations } = useQuery({
    queryKey: ["saved-locations", event?.club_id],
    queryFn: async () => {
      const { data } = await supabase
        .from("events")
        .select("address, suburb, state, postcode")
        .eq("club_id", event!.club_id)
        .not("address", "is", null)
        .neq("address", "")
        .order("event_date", { ascending: false })
        .limit(50);

      if (!data) return [];

      // Deduplicate by address
      const seen = new Set<string>();
      const uniqueLocations: SavedLocation[] = [];
      
      for (const e of data) {
        const key = e.address?.toLowerCase().trim();
        if (key && !seen.has(key)) {
          seen.add(key);
          uniqueLocations.push({
            address: e.address!,
            suburb: e.suburb,
            state: e.state,
            postcode: e.postcode,
          });
        }
        if (uniqueLocations.length >= 10) break;
      }
      
      return uniqueLocations;
    },
    enabled: !!event?.club_id,
  });

  // Fetch user's clubs and teams for selection
  const { data: userClubs } = useQuery({
    queryKey: ["user-clubs-for-edit", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("club_id, clubs(id, name)")
        .eq("user_id", user!.id)
        .not("club_id", "is", null)
        .in("role", ["club_admin", "team_admin", "coach"]);
      
      if (!data) return [];
      const clubs = data.filter(r => r.clubs).map(r => r.clubs as { id: string; name: string });
      return Array.from(new Map(clubs.map(c => [c.id, c])).values());
    },
    enabled: !!user,
  });

  const { data: userTeams } = useQuery({
    queryKey: ["user-teams-for-edit", user?.id, selectedClubId],
    queryFn: async () => {
      const query = supabase
        .from("user_roles")
        .select("team_id, teams(id, name, club_id)")
        .eq("user_id", user!.id)
        .not("team_id", "is", null)
        .in("role", ["team_admin", "coach"]);
      
      const { data } = await query;
      
      if (!data) return [];
      let teams = data.filter(r => r.teams).map(r => r.teams as { id: string; name: string; club_id: string });
      
      // Filter by selected club if set
      if (selectedClubId) {
        teams = teams.filter(t => t.club_id === selectedClubId);
      }
      
      return Array.from(new Map(teams.map(t => [t.id, t])).values());
    },
    enabled: !!user,
  });

  // Populate form with existing data
  useEffect(() => {
    if (event) {
      setTitle(event.title);
      setType(event.type as EventType);
      setDescription(event.description || "");
      setAddress(event.address || "");
      setReminderEnabled(event.reminder_hours_before !== null);
      setReminderHours(event.reminder_hours_before || 24);
      setPrice((event as any).price ? String((event as any).price) : "");
      setSelectedClubId(event.club_id);
      setSelectedTeamId(event.team_id || "");
      setOpponent((event as any).opponent || "");
      
      const parsedEventDateTime = parseISO(event.event_date);
      setEventDateTime(format(parsedEventDateTime, "yyyy-MM-dd'T'HH:mm"));
    }
  }, [event]);

  // Load existing duties
  useEffect(() => {
    if (existingDuties) {
      setDuties(existingDuties.map(d => ({
        id: d.id,
        name: d.name,
        assignedTo: d.assigned_to,
      })));
    }
  }, [existingDuties]);

  const handleSubmit = async (updateSeries: boolean = false) => {
    if (!title.trim() || !eventDateTime) {
      toast({
        title: "Missing information",
        description: "Please fill in all required fields.",
      });
      return;
    }

    // Require team selection for games and training
    if ((type === "game" || type === "training") && !selectedTeamId) {
      toast({
        title: "Team required",
        description: "Please select a team for games and training sessions.",
      });
      return;
    }

    // Validate recurring settings if converting to recurring
    if (enableRecurring && !isRecurring && !recurrenceEndDate) {
      toast({
        title: "Missing end date",
        description: "Please set an end date for recurring events.",
      });
      return;
    }

    setSaving(true);

    const parsedDateTime = new Date(eventDateTime);

    try {
      const parsedPrice = price ? parseFloat(price) : null;
      const updateData = {
        title: title.trim(),
        type,
        address: address.trim() || null,
        description: description.trim() || null,
        reminder_hours_before: reminderEnabled ? reminderHours : null,
        reminder_sent: reminderEnabled ? (event?.reminder_hours_before === reminderHours ? event?.reminder_sent : false) : false,
        price: type === "social" ? parsedPrice : null,
        club_id: selectedClubId,
        team_id: selectedTeamId || null,
        opponent: type === "game" ? opponent.trim() || null : null,
      };

      // If converting single event to recurring series
      if (enableRecurring && !isRecurring) {
        const endDate = new Date(recurrenceEndDate);
        const dates = generateRecurringDates(parsedDateTime, endDate);
        
        // Update the current event to be the parent recurring event
        const { error: parentError } = await supabase
          .from("events")
          .update({
            ...updateData,
            event_date: parsedDateTime.toISOString(),
            is_recurring: true,
            recurrence_pattern: recurrencePattern,
            recurrence_interval: recurrenceInterval,
            recurrence_days: recurrenceDays.length > 0 ? recurrenceDays : null,
            recurrence_end_date: recurrenceEndDate,
          })
          .eq("id", id!);

        if (parentError) throw parentError;

        // Create child events for subsequent dates
        if (dates.length > 1) {
          const childEvents = dates.slice(1).map((date) => {
            const childDateTime = new Date(date);
            childDateTime.setHours(parsedDateTime.getHours(), parsedDateTime.getMinutes());
            return {
              ...updateData,
              event_date: childDateTime.toISOString(),
              parent_event_id: id,
              club_id: event!.club_id,
              team_id: event!.team_id,
              is_recurring: true,
              recurrence_pattern: recurrencePattern,
              recurrence_interval: recurrenceInterval,
              recurrence_days: recurrenceDays.length > 0 ? recurrenceDays : null,
              recurrence_end_date: recurrenceEndDate,
              created_by: user!.id,
            };
          });

          const { error: childError } = await supabase
            .from("events")
            .insert(childEvents);

          if (childError) throw childError;
        }

        toast({
          title: "Recurring series created",
          description: `Created ${dates.length} event${dates.length > 1 ? 's' : ''} in the series.`,
        });
      } else if (updateSeries) {
        // Update this event
        await supabase
          .from("events")
          .update({ ...updateData, event_date: parsedDateTime.toISOString() })
          .eq("id", id!);

        // If this is a child event, update parent and siblings (except date/time)
        if (event?.parent_event_id) {
          await supabase
            .from("events")
            .update(updateData)
            .eq("id", event.parent_event_id);
          await supabase
            .from("events")
            .update(updateData)
            .eq("parent_event_id", event.parent_event_id)
            .neq("id", id!);
        }
        // If this is the parent event, update all children (except date/time)
        else if (event?.is_recurring) {
          await supabase
            .from("events")
            .update(updateData)
            .eq("parent_event_id", id!);
        }
      } else {
        // Just update this single event
        const { error } = await supabase
          .from("events")
          .update({ ...updateData, event_date: parsedDateTime.toISOString() })
          .eq("id", id!);
        if (error) throw error;
      }

      // Handle duty updates for game events
      if (type === "game") {
        // Delete removed duties
        if (dutiesToDelete.length > 0) {
          await supabase.from("duties").delete().in("id", dutiesToDelete);
        }

        // Update existing duties and create new ones
        for (const duty of duties) {
          if (duty.id) {
            // Update existing
            await supabase
              .from("duties")
              .update({ name: duty.name, assigned_to: duty.assignedTo })
              .eq("id", duty.id);
          } else {
            // Create new
            await supabase.from("duties").insert({
              event_id: id!,
              name: duty.name,
              assigned_to: duty.assignedTo,
            });
          }
        }
      }

      // Notify all RSVPs about the event update
      const { data: rsvps } = await supabase
        .from("rsvps")
        .select("user_id")
        .eq("event_id", id!);
      
      if (rsvps && rsvps.length > 0) {
        const notifications = rsvps
          .filter(r => r.user_id !== user?.id)
          .map(r => ({
            user_id: r.user_id,
            type: "event_updated",
            message: `Event updated: ${title.trim()}`,
            related_id: id,
          }));
        
        if (notifications.length > 0) {
          await supabase.from("notifications").insert(notifications);
        }
      }

      navigate(`/events/${id}`);
    } catch (error) {
      console.error("Error updating event:", error);
      toast({
        title: "Error",
        description: "Failed to update event. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveClick = () => {
    // If recurring, show the series dialog
    if (isRecurring && !editSeries) {
      setShowSeriesDialog(true);
    } else if (editSeries) {
      // Came from series selection
      handleSubmit(true);
    } else {
      // Single event
      handleSubmit(false);
    }
  };

  const SectionHeader = ({ 
    icon: Icon, 
    title, 
    isOpen, 
    onClick,
    badge
  }: { 
    icon: any; 
    title: string; 
    isOpen: boolean; 
    onClick: () => void;
    badge?: string;
  }) => (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
      className="flex items-center justify-between w-full p-4 text-left hover:bg-muted/50 transition-colors rounded-lg cursor-pointer select-none"
    >
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <span className="font-medium">{title}</span>
        {badge && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
            {badge}
          </span>
        )}
      </div>
      <ChevronDown className={cn(
        "h-4 w-4 text-muted-foreground transition-transform duration-200",
        isOpen && "rotate-180"
      )} />
    </div>
  );

  if (isLoading) {
    return (
      <div className="pb-6 space-y-4">
        <div className="flex items-center gap-3 py-4">
          <Skeleton className="h-10 w-10 rounded-full" />
          <Skeleton className="h-8 w-32" />
        </div>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!event) {
    return <div className="py-6 text-center text-muted-foreground">Event not found</div>;
  }

  if (canEdit === false) {
    return <div className="py-6 text-center text-muted-foreground">You don't have permission to edit this event</div>;
  }

  return (
    <div className="pb-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 py-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-xl font-bold">Edit Event</h1>
          <p className="text-sm text-muted-foreground">
            {event.clubs?.name} {event.teams?.name && `• ${event.teams.name}`}
          </p>
        </div>
      </div>

      {/* Event Type Selection */}
      <div className="grid grid-cols-3 gap-2">
        {EVENT_TYPES.map((eventType) => (
          <button
            key={eventType.value}
            type="button"
            onClick={() => setType(eventType.value as EventType)}
            className={cn(
              "flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all",
              type === eventType.value
                ? "border-primary bg-primary/10"
                : "border-border hover:border-muted-foreground/50"
            )}
          >
            <span className="text-2xl">{eventType.icon}</span>
            <span className="text-sm font-medium">{eventType.label}</span>
          </button>
        ))}
      </div>

      {/* Details Section */}
      <Card>
        <Collapsible open={openSections.details}>
          <SectionHeader 
            icon={FileText} 
            title="Event Details" 
            isOpen={openSections.details}
            onClick={() => toggleSection('details')}
            badge="Required"
          />
          <CollapsibleContent>
            <CardContent className="pt-0 pb-4 px-4 space-y-4">
              {/* Title */}
              <div className="space-y-2">
                <Label htmlFor="title">Event Title</Label>
                <Input
                  id="title"
                  placeholder="e.g., Saturday Training"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={100}
                />
              </div>

              {/* Description */}
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  placeholder="Add any additional details..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  maxLength={1000}
                />
              </div>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* Club/Team Assignment Section */}
      <Card>
        <Collapsible open={openSections.assignment}>
          <SectionHeader 
            icon={Users} 
            title="Club & Team" 
            isOpen={openSections.assignment}
            onClick={() => toggleSection('assignment')}
          />
          <CollapsibleContent>
            <CardContent className="pt-0 pb-4 px-4 space-y-4">
              {/* Club & Team Selection */}
              <div className="flex flex-col gap-3">
                <MobileCardSelect
                  value={selectedClubId}
                  onValueChange={(value) => {
                    setSelectedClubId(value);
                    if (value !== selectedClubId) {
                      setSelectedTeamId("");
                    }
                  }}
                  options={userClubs?.map((club) => ({ value: club.id, label: club.name })) || []}
                  placeholder="Select club"
                  label="Club"
                  required
                />

                <MobileCardSelect
                  value={selectedTeamId || (type === "social" ? "__none__" : "")}
                  onValueChange={(value) => setSelectedTeamId(value === "__none__" ? "" : value)}
                  options={[
                    ...(type === "social" ? [{ value: "__none__", label: "Club-wide event" }] : []),
                    ...(userTeams?.map((team) => ({ value: team.id, label: team.name })) || []),
                  ]}
                  placeholder={type === "social" ? "Club-wide (optional)" : "Select team"}
                  label="Team"
                  required={type !== "social"}
                />
                {type === "social" && (
                  <p className="text-xs text-muted-foreground">
                    Leave blank for club-wide events.
                  </p>
                )}
              </div>

              {/* Opponent - only for game events */}
              {type === "game" && (
                <OpponentInput
                  value={opponent}
                  onChange={setOpponent}
                  clubId={selectedClubId}
                  teamId={selectedTeamId}
                />
              )}
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* Schedule Section */}
      <Card>
        <Collapsible open={openSections.schedule}>
          <SectionHeader 
            icon={Calendar} 
            title="Date & Time" 
            isOpen={openSections.schedule}
            onClick={() => toggleSection('schedule')}
            badge="Required"
          />
          <CollapsibleContent>
            <CardContent className="pt-0 pb-4 px-4 space-y-4">
              {/* Combined Date & Time input */}
              <div className="space-y-2">
                <Label htmlFor="datetime">Date & Time</Label>
                <Input
                  id="datetime"
                  type="datetime-local"
                  value={eventDateTime}
                  onChange={(e) => setEventDateTime(e.target.value)}
                  className="w-full h-12"
                />
              </div>

              {/* Recurring Toggle - Only show if not already recurring */}
              {!isRecurring && (
                <>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-2">
                      <Repeat className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Convert to recurring series</span>
                    </div>
                    <Switch
                      checked={enableRecurring}
                      onCheckedChange={setEnableRecurring}
                    />
                  </div>

                  {enableRecurring && (
                    <div className="space-y-4 p-3 rounded-lg border border-dashed">
                      <div className="space-y-2">
                        <Label>Frequency</Label>
                        <Select
                          value={recurrencePattern}
                          onValueChange={(v) => setRecurrencePattern(v as RecurrencePattern)}
                        >
                          <SelectTrigger className="h-12 text-base">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent position="popper" sideOffset={4}>
                            <SelectItem value="daily" className="py-3 text-base">Daily</SelectItem>
                            <SelectItem value="weekly" className="py-3 text-base">Weekly</SelectItem>
                            <SelectItem value="biweekly" className="py-3 text-base">Bi-weekly</SelectItem>
                            <SelectItem value="monthly" className="py-3 text-base">Monthly</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {recurrencePattern === "weekly" && (
                        <div className="space-y-2">
                          <Label>Repeat on</Label>
                          <div className="flex gap-1">
                            {DAYS_OF_WEEK.map((day) => (
                              <button
                                key={day.value}
                                type="button"
                                onClick={() => toggleRecurrenceDay(day.value)}
                                className={cn(
                                  "w-9 h-9 rounded-full text-sm font-medium transition-colors",
                                  recurrenceDays.includes(day.value)
                                    ? "bg-primary text-primary-foreground"
                                    : "bg-muted hover:bg-muted/80"
                                )}
                              >
                                {day.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label>Every</Label>
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              min={1}
                              max={12}
                              value={recurrenceInterval}
                              onChange={(e) => setRecurrenceInterval(parseInt(e.target.value) || 1)}
                              className="w-16"
                            />
                            <span className="text-sm text-muted-foreground">
                              {recurrencePattern === "daily" && "day(s)"}
                              {recurrencePattern === "weekly" && "week(s)"}
                              {recurrencePattern === "biweekly" && "period(s)"}
                              {recurrencePattern === "monthly" && "month(s)"}
                            </span>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="endDate">Until</Label>
                          <Input
                            id="endDate"
                            type="date"
                            value={recurrenceEndDate}
                            onChange={(e) => setRecurrenceEndDate(e.target.value)}
                            min={eventDateTime ? eventDateTime.split('T')[0] : undefined}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Show info if already recurring */}
              {isRecurring && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
                  <Repeat className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">This is part of a recurring series</span>
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* Duties Section - Only for game events */}
      {type === "game" && (
        <Card>
          <Collapsible open={openSections.duties}>
            <SectionHeader 
              icon={ClipboardList} 
              title="Duties" 
              isOpen={openSections.duties}
              onClick={() => toggleSection('duties')}
              badge={duties.length > 0 ? `${duties.length}` : "Optional"}
            />
            <CollapsibleContent>
              <CardContent className="pt-0 pb-4 px-4 space-y-4">
                <p className="text-sm text-muted-foreground">
                  Add duties like BBQ, scorer, or first aid for volunteers to sign up.
                </p>
                <div className="flex items-start gap-2 p-3 rounded-lg bg-primary/10 border border-primary/20">
                  <span className="text-lg">🔥</span>
                  <p className="text-sm text-foreground">
                    <span className="font-medium">Ignite Points:</span> Volunteers earn <span className="font-semibold text-primary">10 points</span> for each completed duty (Pro clubs only). Points are awarded 24 hours after the game ends.
                  </p>
                </div>
                
                {/* Add duty input */}
                <div className="flex gap-2">
                  <Input
                    placeholder="e.g., BBQ duty, Scorer, First Aid"
                    value={newDutyName}
                    onChange={(e) => setNewDutyName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addDuty();
                      }
                    }}
                    className="flex-1 h-12"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    className="h-12 w-12 shrink-0"
                    onClick={addDuty}
                    disabled={!newDutyName.trim()}
                  >
                    <Plus className="h-5 w-5" />
                  </Button>
                </div>

                {/* Duty list */}
                {duties.length > 0 && (
                  <div className="space-y-3">
                    {duties.map((duty, index) => (
                      <div 
                        key={duty.id || index} 
                        className="p-3 rounded-lg bg-muted/50 space-y-3"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">{duty.name}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => removeDuty(duty.name, duty.id)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                        <DutyMemberSelect
                          value={duty.assignedTo}
                          onValueChange={(v) => assignDuty(duty.name, v)}
                          members={members || []}
                          dutyName={duty.name}
                        />
                      </div>
                    ))}
                  </div>
                )}

                {/* Quick add common duties */}
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Quick add:</Label>
                  <div className="flex flex-wrap gap-2">
                    {["BBQ", "Scorer", "First Aid", "Line Judge", "Water Duty", "Set Up", "Pack Up"].map((suggestion) => (
                      <Button
                        key={suggestion}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={() => {
                          if (!duties.some(d => d.name === suggestion)) {
                            setDuties(prev => [...prev, { name: suggestion, assignedTo: null }]);
                          }
                        }}
                        disabled={duties.some(d => d.name === suggestion)}
                      >
                        {suggestion}
                      </Button>
                    ))}
                  </div>
                </div>
              </CardContent>
            </CollapsibleContent>
          </Collapsible>
        </Card>
      )}

      {/* Location Section */}
      <Card>
        <Collapsible open={openSections.location}>
          <SectionHeader 
            icon={MapPin} 
            title="Location" 
            isOpen={openSections.location}
            onClick={() => toggleSection('location')}
            badge={address ? "Set" : undefined}
          />
          <CollapsibleContent>
            <CardContent className="pt-0 pb-4 px-4 space-y-4">
              <AddressAutocomplete
                value={address}
                onChange={setAddress}
                onSelect={(addr) => {
                  const fullAddress = [addr.address, addr.suburb, addr.state, addr.postcode]
                    .filter(Boolean)
                    .join(", ");
                  setAddress(fullAddress || addr.address);
                }}
                placeholder="Search for address..."
                savedLocations={savedLocations}
              />
              
              {address && (
                <GoogleMapEmbed address={address} />
              )}
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* Options Section */}
      <Card>
        <Collapsible open={openSections.options}>
          <SectionHeader 
            icon={Bell} 
            title="Options" 
            isOpen={openSections.options}
            onClick={() => toggleSection('options')}
          />
          <CollapsibleContent>
            <CardContent className="pt-0 pb-4 px-4 space-y-4">
              {/* Price - only for social events */}
              {type === "social" && (
                <div className="space-y-2">
                  <Label htmlFor="price" className="flex items-center gap-2">
                    <DollarSign className="h-4 w-4" /> Price (AUD)
                  </Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                    <Input
                      id="price"
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      className="pl-7 h-12"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">Optional - leave empty for free events</p>
                </div>
              )}

              {/* Auto Reminder */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Bell className="h-4 w-4 text-muted-foreground" />
                    <Label htmlFor="reminder">Auto RSVP Reminder</Label>
                  </div>
                  <Switch
                    id="reminder"
                    checked={reminderEnabled}
                    onCheckedChange={setReminderEnabled}
                  />
                </div>

                {reminderEnabled && (
                  <div className="space-y-2">
                    <Label>Send reminder</Label>
                    <Select
                      value={reminderHours.toString()}
                      onValueChange={(v) => setReminderHours(parseInt(v))}
                    >
                      <SelectTrigger className="h-12">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="6">6 hours before</SelectItem>
                        <SelectItem value="12">12 hours before</SelectItem>
                        <SelectItem value="24">24 hours before</SelectItem>
                        <SelectItem value="48">2 days before</SelectItem>
                        <SelectItem value="72">3 days before</SelectItem>
                        <SelectItem value="168">1 week before</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Members who haven't RSVPed will be automatically reminded
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* Event Sponsors - Pro only */}
      {isPro && event && (
        <EventSponsorSelector eventId={event.id} clubId={event.club_id} />
      )}

      {/* Save Button */}
      <Button
        className="w-full h-12 text-base"
        onClick={handleSaveClick}
        disabled={saving || !title.trim() || !eventDateTime}
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Changes"}
      </Button>

      {/* Series Edit Dialog */}
      <AlertDialog open={showSeriesDialog} onOpenChange={setShowSeriesDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Edit Recurring Event</AlertDialogTitle>
            <AlertDialogDescription>
              This event is part of a recurring series. Would you like to edit just this event or the entire series?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => {
                setShowSeriesDialog(false);
                handleSubmit(false);
              }}
              disabled={saving}
            >
              This Event Only
            </Button>
            <AlertDialogAction
              onClick={() => {
                setShowSeriesDialog(false);
                handleSubmit(true);
              }}
              disabled={saving}
            >
              Entire Series
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}