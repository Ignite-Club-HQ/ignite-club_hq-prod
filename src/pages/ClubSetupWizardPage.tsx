import { useState, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Users,
  UserPlus,
  Shield,
  Trophy,
  Check,
  Loader2,
  Plus,
  X,
  Copy,
  Share2,
  Mail,
  CheckCircle2,
  Sparkles,
  Palette,
  Building2,
} from "lucide-react";

import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { defaultRsvpAudienceForTeam } from "@/lib/teamAgeDefaults";
import { ClubThemeEditor } from "@/components/ClubThemeEditor";
import { SponsorsManager } from "@/components/SponsorsManager";
import { ProFeatureLock } from "@/components/subscription/ProFeatureLock";
import { useClubProAccess } from "@/hooks/useClubProAccess";
import { cn } from "@/lib/utils";
import { Crown } from "lucide-react";


// ---------- types ----------

type ClubRole = "club_admin" | "committee_member";
type TeamRole = "team_admin" | "coach";

interface DraftTeam {
  tempId: string;
  name: string;
  levelAge: string;
  createdTeamId?: string; // set after Save
}

interface DraftInvite {
  tempId: string;
  name: string;
  email: string;
  role: ClubRole | TeamRole;
  teamId?: string; // for team-scoped invites
  status: "pending" | "sending" | "sent" | "error";
  link?: string;
  errorMsg?: string;
}

const CLUB_ROLE_LABEL: Record<ClubRole, string> = {
  club_admin: "Club Admin",
  committee_member: "Committee Member",
};
const TEAM_ROLE_LABEL: Record<TeamRole, string> = {
  team_admin: "Team Admin",
  coach: "Coach",
};

const STEPS = [
  { id: "teams", label: "Teams", icon: Users },
  { id: "branding", label: "Branding", icon: Palette },
  { id: "sponsors", label: "Sponsors", icon: Building2 },
  { id: "committee", label: "Committee", icon: Shield },
  { id: "subcommittee", label: "Sub-committee", icon: UserPlus },
  { id: "coaches", label: "Coaches", icon: Trophy },
] as const;


// ---------- page ----------

export default function ClubSetupWizardPage() {
  const { clubId } = useParams<{ clubId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  usePageTitle("Set up your club");

  const [stepIndex, setStepIndex] = useState(0);
  const step = STEPS[stepIndex];
  const { hasPro, isLoading: proLoading } = useClubProAccess(clubId);

  const { data: club } = useQuery({
    queryKey: ["club", clubId, "setup"],
    queryFn: async () => {
      const { data } = await supabase
        .from("clubs")
        .select("*")
        .eq("id", clubId!)
        .maybeSingle();
      return data;

    },
    enabled: !!clubId,
  });

  // Draft state across steps
  const [teams, setTeams] = useState<DraftTeam[]>([
    { tempId: crypto.randomUUID(), name: "", levelAge: "" },
  ]);
  const [committee, setCommittee] = useState<DraftInvite[]>([]);
  const [subcommittee, setSubcommittee] = useState<DraftInvite[]>([]);
  const [coachInvites, setCoachInvites] = useState<DraftInvite[]>([]);

  const savedTeams = teams.filter((t) => t.createdTeamId);
  const canDoCoaches = savedTeams.length > 0;

  // ---------- team creation ----------

  const saveTeamMutation = useMutation({
    mutationFn: async (draft: DraftTeam) => {
      if (!draft.name.trim()) throw new Error("Team name is required");
      const { data: team, error } = await supabase
        .from("teams")
        .insert({
          name: draft.name.trim(),
          club_id: clubId!,
          level_age: draft.levelAge.trim() || null,
          team_type: "team",
          created_by: user!.id,
          default_rsvp_audience: defaultRsvpAudienceForTeam(
            draft.name,
            draft.levelAge,
          ),
        } as any)
        .select("id")
        .single();
      if (error) throw error;
      await supabase.from("user_roles").insert({
        user_id: user!.id,
        role: "team_admin",
        club_id: clubId,
        team_id: team.id,
      });
      return team.id as string;
    },
    onSuccess: (teamId, draft) => {
      setTeams((prev) =>
        prev.map((t) =>
          t.tempId === draft.tempId ? { ...t, createdTeamId: teamId } : t,
        ),
      );
      qc.invalidateQueries({ queryKey: ["club-teams", clubId] });
      toast({ title: "Team created", description: draft.name });
    },
    onError: (err: Error) => {
      toast({
        title: "Could not create team",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // ---------- invite sending ----------

  const sendInvite = async (
    invite: DraftInvite,
    setList: React.Dispatch<React.SetStateAction<DraftInvite[]>>,
  ) => {
    if (!invite.name.trim()) {
      toast({ title: "Add a name first", variant: "destructive" });
      return;
    }
    setList((prev) =>
      prev.map((i) =>
        i.tempId === invite.tempId ? { ...i, status: "sending" } : i,
      ),
    );

    const inviteToken = crypto.randomUUID();
    const isTeamRole = invite.role === "team_admin" || invite.role === "coach";

    const { error: insErr } = await supabase.from("pending_invites").insert({
      club_id: clubId,
      team_id: isTeamRole ? invite.teamId ?? null : null,
      role: invite.role as any,
      invited_user_id: null,
      invited_by_user_id: user!.id,
      invited_label: invite.name.trim(),
      invited_email: invite.email.trim().toLowerCase() || null,
      invite_token: inviteToken,
    } as any);

    if (insErr) {
      setList((prev) =>
        prev.map((i) =>
          i.tempId === invite.tempId
            ? { ...i, status: "error", errorMsg: insErr.message }
            : i,
        ),
      );
      toast({
        title: "Could not create invite",
        description: insErr.message,
        variant: "destructive",
      });
      return;
    }

    const link = `${window.location.origin}/join/p/${inviteToken}`;
    const roleLabel = isTeamRole
      ? TEAM_ROLE_LABEL[invite.role as TeamRole]
      : CLUB_ROLE_LABEL[invite.role as ClubRole];

    // Optional email send
    if (invite.email.trim()) {
      try {
        const { data: res, error: fnErr } = await supabase.functions.invoke(
          "send-email",
          {
            body: {
              to: invite.email.trim(),
              subject: `You're invited to join ${club?.name} as ${roleLabel}`,
              template: "team-invite",
              senderName: club?.name || undefined,
              replyTo: club?.contact_email || undefined,
              templateData: {
                recipientName: invite.name.trim(),
                invitedEmail: invite.email.trim(),
                teamName: club?.name,
                clubName: club?.name,
                roleName: roleLabel,
                inviteLink: link,
                clubLogoUrl: club?.logo_url || undefined,
              },
            },
          },
        );
        if (fnErr) throw fnErr;
        if (!(res?.verified && res?.success)) {
          throw new Error(res?.error || "Email not verified");
        }
        await supabase
          .from("pending_invites")
          .update({
            email_sent_at: new Date().toISOString(),
            email_id: res.emailId,
          } as any)
          .eq("invite_token", inviteToken);
      } catch (err) {
        // Still consider invite created; link is available for manual share
        const msg = err instanceof Error ? err.message : "Email failed";
        await supabase
          .from("pending_invites")
          .update({ email_error: msg } as any)
          .eq("invite_token", inviteToken);
        setList((prev) =>
          prev.map((i) =>
            i.tempId === invite.tempId
              ? { ...i, status: "sent", link, errorMsg: msg }
              : i,
          ),
        );
        toast({
          title: "Invite created — email failed",
          description: "Share the link manually instead.",
        });
        return;
      }
    }

    setList((prev) =>
      prev.map((i) =>
        i.tempId === invite.tempId ? { ...i, status: "sent", link } : i,
      ),
    );
    qc.invalidateQueries({ queryKey: ["pending-invites"] });
    toast({
      title: "Invite sent",
      description: invite.email.trim() || "Share the link with them",
    });
  };

  // ---------- navigation ----------

  const finish = () => {
    toast({ title: "Setup complete", description: "You can invite more anytime." });
    navigate(`/clubs/${clubId}`);
  };

  const goNext = () => {
    // Auto-save unsaved teams on step 0
    if (step.id === "teams") {
      const unsaved = teams.filter(
        (t) => t.name.trim() && !t.createdTeamId,
      );
      if (unsaved.length > 0) {
        toast({
          title: "Save your teams first",
          description: "Tap ‘Save team’ on each row, or clear it.",
        });
        return;
      }
    }
    if (stepIndex < STEPS.length - 1) {
      // Skip coaches step if no teams
      if (STEPS[stepIndex + 1].id === "coaches" && !canDoCoaches) {
        finish();
        return;
      }
      setStepIndex((i) => i + 1);
    } else {
      finish();
    }
  };

  const goBack = () => {
    if (stepIndex === 0) navigate(`/clubs/${clubId}`);
    else setStepIndex((i) => i - 1);
  };

  const progress = ((stepIndex + 1) / STEPS.length) * 100;

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 border-b">
        <div className="px-4 py-3 flex items-center gap-3 max-w-2xl mx-auto w-full">
          <Button variant="ghost" size="icon" onClick={goBack}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <h1 className="text-base font-semibold truncate">
                Set up {club?.name || "your club"}
              </h1>
              <span className="text-xs text-muted-foreground shrink-0">
                Step {stepIndex + 1}/{STEPS.length}
              </span>
            </div>
            <div className="mt-1.5 h-1 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={finish}>
            Skip
          </Button>
        </div>
        {/* Step chips */}
        <div className="px-4 pb-3 flex gap-2 overflow-x-auto max-w-2xl mx-auto w-full">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const active = i === stepIndex;
            const done = i < stepIndex;
            return (
              <button
                key={s.id}
                onClick={() => setStepIndex(i)}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs whitespace-nowrap border transition-colors",
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : done
                      ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
                      : "bg-muted text-muted-foreground border-transparent",
                )}
              >
                {done ? <Check className="h-3 w-3" /> : <Icon className="h-3 w-3" />}
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-5 pb-32 max-w-2xl mx-auto w-full space-y-4">
          {step.id === "teams" && (
            <TeamsStep
              teams={teams}
              setTeams={setTeams}
              onSave={(t) => saveTeamMutation.mutate(t)}
              saving={saveTeamMutation.isPending}
            />
          )}

          {step.id === "branding" && (
            <div className="space-y-4">
              <StepIntro
                icon={Palette}
                title="Make it yours"
                subtitle="Upload your club logo and set colours. You can change these anytime from Club Settings."
              />
              <ClubThemeEditor
                clubId={clubId!}
                clubLogoUrl={(club as any)?.logo_url}
                initialPrimary={(club as any)?.theme_primary_h != null ? { h: (club as any).theme_primary_h, s: (club as any).theme_primary_s, l: (club as any).theme_primary_l } : undefined}
                initialSecondary={(club as any)?.theme_secondary_h != null ? { h: (club as any).theme_secondary_h, s: (club as any).theme_secondary_s, l: (club as any).theme_secondary_l } : undefined}
                initialAccent={(club as any)?.theme_accent_h != null ? { h: (club as any).theme_accent_h, s: (club as any).theme_accent_s, l: (club as any).theme_accent_l } : undefined}
                initialShowLogoInHeader={(club as any)?.show_logo_in_header ?? true}
                initialShowNameInHeader={(club as any)?.show_name_in_header ?? true}
                initialLogoOnlyMode={(club as any)?.logo_only_mode ?? false}
                initialThemeEnabled={(club as any)?.theme_enabled ?? true}
                onSave={() => qc.invalidateQueries({ queryKey: ["club", clubId, "setup"] })}
              />
            </div>
          )}

          {step.id === "sponsors" && (
            <div className="space-y-4">
              <StepIntro
                icon={Building2}
                title="Add your sponsors"
                subtitle="Add businesses that support your club. You can allocate them to teams and events later."
              />
              <SponsorsManager
                clubId={clubId!}
                currentPrimarySponsorId={(club as any)?.primary_sponsor_id ?? null}
                onPrimaryChange={() => qc.invalidateQueries({ queryKey: ["club", clubId, "setup"] })}
              />
            </div>
          )}


          {step.id === "committee" && (
            <InviteStep
              title="Invite your committee"
              subtitle="Club admins can manage everything. Committee members help with governance."
              roleOptions={[
                { value: "club_admin", label: "Club Admin" },
                { value: "committee_member", label: "Committee Member" },
              ]}
              defaultRole="club_admin"
              list={committee}
              setList={setCommittee}
              onSend={(inv) => sendInvite(inv, setCommittee)}
            />
          )}

          {step.id === "subcommittee" && (
            <InviteStep
              title="Invite sub-committee & role holders"
              subtitle="Treasurer, registrar, coach coordinator, etc. Add a title in the name (e.g. ‘Jane — Treasurer’)."
              roleOptions={[
                { value: "committee_member", label: "Committee Member" },
              ]}
              defaultRole="committee_member"
              list={subcommittee}
              setList={setSubcommittee}
              onSend={(inv) => sendInvite(inv, setSubcommittee)}
            />
          )}

          {step.id === "coaches" && (
            <CoachesStep
              teams={savedTeams}
              list={coachInvites}
              setList={setCoachInvites}
              onSend={(inv) => sendInvite(inv, setCoachInvites)}
            />
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="sticky bottom-0 border-t bg-background/95 px-4 py-3">
        <div className="max-w-2xl mx-auto flex gap-2">
          <Button variant="outline" onClick={goBack} className="flex-1">
            Back
          </Button>
          <Button onClick={goNext} className="flex-[2]">
            {stepIndex === STEPS.length - 1 ||
            (STEPS[stepIndex + 1]?.id === "coaches" && !canDoCoaches)
              ? "Finish"
              : "Continue"}
            <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------- step: teams ----------

function TeamsStep({
  teams,
  setTeams,
  onSave,
  saving,
}: {
  teams: DraftTeam[];
  setTeams: React.Dispatch<React.SetStateAction<DraftTeam[]>>;
  onSave: (t: DraftTeam) => void;
  saving: boolean;
}) {
  const addRow = () =>
    setTeams((prev) => [
      ...prev,
      { tempId: crypto.randomUUID(), name: "", levelAge: "" },
    ]);
  const removeRow = (id: string) =>
    setTeams((prev) => prev.filter((t) => t.tempId !== id));
  const update = (id: string, patch: Partial<DraftTeam>) =>
    setTeams((prev) =>
      prev.map((t) => (t.tempId === id ? { ...t, ...patch } : t)),
    );

  return (
    <div className="space-y-4">
      <StepIntro
        icon={Users}
        title="Add your first team(s)"
        subtitle="You can skip this and add teams later. Most clubs start with one."
      />

      <div className="space-y-3">
        {teams.map((t, i) => (
          <div
            key={t.tempId}
            className={cn(
              "rounded-xl border p-3 space-y-3 transition-colors",
              t.createdTeamId
                ? "bg-emerald-500/5 border-emerald-500/30"
                : "bg-card",
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                Team {i + 1}
              </span>
              <div className="flex items-center gap-2">
                {t.createdTeamId && (
                  <Badge variant="outline" className="text-emerald-600 border-emerald-500/40">
                    <Check className="h-3 w-3 mr-1" /> Saved
                  </Badge>
                )}
                {teams.length > 1 && !t.createdTeamId && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => removeRow(t.tempId)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Name</Label>
                <Input
                  value={t.name}
                  onChange={(e) => update(t.tempId, { name: e.target.value })}
                  placeholder="e.g. U12 Lions"
                  disabled={!!t.createdTeamId}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Age / level (optional)</Label>
                <Input
                  value={t.levelAge}
                  onChange={(e) =>
                    update(t.tempId, { levelAge: e.target.value })
                  }
                  placeholder="U12, Div 3, Seniors…"
                  disabled={!!t.createdTeamId}
                />
              </div>
            </div>
            {!t.createdTeamId && (
              <Button
                size="sm"
                className="w-full"
                onClick={() => onSave(t)}
                disabled={!t.name.trim() || saving}
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Save team"
                )}
              </Button>
            )}
          </div>
        ))}
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={addRow}
        className="w-full"
      >
        <Plus className="h-4 w-4 mr-1" /> Add another team
      </Button>
    </div>
  );
}

// ---------- step: generic invite list ----------

function InviteStep({
  title,
  subtitle,
  roleOptions,
  defaultRole,
  list,
  setList,
  onSend,
}: {
  title: string;
  subtitle: string;
  roleOptions: { value: ClubRole; label: string }[];
  defaultRole: ClubRole;
  list: DraftInvite[];
  setList: React.Dispatch<React.SetStateAction<DraftInvite[]>>;
  onSend: (inv: DraftInvite) => void;
}) {
  const addRow = () =>
    setList((prev) => [
      ...prev,
      {
        tempId: crypto.randomUUID(),
        name: "",
        email: "",
        role: defaultRole,
        status: "pending",
      },
    ]);

  const remove = (id: string) =>
    setList((prev) => prev.filter((i) => i.tempId !== id));
  const update = (id: string, patch: Partial<DraftInvite>) =>
    setList((prev) =>
      prev.map((i) => (i.tempId === id ? { ...i, ...patch } : i)),
    );

  return (
    <div className="space-y-4">
      <StepIntro icon={Shield} title={title} subtitle={subtitle} />

      <div className="space-y-3">
        {list.length === 0 && (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            No invites yet. Add one below or skip for later.
          </div>
        )}
        {list.map((inv) => (
          <InviteRow
            key={inv.tempId}
            invite={inv}
            roleOptions={roleOptions}
            onChange={(patch) => update(inv.tempId, patch)}
            onRemove={() => remove(inv.tempId)}
            onSend={() => onSend(inv)}
          />
        ))}
      </div>

      <Button variant="outline" size="sm" onClick={addRow} className="w-full">
        <Plus className="h-4 w-4 mr-1" /> Add invite
      </Button>
    </div>
  );
}

// ---------- step: coaches (team-scoped) ----------

function CoachesStep({
  teams,
  list,
  setList,
  onSend,
}: {
  teams: DraftTeam[];
  list: DraftInvite[];
  setList: React.Dispatch<React.SetStateAction<DraftInvite[]>>;
  onSend: (inv: DraftInvite) => void;
}) {
  const roleOptions = useMemo(
    () => [
      { value: "team_admin" as const, label: "Team Admin" },
      { value: "coach" as const, label: "Coach" },
    ],
    [],
  );

  const addRow = (teamId: string) =>
    setList((prev) => [
      ...prev,
      {
        tempId: crypto.randomUUID(),
        name: "",
        email: "",
        role: "coach",
        teamId,
        status: "pending",
      },
    ]);
  const remove = (id: string) =>
    setList((prev) => prev.filter((i) => i.tempId !== id));
  const update = (id: string, patch: Partial<DraftInvite>) =>
    setList((prev) =>
      prev.map((i) => (i.tempId === id ? { ...i, ...patch } : i)),
    );

  if (teams.length === 0) {
    return (
      <div className="rounded-xl border p-6 text-center text-sm text-muted-foreground">
        Add a team in the previous step first.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <StepIntro
        icon={Trophy}
        title="Invite coaches & managers"
        subtitle="Assign coaches and team admins to the teams you just created."
      />

      {teams.map((team) => {
        const teamList = list.filter((i) => i.teamId === team.createdTeamId);
        return (
          <div key={team.createdTeamId} className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">{team.name}</p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => addRow(team.createdTeamId!)}
              >
                <Plus className="h-4 w-4 mr-1" /> Add
              </Button>
            </div>
            {teamList.length === 0 ? (
              <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground text-center">
                No invites for this team yet.
              </div>
            ) : (
              <div className="space-y-2">
                {teamList.map((inv) => (
                  <InviteRow
                    key={inv.tempId}
                    invite={inv}
                    roleOptions={roleOptions as any}
                    onChange={(patch) => update(inv.tempId, patch)}
                    onRemove={() => remove(inv.tempId)}
                    onSend={() => onSend(inv)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------- reusable invite row ----------

function InviteRow({
  invite,
  roleOptions,
  onChange,
  onRemove,
  onSend,
}: {
  invite: DraftInvite;
  roleOptions: { value: string; label: string }[];
  onChange: (patch: Partial<DraftInvite>) => void;
  onRemove: () => void;
  onSend: () => void;
}) {
  const { toast } = useToast();
  const isSent = invite.status === "sent";
  const isSending = invite.status === "sending";

  const share = async () => {
    if (!invite.link) return;
    const msg = `You've been invited. Tap here to join: ${invite.link}`;
    if (Capacitor.isNativePlatform()) {
      try {
        await Share.share({ title: "Invite", text: msg });
        return;
      } catch {
        /* cancelled */
      }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
  };

  const copy = async () => {
    if (!invite.link) return;
    try {
      await navigator.clipboard.writeText(invite.link);
      toast({ title: "Link copied" });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  return (
    <div
      className={cn(
        "rounded-xl border p-3 space-y-2",
        isSent ? "bg-emerald-500/5 border-emerald-500/30" : "bg-card",
      )}
    >
      <div className="flex items-center gap-2">
        <Input
          value={invite.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Name"
          disabled={isSent || isSending}
          className="h-9"
        />
        <Select
          value={invite.role}
          onValueChange={(v) => onChange({ role: v as any })}
          disabled={isSent || isSending}
        >
          <SelectTrigger className="h-9 w-[140px] shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {roleOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!isSent && (
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={onRemove}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="relative">
        <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="email"
          value={invite.email}
          onChange={(e) => onChange({ email: e.target.value })}
          placeholder="Email (optional — we'll send them the invite)"
          disabled={isSent || isSending}
          className="h-9 pl-9"
        />
      </div>

      {!isSent ? (
        <Button
          size="sm"
          className="w-full"
          onClick={onSend}
          disabled={!invite.name.trim() || isSending}
        >
          {isSending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <UserPlus className="h-4 w-4 mr-1" /> Send invite
            </>
          )}
        </Button>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs text-emerald-600">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {invite.email
              ? `Emailed to ${invite.email}`
              : "Invite created — share the link"}
          </div>
          {invite.errorMsg && (
            <p className="text-xs text-amber-600">
              Email issue: {invite.errorMsg}. Share the link manually.
            </p>
          )}
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={share}
            >
              <Share2 className="h-3.5 w-3.5 mr-1" /> Share
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={copy}
            >
              <Copy className="h-3.5 w-3.5 mr-1" /> Copy
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- shared ----------

function StepIntro({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: any;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-primary/5 border border-primary/15 p-4">
      <div className="p-2 rounded-lg bg-primary/15 shrink-0">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div className="min-w-0">
        <p className="font-semibold text-sm">{title}</p>
        <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
          {subtitle}
        </p>
      </div>
      <Sparkles className="h-4 w-4 text-primary/40 shrink-0 mt-1" />
    </div>
  );
}
