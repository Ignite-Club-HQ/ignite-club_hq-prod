import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Camera, Loader2, Building2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { SPORT_EMOJIS, getSportEmoji } from "@/lib/sportEmojis";

const SPORTS = Object.keys(SPORT_EMOJIS);

export default function CreateClubPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [sport, setSport] = useState("");
  const [saving, setSaving] = useState(false);

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
        description: "Please enter a club name.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);

    // Create the club
    const { data: club, error: clubError } = await supabase
      .from("clubs")
      .insert({
        name: name.trim(),
        description: description.trim() || null,
        logo_url: logoUrl || null,
        sport: sport || null,
        created_by: user!.id,
      })
      .select()
      .single();

    if (clubError) {
      setSaving(false);
      toast({
        title: "Error",
        description: "Failed to create club. Please try again.",
        variant: "destructive",
      });
      return;
    }

    // Assign creator as club_admin
    const { error: roleError } = await supabase
      .from("user_roles")
      .insert({
        user_id: user!.id,
        role: "club_admin",
        club_id: club.id,
      });

    setSaving(false);

    if (roleError) {
      toast({
        title: "Warning",
        description: "Club created but couldn't assign admin role.",
        variant: "destructive",
      });
    }

    toast({
      title: "Club created!",
      description: `${name} has been created successfully.`,
    });

    navigate(`/clubs/${club.id}`);
  };

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
        <div className="flex items-center gap-3 px-4 py-3">
          <Button variant="ghost" size="icon" className="shrink-0" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-lg font-semibold">Create Club</h1>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-6 space-y-8 max-w-lg mx-auto">
          {/* Hero Section with Logo */}
          <div className="flex flex-col items-center text-center space-y-4">
            <div className="relative group">
              <div className="absolute -inset-1 bg-gradient-to-r from-primary/50 to-primary/30 rounded-full blur opacity-40 group-hover:opacity-60 transition-opacity" />
              <Avatar className="relative h-32 w-32 border-4 border-background shadow-xl">
                <AvatarImage src={logoUrl || undefined} className="object-cover" />
                <AvatarFallback className="bg-muted text-muted-foreground text-4xl">
                  {name.charAt(0)?.toUpperCase() || <Building2 className="h-12 w-12" />}
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
              <p className="text-sm text-muted-foreground">Add your club logo</p>
              <p className="text-xs text-muted-foreground/70">Recommended: Square image, 400x400px</p>
            </div>
          </div>

          {/* Form Fields */}
          <div className="space-y-6">
            {/* Club Name */}
            <div className="space-y-2">
              <Label htmlFor="name" className="text-sm font-medium">
                Club Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="name"
                placeholder="Enter your club name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                className="h-12 text-base bg-muted/50 border-muted-foreground/20 focus:bg-background transition-colors"
              />
            </div>

            {/* Sport Selection */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Sport</Label>
              <Select value={sport} onValueChange={setSport}>
                <SelectTrigger className="w-full h-12 text-base bg-muted/50 border-muted-foreground/20 focus:bg-background transition-colors">
                  <SelectValue placeholder="Select a sport">
                    {sport && (
                      <span className="flex items-center gap-2">
                        <span className="text-lg">{getSportEmoji(sport)}</span>
                        <span>{sport}</span>
                      </span>
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="max-h-[40vh]" position="popper" sideOffset={4}>
                  {SPORTS.map((s) => (
                    <SelectItem key={s} value={s} className="py-3 text-base">
                      <span className="flex items-center gap-3">
                        <span className="text-lg">{getSportEmoji(s)}</span>
                        <span>{s}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description" className="text-sm font-medium">
                Description
              </Label>
              <Textarea
                id="description"
                placeholder="Tell members about your club..."
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
          </div>

          {/* Info Card */}
          <div className="rounded-xl bg-primary/5 border border-primary/10 p-4">
            <div className="flex gap-3">
              <div className="shrink-0 mt-0.5">
                <Sparkles className="h-5 w-5 text-primary" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">You'll be the club admin</p>
                <p className="text-xs text-muted-foreground">
                  As the creator, you'll have full control to manage teams, members, and settings.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Fixed Bottom Button */}
      <div className="sticky bottom-0 p-4 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-t">
        <div className="max-w-lg mx-auto">
          <Button 
            className="w-full h-12 text-base font-semibold shadow-lg" 
            onClick={handleSubmit}
            disabled={saving || !name.trim()}
          >
            {saving ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              "Create Club"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
