import { useState, useMemo, useEffect, useRef } from "react";
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
  ClipboardList,
  ClipboardPaste,
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
import { Textarea } from "@/components/ui/textarea";
import { parseRecipients, looksLikeMultiRecipient } from "@/components/invite/recipientParser";
import { lookupInvitableUserByEmail } from "@/lib/inviteEmailDedupe";


// ---------- types ----------

type ClubRole = "club_admin" | "committee_member";
type TeamRole = "team_admin" | "coach" | "player" | "parent";

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

interface DraftGroup {
  tempId: string;
  name: string;
  description: string;
  status: "pending" | "saving" | "saved" | "error";
  createdId?: string;
  errorMsg?: string;
}

const CLUB_ROLE_LABEL: Record<ClubRole, string> = {
  club_admin: "Club Admin",
  committee_member: "Committee Member",
};
const TEAM_ROLE_LABEL: Record<TeamRole, string> = {
  team_admin: "Team Admin",
  coach: "Coach",
  player: "Player",
  parent: "Parent",
};

// Free-tier essentials first (teams, committee, groups, invites), then Pro
// upgrades (branding, sponsors), then review. This keeps the perceived effort
// low for new clubs — they finish something useful before hitting any locks.
const ALL_STEPS = [
  { id: "teams", label: "Teams", icon: Users },
  { id: "committee", label: "Committee", icon: Shield },
  { id: "subcommittee", label: "Working groups", icon: UserPlus },
  { id: "teaminvites", label: "Team invites", icon: Trophy },
  { id: "branding", label: "Branding", icon: Palette },
  { id: "sponsors", label: "Sponsors", icon: Building2 },
  { id: "review", label: "Review", icon: ClipboardList },
] as const;

// Shell clubs (personal team organisers created via StartTeamPage) don't have
// club-level branding, sponsors, committee or operational groups — show only
// the team-focused steps so the wizard doesn't imply a full club.
const SHELL_STEP_IDS = new Set(["teams", "teaminvites", "review"]);




// ---------- page ----------

export default function ClubSetupWizardPage() {
  const { clubId } = useParams<{ clubId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  usePageTitle("Set up your club");

  const [stepIndex, setStepIndex] = useState(0);
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

  const isShellClub = (club as any)?.kind === "shell";
  const STEPS = useMemo(
    () => ALL_STEPS.filter((s) => (isShellClub ? SHELL_STEP_IDS.has(s.id) : true)),
    [isShellClub],
  );
  const safeStepIndex = Math.min(stepIndex, STEPS.length - 1);
  const step = STEPS[safeStepIndex];



  // Draft state across steps — persisted per club to survive refresh/back-nav
  const storageKey = clubId ? `ignite_wizard_draft_${clubId}` : null;
  const loadedDraft = useMemo(() => {
    if (!storageKey) return null;
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, [storageKey]);

  const [teams, setTeams] = useState<DraftTeam[]>(
    loadedDraft?.teams ?? [{ tempId: crypto.randomUUID(), name: "", levelAge: "" }],
  );
  const [committee, setCommittee] = useState<DraftInvite[]>(loadedDraft?.committee ?? []);
  const [groups, setGroups] = useState<DraftGroup[]>(loadedDraft?.groups ?? []);
  const [teamInvites, setTeamInvites] = useState<DraftInvite[]>(loadedDraft?.teamInvites ?? []);

  useEffect(() => {
    if (!storageKey) return;
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ teams, committee, groups, teamInvites }),
      );
    } catch {
      /* quota — ignore */
    }
  }, [storageKey, teams, committee, groups, teamInvites]);

  const savedTeams = teams.filter((t) => t.createdTeamId);
  const canDoTeamInvites = savedTeams.length > 0;


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

    const isTeamRole =
      invite.role === "team_admin" ||
      invite.role === "coach" ||
      invite.role === "player" ||
      invite.role === "parent";

    // Dedupe: skip inviting someone who's already in this club/team
    if (invite.email.trim()) {
      const match = await lookupInvitableUserByEmail({
        email: invite.email.trim(),
        clubId,
        teamId: isTeamRole ? invite.teamId ?? null : null,
      });
      if (match && (match.already_in_club || (isTeamRole && match.already_in_team))) {
        setList((prev) =>
          prev.map((i) =>
            i.tempId === invite.tempId
              ? {
                  ...i,
                  status: "error",
                  errorMsg: `${match.display_name ?? "This user"} is already a member — no invite sent.`,
                }
              : i,
          ),
        );
        toast({
          title: "Already a member",
          description: `${match.display_name ?? invite.email} is already in this ${isTeamRole && match.already_in_team ? "team" : "club"}.`,
        });
        return;
      }
    }

    const inviteToken = crypto.randomUUID();

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
    if (storageKey) {
      try { localStorage.removeItem(storageKey); } catch { /* noop */ }
    }
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
    if (safeStepIndex < STEPS.length - 1) {
      // Skip team-invites step if no teams (jump straight to review)
      if (STEPS[safeStepIndex + 1].id === "teaminvites" && !canDoTeamInvites) {
        setStepIndex((i) => i + 2);
        return;
      }
      setStepIndex((i) => i + 1);
    } else {
      finish();
    }
  };

  const goBack = () => {
    if (safeStepIndex === 0) navigate(`/clubs/${clubId}`);
    else setStepIndex((i) => i - 1);
  };

  const progress = ((safeStepIndex + 1) / STEPS.length) * 100;

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
                {isShellClub
                  ? "Set up your team"
                  : `Set up ${club?.name || "your club"}`}
              </h1>
              <span className="text-xs text-muted-foreground shrink-0">
                Step {safeStepIndex + 1}/{STEPS.length}
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
            const active = i === safeStepIndex;
            const done = i < safeStepIndex;
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
                proBadge
              />
              {proLoading ? null : hasPro ? (
                <>
                  <BrandPresetPicker
                    clubId={clubId!}
                    onApplied={() =>
                      qc.invalidateQueries({ queryKey: ["club", clubId, "setup"] })
                    }
                  />
                  <ClubThemeEditor
                    key={`${(club as any)?.theme_primary_h ?? "x"}-${(club as any)?.theme_secondary_h ?? "x"}-${(club as any)?.theme_accent_h ?? "x"}`}
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
                </>
              ) : (
                <ProFeatureLock
                  title="Branding is a Pro feature"
                  description="Custom logos, colours and header branding are available on Pro. You can skip this step and upgrade anytime."
                  clubId={clubId}
                />
              )}
            </div>
          )}

          {step.id === "sponsors" && (
            <div className="space-y-4">
              <StepIntro
                icon={Building2}
                title="Add your sponsors"
                subtitle="Add businesses that support your club. You can allocate them to teams and events later."
                proBadge
              />
              {proLoading ? null : hasPro ? (
                <SponsorsManager
                  clubId={clubId!}
                  currentPrimarySponsorId={(club as any)?.primary_sponsor_id ?? null}
                  onPrimaryChange={() => qc.invalidateQueries({ queryKey: ["club", clubId, "setup"] })}
                />
              ) : (
                <ProFeatureLock
                  title="Sponsors is a Pro feature"
                  description="Adding sponsors, logos and allocations is available on Pro. You can skip this step and upgrade anytime."
                  clubId={clubId}
                />
              )}
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
            <OperationalGroupsStep
              clubId={clubId!}
              userId={user!.id}
              groups={groups}
              setGroups={setGroups}
            />
          )}

          {step.id === "teaminvites" && (
            <TeamInvitesStep
              teams={savedTeams}
              list={teamInvites}
              setList={setTeamInvites}
              onSend={(inv) => sendInvite(inv, setTeamInvites)}
            />
          )}

          {step.id === "review" && (
            <ReviewStep
              clubName={club?.name}
              teams={savedTeams}
              committee={committee}
              groups={groups}
              teamInvites={teamInvites}
              onJumpToStep={(id) => {
                const idx = STEPS.findIndex((s) => s.id === id);
                if (idx >= 0) setStepIndex(idx);
              }}
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
            {safeStepIndex === STEPS.length - 1 ? "Finish setup" : "Continue"}
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

      <BulkPasteInvites
        onAdd={(rows) =>
          setList((prev) => {
            const existing = new Set(
              prev.map((p) => (p.email || p.name).trim().toLowerCase()),
            );
            const additions = rows
              .filter((r) => !existing.has((r.email || r.name).toLowerCase()))
              .map((r) => ({
                tempId: crypto.randomUUID(),
                name: r.name,
                email: r.email,
                role: defaultRole,
                status: "pending" as const,
              }));
            return [...prev, ...additions];
          })
        }
      />
    </div>
  );
}

// ---------- step: team invites (team-scoped: admins, coaches, players, parents) ----------

function TeamInvitesStep({
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
      { value: "player" as const, label: "Player" },
      { value: "parent" as const, label: "Parent" },
    ],
    [],
  );

  const addRow = (teamId: string, role: TeamRole = "player") =>

    setList((prev) => [
      ...prev,
      {
        tempId: crypto.randomUUID(),
        name: "",
        email: "",
        role,
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
        title="Invite people to your teams"
        subtitle="Add team admins, coaches, players and parents to the teams you just created. Each person gets a personal join link."
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
                onClick={() => addRow(team.createdTeamId!, "player")}
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

            <BulkPasteInvites
              compact
              onAdd={(rows) =>
                setList((prev) => {
                  const teamKeys = new Set(
                    prev
                      .filter((p) => p.teamId === team.createdTeamId)
                      .map((p) => (p.email || p.name).trim().toLowerCase()),
                  );
                  const additions = rows
                    .filter((r) => !teamKeys.has((r.email || r.name).toLowerCase()))
                    .map((r) => ({
                      tempId: crypto.randomUUID(),
                      name: r.name,
                      email: r.email,
                      role: "player" as TeamRole,
                      teamId: team.createdTeamId,
                      status: "pending" as const,
                    }));
                  return [...prev, ...additions];
                })
              }
            />
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
  proBadge,
}: {
  icon: any;
  title: string;
  subtitle: string;
  proBadge?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-primary/5 border border-primary/15 p-4">
      <div className="p-2 rounded-lg bg-primary/15 shrink-0">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-semibold text-sm">{title}</p>
          {proBadge && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary text-primary-foreground">
              <Crown className="h-2.5 w-2.5" /> Pro
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
          {subtitle}
        </p>
      </div>
      <Sparkles className="h-4 w-4 text-primary/40 shrink-0 mt-1" />
    </div>
  );
}

// ---------- step: operational groups (sub-committees) ----------

function OperationalGroupsStep({
  clubId,
  userId,
  groups,
  setGroups,
}: {
  clubId: string;
  userId: string;
  groups: DraftGroup[];
  setGroups: React.Dispatch<React.SetStateAction<DraftGroup[]>>;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const addRow = () =>
    setGroups((prev) => [
      ...prev,
      { tempId: crypto.randomUUID(), name: "", description: "", status: "pending" },
    ]);
  const remove = (id: string) =>
    setGroups((prev) => prev.filter((g) => g.tempId !== id));
  const update = (id: string, patch: Partial<DraftGroup>) =>
    setGroups((prev) => prev.map((g) => (g.tempId === id ? { ...g, ...patch } : g)));

  const suggestions = ["Fundraising", "Grounds & Facilities", "Events", "Sponsorship", "Registrations"];

  const save = async (g: DraftGroup) => {
    if (!g.name.trim()) {
      toast({ title: "Add a group name first", variant: "destructive" });
      return;
    }
    update(g.tempId, { status: "saving" });
    const { data, error } = await supabase
      .from("chat_groups")
      .insert({
        name: g.name.trim(),
        club_id: clubId,
        created_by: userId,
        allowed_roles: ["committee_member", "club_admin"],
        membership_mode: "role",
        category: "subcommittee",
        join_policy: "invite_only",
      } as any)
      .select("id")
      .single();
    if (error) {
      update(g.tempId, { status: "error", errorMsg: error.message });
      toast({ title: "Could not create group", description: error.message, variant: "destructive" });
      return;
    }
    update(g.tempId, { status: "saved", createdId: data.id as string });

    // Auto-seed existing club_admin + committee_member users into the group
    // so they're members immediately (not just role-eligible).
    try {
      const { data: roleRows } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("club_id", clubId)
        .in("role", ["club_admin", "committee_member"]);
      const userIds = Array.from(
        new Set([userId, ...(roleRows ?? []).map((r: any) => r.user_id)]),
      );
      if (userIds.length > 0) {
        await supabase.from("group_members").upsert(
          userIds.map((uid) => ({
            group_id: data.id,
            user_id: uid,
            added_by: userId,
          })) as any,
          { onConflict: "group_id,user_id", ignoreDuplicates: true } as any,
        );
      }
    } catch {
      /* seeding failure is non-fatal — role-based access still applies */
    }

    qc.invalidateQueries({ queryKey: ["chat-groups"] });
    toast({
      title: "Group created",
      description: `${g.name} — existing committee auto-added.`,
    });
  };

  return (
    <div className="space-y-4">
      <StepIntro
        icon={UserPlus}
        title="Create operational groups"
        subtitle="Sub-committees are just chat groups for how you organise work — Fundraising, Grounds, Events, etc. Everyone in them stays a Committee Member; these are not new roles."
      />

      {groups.length === 0 && (
        <div className="rounded-xl border border-dashed p-4 space-y-3">
          <p className="text-xs text-muted-foreground text-center">
            Quick add — tap a suggestion or create your own.
          </p>
          <div className="flex flex-wrap gap-2 justify-center">
            {suggestions.map((s) => (
              <Button
                key={s}
                variant="outline"
                size="sm"
                onClick={() =>
                  setGroups((prev) => [
                    ...prev,
                    { tempId: crypto.randomUUID(), name: s, description: "", status: "pending" },
                  ])
                }
              >
                <Plus className="h-3 w-3 mr-1" /> {s}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3">
        {groups.map((g) => {
          const saved = g.status === "saved";
          const saving = g.status === "saving";
          return (
            <div
              key={g.tempId}
              className={cn(
                "rounded-xl border p-3 space-y-2",
                saved ? "bg-emerald-500/5 border-emerald-500/30" : "bg-card",
              )}
            >
              <div className="flex items-center gap-2">
                <Input
                  value={g.name}
                  onChange={(e) => update(g.tempId, { name: e.target.value })}
                  placeholder="Group name (e.g. Fundraising)"
                  disabled={saved || saving}
                  className="h-9"
                />
                {saved ? (
                  <Badge variant="outline" className="text-emerald-600 border-emerald-500/40 shrink-0">
                    <Check className="h-3 w-3 mr-1" /> Created
                  </Badge>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    onClick={() => remove(g.tempId)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
              {!saved && (
                <Button
                  size="sm"
                  className="w-full"
                  onClick={() => save(g)}
                  disabled={!g.name.trim() || saving}
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create group"}
                </Button>
              )}
              {g.errorMsg && !saved && (
                <p className="text-xs text-destructive">{g.errorMsg}</p>
              )}
            </div>
          );
        })}
      </div>

      <Button variant="outline" size="sm" onClick={addRow} className="w-full">
        <Plus className="h-4 w-4 mr-1" /> Add group
      </Button>

      <p className="text-xs text-muted-foreground text-center">
        You can add members to each group from the group's chat once people have joined the club.
      </p>
    </div>
  );
}

// ---------- shared: bulk-paste invites ----------

function BulkPasteInvites({
  onAdd,
  compact,
}: {
  onAdd: (rows: { name: string; email: string }[]) => void;
  compact?: boolean;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const parsed = useMemo(() => parseRecipients(text), [text]);
  const showHint = text.length > 0 && !looksLikeMultiRecipient(text) && parsed.length < 2;

  const submit = () => {
    if (parsed.length === 0) {
      toast({ title: "Nothing to add", description: "Paste a list of names or emails first.", variant: "destructive" });
      return;
    }
    onAdd(parsed);
    toast({ title: `Added ${parsed.length} to the list`, description: "Review, then Send." });
    setText("");
    setOpen(false);
  };

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className={cn("w-full text-muted-foreground", compact && "h-8 text-xs")}
      >
        <ClipboardPaste className="h-3.5 w-3.5 mr-1" /> Bulk paste names / emails
      </Button>
    );
  }

  return (
    <div className="rounded-xl border p-3 space-y-2 bg-card">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium">Paste a list</p>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setOpen(false); setText(""); }}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        One per line — <code>Alex Smith &lt;alex@x.com&gt;</code>, <code>alex@x.com</code>, or just a name.
        Duplicates are removed.
      </p>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder={"Alex Smith <alex@x.com>\njordan@x.com\nSam Lee"}
        className="text-sm"
      />
      {showHint && (
        <p className="text-[11px] text-amber-600">
          Only detected 1 recipient — separate multiple entries by new lines.
        </p>
      )}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {parsed.length} detected
        </span>
        <Button size="sm" onClick={submit} disabled={parsed.length === 0}>
          Add {parsed.length || ""}
        </Button>
      </div>
    </div>
  );
}

// ---------- step: review & finish ----------

function ReviewStep({
  clubName,
  teams,
  committee,
  groups,
  teamInvites,
  onJumpToStep,
}: {
  clubName?: string | null;
  teams: DraftTeam[];
  committee: DraftInvite[];
  groups: DraftGroup[];
  teamInvites: DraftInvite[];
  onJumpToStep: (id: string) => void;
}) {
  const sentCommittee = committee.filter((i) => i.status === "sent").length;
  const pendingCommittee = committee.length - sentCommittee;
  const sentTeamInv = teamInvites.filter((i) => i.status === "sent").length;
  const pendingTeamInv = teamInvites.length - sentTeamInv;
  const savedGroups = groups.filter((g) => g.status === "saved").length;

  const rows: {
    id: string;
    label: string;
    detail: string;
    warn?: boolean;
  }[] = [
    {
      id: "teams",
      label: "Teams created",
      detail: teams.length === 0 ? "None yet" : `${teams.length} team${teams.length === 1 ? "" : "s"}`,
      warn: teams.length === 0,
    },
    {
      id: "committee",
      label: "Committee invites",
      detail:
        committee.length === 0
          ? "None yet"
          : `${sentCommittee} sent${pendingCommittee ? `, ${pendingCommittee} not sent` : ""}`,
      warn: pendingCommittee > 0,
    },
    {
      id: "subcommittee",
      label: "Operational groups",
      detail: savedGroups === 0 ? "None yet" : `${savedGroups} group${savedGroups === 1 ? "" : "s"}`,
    },
    {
      id: "teaminvites",
      label: "Team invites",
      detail:
        teamInvites.length === 0
          ? "None yet"
          : `${sentTeamInv} sent${pendingTeamInv ? `, ${pendingTeamInv} not sent` : ""}`,
      warn: pendingTeamInv > 0,
    },
  ];

  return (
    <div className="space-y-4">
      <StepIntro
        icon={ClipboardList}
        title={`${clubName || "Your club"} is nearly ready`}
        subtitle="Review what's set up. Tap a row to jump back and finish anything."
      />

      <div className="rounded-xl border divide-y">
        {rows.map((r) => (
          <button
            key={r.id}
            onClick={() => onJumpToStep(r.id)}
            className="w-full flex items-center justify-between px-3 py-3 text-left hover:bg-muted/60 transition-colors"
          >
            <div>
              <p className="text-sm font-medium">{r.label}</p>
              <p className={cn("text-xs", r.warn ? "text-amber-600" : "text-muted-foreground")}>
                {r.detail}
              </p>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
          </button>
        ))}
      </div>

      <div className="rounded-xl border bg-primary/5 border-primary/15 p-4 space-y-2">
        <p className="text-sm font-semibold">Next steps after finish</p>
        <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
          <li>Share pending invite links from the Members page.</li>
          <li>Add your season schedule from the Schedule tab.</li>
          <li>Post a welcome message in each team chat.</li>
          <li>Review sponsors and branding in Club Settings anytime.</li>
        </ul>
      </div>

      <p className="text-xs text-muted-foreground text-center">
        Draft is auto-saved — you can leave and come back anytime before finishing.
      </p>
    </div>
  );
}

// ---------- brand preset picker (quick-apply palettes) ----------

type Hsl = { h: number; s: number; l: number };
interface BrandPreset {
  id: string;
  name: string;
  primary: Hsl;
  secondary: Hsl;
  accent: Hsl;
}

const BRAND_PRESETS: BrandPreset[] = [
  { id: "ignite",    name: "Ignite Orange", primary: { h: 20,  s: 90, l: 55 }, secondary: { h: 220, s: 30, l: 20 }, accent: { h: 40,  s: 95, l: 60 } },
  { id: "royal",     name: "Royal Blue",    primary: { h: 220, s: 85, l: 45 }, secondary: { h: 220, s: 40, l: 20 }, accent: { h: 45,  s: 95, l: 55 } },
  { id: "forest",    name: "Forest Green",  primary: { h: 145, s: 55, l: 32 }, secondary: { h: 30,  s: 25, l: 18 }, accent: { h: 40,  s: 90, l: 55 } },
  { id: "crimson",   name: "Crimson",       primary: { h: 350, s: 75, l: 42 }, secondary: { h: 220, s: 20, l: 15 }, accent: { h: 45,  s: 90, l: 55 } },
  { id: "navy-gold", name: "Navy & Gold",   primary: { h: 220, s: 70, l: 25 }, secondary: { h: 220, s: 50, l: 15 }, accent: { h: 45,  s: 85, l: 55 } },
  { id: "purple",    name: "Deep Purple",   primary: { h: 265, s: 60, l: 42 }, secondary: { h: 260, s: 30, l: 18 }, accent: { h: 320, s: 75, l: 60 } },
  { id: "teal",      name: "Teal",          primary: { h: 180, s: 65, l: 38 }, secondary: { h: 200, s: 40, l: 18 }, accent: { h: 15,  s: 85, l: 60 } },
  { id: "mono",      name: "Mono Charcoal", primary: { h: 220, s: 10, l: 25 }, secondary: { h: 220, s: 8,  l: 15 }, accent: { h: 20,  s: 85, l: 55 } },
];

const hslCss = (c: Hsl) => `hsl(${c.h}, ${c.s}%, ${c.l}%)`;

function BrandPresetPicker({
  clubId,
  onApplied,
}: {
  clubId: string;
  onApplied: () => void;
}) {
  const { toast } = useToast();
  const [applyingId, setApplyingId] = useState<string | null>(null);

  const apply = async (p: BrandPreset) => {
    setApplyingId(p.id);
    const { error } = await supabase
      .from("clubs")
      .update({
        theme_primary_h: p.primary.h,
        theme_primary_s: p.primary.s,
        theme_primary_l: p.primary.l,
        theme_secondary_h: p.secondary.h,
        theme_secondary_s: p.secondary.s,
        theme_secondary_l: p.secondary.l,
        theme_accent_h: p.accent.h,
        theme_accent_s: p.accent.s,
        theme_accent_l: p.accent.l,
        theme_enabled: true,
      } as any)
      .eq("id", clubId);
    setApplyingId(null);
    if (error) {
      toast({ title: "Could not apply preset", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `${p.name} applied`, description: "Tweak individual colours below if you like." });
    onApplied();
  };

  return (
    <div className="rounded-xl border p-3 space-y-3 bg-card">
      <div>
        <p className="text-sm font-semibold">Quick brand palettes</p>
        <p className="text-xs text-muted-foreground">
          Tap a palette to apply it — you can fine-tune each colour below.
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {BRAND_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={applyingId !== null}
            onClick={() => apply(p)}
            className={cn(
              "group rounded-lg border p-2 text-left transition-all hover:border-primary hover:shadow-sm active:scale-[0.98]",
              applyingId === p.id && "opacity-60",
            )}
          >
            <div className="flex gap-1 mb-1.5 h-6 rounded overflow-hidden">
              <div className="flex-1" style={{ background: hslCss(p.primary) }} />
              <div className="flex-1" style={{ background: hslCss(p.secondary) }} />
              <div className="flex-1" style={{ background: hslCss(p.accent) }} />
            </div>
            <p className="text-[11px] font-medium truncate">{p.name}</p>
          </button>
        ))}
      </div>
    </div>
  );
}


