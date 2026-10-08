/**
 * Single "Who's this event for?" control: whole club / one team / multiple
 * teams / competition (optional, permission-gated by the caller).
 *
 * State mapping is unchanged, so backend validation and
 * `events.target_team_ids` semantics are untouched:
 *   - Whole club     → teamId = "",   targetTeamIds = null, competitionId = ""
 *   - One team       → teamId = <id>, targetTeamIds = null
 *   - Multiple teams → teamId = "",   targetTeamIds = string[] (≥ 2 to submit)
 *   - Competition    → teamId = "",   targetTeamIds = null, competitionId = <id>
 */
import { useEffect, useMemo, useState } from "react";
import { Building2, Check, Search, Shield, Trophy, Users } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { MobileCardSelect } from "@/components/MobileCardSelect";
import { cn } from "@/lib/utils";

interface TeamOption {
  id: string;
  name: string;
}

interface Props {
  teams: TeamOption[] | undefined;
  clubTeams?: TeamOption[] | undefined;
  teamId: string;
  onTeamIdChange: (next: string) => void;
  targetTeamIds: string[] | null;
  onTargetTeamIdsChange: (next: string[] | null) => void;
  supportsClubWideScope: boolean;
  disabled?: boolean;
  defaultMode?: Mode;
  /** Pass to enable the Competition option (only when the user may organise one). */
  competitions?: TeamOption[];
  competitionId?: string;
  onCompetitionIdChange?: (next: string) => void;
  competitionTeamCount?: number;
}

type Mode = "club" | "team" | "selected" | "competition";

export function EventAudienceSelector({
  teams,
  clubTeams,
  teamId,
  onTeamIdChange,
  targetTeamIds,
  onTargetTeamIdsChange,
  supportsClubWideScope,
  disabled,
  defaultMode = "team",
  competitions,
  competitionId = "",
  onCompetitionIdChange,
  competitionTeamCount,
}: Props) {
  const showCompetition = !!onCompetitionIdChange && (competitions?.length ?? 0) > 0;
  const derivedMode: Mode = competitionId
    ? "competition"
    : teamId
      ? "team"
      : Array.isArray(targetTeamIds)
        ? "selected"
        : "club";
  const [mode, setMode] = useState<Mode>(defaultMode !== "club" ? defaultMode : derivedMode);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (derivedMode !== "club") setMode(derivedMode);
  }, [derivedMode]);

  const checklistTeams = clubTeams ?? teams;
  const selected: string[] = Array.isArray(targetTeamIds) ? targetTeamIds : [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (checklistTeams ?? []).filter((t) => !q || t.name.toLowerCase().includes(q));
  }, [checklistTeams, search]);

  const pickMode = (next: Mode) => {
    setMode(next);
    if (next !== "competition") onCompetitionIdChange?.("");
    if (next === "club" || next === "competition") {
      onTeamIdChange("");
      onTargetTeamIdsChange(null);
    } else if (next === "team") {
      onTargetTeamIdsChange(null);
    } else {
      onTeamIdChange("");
      onTargetTeamIdsChange(selected);
    }
  };

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onTargetTeamIdsChange(Array.from(next));
  };

  const allFilteredSelected = filtered.length > 0 && filtered.every((t) => selected.includes(t.id));
  const toggleAll = () => {
    const next = new Set(selected);
    if (allFilteredSelected) filtered.forEach((t) => next.delete(t.id));
    else filtered.forEach((t) => next.add(t.id));
    onTargetTeamIdsChange(Array.from(next));
  };

  if (!supportsClubWideScope) {
    return (
      <MobileCardSelect
        value={teamId}
        onValueChange={onTeamIdChange}
        options={teams?.map((t) => ({ value: t.id, label: t.name })) || []}
        placeholder="Select team"
        label="Team"
        disabled={disabled}
      />
    );
  }

  const options: Array<{ key: Mode; title: string; hint: string; icon: typeof Users }> = [
    { key: "club", title: "Whole club", hint: "All club members", icon: Building2 },
    { key: "team", title: "One team", hint: "A single team", icon: Shield },
    { key: "selected", title: "Multiple teams", hint: "Two or more teams", icon: Users },
    ...(showCompetition
      ? [{ key: "competition" as Mode, title: "Competition", hint: "Teams in a competition", icon: Trophy }]
      : []),
  ];

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">Who's this event for?</Label>
      <div role="radiogroup" className="rounded-xl border border-border overflow-hidden divide-y divide-border">
        {options.map((o) => {
          const active = mode === o.key;
          const Icon = o.icon;
          return (
            <button
              key={o.key}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => pickMode(o.key)}
              className={cn(
                "flex w-full items-center gap-3 px-3 min-h-[52px] py-2 text-left transition-colors disabled:opacity-50",
                active ? "bg-primary/10" : "bg-card hover:bg-muted/40",
              )}
            >
              <span
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                  active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium text-foreground">{o.title}</span>
                <span className="block text-xs text-muted-foreground">{o.hint}</span>
              </span>
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
                  active ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40",
                )}
              >
                {active && <Check className="h-3 w-3" />}
              </span>
            </button>
          );
        })}
      </div>

      {mode === "team" && (
        <MobileCardSelect
          value={teamId}
          onValueChange={onTeamIdChange}
          options={teams?.map((t) => ({ value: t.id, label: t.name })) || []}
          placeholder="Select team"
          label="Team"
          disabled={disabled}
        />
      )}

      {mode === "selected" && (
        <div className="rounded-xl border border-border p-3 space-y-2">
          {(!checklistTeams || checklistTeams.length === 0) ? (
            <p className="text-xs text-muted-foreground">No teams available in this club.</p>
          ) : (
            <>
              {checklistTeams.length > 6 && (
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search teams"
                    className="pl-8 h-10"
                  />
                </div>
              )}
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{selected.length} selected</span>
                <button
                  type="button"
                  onClick={toggleAll}
                  disabled={disabled || filtered.length === 0}
                  className="font-medium text-primary py-1 px-1"
                >
                  {allFilteredSelected ? "Clear all" : "Select all"}
                </button>
              </div>
              <div className="max-h-64 overflow-y-auto -mx-1">
                {filtered.map((t) => (
                  <label
                    key={t.id}
                    className="flex items-center gap-3 rounded-md px-1 min-h-[40px] text-sm cursor-pointer hover:bg-muted/40"
                  >
                    <Checkbox
                      checked={selected.includes(t.id)}
                      onCheckedChange={() => toggle(t.id)}
                      disabled={disabled}
                    />
                    <span className="truncate">{t.name}</span>
                  </label>
                ))}
                {filtered.length === 0 && (
                  <p className="px-1 py-2 text-xs text-muted-foreground">No teams match.</p>
                )}
              </div>
            </>
          )}
          {selected.length < 2 && (
            <p className="text-xs text-muted-foreground">
              Pick at least 2 teams. For just one, choose "One team".
            </p>
          )}
        </div>
      )}

      {mode === "competition" && showCompetition && (
        <div className="space-y-1.5">
          <MobileCardSelect
            value={competitionId}
            onValueChange={(v) => onCompetitionIdChange!(v)}
            options={competitions!.map((c) => ({ value: c.id, label: c.name }))}
            placeholder="Select competition"
            label="Competition"
            disabled={disabled}
          />
          {competitionId && (
            <p className="text-xs text-muted-foreground">
              One event for the whole competition. Everyone on the {competitionTeamCount ?? 0} entered{" "}
              {competitionTeamCount === 1 ? "team" : "teams"} (and parents/guardians) is invited.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
