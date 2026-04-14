import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Copy, Link2, Loader2, Share2, UserPlus, UserCheck } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MobileCardSelect } from "@/components/MobileCardSelect";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useClubTheme } from "@/hooks/useClubTheme";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

const inviteRoles: { value: AppRole; label: string }[] = [
  { value: "player", label: "Player" },
  { value: "coach", label: "Coach" },
  { value: "parent", label: "Parent" },
  { value: "team_admin", label: "Team Admin" },
];

interface MemberInviteSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function MemberInviteSheet({ open, onOpenChange }: MemberInviteSheetProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { activeClubFilter } = useClubTheme();
  const [selectedTeam, setSelectedTeam] = useState("");
  const [selectedRole, setSelectedRole] = useState<AppRole>("player");
  const [childName, setChildName] = useState("");
  const [childYearOfBirth, setChildYearOfBirth] = useState("");
  const [selectedExistingChildId, setSelectedExistingChildId] = useState<string | null>(null);
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [teamName, setTeamName] = useState("");
  const [clubName, setClubName] = useState("");
  const [roleName, setRoleName] = useState("");
  const [linkedChildName, setLinkedChildName] = useState("");

  const { data: teams = [] } = useQuery({
    queryKey: ["member-invite-teams", user?.id, activeClubFilter],
    enabled: !!user && open,
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("team_id")
        .eq("user_id", user!.id)
        .not("team_id", "is", null);

      if (!roles || roles.length === 0) return [];
      const teamIds = [...new Set(roles.map(r => r.team_id).filter(Boolean))] as string[];

      const { data: teamData } = await supabase
        .from("teams")
        .select("id, name, club_id, clubs(name)")
        .in("id", teamIds);

      if (!teamData) return [];
      return teamData
        .filter(t => !activeClubFilter || t.club_id === activeClubFilter)
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });

  // Fetch existing children on the selected team
  const { data: teamChildren = [] } = useQuery({
    queryKey: ["invite-team-children", selectedTeam],
    enabled: !!selectedTeam && selectedRole === "parent" && open,
    queryFn: async () => {
      const { data } = await supabase
        .from("child_team_assignments")
        .select("child_id, children(id, name, year_of_birth)")
        .eq("team_id", selectedTeam);
      return (data?.map(a => (a.children as any)).filter(Boolean) || []) as { id: string; name: string; year_of_birth: number | null }[];
    },
  });

  if (teams.length === 1 && !selectedTeam) {
    setSelectedTeam(teams[0].id);
  }

  const generateLink = useMutation({
    mutationFn: async () => {
      if (!user || !selectedTeam) return;

      const team = teams.find(t => t.id === selectedTeam);
      if (!team) return;

      setTeamName(team.name);
      setClubName((team.clubs as any)?.name || "");
      const roleLabel = inviteRoles.find(r => r.value === selectedRole)?.label || "Player";
      setRoleName(roleLabel);

      const rpcArgs: any = { p_team_id: selectedTeam, p_role: selectedRole, p_child_name: null, p_child_year_of_birth: null };
      
      if (selectedRole === "parent") {
        if (selectedExistingChildId) {
          // Use existing child's name for the invite metadata
          const child = teamChildren.find(c => c.id === selectedExistingChildId);
          if (child) {
            rpcArgs.p_child_name = child.name;
            rpcArgs.p_child_year_of_birth = child.year_of_birth;
            setLinkedChildName(child.name);
          }
        } else if (childName.trim()) {
          rpcArgs.p_child_name = childName.trim();
          if (childYearOfBirth) {
            rpcArgs.p_child_year_of_birth = parseInt(childYearOfBirth);
          }
          setLinkedChildName(childName.trim());
        } else {
          setLinkedChildName("");
        }
      }

      const { data: token, error } = await supabase
        .rpc("get_or_create_member_invite_token", rpcArgs);
      if (error || !token) throw error || new Error("No token returned");

      const link = `https://igniteclubhq.app/join/${token}`;
      setGeneratedLink(link);
    },
    onError: (error: Error) => {
      console.error("[MemberInvite] Error:", error);
      toast({ title: "Failed to generate link", variant: "destructive" });
    },
  });

  const handleShare = async () => {
    if (!generatedLink) return;
    const childInfo = linkedChildName ? ` (for ${linkedChildName})` : "";
    const textBody = `Join ${teamName}${clubName ? ` at ${clubName}` : ""} as ${roleName}${childInfo}!`;

    if (Capacitor.isNativePlatform()) {
      try {
        await Share.share({ text: `${textBody}\n\nJoin here: ${generatedLink}`, dialogTitle: "Share invite" });
        return;
      } catch { /* cancelled */ }
    }
    const webMsg = `${textBody} ${generatedLink}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(webMsg)}`, "_blank");
  };

  const handleCopy = async () => {
    if (!generatedLink) return;
    try {
      await navigator.clipboard.writeText(generatedLink);
      toast({ title: "Link copied!" });
    } catch {
      toast({ title: "Failed to copy", variant: "destructive" });
    }
  };

  const handleClose = (v: boolean) => {
    if (!v) {
      setGeneratedLink(null);
      setSelectedTeam(teams.length === 1 ? teams[0]?.id || "" : "");
      setSelectedRole("player");
      setChildName("");
      setChildYearOfBirth("");
      setSelectedExistingChildId(null);
      setLinkedChildName("");
    }
    onOpenChange(v);
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={handleClose}>
      <ResponsiveDialogContent className="max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Invite to Team
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Choose a role and share the join link.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        {!generatedLink ? (
          <div className="space-y-4 pt-2">
            {teams.length > 1 && (
              <MobileCardSelect
                value={selectedTeam}
                onValueChange={(v) => {
                  setSelectedTeam(v);
                  setSelectedExistingChildId(null);
                }}
                options={teams.map(t => ({
                  value: t.id,
                  label: activeClubFilter ? t.name : `${t.name} (${(t.clubs as any)?.name || ""})`,
                }))}
                label="Select Team"
                placeholder="Choose a team..."
                searchable={teams.length > 5}
                searchPlaceholder="Search teams..."
                emptyMessage="No teams found."
              />
            )}

            {teams.length === 1 && (
              <div className="text-sm text-muted-foreground">
                Team: <span className="font-medium text-foreground">{teams[0].name}</span>
              </div>
            )}

            <MobileCardSelect
              value={selectedRole}
              onValueChange={(v) => {
                setSelectedRole(v as AppRole);
                if (v !== "parent") {
                  setChildName("");
                  setChildYearOfBirth("");
                  setSelectedExistingChildId(null);
                }
              }}
              options={inviteRoles.map(r => ({
                value: r.value,
                label: r.label,
              }))}
              label="Role"
              placeholder="Choose a role..."
            />

            {selectedRole === "parent" && (
              <div className="space-y-3 p-3 rounded-lg border border-border bg-muted/30">
                <p className="text-sm font-medium">Link to Child <span className="text-muted-foreground font-normal">(optional)</span></p>
                
                {teamChildren.length > 0 && (
                  <>
                    <div className="space-y-1">
                      {teamChildren.map((child) => (
                        <button
                          key={child.id}
                          onClick={() => {
                            setSelectedExistingChildId(selectedExistingChildId === child.id ? null : child.id);
                            if (selectedExistingChildId !== child.id) setChildName("");
                          }}
                          className={`w-full flex items-center gap-2 p-3 rounded-lg border text-left transition-colors ${
                            selectedExistingChildId === child.id
                              ? "border-primary bg-primary/5"
                              : "border-border hover:bg-muted/50"
                          }`}
                        >
                          <UserCheck className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="text-sm">{child.name}</span>
                          {child.year_of_birth && (
                            <span className="text-xs text-muted-foreground ml-auto">{child.year_of_birth}</span>
                          )}
                        </button>
                      ))}
                    </div>
                    <div className="relative py-1">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t border-border" />
                      </div>
                      <div className="relative flex justify-center text-xs uppercase">
                        <span className="bg-muted/30 px-2 text-muted-foreground">or add new</span>
                      </div>
                    </div>
                  </>
                )}

                {!selectedExistingChildId && (
                  <div className="space-y-3">
                    <div>
                      <Label htmlFor="invite-child-name" className="text-xs text-muted-foreground">Child's Name</Label>
                      <Input
                        id="invite-child-name"
                        value={childName}
                        onChange={(e) => setChildName(e.target.value)}
                        placeholder="e.g. Jack Smith"
                      />
                    </div>
                    <div>
                      <Label htmlFor="invite-child-yob" className="text-xs text-muted-foreground">Year of Birth</Label>
                      <Input
                        id="invite-child-yob"
                        type="number"
                        value={childYearOfBirth}
                        onChange={(e) => setChildYearOfBirth(e.target.value)}
                        placeholder="e.g. 2015"
                        min="2000"
                        max={new Date().getFullYear()}
                      />
                    </div>
                  </div>
                )}
                
                <p className="text-xs text-muted-foreground">
                  The child will be auto-linked to this parent when they join.
                </p>
              </div>
            )}

            <ResponsiveDialogFooter>
              <Button
                className="w-full"
                onClick={() => generateLink.mutate()}
                disabled={!selectedTeam || generateLink.isPending}
              >
                {generateLink.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Link2 className="h-4 w-4 mr-2" />
                )}
                Get Invite Link
              </Button>
            </ResponsiveDialogFooter>
          </div>
        ) : (
          <div className="space-y-4 pt-2">
            <div className="p-4 rounded-xl bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/20">
              <p className="font-medium mb-1">{teamName}</p>
              <p className="text-sm text-muted-foreground mb-1">Role: {roleName}</p>
              {linkedChildName && (
                <p className="text-sm text-muted-foreground mb-1">Child: {linkedChildName}</p>
              )}
              <p className="text-xs text-muted-foreground break-all select-all">{generatedLink}</p>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={handleShare}>
                <Share2 className="h-4 w-4 mr-2" />
                Share
              </Button>
              <Button variant="outline" className="flex-1" onClick={handleCopy}>
                <Copy className="h-4 w-4 mr-2" />
                Copy Link
              </Button>
            </div>
          </div>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
