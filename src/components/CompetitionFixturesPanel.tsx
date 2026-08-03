import { FixtureList } from "@/features/competitions/fixtures/FixtureList";
import { FixtureRoundSection } from "@/features/competitions/fixtures/FixtureRoundSection";
import { FixtureMatchRow } from "@/features/competitions/fixtures/FixtureMatchRow";
import { FixtureMatchDetailsDialog } from "@/features/competitions/fixtures/FixtureMatchDetailsDialog";
import { SetMaxRoundsButton } from "@/features/competitions/fixtures/SetMaxRoundsButton";
import { CompetitionFixtureGenerator } from "@/features/competitions/fixtures/FixtureGenerator";
import { CompetitionLadderPanel as FeatureCompetitionLadderPanel } from "@/features/competitions/ladder/CompetitionLadder";
import type {
  CompetitionDivisionSummary,
  CompetitionEntrySummary,
  CompetitionFixtureRow,
} from "@/features/competitions/fixtures/types";

interface Props {
  competitionId: string;
  isAdmin: boolean;
  divisions: CompetitionDivisionSummary[];
  entries: CompetitionEntrySummary[];
  source?: string;
}

export function CompetitionFixturesPanel({
  competitionId,
  isAdmin,
  divisions,
  entries,
  source,
}: Props) {
  return (
    <CompetitionFixtureGenerator
      competitionId={competitionId}
      isAdmin={isAdmin}
      divisions={divisions}
      entries={entries}
      source={source}
      renderFixtureList={(matches) => (
        <FixturesFilterAndList
          matches={matches}
          divisions={divisions}
          entries={entries}
          isAdmin={isAdmin}
          competitionId={competitionId}
          source={source}
        />
      )}
    />
  );
}



function FixturesFilterAndList({
  matches,
  divisions,
  entries,
  isAdmin,
  competitionId,
  source,
}: {
  matches: CompetitionFixtureRow[];
  divisions: CompetitionDivisionSummary[];
  entries: CompetitionEntrySummary[];
  isAdmin: boolean;
  competitionId: string;
  source?: string;
}) {
  return (
    <FixtureList
      matches={matches}
      divisions={divisions}
      isAdmin={isAdmin}
      competitionId={competitionId}
      source={source}
      renderSummaryAction={({ roundNumbers, maximumRound }) => (
        <SetMaxRoundsButton
          competitionId={competitionId}
          currentMax={maximumRound}
          roundNums={roundNumbers}
        />
      )}
      renderRound={(group) => (
        <RoundSection
          key={group.key}
          label={group.label}
          items={group.items}
          isAdmin={isAdmin}
          competitionId={competitionId}
          entries={entries}
          divisions={divisions}
          source={source}
        />
      )}
    />
  );
}



function RoundSection({
  label,
  items,
  isAdmin,
  competitionId,
  entries,
  divisions,
  source,
}: {
  label: string;
  items: CompetitionFixtureRow[];
  isAdmin: boolean;
  competitionId: string;
  entries: CompetitionEntrySummary[];
  divisions: CompetitionDivisionSummary[];
  source?: string;
}) {
  return (
    <FixtureRoundSection
      label={label}
      items={items}
      renderMatch={(match) => (
        <MatchRow
          key={match.id}
          match={match}
          isAdmin={isAdmin}
          competitionId={competitionId}
          entries={entries}
          divisions={divisions}
          source={source}
          hideRoundBadge
        />
      )}
    />
  );
}


function MatchRow({
  match,
  isAdmin,
  competitionId,
  entries,
  divisions,
  source,
}: {
  match: CompetitionFixtureRow;
  isAdmin: boolean;
  competitionId: string;
  entries: CompetitionEntrySummary[];
  divisions: CompetitionDivisionSummary[];
  hideRoundBadge?: boolean;
  source?: string;
}) {
  return (
    <FixtureMatchRow
      match={match}
      isAdmin={isAdmin}
      competitionId={competitionId}
      source={source}
      renderEditDetails={({ open, onOpenChange }) => (
        <FixtureMatchDetailsDialog
          open={open}
          onOpenChange={onOpenChange}
          match={match}
          competitionId={competitionId}
          entries={entries}
          divisions={divisions}
        />
      )}
    />
  );
}






export function CompetitionLadderPanel({ competitionId, divisions, isAdmin = false }: { competitionId: string; divisions: CompetitionDivisionSummary[]; isAdmin?: boolean }) {
  return <FeatureCompetitionLadderPanel competitionId={competitionId} divisions={divisions} isAdmin={isAdmin} />;
}
