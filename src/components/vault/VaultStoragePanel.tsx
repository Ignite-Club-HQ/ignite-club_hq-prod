import type { ReactNode } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { ChevronDown, File, FileImage, FolderOpen, HardDrive, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { VaultStorageBarRow } from "@/components/vault/VaultStorageBarRow";
import type { VaultStorageBreakdown } from "@/features/vault/vaultStorageRepository";

interface VaultStoragePanelProps {
  storagePercentage: number;
  usageLabel: string;
  isStorageLimitReached: boolean;
  headerActions?: ReactNode;
  viewType: "club" | "team" | "other";
  currentTeamStorageUsed: number;
  totalClubStorageUsed: number;
  breakdown?: VaultStorageBreakdown;
  showLargeFilesAction: boolean;
  showStoragePurchaseAction: boolean;
  storagePurchaseLabel: "Buy Storage" | "Manage Storage";
  onManageLargeFiles: () => void;
  onManageStorage: () => void;
  formatSize: (bytes: number) => string;
}

export function VaultStoragePanel({
  storagePercentage,
  usageLabel,
  isStorageLimitReached,
  headerActions,
  viewType,
  currentTeamStorageUsed,
  totalClubStorageUsed,
  breakdown,
  showLargeFilesAction,
  showStoragePurchaseAction,
  storagePurchaseLabel,
  onManageLargeFiles,
  onManageStorage,
  formatSize,
}: VaultStoragePanelProps) {
  const chartData = [
    { name: "Photos", value: breakdown?.photos ?? 0, color: "hsl(var(--primary))" },
    { name: "Documents", value: breakdown?.documents ?? 0, color: "hsl(var(--muted-foreground))" },
  ].filter(({ value }) => value > 0);

  return (
    <Collapsible className="w-full">
      <div className="bg-card border rounded-lg p-3">
        <VaultStorageBarRow
          storagePercentage={storagePercentage}
          usageLabel={usageLabel}
          isStorageLimitReached={isStorageLimitReached}
          actions={headerActions}
        />

        <CollapsibleContent className="mt-3 pt-3 border-t">
          <div className="space-y-3">
            {viewType === "team" && currentTeamStorageUsed > 0 && (
              <div className="pb-3 border-b">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <span className="font-medium text-foreground">This Team</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-base font-semibold text-foreground">
                    {formatSize(currentTeamStorageUsed)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    ({Math.round((currentTeamStorageUsed / totalClubStorageUsed) * 100)}% of club storage)
                  </span>
                </div>
              </div>
            )}

            {chartData.length > 0 && (
              <div className="flex items-center gap-4">
                <div className="w-16 h-16" aria-hidden="true">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={chartData}
                        cx="50%"
                        cy="50%"
                        innerRadius={16}
                        outerRadius={28}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        {chartData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2 text-xs">
                    <div className="w-2 h-2 rounded-sm bg-primary shrink-0" />
                    <FileImage className="h-3 w-3 text-muted-foreground" />
                    <span className="text-muted-foreground">Photos</span>
                    <span className="ml-auto font-medium">{formatSize(breakdown?.photos ?? 0)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <div className="w-2 h-2 rounded-sm bg-muted-foreground shrink-0" />
                    <File className="h-3 w-3 text-muted-foreground" />
                    <span className="text-muted-foreground">Documents</span>
                    <span className="ml-auto font-medium">{formatSize(breakdown?.documents ?? 0)}</span>
                  </div>
                </div>
              </div>
            )}

            {viewType === "club" && Boolean(breakdown?.byTeam.length) && (
              <Collapsible className="pt-3 border-t">
                <CollapsibleTrigger className="flex items-center justify-between w-full text-xs font-medium text-muted-foreground hover:text-foreground transition-colors group">
                  <span>Storage by Team</span>
                  <ChevronDown className="h-3 w-3 transition-transform group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2 space-y-2">
                  {breakdown!.byTeam.slice(0, 5).map((team) => {
                    const percentage = totalClubStorageUsed > 0
                      ? Math.min(100, (team.size / totalClubStorageUsed) * 100)
                      : 0;
                    return (
                      <div key={team.teamId || "club"} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <FolderOpen className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span className="truncate">{team.teamName}</span>
                          </div>
                          <span className="text-muted-foreground shrink-0">
                            {formatSize(team.size)} ({Math.round(percentage)}%)
                          </span>
                        </div>
                        <Progress
                          value={percentage}
                          className="h-1.5 w-full bg-white dark:bg-muted [&>div]:bg-primary"
                        />
                      </div>
                    );
                  })}
                  {breakdown!.byTeam.length > 5 && (
                    <span className="text-xs text-muted-foreground">
                      +{breakdown!.byTeam.length - 5} more teams
                    </span>
                  )}
                </CollapsibleContent>
              </Collapsible>
            )}

            {(showLargeFilesAction || showStoragePurchaseAction) && (
              <div className="pt-3 border-t flex items-center gap-2">
                {showLargeFilesAction && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          onClick={onManageLargeFiles}
                          aria-label="Manage Large Files"
                        >
                          <HardDrive className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Manage Large Files</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                {showStoragePurchaseAction && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          onClick={onManageStorage}
                          aria-label={storagePurchaseLabel}
                        >
                          <ShoppingCart className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{storagePurchaseLabel}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
