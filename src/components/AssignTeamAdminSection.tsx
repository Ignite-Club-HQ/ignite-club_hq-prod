import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Search, UserPlus, Link2, Copy, Check, Mail, User } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";

interface AssignTeamAdminSectionProps {
  clubId: string;
  teamId?: string; // Will be set after team is created
  teamName: string;
  onAssignmentChange: (assignment: TeamAdminAssignment | null) => void;
}

export interface TeamAdminAssignment {
  type: 'existing_user' | 'invite_link';
  userId?: string;
  userDisplayName?: string;
  inviteToken?: string;
}

export function AssignTeamAdminSection({ 
  clubId, 
  teamId,
  teamName,
  onAssignmentChange 
}: AssignTeamAdminSectionProps) {
  const [assignOther, setAssignOther] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState<{ id: string; display_name: string; avatar_url: string | null } | null>(null);
  const [showInviteOption, setShowInviteOption] = useState(false);
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Fetch club members who could become team admins
  const { data: clubMembers = [] } = useQuery({
    queryKey: ['club-members-for-admin', clubId, searchQuery],
    queryFn: async () => {
      if (!searchQuery.trim()) return [];
      
      // Get all users who have any role in this club (directly or via teams)
      const { data: directMembers } = await supabase
        .from('user_roles')
        .select('user_id, profiles!inner(id, display_name, avatar_url)')
        .eq('club_id', clubId);

      const { data: teamMembers } = await supabase
        .from('user_roles')
        .select(`
          user_id,
          teams!inner(club_id),
          profiles!inner(id, display_name, avatar_url)
        `)
        .eq('teams.club_id', clubId);

      const memberMap = new Map<string, { id: string; display_name: string; avatar_url: string | null }>();
      
      directMembers?.forEach(m => {
        const profile = m.profiles as any;
        if (profile?.display_name?.toLowerCase().includes(searchQuery.toLowerCase())) {
          memberMap.set(profile.id, {
            id: profile.id,
            display_name: profile.display_name,
            avatar_url: profile.avatar_url
          });
        }
      });

      teamMembers?.forEach(m => {
        const profile = m.profiles as any;
        if (profile?.display_name?.toLowerCase().includes(searchQuery.toLowerCase())) {
          memberMap.set(profile.id, {
            id: profile.id,
            display_name: profile.display_name,
            avatar_url: profile.avatar_url
          });
        }
      });

      return Array.from(memberMap.values());
    },
    enabled: assignOther && searchQuery.length >= 2,
  });

  const generateToken = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let token = '';
    for (let i = 0; i < 8; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
  };

  const handleToggleAssignOther = (checked: boolean) => {
    setAssignOther(checked);
    if (!checked) {
      setSelectedUser(null);
      setShowInviteOption(false);
      setGeneratedToken(null);
      onAssignmentChange(null);
    }
  };

  const handleSelectUser = (user: { id: string; display_name: string; avatar_url: string | null }) => {
    setSelectedUser(user);
    setShowInviteOption(false);
    setGeneratedToken(null);
    onAssignmentChange({
      type: 'existing_user',
      userId: user.id,
      userDisplayName: user.display_name
    });
  };

  const handleGenerateInvite = () => {
    const token = generateToken();
    setGeneratedToken(token);
    setSelectedUser(null);
    setShowInviteOption(true);
    onAssignmentChange({
      type: 'invite_link',
      inviteToken: token
    });
  };

  const inviteLink = generatedToken 
    ? `${window.location.origin}/join/${generatedToken}?install=true`
    : '';

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      toast.success("Link copied!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy link");
    }
  };

  const handleShareLink = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Join ${teamName} as Team Admin`,
          text: `You've been invited to manage ${teamName}. Click the link to join:`,
          url: inviteLink
        });
        toast.success("Link shared!");
      } catch (err: any) {
        // User cancelled - don't show error
        if (err?.name !== 'AbortError') {
          // Fallback to copy if share fails
          handleCopyLink();
        }
      }
    } else {
      handleCopyLink();
    }
  };

  if (!assignOther) {
    return (
      <div className="flex items-center justify-between py-3 px-4 bg-muted/30 rounded-lg">
        <div className="flex items-center gap-3">
          <UserPlus className="h-5 w-5 text-muted-foreground" />
          <div>
            <Label htmlFor="assign-other" className="text-sm font-medium">
              Assign someone else as Team Admin
            </Label>
            <p className="text-xs text-muted-foreground">
              You won't be added as admin
            </p>
          </div>
        </div>
        <Switch
          id="assign-other"
          checked={assignOther}
          onCheckedChange={handleToggleAssignOther}
        />
      </div>
    );
  }

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <UserPlus className="h-5 w-5 text-primary" />
          <Label className="text-sm font-medium">Assign Team Admin</Label>
        </div>
        <Switch
          checked={assignOther}
          onCheckedChange={handleToggleAssignOther}
        />
      </div>

      {/* Selected user display */}
      {selectedUser && (
        <div className="flex items-center gap-3 p-3 bg-primary/10 rounded-lg border border-primary/20">
          <Avatar className="h-10 w-10">
            <AvatarImage src={selectedUser.avatar_url || undefined} />
            <AvatarFallback>{selectedUser.display_name?.charAt(0) || 'U'}</AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <p className="font-medium">{selectedUser.display_name}</p>
            <p className="text-xs text-muted-foreground">Will be assigned as Team Admin</p>
          </div>
          <Badge variant="secondary">Selected</Badge>
          <Button 
            variant="ghost" 
            size="sm"
            onClick={() => {
              setSelectedUser(null);
              onAssignmentChange(null);
            }}
          >
            Change
          </Button>
        </div>
      )}

      {/* Invite link generated */}
      {generatedToken && !selectedUser && (
        <div className="space-y-4 p-4 bg-muted/30 rounded-lg border">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Link2 className="h-4 w-4 text-primary" />
            Invite Link Generated
          </div>
          
          <div className="flex gap-2">
            <Input 
              value={inviteLink} 
              readOnly 
              className="text-xs"
            />
            <Button 
              variant="outline" 
              size="icon"
              onClick={handleCopyLink}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>

          <div className="flex justify-center py-4 bg-white rounded-lg">
            <QRCodeSVG value={inviteLink} size={120} />
          </div>

          <div className="flex gap-2">
            <Button 
              variant="outline" 
              className="flex-1"
              onClick={handleShareLink}
            >
              <Mail className="h-4 w-4 mr-2" />
              Share Link
            </Button>
          </div>

          <p className="text-xs text-muted-foreground text-center">
            Share this link with the person you want to manage this team.
            They'll be added as Team Admin when they join.
          </p>
        </div>
      )}

      {/* Search or invite options */}
      {!selectedUser && !generatedToken && (
        <>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search existing members by name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Search results */}
          {searchQuery.length >= 2 && clubMembers.length > 0 && (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {clubMembers.map((member) => (
                <button
                  key={member.id}
                  onClick={() => handleSelectUser(member)}
                  className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors text-left"
                >
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={member.avatar_url || undefined} />
                    <AvatarFallback>{member.display_name?.charAt(0) || 'U'}</AvatarFallback>
                  </Avatar>
                  <span className="font-medium text-sm">{member.display_name}</span>
                </button>
              ))}
            </div>
          )}

          {searchQuery.length >= 2 && clubMembers.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-2">
              No members found matching "{searchQuery}"
            </p>
          )}

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">or</span>
            </div>
          </div>

          <Button 
            variant="outline" 
            className="w-full"
            onClick={handleGenerateInvite}
          >
            <User className="h-4 w-4 mr-2" />
            Generate Invite Link for New User
          </Button>

          <p className="text-xs text-muted-foreground text-center">
            If they're not yet on Ignite, generate an invite link they can use to sign up and become Team Admin.
          </p>
        </>
      )}
    </Card>
  );
}
