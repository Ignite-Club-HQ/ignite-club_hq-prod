import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2, FlaskConical } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { withFeatureBackend } from "@/live/featureRouter";
import { writeOnce } from "@/live/clubScope";
import { isFeatureRoutedToIcp } from "@/live/loadBackendRouting";
import { normaliseTestPlayer, TEST_PLAYER_POSITIONS, type TestPlayerRow } from "@/lib/testPlayers";

export const testPlayersQueryKey = (teamId: string) => ["team-test-players", teamId] as const;

/** Test players for a team on the secure sign-in service; empty elsewhere. */
export function useTeamTestPlayers(clubId: string | null | undefined, teamId: string | null | undefined, enabled = true) {
  const icp = isFeatureRoutedToIcp("events");
  return useQuery({
    queryKey: testPlayersQueryKey(teamId ?? ""),
    enabled: icp && enabled && !!clubId && !!teamId,
    staleTime: 30_000,
    queryFn: () => withFeatureBackend("events", {
      supabase: async () => [] as TestPlayerRow[],
      icp: async (ctx) => {
        const { listLiveTestPlayers } = await import("@/live/features/events");
        const rows = await listLiveTestPlayers(ctx, clubId!, teamId!);
        return (rows as unknown[]).map(normaliseTestPlayer);
      },
    }, { teamId: teamId! }),
  });
}

export function TeamTestPlayersCard({ clubId, teamId }: { clubId: string; teamId: string }) {
  const qc = useQueryClient();
  const { data: players = [], isLoading } = useTeamTestPlayers(clubId, teamId);
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [positions, setPositions] = useState<string[]>([]);

  const refresh = () => qc.invalidateQueries({ queryKey: testPlayersQueryKey(teamId) });

  const add = useMutation({
    mutationFn: () => withFeatureBackend("events", {
      supabase: async () => { throw new Error("Test players need secure sign-in"); },
      icp: async (ctx) => {
        const { createLiveTestPlayer } = await import("@/live/features/events");
        const n = number.trim() === "" ? null : Number(number);
        return createLiveTestPlayer(ctx, clubId, teamId, { name: name.trim(), shirtNumber: n, positions });
      },
    }, writeOnce({ teamId })),
    onSuccess: () => { setName(""); setNumber(""); setPositions([]); refresh(); },
    onError: (e) => {
      console.error("create test player", e);
      toast({ title: "Couldn't add test player", description: "Check the name isn't already used, then try again.", variant: "destructive" });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => withFeatureBackend("events", {
      supabase: async () => { throw new Error("Test players need secure sign-in"); },
      icp: async (ctx) => {
        const { deleteLiveTestPlayer } = await import("@/live/features/events");
        return deleteLiveTestPlayer(ctx, id);
      },
    }, writeOnce({ teamId })),
    onSuccess: refresh,
    onError: (e) => {
      console.error("delete test player", e);
      toast({ title: "Couldn't remove test player", description: "Please try again.", variant: "destructive" });
    },
  });

  const validNumber = number.trim() === "" || (/^\d{1,3}$/.test(number.trim()));

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-semibold">Test players</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Made-up players for trying the Pitch Board. They have no login or parent. Don't use real names.
        </p>
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
          <ul className="space-y-1">
            {players.map((p) => (
              <li key={p.id} className="flex items-center justify-between text-sm">
                <span>{p.shirt_number != null ? `#${p.shirt_number} ` : ""}{p.name}{p.positions.length ? ` · ${p.positions.join(", ")}` : ""}</span>
                <Button size="icon" variant="ghost" aria-label={`Remove ${p.name}`} disabled={remove.isPending} onClick={() => remove.mutate(p.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
            {players.length === 0 && <li className="text-sm text-muted-foreground">No test players yet.</li>}
          </ul>
        )}
        <div className="grid grid-cols-[1fr_5rem] gap-2">
          <div><Label htmlFor="tp-name">Name</Label><Input id="tp-name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><Label htmlFor="tp-num">Number</Label><Input id="tp-num" inputMode="numeric" value={number} onChange={(e) => setNumber(e.target.value)} /></div>
        </div>
        <div className="flex flex-wrap gap-2">
          {TEST_PLAYER_POSITIONS.map((pos) => (
            <Button key={pos} type="button" size="sm" variant={positions.includes(pos) ? "default" : "outline"}
              onClick={() => setPositions((cur) => cur.includes(pos) ? cur.filter((x) => x !== pos) : [...cur, pos])}>
              {pos}
            </Button>
          ))}
        </div>
        <Button disabled={!name.trim() || !validNumber || add.isPending} onClick={() => add.mutate()}>
          {add.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Add test player
        </Button>
      </CardContent>
    </Card>
  );
}
