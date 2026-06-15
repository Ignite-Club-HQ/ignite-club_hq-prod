import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, Network } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useUserHasAnyClubPro } from "@/hooks/useUserHasAnyClubPro";
import { ProFeatureLock } from "@/components/subscription/ProFeatureLock";

export default function CreateAssociationPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  usePageTitle("New association");
  const { hasAnyClubPro, isLoading: proLoading } = useUserHasAnyClubPro();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim() || !user) return;
    setSaving(true);
    const { data: club, error } = await supabase
      .from("clubs")
      .insert({ name: name.trim(), description: description.trim() || null, kind: "association" })
      .select("id")
      .single();
    if (error || !club) {
      setSaving(false);
      toast({ title: "Could not create association", description: error?.message, variant: "destructive" });
      return;
    }
    // Make creator an association_admin
    const { error: roleErr } = await supabase.from("user_roles").insert({
      user_id: user.id,
      club_id: club.id,
      role: "association_admin",
    });
    setSaving(false);
    if (roleErr) {
      toast({ title: "Created, but couldn't assign admin role", description: roleErr.message, variant: "destructive" });
    }
    toast({ title: "Association created" });
    navigate(`/associations/${club.id}`);
  };

  return (
    <div className="container max-w-xl mx-auto px-4 py-6 space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
        <ArrowLeft className="h-4 w-4 mr-1" /> Back
      </Button>
      <header className="flex items-center gap-3">
        <div className="rounded-xl bg-primary/10 p-3"><Network className="h-5 w-5 text-primary" /></div>
        <h1 className="text-2xl font-bold">New association</h1>
      </header>
      {!proLoading && !hasAnyClubPro ? (
        <ProFeatureLock
          title="Associations is a Pro feature"
          description="Federations and umbrella bodies require an active Pro club. Upgrade to unlock."
          showUpgradeButton={false}
        />
      ) : (
      <Card>
        <CardContent className="p-4 space-y-3">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Riverside Junior Sports Federation" />
          </div>
          <div>
            <Label>Description (optional)</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>
          <Button onClick={submit} disabled={!name.trim() || saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Create association
          </Button>
        </CardContent>
      </Card>
      )}
      <p className="text-xs text-muted-foreground">
        Once created, you can link existing clubs to this association from each club's settings (by setting its parent organisation).
      </p>
    </div>
  );
}
