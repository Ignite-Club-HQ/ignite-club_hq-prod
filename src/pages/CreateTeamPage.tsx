import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Camera, Loader2, AlertCircle, Users, Sparkles, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { AssignTeamAdminSection, TeamAdminAssignment } from "@/components/AssignTeamAdminSection";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

export default function CreateTeamPage() {
  const { clubId } = useParams<{ clubId: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [levelAge, setLevelAge] = useState("");
  const [description, setDescription] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [adminAssignment, setAdminAssignment] = useState<TeamAdminAssignment | null>(null);

  const { data: club } = useQuery({
    queryKey: ["club", clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clubs")
        .select("name, logo_url")
        .eq("id", clubId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!clubId,
  });

  // Get team count and club subscription
  const { data: teamCount = 0 } = useQuery({
    queryKey: ["club-team-count", clubId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("teams")
        .select("*", { count: "exact", head: true })
        .eq("club_id", clubId!);
      if (error) throw error;
      return count || 0;
    },
    enabled: !!clubId,
  });

  const { data: clubSubscription } = useQuery({
    queryKey: ["club-subscription", clubId],
    queryFn: async () => {
      const { data } = await supabase
        .from("club_subscriptions")
        .select("*")
        .eq("club_id", clubId!)
        .maybeSingle();
      return data;
    },
    enabled: !!clubId,
  });

  // Fetch team folders for selection
  const { data: folders = [] } = useQuery({
    queryKey: ["team-folders", clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("team_folders")
        .select("*")
        .eq("club_id", clubId!)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!clubId,
  });

  // Check if team limit is exceeded
  const teamLimitExceeded = clubSubscription?.team_limit !== null && 
    clubSubscription?.team_limit !== undefined &&
    teamCount >= clubSubscription.team_limit;

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      setLogoUrl(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast({
        title: "Missing information",
        description: "Please enter a team name.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);

    // Create the team
    const { data: team, error: teamError } = await supabase
      .from("teams")
      .insert({
        name: name.trim(),
        club_id: clubId!,
        level_age: levelAge.trim() || null,
        description: description.trim() || null,
        logo_url: logoUrl || null,
        folder_id: folderId || null,
        created_by: user!.id,
      })
      .select()
      .single();

    if (teamError) {
      setSaving(false);
      toast({
        title: "Error",
        description: "Failed to create team. Please try again.",
        variant: "destructive",
      });
      return;
    }

    // Handle admin assignment
    if (adminAssignment?.type === 'existing_user' && adminAssignment.userId) {
      // Assign the selected user as team admin
      const { error: roleError } = await supabase.from("user_roles").insert({
        user_id: adminAssignment.userId,
        role: "team_admin" as AppRole,
        club_id: clubId!,
        team_id: team.id,
      });

      setSaving(false);
      if (roleError) {
        toast({
          title: "Warning",
          description: "Team created but couldn't assign admin role.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Team created!",
          description: `${adminAssignment.userDisplayName} has been assigned as Team Admin.`,
        });
      }
    } else if (adminAssignment?.type === 'invite_link' && adminAssignment.inviteToken) {
      // Create invite link for new user
      const { error: inviteError } = await supabase.from("team_invites").insert({
        team_id: team.id,
        token: adminAssignment.inviteToken,
        role: "team_admin" as AppRole,
        created_by: user!.id,
        max_uses: 1,
      });

      setSaving(false);
      if (inviteError) {
        toast({
          title: "Warning",
          description: "Team created but couldn't create invite link.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Team created!",
          description: "Share the invite link with the person who will manage this team.",
        });
      }
    } else {
      // Default: Assign creator as team_admin
      const { error: roleError } = await supabase.from("user_roles").insert({
        user_id: user!.id,
        role: "team_admin" as AppRole,
        club_id: clubId!,
        team_id: team.id,
      });

      setSaving(false);

      if (roleError) {
        toast({
          title: "Warning",
          description: "Team created but couldn't assign admin role.",
          variant: "destructive",
        });
      }

      toast({
        title: "Team created!",
        description: `${name} has been created successfully.`,
      });
    }

    navigate(`/teams/${team.id}`);
  };

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
        <div className="flex items-center gap-3 px-4 py-3">
          <Button variant="ghost" size="icon" className="shrink-0" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold">Create Team</h1>
            {club && (
              <p className="text-sm text-muted-foreground truncate">{club.name}</p>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-6 space-y-8 max-w-lg mx-auto">
          {/* Team Limit Warning */}
          {teamLimitExceeded && (
            <Alert variant="destructive" className="border-destructive/50 bg-destructive/10">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Your club has reached its team limit ({clubSubscription?.team_limit} teams). 
                Please upgrade your club subscription to add more teams.
              </AlertDescription>
            </Alert>
          )}

          {/* Hero Section with Logo */}
          <div className="flex flex-col items-center text-center space-y-4">
            <div className="relative group">
              <div className="absolute -inset-1 bg-gradient-to-r from-primary/50 to-primary/30 rounded-full blur opacity-40 group-hover:opacity-60 transition-opacity" />
              <Avatar className="relative h-32 w-32 border-4 border-background shadow-xl">
                <AvatarImage src={logoUrl || undefined} className="object-cover" />
                <AvatarFallback className="bg-muted text-muted-foreground text-4xl">
                  {name.charAt(0)?.toUpperCase() || <Users className="h-12 w-12" />}
                </AvatarFallback>
              </Avatar>
              <label className="absolute bottom-1 right-1 p-2.5 rounded-full bg-primary cursor-pointer hover:bg-primary/90 transition-all shadow-lg hover:scale-105 active:scale-95">
                <Camera className="h-4 w-4 text-primary-foreground" />
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleLogoUpload}
                />
              </label>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Add your team logo</p>
              <p className="text-xs text-muted-foreground/70">Recommended: Square image, 400x400px</p>
            </div>
          </div>

          {/* Form Fields */}
          <div className="space-y-6">
            {/* Team Name */}
            <div className="space-y-2">
              <Label htmlFor="name" className="text-sm font-medium">
                Team Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="name"
                placeholder="e.g., U12 Dragons"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                className="h-12 text-base bg-muted/50 border-muted-foreground/20 focus:bg-background transition-colors"
              />
            </div>

            {/* Level / Age Group */}
            <div className="space-y-2">
              <Label htmlFor="levelAge" className="text-sm font-medium">
                Level / Age Group
              </Label>
              <Input
                id="levelAge"
                placeholder="e.g., Under 12s, Division 2"
                value={levelAge}
                onChange={(e) => setLevelAge(e.target.value)}
                maxLength={50}
                className="h-12 text-base bg-muted/50 border-muted-foreground/20 focus:bg-background transition-colors"
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description" className="text-sm font-medium">
                Description
              </Label>
              <Textarea
                id="description"
                placeholder="Tell members about this team..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={500}
                rows={4}
                className="text-base resize-none bg-muted/50 border-muted-foreground/20 focus:bg-background transition-colors"
              />
              <p className="text-xs text-muted-foreground text-right">
                {description.length}/500
              </p>
            </div>

            {/* Folder Selection */}
            {folders.length > 0 && (
              <div className="space-y-2">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <FolderOpen className="h-4 w-4 text-muted-foreground" />
                  Team Folder
                </Label>
                <Select
                  value={folderId || "none"}
                  onValueChange={(value) => setFolderId(value === "none" ? null : value)}
                >
                  <SelectTrigger className="h-12 text-base bg-muted/50 border-muted-foreground/20 focus:bg-background transition-colors">
                    <SelectValue placeholder="Select a folder (optional)" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover">
                    <SelectItem value="none">No folder</SelectItem>
                    {folders.map((folder) => (
                      <SelectItem key={folder.id} value={folder.id}>
                        <span className="flex items-center gap-2">
                          {folder.color && (
                            <span 
                              className="w-3 h-3 rounded-full" 
                              style={{ backgroundColor: folder.color }} 
                            />
                          )}
                          {folder.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Organize this team into a folder (e.g., Junior Teams, Senior Teams)
                </p>
              </div>
            )}
          </div>

          {/* Assign Team Admin Section */}
          {clubId && (
            <AssignTeamAdminSection
              clubId={clubId}
              teamName={name || "this team"}
              onAssignmentChange={setAdminAssignment}
            />
          )}

          {/* Info Card - only show if not assigning someone else */}
          {!adminAssignment && (
            <div className="rounded-xl bg-primary/5 border border-primary/10 p-4">
              <div className="flex gap-3">
                <div className="shrink-0 mt-0.5">
                  <Sparkles className="h-5 w-5 text-primary" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">You'll be the team admin</p>
                  <p className="text-xs text-muted-foreground">
                    As the creator, you'll have full control to manage players, events, and team settings.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Fixed Bottom Button */}
      <div className="sticky bottom-0 p-4 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-t">
        <div className="max-w-lg mx-auto">
          <Button
            className="w-full h-12 text-base font-semibold shadow-lg"
            onClick={handleSubmit}
            disabled={saving || !name.trim() || teamLimitExceeded}
          >
            {saving ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : teamLimitExceeded ? (
              "Upgrade Required"
            ) : (
              "Create Team"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
