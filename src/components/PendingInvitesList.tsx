import { useState, useEffect } from "react";
import { ChevronLeft, X } from "lucide-react";
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

const HINT_KEY = "pending_invite_swipe_hint_seen";

export default function PendingInvitesList({ invites, teamId, clubId, isAdmin = true }: PendingInvitesListProps) {
  const [showHint, setShowHint] = useState(false);

  useEffect(() => {
    if (!isAdmin || invites.length === 0) return;
    try {
      if (!localStorage.getItem(HINT_KEY)) {
        setShowHint(true);
      }
    } catch {}
  }, [isAdmin, invites.length]);

  const dismissHint = () => {
    setShowHint(false);
    try { localStorage.setItem(HINT_KEY, "1"); } catch {}
  };

  if (invites.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <div className="px-1 py-1.5">
        <span className="text-sm text-muted-foreground">
          {invites.length} pending invite{invites.length !== 1 ? "s" : ""}
        </span>
      </div>

      {showHint && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/60 text-xs text-muted-foreground">
          <ChevronLeft className="h-3.5 w-3.5 shrink-0 animate-pulse" />
          <span className="flex-1">Swipe left on a card to manage invite</span>
          <button onClick={dismissHint} className="shrink-0 p-0.5 rounded hover:bg-muted">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

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
