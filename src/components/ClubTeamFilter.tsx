import { useState } from "react";
import { Check, ChevronDown, X, Building2, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Club {
  id: string;
  name: string;
  sport?: string | null;
}

interface Team {
  id: string;
  name: string;
  club_id?: string;
}

interface ClubTeamFilterProps {
  clubs: Club[];
  teams: Team[];
  selectedClubId: string;
  selectedTeamId: string;
  onClubChange: (clubId: string) => void;
  onTeamChange: (teamId: string) => void;
  showClubFilter?: boolean;
  showTeamFilter?: boolean;
  clubLabel?: string;
  teamLabel?: string;
  getSportEmoji?: (sport: string) => string;
}

export function ClubTeamFilter({
  clubs,
  teams,
  selectedClubId,
  selectedTeamId,
  onClubChange,
  onTeamChange,
  showClubFilter = true,
  showTeamFilter = true,
  clubLabel = "Club",
  teamLabel = "Team",
  getSportEmoji,
}: ClubTeamFilterProps) {
  const isMobile = useIsMobile();
  const [clubDrawerOpen, setClubDrawerOpen] = useState(false);
  const [teamDrawerOpen, setTeamDrawerOpen] = useState(false);

  const selectedClub = clubs.find((c) => c.id === selectedClubId);
  const selectedTeam = teams.find((t) => t.id === selectedTeamId);

  // Only show clear button if there are visible filters with active selections
  const showClubOption = showClubFilter && clubs.length > 1;
  const showTeamOption = showTeamFilter && teams.length > 0;
  const hasActiveFilters = (showClubOption && selectedClubId !== "all") || (showTeamOption && selectedTeamId !== "all");

  const handleClubSelect = (clubId: string) => {
    onClubChange(clubId);
    setClubDrawerOpen(false);
  };

  const handleTeamSelect = (teamId: string) => {
    onTeamChange(teamId);
    setTeamDrawerOpen(false);
  };

  const clearFilters = () => {
    onClubChange("all");
    onTeamChange("all");
  };

  // If no filters are visible, don't render anything
  if (!showClubOption && !showTeamOption) {
    return null;
  }

  if (isMobile) {
    return (
      <div className="flex flex-wrap gap-2">
        {/* Mobile Club Filter */}
        {showClubOption && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setClubDrawerOpen(true)}
              className={cn(
                "h-10 px-3 gap-2 rounded-full",
                selectedClubId !== "all" && "bg-primary/10 border-primary text-primary"
              )}
            >
              <Building2 className="h-4 w-4" />
              <span className="max-w-[100px] truncate">
                {selectedClub ? selectedClub.name : "All Clubs"}
              </span>
              <ChevronDown className="h-3 w-3" />
            </Button>

            <Drawer open={clubDrawerOpen} onOpenChange={setClubDrawerOpen}>
              <DrawerContent className="max-h-[85vh] flex flex-col overflow-hidden">
                <DrawerHeader className="text-left border-b shrink-0">
                  <DrawerTitle className="flex items-center gap-2">
                    <Building2 className="h-5 w-5" />
                    Select {clubLabel}
                  </DrawerTitle>
                </DrawerHeader>
                <ScrollArea className="flex-1 min-h-0">
                  <div className="p-4 space-y-2 pb-safe">
                    <button
                      type="button"
                      onClick={() => handleClubSelect("all")}
                      className={cn(
                        "w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all text-left",
                        "hover:bg-accent/50",
                        selectedClubId === "all"
                          ? "border-primary bg-primary/5"
                          : "border-border bg-card"
                      )}
                    >
                      <span className="text-base font-medium">All Clubs</span>
                      {selectedClubId === "all" && (
                        <Check className="h-5 w-5 text-primary" />
                      )}
                    </button>
                    {clubs.map((club) => (
                      <button
                        key={club.id}
                        type="button"
                        onClick={() => handleClubSelect(club.id)}
                        className={cn(
                          "w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all text-left",
                          "hover:bg-accent/50",
                          selectedClubId === club.id
                            ? "border-primary bg-primary/5"
                            : "border-border bg-card"
                        )}
                      >
                        <span className="text-base font-medium flex items-center gap-2">
                          {getSportEmoji && club.sport && (
                            <span>{getSportEmoji(club.sport)}</span>
                          )}
                          {club.name}
                        </span>
                        {selectedClubId === club.id && (
                          <Check className="h-5 w-5 text-primary" />
                        )}
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              </DrawerContent>
            </Drawer>
          </>
        )}

        {/* Mobile Team Filter */}
        {showTeamOption && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setTeamDrawerOpen(true)}
              className={cn(
                "h-10 px-3 gap-2 rounded-full",
                selectedTeamId !== "all" && "bg-primary/10 border-primary text-primary"
              )}
            >
              <Users className="h-4 w-4" />
              <span className="max-w-[100px] truncate">
                {selectedTeam ? selectedTeam.name : "All Teams"}
              </span>
              <ChevronDown className="h-3 w-3" />
            </Button>

            <Drawer open={teamDrawerOpen} onOpenChange={setTeamDrawerOpen}>
              <DrawerContent className="h-[85vh] max-h-[85vh] flex flex-col overflow-hidden">
                <DrawerHeader className="text-left border-b shrink-0">
                  <DrawerTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    Select {teamLabel}
                  </DrawerTitle>
                </DrawerHeader>
                <ScrollArea className="flex-1 min-h-0 overflow-y-auto">
                  <div className="p-4 space-y-2 pb-safe">
                    <button
                      type="button"
                      onClick={() => handleTeamSelect("all")}
                      className={cn(
                        "w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all text-left",
                        "hover:bg-accent/50",
                        selectedTeamId === "all"
                          ? "border-primary bg-primary/5"
                          : "border-border bg-card"
                      )}
                    >
                      <span className="text-base font-medium">All Teams</span>
                      {selectedTeamId === "all" && (
                        <Check className="h-5 w-5 text-primary" />
                      )}
                    </button>
                    {teams.map((team) => (
                      <button
                        key={team.id}
                        type="button"
                        onClick={() => handleTeamSelect(team.id)}
                        className={cn(
                          "w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all text-left",
                          "hover:bg-accent/50",
                          selectedTeamId === team.id
                            ? "border-primary bg-primary/5"
                            : "border-border bg-card"
                        )}
                      >
                        <span className="text-base font-medium">{team.name}</span>
                        {selectedTeamId === team.id && (
                          <Check className="h-5 w-5 text-primary" />
                        )}
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              </DrawerContent>
            </Drawer>
          </>
        )}

        {/* Clear button */}
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="h-10 px-3 rounded-full"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    );
  }

  // Desktop: Standard select dropdowns
  return (
    <div className="flex flex-wrap items-center gap-3">
      {showClubOption && (
        <Select value={selectedClubId} onValueChange={onClubChange}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Clubs" />
          </SelectTrigger>
          <SelectContent className="bg-popover z-[100]">
            <SelectItem value="all">All Clubs</SelectItem>
            {clubs.map((club) => (
              <SelectItem key={club.id} value={club.id}>
                {getSportEmoji && club.sport && getSportEmoji(club.sport)} {club.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {showTeamOption && (
        <Select value={selectedTeamId} onValueChange={onTeamChange}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Teams" />
          </SelectTrigger>
          <SelectContent className="bg-popover z-[100]">
            <SelectItem value="all">All Teams</SelectItem>
            {teams.map((team) => (
              <SelectItem key={team.id} value={team.id}>
                {team.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={clearFilters}>
          <X className="h-4 w-4 mr-1" /> Clear
        </Button>
      )}
    </div>
  );
}
