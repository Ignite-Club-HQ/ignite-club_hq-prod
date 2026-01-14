import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, MapPin, Repeat, Bell, ChevronDown, Calendar, FileText, DollarSign, ClipboardList, Plus, X, User, Star, Trash2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { GoogleMapEmbed } from "@/components/GoogleMapEmbed";
import { AddressAutocomplete, SavedLocation } from "@/components/AddressAutocomplete";
import { MobileCardSelect } from "@/components/MobileCardSelect";
import { OpponentInput } from "@/components/OpponentInput";
import { DutyMemberSelect } from "@/components/DutyMemberSelect";
import { useClubTheme } from "@/hooks/useClubTheme";
import { cn } from "@/lib/utils";

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

export default function CreateEventPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { activeClubFilter } = useClubTheme();

  const [title, setTitle] = useState("");
  const [type, setType] = useState<EventType>("training");
  const [clubId, setClubId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [eventDateTime, setEventDateTime] = useState("");
  const [address, setAddress] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  // Recurring event state
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrencePattern, setRecurrencePattern] = useState<RecurrencePattern>("weekly");
  const [recurrenceInterval, setRecurrenceInterval] = useState(1);
  const [recurrenceDays, setRecurrenceDays] = useState<number[]>([]);
  const [recurrenceEndDate, setRecurrenceEndDate] = useState("");
  
  // Reminder settings
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [reminderHours, setReminderHours] = useState(24);
  
  // Price for social events
  const [price, setPrice] = useState("");

  // Duties for game events
  const [duties, setDuties] = useState<{ name: string; assignedTo: string | null }[]>([]);
  const [newDutyName, setNewDutyName] = useState("");

  // Opponent for game events
  const [opponent, setOpponent] = useState("");

  // Collapsible sections state - all expanded by default
  const [openSections, setOpenSections] = useState({
    details: true,
    schedule: true,
    duties: true,
    location: true,
    options: true,
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

  const removeDuty = (dutyToRemove: string) => {
    setDuties(prev => prev.filter(d => d.name !== dutyToRemove));
  };

  const assignDuty = (dutyName: string, userId: string | null) => {
    setDuties(prev => prev.map(d => 
      d.name === dutyName ? { ...d, assignedTo: userId } : d
    ));
  };

  const { data: clubs } = useQuery({
    queryKey: ["user-admin-clubs", user?.id],
    queryFn: async () => {
      const { data: clubRoles } = await supabase
        .from("user_roles")
        .select("club_id")
        .eq("user_id", user!.id)
        .eq("role", "club_admin")
        .not("club_id", "is", null);

      const { data: teamRoles } = await supabase
        .from("user_roles")
        .select("team_id, teams!inner(club_id)")
        .eq("user_id", user!.id)
        .in("role", ["team_admin", "coach"])
        .not("team_id", "is", null);

      const clubIdsFromClubs = clubRoles?.map((r) => r.club_id).filter(Boolean) || [];
      const clubIdsFromTeams = teamRoles?.map((r) => (r.teams as any)?.club_id).filter(Boolean) || [];
      const clubIds = [...new Set([...clubIdsFromClubs, ...clubIdsFromTeams])];

      if (clubIds.length === 0) return [];
      
      const { data } = await supabase
        .from("clubs")
        .select("id, name")
        .in("id", clubIds);

      return data || [];
    },
    enabled: !!user,
  });

  // Auto-select filtered club when active
  const filteredClubs = activeClubFilter 
    ? clubs?.filter(c => c.id === activeClubFilter) 
    : clubs;
  
  // Auto-select the filtered club when active
  useEffect(() => {
    if (activeClubFilter && clubs?.some(c => c.id === activeClubFilter) && !clubId) {
      setClubId(activeClubFilter);
    }
  }, [activeClubFilter, clubs, clubId]);

  const { data: teams } = useQuery({
    queryKey: ["club-teams-for-event", clubId],
    queryFn: async () => {
      const { data } = await supabase
        .from("teams")
        .select("id, name")
        .eq("club_id", clubId);

      return data || [];
    },
    enabled: !!clubId,
  });

  // Fetch members for duty assignment
  const { data: members } = useQuery({
    queryKey: ["event-members-for-duty", clubId, teamId],
    queryFn: async () => {
      // Get members from team if selected, otherwise from club
      const targetId = teamId || clubId;
      const idColumn = teamId ? "team_id" : "club_id";
      
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id, profiles!inner(id, display_name, avatar_url)")
        .eq(idColumn, targetId);

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
    enabled: !!clubId,
  });

  // Fetch saved locations from previous events for the selected club
  const { data: savedLocations } = useQuery({
    queryKey: ["saved-locations", clubId],
    queryFn: async () => {
      const { data } = await supabase
        .from("events")
        .select("address, suburb, state, postcode")
        .eq("club_id", clubId)
        .not("address", "is", null)
        .neq("address", "")
        .order("event_date", { ascending: false })
        .limit(50);

      if (!data) return [];

      // Deduplicate by address
      const seen = new Set<string>();
      const uniqueLocations: SavedLocation[] = [];
      
      for (const event of data) {
        const key = event.address?.toLowerCase().trim();
        if (key && !seen.has(key)) {
          seen.add(key);
          uniqueLocations.push({
            address: event.address!,
            suburb: event.suburb,
            state: event.state,
            postcode: event.postcode,
          });
        }
        if (uniqueLocations.length >= 10) break;
      }
      
      return uniqueLocations;
    },
    enabled: !!clubId,
  });

  // Fetch favorite event titles
  const queryClient = useQueryClient();
  const { data: favoriteTitles } = useQuery({
    queryKey: ["favorite-event-titles", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("favorite_event_titles")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!user,
  });

  const saveFavoriteTitle = async () => {
    if (!user || !title.trim()) return;
    
    const { error } = await supabase
      .from("favorite_event_titles")
      .insert({
        user_id: user.id,
        title: title.trim(),
        event_type: type,
      });
    
    if (error) {
      if (error.code === "23505") {
        toast({ title: "Already saved", description: "This title is already in your favorites" });
      } else {
        toast({ title: "Error", description: "Failed to save favorite", variant: "destructive" });
      }
    } else {
      toast({ title: "Saved!", description: "Title added to favorites" });
      queryClient.invalidateQueries({ queryKey: ["favorite-event-titles"] });
    }
  };

  const deleteFavoriteTitle = async (id: string) => {
    const { error } = await supabase
      .from("favorite_event_titles")
      .delete()
      .eq("id", id);
    
    if (!error) {
      queryClient.invalidateQueries({ queryKey: ["favorite-event-titles"] });
    }
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

  const handleSubmit = async () => {
    if (!title.trim() || !clubId || !eventDateTime) {
      toast({
        title: "Missing information",
        description: "Please fill in all required fields.",
      });
      return;
    }

    // Require team selection for games and training
    if ((type === "game" || type === "training") && !teamId) {
      toast({
        title: "Team required",
        description: "Please select a team for games and training sessions.",
      });
      return;
    }

    if (isRecurring && !recurrenceEndDate) {
      toast({
        title: "Missing end date",
        description: "Please set an end date for recurring events.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);

    const parsedDateTime = new Date(eventDateTime);
    const parsedPrice = price ? parseFloat(price) : null;
    const baseEventData = {
      title: title.trim(),
      type,
      club_id: clubId,
      team_id: teamId || null,
      address: address.trim() || null,
      suburb: null,
      state: null,
      postcode: null,
      description: description.trim() || null,
      created_by: user!.id,
      is_recurring: isRecurring,
      recurrence_pattern: isRecurring ? recurrencePattern : null,
      recurrence_interval: isRecurring ? recurrenceInterval : null,
      recurrence_days: isRecurring && recurrenceDays.length > 0 ? recurrenceDays : null,
      recurrence_end_date: isRecurring ? recurrenceEndDate : null,
      reminder_hours_before: reminderEnabled ? reminderHours : null,
      reminder_sent: false,
      price: type === "social" ? parsedPrice : null,
      opponent: type === "game" ? opponent.trim() || null : null,
    };

    try {
      if (isRecurring) {
        const endDate = new Date(recurrenceEndDate);
        const dates = generateRecurringDates(parsedDateTime, endDate);
        
        const { data: parentEvent, error: parentError } = await supabase
          .from("events")
          .insert({
            ...baseEventData,
            event_date: parsedDateTime.toISOString(),
          })
          .select()
          .single();

        if (parentError) throw parentError;

        if (dates.length > 1) {
          const childEvents = dates.slice(1).map((date) => {
            const childDateTime = new Date(date);
            childDateTime.setHours(parsedDateTime.getHours(), parsedDateTime.getMinutes());
            return {
              ...baseEventData,
              event_date: childDateTime.toISOString(),
              parent_event_id: parentEvent.id,
            };
          });

          const { error: childError } = await supabase
            .from("events")
            .insert(childEvents);

          if (childError) throw childError;
        }

        // Create duties for parent event if it's a game
        if (type === "game" && duties.length > 0) {
          const dutyRecords = duties.map(duty => ({
            event_id: parentEvent.id,
            name: duty.name,
            assigned_to: duty.assignedTo,
          }));
          await supabase.from("duties").insert(dutyRecords);
        }

        navigate(`/events/${parentEvent.id}`);
      } else {
        const { data, error } = await supabase
          .from("events")
          .insert({
            ...baseEventData,
            event_date: parsedDateTime.toISOString(),
          })
          .select()
          .single();

        if (error) throw error;

        // Create duties if it's a game event
        if (type === "game" && duties.length > 0) {
          const dutyRecords = duties.map(duty => ({
            event_id: data.id,
            name: duty.name,
            assigned_to: duty.assignedTo,
          }));
          await supabase.from("duties").insert(dutyRecords);
        }

        navigate(`/events/${data.id}`);
      }
    } catch (error: any) {
      console.error("Error creating event:", error);
      
      // Build a more helpful error message
      let errorDescription = "Failed to create event. ";
      
      if (error?.message?.includes("row-level security")) {
        errorDescription += "You don't have permission to create events for this club/team.";
      } else if (error?.message?.includes("violates check constraint")) {
        errorDescription += "Please check that all fields have valid values.";
      } else if (error?.code === "23502") {
        // Not null violation
        errorDescription += "Some required information is missing.";
      } else if (error?.message) {
        errorDescription += error.message;
      } else {
        // Provide guidance on what might be missing
        const missingFields: string[] = [];
        if (!title.trim()) missingFields.push("Event title");
        if (!clubId) missingFields.push("Club selection");
        if (!eventDateTime) missingFields.push("Date and time");
        if ((type === "game" || type === "training") && !teamId) missingFields.push("Team selection");
        
        if (missingFields.length > 0) {
          errorDescription = `Missing required fields: ${missingFields.join(", ")}`;
        } else {
          errorDescription += "Please try again.";
        }
      }
      
      toast({
        title: "Error",
        description: errorDescription,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
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

  return (
    <div className="pb-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 py-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-xl font-bold">New Event</h1>
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
                <div className="flex items-center justify-between">
                  <Label htmlFor="title">Event Title</Label>
                  <div className="flex items-center gap-1">
                    {favoriteTitles && favoriteTitles.length > 0 && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1">
                            <Star className="h-3 w-3" />
                            Favorites
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-64">
                          {favoriteTitles.map((fav) => (
                            <DropdownMenuItem
                              key={fav.id}
                              className="flex items-center justify-between gap-2"
                              onSelect={() => {
                                setTitle(fav.title);
                                setType(fav.event_type as EventType);
                              }}
                            >
                              <span className="flex-1 truncate">
                                {fav.title}
                              </span>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 hover:bg-destructive/10"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  deleteFavoriteTitle(fav.id);
                                }}
                              >
                                <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                              </Button>
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                    {title.trim() && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs gap-1"
                        onClick={saveFavoriteTitle}
                      >
                        <Star className="h-3 w-3" />
                        Save
                      </Button>
                    )}
                  </div>
                </div>
                <div className="relative">
                  <Input
                    id="title"
                    placeholder="e.g., Saturday Training"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={100}
                    className={title ? "pr-8" : ""}
                  />
                  {title && (
                    <button
                      type="button"
                      onClick={() => setTitle("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Club & Team */}
              <div className="flex flex-col gap-3">
                <MobileCardSelect
                  value={clubId}
                  onValueChange={setClubId}
                  options={filteredClubs?.map((club) => ({ value: club.id, label: club.name })) || []}
                  placeholder="Select club"
                  label="Club"
                  required
                  disabled={!!activeClubFilter}
                />
                
                <MobileCardSelect
                  value={teamId || (type === "social" ? "__all__" : "")}
                  onValueChange={(v) => setTeamId(v === "__all__" ? "" : v)}
                  options={[
                    ...(type === "social" ? [{ value: "__all__", label: "All Club" }] : []),
                    ...(teams?.map((team) => ({ value: team.id, label: team.name })) || []),
                  ]}
                  placeholder={type === "social" ? "All Club" : "Select team"}
                  label="Team"
                  disabled={!clubId}
                  required={type !== "social"}
                />
              </div>

              {/* Opponent - only for game events */}
              {type === "game" && (
                <OpponentInput
                  value={opponent}
                  onChange={setOpponent}
                  clubId={clubId}
                  teamId={teamId}
                />
              )}

              {/* Price - only for social events */}
              {type === "social" && (
                <div className="space-y-2">
                  <Label htmlFor="price">Price (AUD)</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="price"
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00 (free)"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                </div>
              )}

              {/* Description */}
              <div className="space-y-2">
                <Label htmlFor="description">Description <span className="text-muted-foreground text-xs">(optional)</span></Label>
                <Textarea
                  id="description"
                  placeholder="Add any additional details..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="resize-none"
                />
              </div>
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

              {/* Recurring Toggle */}
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                <div className="flex items-center gap-2">
                  <Repeat className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Repeat this event</span>
                </div>
                <Switch
                  checked={isRecurring}
                  onCheckedChange={setIsRecurring}
                />
              </div>

              {isRecurring && (
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
                        key={index} 
                        className="p-3 rounded-lg bg-muted/50 space-y-3"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">{duty.name}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => removeDuty(duty.name)}
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
            badge={address ? "Set" : "Optional"}
          />
          <CollapsibleContent>
            <CardContent className="pt-0 pb-4 px-4 space-y-3">
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
                <div className="rounded-lg overflow-hidden">
                  <GoogleMapEmbed address={address} />
                </div>
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
            title="Reminders" 
            isOpen={openSections.options}
            onClick={() => toggleSection('options')}
            badge={reminderEnabled ? "On" : "Off"}
          />
          <CollapsibleContent>
            <CardContent className="pt-0 pb-4 px-4 space-y-4">
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                <div className="flex flex-col">
                  <span className="text-sm font-medium">Auto RSVP Reminder</span>
                  <span className="text-xs text-muted-foreground">
                    Remind members who haven't responded
                  </span>
                </div>
                <Switch
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
                    <SelectTrigger className="h-12 text-base">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper" sideOffset={4}>
                      <SelectItem value="6" className="py-3 text-base">6 hours before</SelectItem>
                      <SelectItem value="12" className="py-3 text-base">12 hours before</SelectItem>
                      <SelectItem value="24" className="py-3 text-base">24 hours before</SelectItem>
                      <SelectItem value="48" className="py-3 text-base">2 days before</SelectItem>
                      <SelectItem value="72" className="py-3 text-base">3 days before</SelectItem>
                      <SelectItem value="168" className="py-3 text-base">1 week before</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* Submit Button - Sticky on mobile */}
      <div className="sticky bottom-4 pt-2">
        <Button
          className="w-full h-12 text-base font-semibold shadow-lg"
          onClick={handleSubmit}
          disabled={saving || !title.trim() || !clubId || !eventDateTime}
        >
          {saving ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            "Create Event"
          )}
        </Button>
      </div>
    </div>
  );
}
