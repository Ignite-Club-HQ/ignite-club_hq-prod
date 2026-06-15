import { useState } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
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
import { ensureFreshSession } from "@/lib/ensureFreshSession";
import { useClubProAccess } from "@/hooks/useClubProAccess";
import { useUserHasAnyClubPro } from "@/hooks/useUserHasAnyClubPro";
import { ProFeatureLock } from "@/components/subscription/ProFeatureLock";

const SPORTS = Object.keys(SPORT_EMOJIS);
const PERSONAL_ORGANISER = "__personal__";

export default function CreateCompetitionPage() {
  usePageTitle("New competition");
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preselectedOrganizer = searchParams.get("organizer");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sport, setSport] = useState("");
  const [season, setSeason] = useState("");
  const [organizerClubId, setOrganizerClubId] = useState(preselectedOrganizer || PERSONAL_ORGANISER);
  const [visibility, setVisibility] = useState<"private" | "unlisted" | "public">("private");
  const [saving, setSaving] = useState(false);

  const { data: organisers = [], isLoading: loadingClubs } = useQuery({
    queryKey: ["my-organiser-clubs", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("club_id, role, clubs:club_id(id, name, kind)")
        .eq("user_id", user!.id)
        .in("role", ["club_admin", "association_admin", "app_admin"]);
      const seen = new Set<string>();
      return (data ?? [])
        .map((r: any) => r.clubs)
        .filter((c: any) => c && c.kind !== "shell" && !seen.has(c.id) && (seen.add(c.id), true));
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !name.trim() || !organizerClubId) return;
    setSaving(true);

    try {
      await ensureFreshSession();
    } catch (err: any) {
      setSaving(false);
      toast({ title: "Session expired", description: "Please sign in again and retry.", variant: "destructive" });
      return;
    }

    let clubIdToUse = organizerClubId;

    // Auto-create a personal shell club if the user picked "Personal organiser"
    if (organizerClubId === PERSONAL_ORGANISER) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", user.id)
        .maybeSingle();
      const who = profile?.display_name?.trim() || "My";
      const shellName = `${who}'s competitions`;

      const { data: shell, error: shellErr } = await supabase
        .from("clubs")
        .insert({ name: shellName, kind: "shell", created_by: user.id })
        .select("id")
        .single();
      if (shellErr || !shell) {
        setSaving(false);
        toast({ title: "Could not create organiser", description: shellErr?.message, variant: "destructive" });
        return;
      }
      const { error: roleErr } = await supabase
        .from("user_roles")
        .insert({ user_id: user.id, club_id: shell.id, role: "club_admin" });
      if (roleErr) {
        setSaving(false);
        toast({ title: "Couldn't set you as organiser admin", description: roleErr.message, variant: "destructive" });
        return;
      }
      clubIdToUse = shell.id;
    }

    const { data, error } = await supabase
      .from("competitions")
      .insert({
        name: name.trim(),
        description: description.trim() || null,
        sport: sport || null,
        season: season.trim() || null,
        organizer_club_id: clubIdToUse,
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

  const kindLabel = (kind: string) =>
    kind === "association" ? "Association" : kind === "full" ? "Club" : kind;

  return (
    <div className="container max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center gap-3 mb-1">
        <Button asChild variant="ghost" size="icon" className="-ml-2 shrink-0">
          <Link to="/start" aria-label="Back"><ArrowLeft className="h-5 w-5" /></Link>
        </Button>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Trophy className="h-6 w-6 text-primary" /> New competition
        </h1>
      </div>
      <p className="text-sm text-muted-foreground mb-6 pl-10">
        Set up a league or tournament that teams can be invited to.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="club">Organiser</Label>
          <Select value={organizerClubId} onValueChange={setOrganizerClubId}>
            <SelectTrigger id="club"><SelectValue placeholder="Choose organiser" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={PERSONAL_ORGANISER}>
                Personal organiser (just me)
              </SelectItem>
              {!loadingClubs && organisers.length > 0 && (
                <>
                  {organisers.map((c: any) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} <span className="text-muted-foreground">· {kindLabel(c.kind)}</span>
                    </SelectItem>
                  ))}
                </>
              )}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1">
            Pick a club or association if this competition belongs to one, or run it under a personal organiser.
          </p>
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

        <CreateCompetitionSubmitButton
          organizerClubId={organizerClubId === PERSONAL_ORGANISER ? null : organizerClubId}
          saving={saving}
          name={name}
        />
      </form>
    </div>
  );
}

function CreateCompetitionSubmitButton({
  organizerClubId,
  saving,
  name,
}: {
  organizerClubId: string | null;
  saving: boolean;
  name: string;
}) {
  const scoped = useClubProAccess(organizerClubId);
  const any = useUserHasAnyClubPro();
  const hasPro = organizerClubId ? scoped.hasPro : any.hasAnyClubPro;
  const loading = organizerClubId ? scoped.isLoading : any.isLoading;

  if (!loading && !hasPro) {
    return (
      <ProFeatureLock
        title="Competitions is a Pro feature"
        description="Upgrade the organiser club to Pro to create competitions."
        clubId={organizerClubId}
      />
    );
  }
  return (
    <Button type="submit" disabled={saving || !name.trim()} className="w-full">
      {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
      Create competition
    </Button>
  );
}
