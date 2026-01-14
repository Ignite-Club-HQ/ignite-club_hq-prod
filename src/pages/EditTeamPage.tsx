import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Camera, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

export default function EditTeamPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [levelAge, setLevelAge] = useState("");
  const [description, setDescription] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: team, isLoading } = useQuery({
    queryKey: ["team", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("*, clubs (id, name, sport)")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  // Fetch available folders for this club
  const { data: folders = [] } = useQuery({
    queryKey: ["team-folders", team?.club_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("team_folders")
        .select("*")
        .eq("club_id", team!.club_id)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!team?.club_id,
  });

  useEffect(() => {
    if (team) {
      setName(team.name || "");
      setLevelAge(team.level_age || "");
      setDescription(team.description || "");
      setLogoUrl(team.logo_url || "");
      setFolderId(team.folder_id || null);
    }
  }, [team]);

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

    const { error: teamError } = await supabase
      .from("teams")
      .update({
        name: name.trim(),
        level_age: levelAge.trim() || null,
        description: description.trim() || null,
        logo_url: logoUrl || null,
        folder_id: folderId || null,
      })
      .eq("id", id!);

    setSaving(false);

    if (teamError) {
      toast({
        title: "Error",
        description: "Failed to update team. Please try again.",
        variant: "destructive",
      });
      return;
    }

    queryClient.invalidateQueries({ queryKey: ["team", id] });
    queryClient.invalidateQueries({ queryKey: ["club-teams", team?.club_id] });

    toast({
      title: "Team updated!",
      description: `${name} has been updated successfully.`,
    });

    navigate(`/teams/${id}`);
  };

  if (isLoading) {
    return (
      <div className="py-6 space-y-6">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!team) {
    return (
      <div className="py-6 text-center">
        <p className="text-muted-foreground">Team not found</p>
      </div>
    );
  }

  return (
    <div className="pb-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 py-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-xl font-bold">Edit Team</h1>
          {team.clubs && <p className="text-sm text-muted-foreground">{team.clubs.name}</p>}
        </div>
      </div>

      {/* Logo Upload Section */}
      <Card>
        <CardContent className="py-6">
          <div className="flex flex-col items-center gap-4">
            <div className="relative">
              <Avatar className="h-28 w-28 border-4 border-primary/20">
                <AvatarImage src={logoUrl || undefined} />
                <AvatarFallback className="bg-primary/10 text-primary text-3xl">
                  {name.charAt(0)?.toUpperCase() || "T"}
                </AvatarFallback>
              </Avatar>
              <label className="absolute bottom-0 right-0 p-2.5 rounded-full bg-primary cursor-pointer hover:bg-primary/90 transition-colors shadow-lg">
                <Camera className="h-5 w-5 text-primary-foreground" />
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleLogoUpload}
                />
              </label>
            </div>
            <p className="text-sm text-muted-foreground">Tap to change team logo</p>
          </div>
        </CardContent>
      </Card>

      {/* Team Details */}
      <Card>
        <CardContent className="py-6 space-y-5">
          <div className="space-y-2">
            <Label htmlFor="name" className="text-base">Team Name *</Label>
            <Input
              id="name"
              placeholder="e.g., U12 Dragons"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              className="h-12 text-base"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="levelAge" className="text-base">Level / Age Group</Label>
            <Input
              id="levelAge"
              placeholder="e.g., Under 12s, Division 2"
              value={levelAge}
              onChange={(e) => setLevelAge(e.target.value)}
              maxLength={50}
              className="h-12 text-base"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description" className="text-base">Description</Label>
            <Textarea
              id="description"
              placeholder="Optional team description..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              rows={4}
              className="text-base resize-none"
            />
          </div>

          {/* Folder Selection */}
          {folders.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="folder" className="text-base">Team Folder</Label>
              <Select
                value={folderId || "none"}
                onValueChange={(value) => setFolderId(value === "none" ? null : value)}
              >
                <SelectTrigger className="h-12 text-base">
                  <SelectValue placeholder="Select a folder (optional)" />
                </SelectTrigger>
                <SelectContent className="bg-popover">
                  <SelectItem value="none">No folder</SelectItem>
                  {folders.map((folder) => (
                    <SelectItem key={folder.id} value={folder.id}>
                      {folder.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Organize this team into a folder (e.g., Junior Teams, Senior Teams)
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Submit Button */}
      <Button
        className="w-full h-12 text-base font-medium"
        onClick={handleSubmit}
        disabled={saving || !name.trim()}
      >
        {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : "Save Changes"}
      </Button>
    </div>
  );
}
