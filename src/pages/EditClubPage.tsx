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
import { SPORT_EMOJIS, getSportEmoji } from "@/lib/sportEmojis";


const SPORTS = Object.keys(SPORT_EMOJIS);

export default function EditClubPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [sport, setSport] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: club, isLoading } = useQuery({
    queryKey: ["club", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clubs")
        .select(`
          *,
          club_subscriptions(is_pro, is_pro_football, expires_at)
        `)
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  useEffect(() => {
    if (club) {
      setName(club.name || "");
      setDescription(club.description || "");
      setLogoUrl(club.logo_url || "");
      setSport(club.sport || "");
    }
  }, [club]);

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

    const { error } = await supabase
      .from("clubs")
      .update({
        name: name.trim(),
        description: description.trim() || null,
        logo_url: logoUrl || null,
        sport: sport || null,
      })
      .eq("id", id!);

    setSaving(false);

    if (error) {
      toast({
        title: "Error",
        description: "Failed to update club. Please try again.",
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Club updated!",
      description: `${name} has been updated successfully.`,
    });

    navigate(`/clubs/${id}`);
  };

  if (isLoading) {
    return (
      <div className="py-6 space-y-6">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!club) {
    return (
      <div className="py-6 text-center">
        <p className="text-muted-foreground">Club not found</p>
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
        <h1 className="text-xl font-bold">Edit Club</h1>
      </div>

      {/* Logo Upload Section */}
      <Card>
        <CardContent className="py-6">
          <div className="flex flex-col items-center gap-4">
            <div className="relative">
              <Avatar className="h-28 w-28 border-4 border-primary/20">
                <AvatarImage src={logoUrl || undefined} />
                <AvatarFallback className="bg-primary/10 text-primary text-3xl">
                  {name.charAt(0)?.toUpperCase() || "C"}
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
            <p className="text-sm text-muted-foreground">Tap to change club logo</p>
          </div>
        </CardContent>
      </Card>

      {/* Club Details */}
      <Card>
        <CardContent className="py-6 space-y-5">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="name" className="text-base">Club Name *</Label>
            <Input
              id="name"
              placeholder="Enter club name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              className="h-12 text-base"
            />
          </div>

          {/* Sport */}
          <div className="space-y-2">
            <Label className="text-base">Sport</Label>
            <Select value={sport} onValueChange={setSport}>
              <SelectTrigger className="w-full h-12 text-base">
                <SelectValue placeholder="Select a sport">
                  {sport && (
                    <span className="flex items-center gap-2">
                      <span>{getSportEmoji(sport)}</span>
                      <span>{sport}</span>
                    </span>
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="max-h-[40vh]" position="popper" sideOffset={4}>
                {SPORTS.map((s) => (
                  <SelectItem key={s} value={s} className="py-3 text-base">
                    <span className="flex items-center gap-2">
                      <span>{getSportEmoji(s)}</span>
                      <span>{s}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description" className="text-base">Description</Label>
            <Textarea
              id="description"
              placeholder="Tell us about your club..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              rows={4}
              className="text-base resize-none"
            />
          </div>
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
