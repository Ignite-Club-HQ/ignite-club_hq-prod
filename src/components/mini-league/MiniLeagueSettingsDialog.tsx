import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2, Loader2, Camera, ImageIcon, Plus, X, Clock, Users, UsersRound, Copy } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { compressImage } from "@/lib/imageCompression";
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
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { toast } from "sonner";

const BIB_COLOR_PRESETS = [
  { name: "Red", value: "#ef4444" },
  { name: "Blue", value: "#3b82f6" },
  { name: "Green", value: "#22c55e" },
  { name: "Yellow", value: "#eab308" },
  { name: "Orange", value: "#f97316" },
  { name: "Purple", value: "#a855f7" },
  { name: "Pink", value: "#ec4899" },
  { name: "Cyan", value: "#06b6d4" },
  { name: "White", value: "#ffffff" },
  { name: "Black", value: "#171717" },
];

interface MiniLeagueSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  league: {
    id: string;
    name: string;
    description: string | null;
    logo_url: string | null;
    club_id: string;
    team_size: number | null;
    min_players_per_side: number | null;
    minutes_per_half: number | null;
    bib_colors: string[] | null;
  };
}

export function MiniLeagueSettingsDialog({ open, onOpenChange, league }: MiniLeagueSettingsDialogProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const logoInputRef = useRef<HTMLInputElement>(null);

  const [editName, setEditName] = useState(league.name);
  const [editDescription, setEditDescription] = useState(league.description || "");
  const [editLogoUrl, setEditLogoUrl] = useState<string | null>(league.logo_url || null);
  const [editTeamSize, setEditTeamSize] = useState(league.team_size || 4);
  const [editMinPlayersPerSide, setEditMinPlayersPerSide] = useState(league.min_players_per_side || 3);
  const [editMinutesPerHalf, setEditMinutesPerHalf] = useState(league.minutes_per_half || 10);
  const [editBibColors, setEditBibColors] = useState<string[]>(
    league.bib_colors || ["#ef4444", "#3b82f6", "#22c55e", "#eab308", "#f97316", "#a855f7"]
  );
  const [uploadingLogo, setUploadingLogo] = useState(false);

  // Sync state when league prop changes (dialog reopens)
  const handleOpenChange = (o: boolean) => {
    if (o) {
      setEditName(league.name);
      setEditDescription(league.description || "");
      setEditLogoUrl(league.logo_url || null);
      setEditTeamSize(league.team_size || 4);
      setEditMinPlayersPerSide(league.min_players_per_side || 3);
      setEditMinutesPerHalf(league.minutes_per_half || 10);
      setEditBibColors(league.bib_colors || ["#ef4444", "#3b82f6", "#22c55e", "#eab308", "#f97316", "#a855f7"]);
    }
    onOpenChange(o);
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingLogo(true);
    try {
      const { file: compressedFile } = await compressImage(file);
      const fileName = `mini-league-${league.id}-${Date.now()}.jpg`;
      const filePath = `${league.club_id}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from("club-logos")
        .upload(filePath, compressedFile, { upsert: true });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from("club-logos").getPublicUrl(filePath);
      setEditLogoUrl(urlData.publicUrl);
      toast.success("Logo uploaded");
    } catch (error: any) {
      toast.error(error.message || "Failed to upload logo");
    } finally {
      setUploadingLogo(false);
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  };

  const updateLeagueMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("mini_leagues")
        .update({
          name: editName.trim(),
          description: editDescription.trim() || null,
          logo_url: editLogoUrl,
          team_size: editTeamSize,
          min_players_per_side: editMinPlayersPerSide,
          minutes_per_half: editMinutesPerHalf,
          bib_colors: editBibColors.length > 0 ? editBibColors : null,
        })
        .eq("id", league.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mini-league", league.id] });
      onOpenChange(false);
      toast.success("Mini League updated");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteLeagueMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("mini_leagues").delete().eq("id", league.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Mini League deleted");
      navigate("/mini-leagues");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const duplicateLeagueMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("You must be logged in to duplicate a league");

      // Create duplicated league with current form values
      const { data: newLeague, error: createError } = await supabase
        .from("mini_leagues")
        .insert({
          name: `${editName.trim() || league.name} (Copy)`,
          description: editDescription.trim() || league.description,
          club_id: league.club_id,
          team_size: editTeamSize,
          min_players_per_side: editMinPlayersPerSide,
          minutes_per_half: editMinutesPerHalf,
          bib_colors: editBibColors.length > 0 ? editBibColors : league.bib_colors,
          logo_url: editLogoUrl ?? league.logo_url,
          created_by: user.id,
        })
        .select("id")
        .single();
      if (createError) throw createError;

      // Copy players
      const { data: existingPlayers } = await supabase
        .from("mini_league_players")
        .select("name, ability_rating, notes, parent_user_id, child_id")
        .eq("mini_league_id", league.id);

      if (existingPlayers && existingPlayers.length > 0) {
        const { error: playersError } = await supabase
          .from("mini_league_players")
          .insert(existingPlayers.map(p => ({
            ...p,
            mini_league_id: newLeague.id,
          })));
        if (playersError) throw playersError;
      }

      return newLeague.id;
    },
    onSuccess: (newId) => {
      queryClient.invalidateQueries({ queryKey: ["mini-leagues"] });
      onOpenChange(false);
      toast.success("League duplicated with all players!");
      navigate(`/mini-leagues/${newId}`);
    },
    onError: (error: Error) => toast.error(`Failed to duplicate: ${error.message}`),
  });

  const getColorName = (hex: string) => {
    const preset = BIB_COLOR_PRESETS.find(p => p.value.toLowerCase() === hex.toLowerCase());
    return preset?.name || hex;
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={handleOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Mini League Settings</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <div className="space-y-4 py-4">
          {/* Logo upload */}
          <div className="space-y-2">
            <Label>League Logo</Label>
            <div className="flex items-center gap-4">
              <div className="relative cursor-pointer group" onClick={() => logoInputRef.current?.click()}>
                <Avatar className="h-20 w-20 border-2 border-dashed border-muted-foreground/30 group-hover:border-primary transition-colors">
                  {editLogoUrl ? <AvatarImage src={editLogoUrl} alt="League logo" /> : null}
                  <AvatarFallback className="bg-muted">
                    <ImageIcon className="h-8 w-8 text-muted-foreground" />
                  </AvatarFallback>
                </Avatar>
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                  {uploadingLogo ? (
                    <Loader2 className="h-5 w-5 text-white animate-spin" />
                  ) : (
                    <Camera className="h-5 w-5 text-white" />
                  )}
                </div>
              </div>
              <div className="text-sm text-muted-foreground">
                <p>Click to upload a logo</p>
                <p className="text-xs">JPG, PNG up to 5MB</p>
              </div>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleLogoUpload}
                disabled={uploadingLogo}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="league-name">Name</Label>
            <Input id="league-name" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Mini League name" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="league-description">Description</Label>
            <Textarea id="league-description" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} placeholder="Optional description" rows={3} />
          </div>

          <div className="space-y-2">
            <Label>Default Players Per Side</Label>
            <div className="flex items-center gap-3">
              <UsersRound className="h-5 w-5 text-muted-foreground" />
              <div className="flex items-center gap-2">
                {[4, 5, 6, 7, 8].map((size) => (
                  <Button
                    key={size}
                    type="button"
                    variant={editTeamSize === size ? "default" : "outline"}
                    size="sm"
                    className="w-10 h-10"
                    onClick={() => {
                      setEditTeamSize(size);
                      if (editMinPlayersPerSide > size) setEditMinPlayersPerSide(size);
                    }}
                  >
                    {size}
                  </Button>
                ))}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Target team size for auto-generating balanced teams</p>
          </div>

          <div className="space-y-2">
            <Label>Minimum Players Per Side</Label>
            <div className="flex items-center gap-3">
              <Users className="h-5 w-5 text-muted-foreground" />
              <div className="flex items-center gap-2">
                {[2, 3, 4, 5, 6, 7, 8].filter(n => n <= editTeamSize).map((size) => (
                  <Button
                    key={size}
                    type="button"
                    variant={editMinPlayersPerSide === size ? "default" : "outline"}
                    size="sm"
                    className="w-10 h-10"
                    onClick={() => setEditMinPlayersPerSide(size)}
                  >
                    {size}
                  </Button>
                ))}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">No team can have fewer than this many players</p>
          </div>

          <div className="space-y-2">
            <Label>Minutes Per Half</Label>
            <div className="flex items-center gap-3">
              <Clock className="h-5 w-5 text-muted-foreground" />
              <div className="flex items-center gap-2">
                {[5, 7, 10, 12, 15, 20].map((mins) => (
                  <Button
                    key={mins}
                    type="button"
                    variant={editMinutesPerHalf === mins ? "default" : "outline"}
                    size="sm"
                    className="w-10 h-10"
                    onClick={() => setEditMinutesPerHalf(mins)}
                  >
                    {mins}
                  </Button>
                ))}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Default game timer duration per half</p>
          </div>

          {/* Bib Colors */}
          <div className="space-y-3">
            <Label>Available Bib Colors</Label>
            <p className="text-xs text-muted-foreground">Select which bib colors are available for matches</p>
            <div className="flex flex-wrap gap-2">
              {editBibColors.map((color) => (
                <div key={color} className="flex items-center gap-1.5 px-2 py-1 rounded-full border" style={{ borderColor: color }}>
                  <div className="w-4 h-4 rounded-full border border-border" style={{ backgroundColor: color }} />
                  <span className="text-xs">{getColorName(color)}</span>
                  <button type="button" onClick={() => setEditBibColors(editBibColors.filter(c => c !== color))} className="ml-1 text-muted-foreground hover:text-destructive">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {editBibColors.length === 0 && <span className="text-xs text-muted-foreground">No colors selected</span>}
            </div>
            <div className="flex flex-wrap gap-2">
              {BIB_COLOR_PRESETS.filter(p => !editBibColors.includes(p.value)).map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => setEditBibColors([...editBibColors, preset.value])}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-full border border-dashed hover:border-solid hover:bg-muted/50 transition-colors"
                >
                  <div className="w-4 h-4 rounded-full border border-border" style={{ backgroundColor: preset.value }} />
                  <span className="text-xs text-muted-foreground">{preset.name}</span>
                  <Plus className="h-3 w-3 text-muted-foreground" />
                </button>
              ))}
            </div>
          </div>
        </div>

        <ResponsiveDialogFooter className="flex-col gap-2 sm:flex-row">
          <div className="flex gap-2 w-full sm:w-auto">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" className="flex-1 sm:flex-none">
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Mini League?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete "{league.name}" and all its players. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => deleteLeagueMutation.mutate()}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <Button
              variant="outline"
              className="flex-1 sm:flex-none"
              onClick={() => duplicateLeagueMutation.mutate()}
              disabled={duplicateLeagueMutation.isPending}
            >
              {duplicateLeagueMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Copy className="h-4 w-4 mr-2" />
              )}
              Duplicate
            </Button>
          </div>

          <div className="flex gap-2 w-full sm:w-auto sm:ml-auto">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1 sm:flex-none">Cancel</Button>
            <Button
              onClick={() => updateLeagueMutation.mutate()}
              disabled={!editName.trim() || updateLeagueMutation.isPending}
              className="flex-1 sm:flex-none"
            >
              {updateLeagueMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </Button>
          </div>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
