/**
 * Collapsed-by-default section housing the advanced RSVP / audience controls
 * for event create & edit. Keeps the main event flow short while preserving
 * every existing control and its exact state/validation semantics.
 *
 * Contains (visibility rules unchanged from before):
 *  - Display RSVPs by (rsvp_grouping)  — club-wide events only
 *  - RSVP audience                     — game / training / social
 *  - Adults only                       — all types
 *  - Restrict to roles                 — club-wide social events only
 *
 * When any value differs from its default, a short summary is shown under
 * the collapsed heading so restrictions are visible without expanding.
 */
import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { MobileCardSelect } from "@/components/MobileCardSelect";
import { RsvpAudienceSelect } from "@/components/event/RsvpAudienceSelect";
import { EventRoleAudienceSelect, type ClubEventRole } from "@/components/event/EventRoleAudienceSelect";
import { RSVP_AUDIENCE_OPTIONS, type RsvpAudience } from "@/lib/rsvpAudience";
import { cn } from "@/lib/utils";

type RsvpGrouping = "" | "level" | "team";

const GROUPING_LABELS: Record<string, string> = {
  level: "By age level",
  team: "By team",
};

const ROLE_LABELS: Record<ClubEventRole, string> = {
  committee_member: "Committee members",
  club_admin: "Club admins",
  league_admin: "League admins",
  team_admin: "Team admins",
  coach: "Coaches",
};

interface Props {
  /** Show "Display RSVPs by" (club-wide events only). */
  showGrouping: boolean;
  rsvpGrouping: RsvpGrouping;
  onRsvpGroupingChange: (next: RsvpGrouping) => void;
  /** Show RSVP audience picker (game / training / social). */
  showAudience: boolean;
  rsvpAudience: RsvpAudience | null;
  onRsvpAudienceChange: (next: RsvpAudience | null) => void;
  /** Team default for RSVP audience; pass undefined to hide the "Use team default" option. */
  teamDefaultAudience?: RsvpAudience | null;
  adultsOnly: boolean;
  onAdultsOnlyChange: (next: boolean) => void;
  /** Show the role restriction picker (club-wide social events). */
  showRoleRestriction: boolean;
  restrictedRoles: ClubEventRole[];
  onRestrictedRolesChange: (next: ClubEventRole[]) => void;
}

export function AdvancedRsvpOptions({
  showGrouping,
  rsvpGrouping,
  onRsvpGroupingChange,
  showAudience,
  rsvpAudience,
  onRsvpAudienceChange,
  teamDefaultAudience,
  adultsOnly,
  onAdultsOnlyChange,
  showRoleRestriction,
  restrictedRoles,
  onRestrictedRolesChange,
}: Props) {
  const [open, setOpen] = useState(false);

  const summary = useMemo(() => {
    const parts: string[] = [];
    if (showGrouping && rsvpGrouping) parts.push(GROUPING_LABELS[rsvpGrouping] ?? rsvpGrouping);
    if (showAudience && rsvpAudience) {
      parts.push(RSVP_AUDIENCE_OPTIONS.find((o) => o.value === rsvpAudience)?.label ?? rsvpAudience);
    }
    if (adultsOnly) parts.push("Adults only");
    if (showRoleRestriction && restrictedRoles.length > 0) {
      parts.push(restrictedRoles.map((r) => ROLE_LABELS[r] ?? r).join(", "));
    }
    return parts.join(" · ");
  }, [showGrouping, rsvpGrouping, showAudience, rsvpAudience, adultsOnly, showRoleRestriction, restrictedRoles]);

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 py-2 text-left"
      >
        <span className="text-sm font-medium">Advanced RSVP &amp; audience options</span>
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>
      {!open && summary && (
        <p className="text-xs text-muted-foreground -mt-1 pb-1">{summary}</p>
      )}

      {open && (
        <div className="space-y-4 pt-1">
          {showGrouping && (
            <MobileCardSelect
              value={rsvpGrouping || "none"}
              onValueChange={(v) => onRsvpGroupingChange(v === "none" ? "" : (v as "level" | "team"))}
              options={[
                { value: "none", label: "Everyone together" },
                { value: "level", label: "By age level (U8, U9…)" },
                { value: "team", label: "By team (U8 Blue, U8 Red…)" },
              ]}
              placeholder="Everyone together"
              label="Display RSVPs by"
            />
          )}

          {showAudience && (
            <RsvpAudienceSelect
              value={rsvpAudience}
              onChange={onRsvpAudienceChange}
              teamDefault={teamDefaultAudience}
            />
          )}

          <div className="flex items-start justify-between gap-3">
            <div className="space-y-0.5">
              <Label htmlFor="adults-only" className="text-sm font-medium">Adults only</Label>
              <p className="text-xs text-muted-foreground">
                Hide child RSVP prompts. Use for committee meetings, AGMs and adult socials.
              </p>
            </div>
            <Switch id="adults-only" checked={adultsOnly} onCheckedChange={onAdultsOnlyChange} />
          </div>

          {showRoleRestriction && (
            <EventRoleAudienceSelect
              value={restrictedRoles}
              onChange={onRestrictedRolesChange}
            />
          )}
        </div>
      )}
    </div>
  );
}
