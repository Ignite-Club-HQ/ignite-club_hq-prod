import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Send, UserPlus } from "lucide-react";
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

interface MemberInviteSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function MemberInviteSheet({ open, onOpenChange }: MemberInviteSheetProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { activeClubFilter } = useClubTheme();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [selectedTeam, setSelectedTeam] = useState("");
  const [selectedRole, setSelectedRole] = useState("player");

  // Fetch user's teams for the selector
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
        .select("id, name, club_id, clubs(name, sport)")
        .in("id", teamIds);

      if (!teamData) return [];

      return teamData
        .filter(t => !activeClubFilter || t.club_id === activeClubFilter)
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });

  const submitReferral = useMutation({
    mutationFn: async () => {
      if (!user || !name.trim() || !selectedTeam) return;

      const { error } = await supabase.from("member_referrals" as any).insert({
        team_id: selectedTeam,
        referred_by: user.id,
        referred_name: name.trim(),
        referred_email: email.trim().toLowerCase() || null,
        referred_role: selectedRole,
      } as any);

      if (error) throw error;

      // Notify admins/coaches via notifications table
      const { data: adminRoles } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("team_id", selectedTeam)
        .in("role", ["club_admin", "coach", "team_admin"]);

      const team = teams.find(t => t.id === selectedTeam);

      if (adminRoles && adminRoles.length > 0) {
        const notifications = adminRoles.map(r => ({
          user_id: r.user_id,
          type: "membership",
          message: `New invite referral: ${name.trim()} was referred as ${selectedRole} to ${team?.name || "your team"}`,
          related_id: selectedTeam,
        }));

        await supabase.from("notifications").insert(notifications);
      }
    },
    onSuccess: () => {
      toast({ title: `Referral submitted for ${name.trim()}`, description: "An admin will review and send the invite." });
      setName("");
      setEmail("");
      setSelectedTeam("");
      setSelectedRole("player");
      onOpenChange(false);
    },
    onError: (error: Error) => {
      console.error("[MemberInvite] Error:", error);
      toast({ title: "Failed to submit referral", variant: "destructive" });
    },
  });

  const canSubmit = name.trim() && selectedTeam;

  // Auto-select team if only one
  if (teams.length === 1 && !selectedTeam) {
    setSelectedTeam(teams[0].id);
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Invite Someone
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Refer someone to join your team. An admin or coach will review and send the invite.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="space-y-4 pt-2">
          {teams.length > 1 && (
            <MobileCardSelect
              value={selectedTeam}
              onValueChange={setSelectedTeam}
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
            onValueChange={setSelectedRole}
            options={[
              { value: "player", label: "Player" },
              { value: "parent", label: "Parent" },
              { value: "coach", label: "Coach" },
            ]}
            label="Role"
            placeholder="Choose a role..."
          />

          <div className="space-y-2">
            <Label htmlFor="referral-name">Name</Label>
            <Input
              id="referral-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter their name"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="referral-email">Email (optional)</Label>
            <Input
              id="referral-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter their email"
            />
          </div>
        </div>

        <ResponsiveDialogFooter className="mt-4">
          <Button
            className="w-full"
            onClick={() => submitReferral.mutate()}
            disabled={!canSubmit || submitReferral.isPending}
          >
            {submitReferral.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            {canSubmit ? "Submit Referral" : "Enter name and select team"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
