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
  QrCode,
  ChevronDown,
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
import { MonogramLogoGenerator } from "@/components/club/MonogramLogoGenerator";
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

// Core wizard: three steps only. Branding, Sponsors, Committee and Operational
// Groups are deferred to the post-setup checklist / Club Settings so a new
// club can become operational in the fastest possible flow.
const ALL_STEPS = [
  { id: "teams", label: "Teams", icon: Users },
  { id: "teaminvites", label: "Invite members", icon: UserPlus },
  { id: "review", label: "Review", icon: ClipboardList },
] as const;

// Shell clubs (personal team organisers) use the same three steps.
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

  // Hydrate from DB: if the club already has teams (e.g. user set them up on
  // another device, or cleared local storage), seed them into the wizard so
  // "Resume setup" doesn't show an empty list and skip team invites.
  const { data: existingTeams } = useQuery({
    queryKey: ["club-teams", clubId],
    queryFn: async () => {
      const { data } = await supabase
        .from("teams")
        .select("id, name, level_age")
        .eq("club_id", clubId!)
        .order("created_at", { ascending: true });
      return data ?? [];
    },
    enabled: !!clubId,
  });

  const hydratedFromDbRef = useRef(false);
  useEffect(() => {
    if (hydratedFromDbRef.current) return;
    if (!existingTeams || existingTeams.length === 0) return;
    hydratedFromDbRef.current = true;
    setTeams((prev) => {
      const alreadySavedIds = new Set(prev.filter(t => t.createdTeamId).map(t => t.createdTeamId));
      const missing = existingTeams
        .filter((t: any) => !alreadySavedIds.has(t.id))
        .map((t: any) => ({
          tempId: crypto.randomUUID(),
          name: t.name ?? "",
          levelAge: t.level_age ?? "",
          createdTeamId: t.id as string,
        }));
      if (missing.length === 0) return prev;
      // Drop empty placeholder rows when we have real teams to show.
      const kept = prev.filter(t => t.createdTeamId || t.name.trim() !== "");
      return [...missing, ...kept];
    });
  }, [existingTeams]);

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
          team_type: "mixed",
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

  const [savingTeams, setSavingTeams] = useState(false);

  const goNext = async () => {
    // Auto-save any unsaved teams that have a name — no per-row Save needed.
    if (step.id === "teams") {
      const unsaved = teams.filter(
        (t) => t.name.trim() && !t.createdTeamId,
      );
      if (unsaved.length > 0) {
        setSavingTeams(true);
        try {
          for (const t of unsaved) {
            await saveTeamMutation.mutateAsync(t);
          }
        } catch {
          setSavingTeams(false);
          return; // toast surfaced by mutation onError
        }
        setSavingTeams(false);
      }
    }
    if (safeStepIndex < STEPS.length - 1) {
      // Skip team-invites step if no teams (jump straight to next step)
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

  // No optional Pro steps remain in the core wizard — keep goSkip/isOptionalStep
  // as no-op aliases so any remaining handlers still compile.
  const goSkip = goNext;
  const isOptionalStep = false;

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
            <h1 className="text-base font-semibold truncate">
              {isShellClub
                ? "Set up your team"
                : `Set up ${club?.name || "your club"}`}
            </h1>
            <p className="text-xs text-muted-foreground">
              Step {safeStepIndex + 1} of {STEPS.length}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={finish}>
            Exit
          </Button>
        </div>
        {/* Progress bar */}
        <div className="px-4 max-w-2xl mx-auto w-full">
          <div className="h-1 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
        {/* Compact 3-step indicator — always fits on screen, no scrollbar */}
        <div className="px-4 pt-2.5 pb-3 max-w-2xl mx-auto w-full">
          <div className="flex items-center justify-between gap-1">
            {STEPS.map((s, i) => {
              const active = i === safeStepIndex;
              const done = i < safeStepIndex;
              return (
                <div key={s.id} className="flex items-center flex-1 min-w-0 gap-1">
                  <button
                    type="button"
                    onClick={() => setStepIndex(i)}
                    className={cn(
                      "flex items-center gap-1.5 min-w-0 flex-1 px-2 py-1 rounded-md text-[11px] sm:text-xs font-medium transition-colors",
                      active
                        ? "text-primary"
                        : done
                          ? "text-emerald-600"
                          : "text-muted-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "flex items-center justify-center h-5 w-5 rounded-full text-[10px] font-semibold shrink-0",
                        active
                          ? "bg-primary text-primary-foreground"
                          : done
                            ? "bg-emerald-500 text-white"
                            : "bg-muted text-muted-foreground",
                      )}
                    >
                      {done ? <Check className="h-3 w-3" /> : i + 1}
                    </span>
                    <span className="truncate">{s.label}</span>
                  </button>
                  {i < STEPS.length - 1 && (
                    <ArrowRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                  )}
                </div>
              );
            })}
          </div>
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

          {/* Branding, Sponsors, Committee and Working Groups intentionally
              removed from the core wizard — surfaced via the post-setup
              checklist and Club Settings. */}




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
              clubId={clubId!}
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

      {/* Footer — sticky, always visible on mobile so Continue is reachable */}
      <div
        className="sticky bottom-0 border-t bg-background/95 backdrop-blur-none px-4 py-3"
        style={{ paddingBottom: `max(0.75rem, env(safe-area-inset-bottom))` }}
      >
        <div className="max-w-2xl mx-auto space-y-2">
          <div className="flex gap-2">
            {step.id === "review" ? (
              <Button
                variant="outline"
                onClick={() => {
                  const idx = STEPS.findIndex((s) => s.id === "teaminvites");
                  if (idx >= 0) setStepIndex(idx);
                }}
                className="flex-1"
              >
                <UserPlus className="h-4 w-4 mr-1" /> Invite more members
              </Button>
            ) : (
              <Button variant="outline" onClick={goBack} className="flex-1">
                Back
              </Button>
            )}
            <Button
              onClick={goNext}
              disabled={savingTeams}
              className={cn(
                "flex-[2]",
                safeStepIndex === STEPS.length - 1 &&
                  "bg-emerald-600 hover:bg-emerald-700 text-white",
              )}
            >
              {savingTeams ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : safeStepIndex === STEPS.length - 1 ? (
                <>
                  <Check className="h-4 w-4 mr-1" /> Finish setup
                </>
              ) : (
                <>
                  Continue
                  <ArrowRight className="h-4 w-4 ml-1" />
                </>
              )}
            </Button>
          </div>
          {step.id === "teaminvites" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={goNext}
              className="w-full text-muted-foreground"
            >
              I’ll invite people later
            </Button>
          )}
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
        title="Create your teams"
        subtitle="Most clubs start with one or two teams. Add the teams you want to set up now — you can add more anytime from Club Settings."
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
                <Label className="text-xs">Age group or level (optional)</Label>
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
            {!t.createdTeamId && t.name.trim() && (
              <p className="text-[11px] text-muted-foreground">
                Saves automatically when you tap Continue.
              </p>
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

      <BulkPasteTeams
        onAdd={(names) =>
          setTeams((prev) => {
            const existing = new Set(
              prev.map((p) => p.name.trim().toLowerCase()).filter(Boolean),
            );
            const additions = names
              .map((n) => n.trim())
              .filter((n) => n && !existing.has(n.toLowerCase()))
              .map((n) => ({
                tempId: crypto.randomUUID(),
                name: n,
                levelAge: "",
              }));
            // Drop the trailing empty placeholder row if user is pasting.
            const kept = prev.filter(
              (t) => t.createdTeamId || t.name.trim() !== "",
            );
            return [...kept, ...additions];
          })
        }
      />
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
    <div className="space-y-4">
      <StepIntro
        icon={UserPlus}
        title="Invite people to your teams"
        subtitle="Add coaches, team admins, players and parents to the teams you created. Each person will receive their own invitation link. You can also skip this and invite people later."
      />

      {teams.map((team) => {
        const teamList = list.filter((i) => i.teamId === team.createdTeamId);
        return (
          <div
            key={team.createdTeamId}
            className="rounded-xl border bg-card p-3 space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{team.name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {teamList.length === 0
                    ? "0 people invited"
                    : `${teamList.length} ${teamList.length === 1 ? "person" : "people"} invited`}
                </p>
              </div>
            </div>

            {teamList.length > 0 && (
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

            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => addRow(team.createdTeamId!, "player")}
              >
                <UserPlus className="h-4 w-4 mr-1" /> Add members
              </Button>
              <BulkPasteInvites
                compact
                triggerLabel="Paste a member list"
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
        title="Create working groups (optional)"
        subtitle="Sub-committees for how you organise work — e.g. Fundraising, Grounds, Events. Each one is just a private chat group for that committee. Skip this if you're not sure — you can add them anytime."
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
  triggerLabel,
}: {
  onAdd: (rows: { name: string; email: string }[]) => void;
  compact?: boolean;
  triggerLabel?: string;
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
        className={cn(
          "w-full text-muted-foreground",
          compact && "flex-1 h-9 text-xs sm:text-sm",
        )}
      >
        <ClipboardPaste className="h-3.5 w-3.5 mr-1" />
        {triggerLabel ?? "Bulk paste names / emails"}
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

// ---------- shared: bulk-paste team names (one per line) ----------

function BulkPasteTeams({ onAdd }: { onAdd: (names: string[]) => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const lines = useMemo(
    () =>
      text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean),
    [text],
  );

  const submit = () => {
    if (lines.length === 0) {
      toast({ title: "Nothing to add", description: "Paste one team name per line.", variant: "destructive" });
      return;
    }
    onAdd(lines);
    toast({ title: `Added ${lines.length} team${lines.length === 1 ? "" : "s"}` });
    setText("");
    setOpen(false);
  };

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="w-full text-muted-foreground"
      >
        <ClipboardPaste className="h-3.5 w-3.5 mr-1" /> Paste a list of team names
      </Button>
    );
  }

  return (
    <div className="rounded-xl border p-3 space-y-2 bg-card">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium">Paste team names</p>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setOpen(false); setText(""); }}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        One team name per line. Duplicates are removed automatically.
      </p>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder={"U10 Lions\nU12 Girls\nSeniors"}
        className="text-sm"
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {lines.length} detected
        </span>
        <Button size="sm" onClick={submit} disabled={lines.length === 0}>
          Add {lines.length || ""}
        </Button>
      </div>
    </div>
  );
}



// ---------- step: review & finish ----------

function ReviewStep({
  clubId,
  clubName,
  teams,
  committee,
  groups,
  teamInvites,
  onJumpToStep,
}: {
  clubId: string;
  clubName?: string | null;
  teams: DraftTeam[];
  committee: DraftInvite[];
  groups: DraftGroup[];
  teamInvites: DraftInvite[];
  onJumpToStep: (id: string) => void;
}) {
  const navigate = useNavigate();
  const sentTeamInv = teamInvites.filter((i) => i.status === "sent").length;
  const pendingTeamInv = teamInvites.length - sentTeamInv;


  // Section 1 — completed setup summary (only what the wizard actually asked for).
  const summaryRows: {
    id: string;
    label: string;
    detail: string;
    done: boolean;
  }[] = [
    {
      id: "teams",
      label: "Teams",
      detail:
        teams.length === 0
          ? "None yet"
          : `${teams.length} created`,
      done: teams.length > 0,
    },
    {
      id: "teaminvites",
      label: "Member invitations",
      detail:
        teamInvites.length === 0
          ? "Invite later"
          : `${sentTeamInv} invited${pendingTeamInv ? `, ${pendingTeamInv} not sent` : ""}`,
      // No green tick just for viewing — only when at least one was sent.
      done: sentTeamInv > 0,
    },
  ];

  // Section 2 — optional next steps (not gated inside the wizard).
  const optionalItems: {
    id: string;
    label: string;
    hint: string;
    to: string;
    pro?: boolean;
  }[] = [
    {
      id: "committee",
      label: "Invite committee members",
      hint: "Optional",
      to: `/clubs/${clubId}/settings`,
    },
    {
      id: "groups",
      label: "Create operational groups",
      hint: "Set up later",
      to: `/clubs/${clubId}/settings`,
    },
    {
      id: "branding",
      label: "Add club branding",
      hint: "Pro",
      to: `/clubs/${clubId}/settings`,
      pro: true,
    },
    {
      id: "sponsors",
      label: "Add sponsors",
      hint: "Pro",
      to: `/clubs/${clubId}/settings`,
      pro: true,
    },
  ];

  return (
    <div className="space-y-4">
      <StepIntro
        icon={ClipboardList}
        title={`${clubName || "Your club"} is nearly ready`}
        subtitle="Review what you've set up. Select an item to make changes, or finish setup and enter your club."
      />

      {/* Section 1 — Setup summary */}
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-1">
          Setup summary
        </p>
        <div className="rounded-xl border divide-y bg-card">
          {summaryRows.map((r) => (
            <button
              key={r.id}
              onClick={() => onJumpToStep(r.id)}
              className="w-full flex items-center justify-between px-3 py-3 text-left hover:bg-muted/60 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                {r.done ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                ) : (
                  <span className="h-5 w-5 rounded-full border-2 border-muted-foreground/30 shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{r.label}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {r.detail}
                  </p>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </button>
          ))}
        </div>
      </div>

      {/* Section 2 — Optional next steps */}
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-1">
          Optional next steps
        </p>
        <div className="rounded-xl border divide-y bg-card">
          {optionalItems.map((item) => (
            <button
              key={item.id}
              onClick={() => navigate(item.to)}
              className="w-full flex items-center justify-between px-3 py-3 text-left hover:bg-muted/60 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="h-5 w-5 rounded-full border-2 border-muted-foreground/30 shrink-0" />
                <p className="text-sm font-medium truncate">{item.label}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span
                  className={cn(
                    "text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded",
                    item.pro
                      ? "bg-primary/15 text-primary"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {item.hint}
                </span>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </button>
          ))}
        </div>
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


