import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { SPORT_EMOJIS } from "@/lib/sportEmojis";
import { usePageTitle } from "@/hooks/usePageTitle";

const SPORTS = Object.keys(SPORT_EMOJIS);

export default function CreateCompetitionPage() {
  usePageTitle("New competition");
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sport, setSport] = useState("");
  const [season, setSeason] = useState("");
  const [organizerClubId, setOrganizerClubId] = useState("");
  const [visibility, setVisibility] = useState<"private" | "unlisted" | "public">("private");
  const [saving, setSaving] = useState(false);

  const { data: clubs = [], isLoading: loadingClubs } = useQuery({
    queryKey: ["my-admin-clubs", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("club_id, clubs:club_id(id, name, kind)")
        .eq("user_id", user!.id)
        .in("role", ["club_admin", "app_admin"]);
      const seen = new Set<string>();
      return (data ?? [])
        .map((r: any) => r.clubs)
        .filter((c: any) => c && c.kind !== "shell" && !seen.has(c.id) && (seen.add(c.id), true));
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !organizerClubId || !name.trim()) return;
    setSaving(true);
    const { data, error } = await supabase
      .from("competitions")
      .insert({
        name: name.trim(),
        description: description.trim() || null,
        sport: sport || null,
        season: season.trim() || null,
        organizer_club_id: organizerClubId,
        visibility,
        status: "draft",
        created_by: user.id,
      })
      .select("id")
      .single();
    setSaving(false);
    if (error || !data) {
      toast({ title: "Could not create competition", description: error?.message, variant: "destructive" });
      return;
    }
    toast({ title: "Competition created" });
    navigate(`/competitions/${data.id}`);
  };

  return (
    <div className="container max-w-2xl mx-auto px-4 py-6">
      <Button asChild variant="ghost" size="sm" className="mb-4">
        <Link to="/competitions"><ArrowLeft className="h-4 w-4 mr-1" /> Back</Link>
      </Button>

      <h1 className="text-2xl font-bold flex items-center gap-2 mb-1">
        <Trophy className="h-6 w-6 text-primary" /> New competition
      </h1>
      <p className="text-sm text-muted-foreground mb-6">
        Set up a league or tournament that teams can be invited to.
      </p>

      {loadingClubs ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : clubs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          You need to be a club admin to create a competition.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="club">Organising club</Label>
            <Select value={organizerClubId} onValueChange={setOrganizerClubId}>
              <SelectTrigger id="club"><SelectValue placeholder="Select club" /></SelectTrigger>
              <SelectContent>
                {clubs.map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="name">Competition name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Twilight Twenty 2026" required />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="sport">Sport</Label>
              <Select value={sport} onValueChange={setSport}>
                <SelectTrigger id="sport"><SelectValue placeholder="Optional" /></SelectTrigger>
                <SelectContent>
                  {SPORTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="season">Season</Label>
              <Input id="season" value={season} onChange={(e) => setSeason(e.target.value)} placeholder="e.g. 2026" />
            </div>
          </div>

          <div>
            <Label htmlFor="visibility">Visibility</Label>
            <Select value={visibility} onValueChange={(v: any) => setVisibility(v)}>
              <SelectTrigger id="visibility"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="private">Private — admins and entered teams only</SelectItem>
                <SelectItem value="unlisted">Unlisted — admins and entered teams only</SelectItem>
                <SelectItem value="public">Public — anyone signed in</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>

          <Button type="submit" disabled={saving || !organizerClubId || !name.trim()} className="w-full">
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Create competition
          </Button>
        </form>
      )}
    </div>
  );
}
