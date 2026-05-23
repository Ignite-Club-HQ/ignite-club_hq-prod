/**
 * Helpers to build a rich, glanceable identity for a member row
 * (used in pickers across chats, teams, and groups).
 */

export type MemberRole =
  | "club_admin"
  | "team_admin"
  | "committee_member"
  | "coach"
  | "league_admin"
  | "player"
  | "parent"
  | "basic_user"
  | "app_admin";

export interface MemberIdentityInput {
  display_name: string | null;
  roles: { role: MemberRole; team_id: string | null }[];
  /** Children where this user is the parent (full names ok, we trim) */
  children_names?: string[];
  /** Map of teamId → team display name */
  teamNameById?: Record<string, string>;
}

export interface MemberIdentity {
  /** Primary role used for badge/color */
  primaryRole: MemberRole | null;
  /** Short context line, e.g. "Coach • U7 Red" */
  contextLine: string;
  /** Short role label, e.g. "Coach" */
  roleLabel: string;
}

const ROLE_PRIORITY: MemberRole[] = [
  "club_admin",
  "committee_member",
  "coach",
  "team_admin",
  "league_admin",
  "player",
  "parent",
  "basic_user",
  "app_admin",
];

const ROLE_LABEL: Record<MemberRole, string> = {
  club_admin: "Club admin",
  committee_member: "Committee",
  coach: "Coach",
  team_admin: "Team admin",
  league_admin: "League admin",
  player: "Player",
  parent: "Parent",
  basic_user: "Member",
  app_admin: "Admin",
};

/** Tailwind classes for role chip (uses semantic tokens). */
export const ROLE_BADGE_CLASS: Record<MemberRole, string> = {
  club_admin: "bg-primary/15 text-primary border-primary/25",
  committee_member: "bg-primary/15 text-primary border-primary/25",
  coach: "bg-accent/20 text-accent-foreground border-accent/30",
  team_admin: "bg-accent/20 text-accent-foreground border-accent/30",
  league_admin: "bg-primary/15 text-primary border-primary/25",
  player: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/25",
  parent: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/25",
  basic_user: "bg-muted text-muted-foreground border-border",
  app_admin: "bg-primary/15 text-primary border-primary/25",
};

function pickPrimary(roles: MemberRole[]): MemberRole | null {
  for (const r of ROLE_PRIORITY) if (roles.includes(r)) return r;
  return null;
}

function firstName(full: string): string {
  return (full || "").trim().split(/\s+/)[0] || full;
}

function joinList(items: string[], max = 2): string {
  const seen = Array.from(new Set(items.filter(Boolean)));
  if (seen.length === 0) return "";
  if (seen.length <= max) return seen.join(", ");
  return `${seen.slice(0, max).join(", ")} +${seen.length - max}`;
}

export function computeMemberIdentity(input: MemberIdentityInput): MemberIdentity {
  const allRoles = input.roles.map(r => r.role);
  const primary = pickPrimary(allRoles);
  const roleLabel = primary ? ROLE_LABEL[primary] : "Member";
  const teamNames = (teamIds: (string | null)[]) =>
    teamIds
      .filter((t): t is string => !!t)
      .map(id => input.teamNameById?.[id])
      .filter((n): n is string => !!n);

  let contextLine = roleLabel;

  if (primary === "coach" || primary === "team_admin") {
    const teams = teamNames(
      input.roles.filter(r => r.role === primary).map(r => r.team_id),
    );
    contextLine = teams.length ? `${roleLabel} • ${joinList(teams)}` : roleLabel;
  } else if (primary === "player") {
    const teams = teamNames(
      input.roles.filter(r => r.role === "player").map(r => r.team_id),
    );
    contextLine = teams.length ? `Player • ${joinList(teams)}` : "Player";
  } else if (primary === "parent") {
    const kids = (input.children_names || []).map(firstName);
    contextLine = kids.length ? `Parent of ${joinList(kids)}` : "Parent";
  } else if (primary === "committee_member") {
    contextLine = "Committee";
  } else if (primary === "club_admin") {
    contextLine = "Club admin";
  } else if (primary === "league_admin") {
    contextLine = "League admin";
  }

  return { primaryRole: primary, contextLine, roleLabel };
}

/** Deterministic HSL gradient for fallback avatar based on name. */
export function avatarGradient(name: string | null | undefined): string {
  const s = (name || "?").trim();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const hue1 = h % 360;
  const hue2 = (hue1 + 40) % 360;
  return `linear-gradient(135deg, hsl(${hue1} 70% 55%), hsl(${hue2} 70% 45%))`;
}

export function avatarInitials(name: string | null | undefined): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
