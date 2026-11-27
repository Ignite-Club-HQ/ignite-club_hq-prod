import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { icpListMyAdminClubs, isIcpSession } from "@/lib/icpClubTeamLookup";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** App-admin tool: create a synthetic club with teams, events, chats and photos (ICP mode). */
export function SeedTestDataCard() {
  const qc = useQueryClient();
  const [clubName, setClubName] = useState("Test Club");
  const [perTeam, setPerTeam] = useState(300);
  const [clubMsgs, setClubMsgs] = useState(100);
  const [photos, setPhotos] = useState(12);
  const [running, setRunning] = useState(false);
  const [demoProgress, setDemoProgress] = useState<{done:number,total:number}|null>(null);
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null);
  const [clubs, setClubs] = useState<Array<{ id: string; name: string }>>([]);
  const [fillClubId, setFillClubId] = useState<string>("");

  useEffect(() => {
    if (!isIcpSession()) return;
    icpListMyAdminClubs()
      .then((list) => {
        setClubs(list);
        const rd = list.find((c) => /riverdogs/i.test(c.name));
        if (rd) setFillClubId(rd.id);
      })
      .catch(() => setClubs([]));
  }, []);

  if (!isIcpSession()) return null;

  const fillVirtuosoDemo = async () => {
    if (!window.confirm("Add sample messages ONLY to the demo club's chats you belong to until each contains at least 150 messages?")) return;
    setRunning(true);
    setDemoProgress({done:0,total:1});
    try {
      const { fillDemoVirtuosoChats } = await import("@/live/fillDemoVirtuosoChats");
      await fillDemoVirtuosoChats((done,total)=>setDemoProgress({done,total}));
      qc.invalidateQueries();
      toast.success("Demo club chats now have at least 150 messages each");
    } catch(e) {
      toast.error(e instanceof Error ? e.message : "Demo chat seeding stopped", {duration:15000});
    } finally {
      setRunning(false);
    }
  };

  const fillExisting = async () => {
    if (!fillClubId) return;
    setRunning(true);
    try {
      const { seedIcpTestData } = await import("@/live/seedIcpTestData");
      const res = await seedIcpTestData({
        clubName: clubs.find((c) => c.id === fillClubId)?.name ?? "Club",
        existingClubId: fillClubId,
        messagesPerTeamChat: 20,
        clubChatMessages: 20,
        photos: 10,
        files: 6,
        onProgress: (label, done, total) => setProgress({ label, done, total }),
      });
      qc.invalidateQueries();
      if (res.failures.length) {
        toast.warning(`${res.summary}. ${res.failures.length} problems — first: ${res.failures[0]}`, { duration: 20000 });
      } else {
        toast.success(res.summary);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add demo content");
    } finally {
      setRunning(false);
    }
  };

  const run = async () => {
    setRunning(true);
    try {
      const { seedIcpTestData } = await import("@/live/seedIcpTestData");
      await seedIcpTestData({
        clubName: clubName.trim() || "Test Club",
        messagesPerTeamChat: Math.min(Math.max(perTeam, 0), 2000),
        clubChatMessages: Math.min(Math.max(clubMsgs, 0), 2000),
        photos: Math.min(Math.max(photos, 0), 50),
        onProgress: (label, done, total) => setProgress({ label, done, total }),
      });
      qc.invalidateQueries();
      toast.success("Test club created — check Home, Messages, Schedule and Media");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create test data");
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Test data</CardTitle>
        <CardDescription>
          Creates a new club with 3 teams, a month of events, long chat histories and sample photos, all under your account. Keep this page open while it runs.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2 rounded-md border border-border p-3">
          <Label>Virtuoso scrolling test — demo club only</Label>
          <p className="text-sm text-muted-foreground">
            Add fictional chat messages to the nine existing demo conversations until each has at least 150 messages.
            Uses your current signed-in ICP identity. Does not create clubs, teams or events.
          </p>
          <Button type="button" disabled={running} onClick={fillVirtuosoDemo}>
            {running && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Fill demo chats to 150 messages
          </Button>
          {demoProgress && <p className="text-sm text-muted-foreground">Sent {demoProgress.done} of up to {demoProgress.total} messages</p>}
        </div>
        <div className="space-y-2 rounded-md border border-border p-3">
          <Label>Fill with demo content</Label>
          <p className="text-sm text-muted-foreground">
            Adds 2 teams with a month of games and trainings, about 60 chat messages across 3 chats, plus a poll (with a vote), a chat image and an event link in each chat, 10 gallery photos and 6 vault files to a club you manage.
          </p>
          <Select value={fillClubId} onValueChange={setFillClubId} disabled={running}>
            <SelectTrigger><SelectValue placeholder={clubs.length ? "Choose a club" : "Loading your clubs…"} /></SelectTrigger>
            <SelectContent>
              {clubs.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={fillExisting} disabled={running || !fillClubId}>
            {running && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Fill with demo content
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1">
            <Label htmlFor="seed-club">Club name</Label>
            <Input id="seed-club" value={clubName} onChange={(e) => setClubName(e.target.value)} disabled={running} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="seed-team">Messages per team chat</Label>
            <Input id="seed-team" type="number" value={perTeam} onChange={(e) => setPerTeam(+e.target.value)} disabled={running} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="seed-club-msgs">Club chat messages</Label>
            <Input id="seed-club-msgs" type="number" value={clubMsgs} onChange={(e) => setClubMsgs(+e.target.value)} disabled={running} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="seed-photos">Photos</Label>
            <Input id="seed-photos" type="number" value={photos} onChange={(e) => setPhotos(+e.target.value)} disabled={running} />
          </div>
        </div>
        {progress && (
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">{progress.label} {progress.total > 1 ? `(${progress.done}/${progress.total})` : ""}</p>
            <Progress value={(progress.done / Math.max(progress.total, 1)) * 100} />
          </div>
        )}
        <Button onClick={run} disabled={running}>
          {running && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Create test club
        </Button>
      </CardContent>
    </Card>
  );
}
