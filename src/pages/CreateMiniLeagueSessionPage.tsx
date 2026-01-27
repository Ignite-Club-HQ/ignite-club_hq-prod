import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, MapPin, Repeat, ChevronDown, Calendar, ClipboardList, Plus, X, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { GoogleMapEmbed } from "@/components/GoogleMapEmbed";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { cn } from "@/lib/utils";

type RecurrencePattern = "weekly" | "biweekly";

const DAYS_OF_WEEK = [
  { value: 0, label: "S" },
  { value: 1, label: "M" },
  { value: 2, label: "T" },
  { value: 3, label: "W" },
  { value: 4, label: "T" },
  { value: 5, label: "F" },
  { value: 6, label: "S" },
];

export default function CreateMiniLeagueSessionPage() {
  const { id: leagueId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Form state
  const [sessionDate, setSessionDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [address, setAddress] = useState("");
  const [teamSizeOverride, setTeamSizeOverride] = useState("");
  
  // Recurring state
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrencePattern, setRecurrencePattern] = useState<RecurrencePattern>("weekly");
  const [recurrenceDays, setRecurrenceDays] = useState<number[]>([]);
  const [recurrenceEndDate, setRecurrenceEndDate] = useState("");
  
  // Duties
  const [duties, setDuties] = useState<string[]>([]);
  const [newDutyName, setNewDutyName] = useState("");

  // Collapsible sections
  const [openSections, setOpenSections] = useState({
    schedule: true,
    location: true,
    duties: false,
    options: false,
  });

  const toggleSection = (section: keyof typeof openSections) => {
    setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  // Fetch league details
  const { data: league, isLoading: leagueLoading } = useQuery({
    queryKey: ["mini-league", leagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mini_leagues")
        .select("*, club:clubs(id, name)")
        .eq("id", leagueId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!leagueId,
  });

  // Set default day based on session date
  useEffect(() => {
    if (sessionDate && recurrenceDays.length === 0) {
      const dayOfWeek = new Date(sessionDate).getDay();
      setRecurrenceDays([dayOfWeek]);
    }
  }, [sessionDate, recurrenceDays.length]);

  const addDuty = () => {
    const trimmed = newDutyName.trim();
    if (trimmed && !duties.includes(trimmed)) {
      setDuties(prev => [...prev, trimmed]);
      setNewDutyName("");
    }
  };

  const removeDuty = (duty: string) => {
    setDuties(prev => prev.filter(d => d !== duty));
  };

  const toggleDay = (day: number) => {
    setRecurrenceDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  // Generate recurring dates
  const generateRecurringDates = (startDate: Date, endDate: Date): Date[] => {
    const dates: Date[] = [];
    const current = new Date(startDate);
    const interval = recurrencePattern === "biweekly" ? 14 : 7;

    while (current <= endDate) {
      if (recurrenceDays.includes(current.getDay())) {
        dates.push(new Date(current));
      }
      current.setDate(current.getDate() + 1);
      
      // Skip weeks if biweekly
      if (recurrencePattern === "biweekly" && dates.length > 0) {
        const lastDate = dates[dates.length - 1];
        const daysDiff = Math.floor((current.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
        if (daysDiff < interval && !recurrenceDays.includes(current.getDay())) {
          continue;
        }
      }
    }
    return dates;
  };

  // Create session mutation
  const createMutation = useMutation({
    mutationFn: async () => {
      if (!league) throw new Error("League not loaded");
      if (!sessionDate) throw new Error("Date is required");

      const sessionsToCreate: Date[] = [];
      const startDateObj = new Date(sessionDate);

      if (isRecurring && recurrenceEndDate) {
        const endDateObj = new Date(recurrenceEndDate);
        const dates = generateRecurringDates(startDateObj, endDateObj);
        sessionsToCreate.push(...dates);
      } else {
        sessionsToCreate.push(startDateObj);
      }

      if (sessionsToCreate.length === 0) {
        throw new Error("No sessions to create");
      }

      // Create each session with linked event
      for (const date of sessionsToCreate) {
        const dateStr = date.toISOString().split("T")[0];
        
        // Create event first
        const { data: eventData, error: eventError } = await supabase.from("events").insert({
          title: `${league.name} Session`,
          event_date: date.toISOString(),
          start_time: startTime,
          end_time: endTime || null,
          address: address || null,
          location_name: address ? address.split(",")[0] : null,
          club_id: league.club_id,
          created_by: user!.id,
          type: "mini_league" as const,
          description: `Mini League session for ${league.name}`,
        }).select().single();

        if (eventError) throw eventError;

        // Create session
        const { data: sessionData, error: sessionError } = await supabase.from("mini_league_sessions").insert({
          mini_league_id: leagueId!,
          session_date: dateStr,
          start_time: startTime,
          end_time: endTime || null,
          location_name: address || null,
          team_size_override: teamSizeOverride ? parseInt(teamSizeOverride) : null,
          created_by: user!.id,
          linked_event_id: eventData.id,
        }).select().single();

        if (sessionError) {
          await supabase.from("events").delete().eq("id", eventData.id);
          throw sessionError;
        }

        // Create duties for the event
        if (duties.length > 0) {
          const dutyRecords = duties.map(name => ({
            event_id: eventData.id,
            name,
            assigned_to: null,
          }));
          await supabase.from("duties").insert(dutyRecords);
        }
      }

      return sessionsToCreate.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["mini-league-sessions", leagueId] });
      queryClient.invalidateQueries({ queryKey: ["events"] });
      toast.success(`Created ${count} session${count > 1 ? "s" : ""}`);
      navigate(`/mini-leagues/${leagueId}`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const handleCreate = () => {
    if (!sessionDate) {
      toast.error("Please select a date");
      return;
    }
    if (isRecurring && !recurrenceEndDate) {
      toast.error("Please set an end date for recurring sessions");
      return;
    }
    createMutation.mutate();
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

  if (leagueLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!league) {
    return (
      <div className="container max-w-2xl py-6 text-center">
        <p className="text-muted-foreground">League not found</p>
      </div>
    );
  }

  return (
    <div className="container max-w-2xl px-4 pb-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 py-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-xl font-bold">New Session</h1>
          <p className="text-sm text-muted-foreground">{league.name}</p>
        </div>
      </div>

      {/* Schedule Section */}
      <Card>
        <SectionHeader
          icon={Calendar}
          title="Schedule"
          isOpen={openSections.schedule}
          onClick={() => toggleSection("schedule")}
        />
        <Collapsible open={openSections.schedule}>
          <CollapsibleContent>
            <CardContent className="pt-0 space-y-4">
              <div className="space-y-2">
                <Label>Date *</Label>
                <Input
                  type="date"
                  value={sessionDate}
                  onChange={(e) => setSessionDate(e.target.value)}
                />
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Start Time</Label>
                  <Input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>End Time</Label>
                  <Input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                  />
                </div>
              </div>

              {/* Players per Side */}
              <div className="space-y-2">
                <Label>Players per Side</Label>
                <div className="grid grid-cols-5 gap-2">
                  <Button
                    type="button"
                    variant={!teamSizeOverride ? "default" : "outline"}
                    size="sm"
                    className="h-10 text-xs"
                    onClick={() => setTeamSizeOverride("")}
                  >
                    Default
                  </Button>
                  {["4", "5", "6", "7"].map((size) => (
                    <Button
                      key={size}
                      type="button"
                      variant={teamSizeOverride === size ? "default" : "outline"}
                      size="sm"
                      className="h-10"
                      onClick={() => setTeamSizeOverride(size)}
                    >
                      {size}v{size}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Default: {league.team_size}v{league.team_size} from league settings
                </p>
              </div>

              {/* Recurring Toggle */}
              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-2">
                  <Repeat className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Recurring Session</span>
                </div>
                <Switch checked={isRecurring} onCheckedChange={setIsRecurring} />
              </div>

              {isRecurring && (
                <div className="space-y-4 pl-6 border-l-2 border-primary/20">
                  <div className="space-y-2">
                    <Label>Repeat</Label>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant={recurrencePattern === "weekly" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setRecurrencePattern("weekly")}
                      >
                        Weekly
                      </Button>
                      <Button
                        type="button"
                        variant={recurrencePattern === "biweekly" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setRecurrencePattern("biweekly")}
                      >
                        Fortnightly
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>On Days</Label>
                    <div className="flex gap-1">
                      {DAYS_OF_WEEK.map(({ value, label }) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => toggleDay(value)}
                          className={cn(
                            "w-9 h-9 rounded-full text-sm font-medium transition-colors",
                            recurrenceDays.includes(value)
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted hover:bg-muted/80"
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Until *</Label>
                    <Input
                      type="date"
                      value={recurrenceEndDate}
                      onChange={(e) => setRecurrenceEndDate(e.target.value)}
                      min={sessionDate}
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* Location Section */}
      <Card>
        <SectionHeader
          icon={MapPin}
          title="Location"
          isOpen={openSections.location}
          onClick={() => toggleSection("location")}
          badge={address ? "Set" : undefined}
        />
        <Collapsible open={openSections.location}>
          <CollapsibleContent>
            <CardContent className="pt-0 space-y-4">
              <AddressAutocomplete
                value={address}
                onChange={setAddress}
                placeholder="Search for a location..."
              />
              {address && (
                <div className="rounded-lg overflow-hidden border">
                  <GoogleMapEmbed address={address} className="w-full h-48" />
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* Duties Section */}
      <Card>
        <SectionHeader
          icon={ClipboardList}
          title="Duties"
          isOpen={openSections.duties}
          onClick={() => toggleSection("duties")}
          badge={duties.length > 0 ? `${duties.length}` : undefined}
        />
        <Collapsible open={openSections.duties}>
          <CollapsibleContent>
            <CardContent className="pt-0 space-y-4">
              <p className="text-sm text-muted-foreground">
                Add duties that need to be assigned for this session
              </p>
              
              <div className="flex gap-2">
                <Input
                  placeholder="e.g. Referee, First Aid, Setup"
                  value={newDutyName}
                  onChange={(e) => setNewDutyName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addDuty())}
                />
                <Button type="button" onClick={addDuty} size="icon" variant="outline">
                  <Plus className="h-4 w-4" />
                </Button>
              </div>

              {duties.length > 0 && (
                <div className="space-y-2">
                  {duties.map((duty) => (
                    <div
                      key={duty}
                      className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                    >
                      <span className="font-medium">{duty}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => removeDuty(duty)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* Create Button */}
      <Button
        onClick={handleCreate}
        disabled={createMutation.isPending || !sessionDate}
        className="w-full h-12 text-base"
      >
        {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        {isRecurring ? "Create Sessions" : "Create Session"}
      </Button>
    </div>
  );
}
