import PendingInviteCard from "./PendingInviteCard";

interface PendingInvite {
  id: string;
  role: string;
  invited_user_id: string | null;
  invited_label: string | null;
  invited_email?: string | null;
  created_at: string;
  status: string;
  profiles?: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
}

interface PendingInvitesListProps {
  invites: PendingInvite[];
  teamId?: string;
  clubId?: string;
  isAdmin?: boolean;
}

export default function PendingInvitesList({ invites, teamId, clubId, isAdmin = true }: PendingInvitesListProps) {
  if (invites.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="px-1 py-1.5">
        <span className="text-sm text-muted-foreground">
          {invites.length} pending invite{invites.length !== 1 ? "s" : ""}
        </span>
      </div>

      {invites.map((invite) => (
        <PendingInviteCard
          key={invite.id}
          invite={invite}
          teamId={teamId}
          clubId={clubId}
          isAdmin={isAdmin}
        />
      ))}
    </div>
  );
}
