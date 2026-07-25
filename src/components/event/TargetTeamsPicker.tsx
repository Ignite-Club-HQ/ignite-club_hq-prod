/**
 * Multi-team picker for club-wide games/socials that should only be seen
 * by members of a subset of teams (see `events.target_team_ids`).
 *
 * Renders as a "Target" segmented control (All club members vs. Only selected
 * teams). When "Only selected teams" is active, a checkbox list of the club's
 * teams is shown below.
 *
 * Empty `value` (`null` or []) means no targeting — visible to the whole club.
 */
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

interface TeamOption {
  id: string;
  name: string;
}

interface Props {
  teams: TeamOption[] | undefined;
  value: string[] | null;
  onChange: (next: string[] | null) => void;
  disabled?: boolean;
}

export function TargetTeamsPicker({ teams, value, onChange, disabled }: Props) {
  const active = Array.isArray(value) && value.length > 0;

  const toggle = (id: string) => {
    const set = new Set(active ? value! : []);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    onChange(set.size === 0 ? [] : Array.from(set));
  };

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">Target audience</Label>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(null)}
          className={cn(
            "rounded-lg border px-3 py-2 text-sm text-left transition-colors",
            !active
              ? "border-primary bg-primary/5 text-foreground"
              : "border-border text-muted-foreground hover:bg-muted/40",
          )}
        >
          <div className="font-medium">All club members</div>
          <div className="text-xs text-muted-foreground">Everyone in the club can RSVP</div>
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(value && value.length > 0 ? value : [])}
          className={cn(
            "rounded-lg border px-3 py-2 text-sm text-left transition-colors",
            active
              ? "border-primary bg-primary/5 text-foreground"
              : "border-border text-muted-foreground hover:bg-muted/40",
          )}
        >
          <div className="font-medium">Only selected teams</div>
          <div className="text-xs text-muted-foreground">Pick 2 or more teams below</div>
        </button>
      </div>

      {active && (
        <div className="rounded-lg border p-3 space-y-2">
          {(!teams || teams.length === 0) ? (
            <p className="text-xs text-muted-foreground">No teams available in this club.</p>
          ) : (
            teams.map((t) => {
              const checked = (value ?? []).includes(t.id);
              return (
                <label
                  key={t.id}
                  className="flex items-center gap-2 text-sm cursor-pointer"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => toggle(t.id)}
                    disabled={disabled}
                  />
                  <span>{t.name}</span>
                </label>
              );
            })
          )}
          {active && (value ?? []).length < 2 && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Select at least 2 teams — for a single team, choose it directly in the Team dropdown.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
