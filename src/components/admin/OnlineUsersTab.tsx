import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Users, RefreshCw, Smartphone, Globe } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";

type WindowMinutes = 2 | 5 | 15 | 60;

export default function OnlineUsersTab() {
  const [windowMinutes, setWindowMinutes] = useState<WindowMinutes>(5);
  const [search, setSearch] = useState("");
  const [now, setNow] = useState(() => Date.now());

  // Tick every 15s so "X seconds ago" stays fresh.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["admin-online-users", windowMinutes],
    queryFn: async () => {
      const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
      const { data: presence, error } = await supabase
        .from("user_presence" as any)
        .select("user_id, last_seen_at, platform, user_agent")
        .gte("last_seen_at", cutoff)
        .order("last_seen_at", { ascending: false });

      if (error) throw error;
      const rows = (presence as any[]) || [];

      const userIds = [...new Set(rows.map((r) => r.user_id))];
      if (userIds.length === 0) return [];

      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url, email")
        .in("id", userIds);

      const profileMap: Record<string, any> = {};
      (profiles || []).forEach((p: any) => {
        profileMap[p.id] = p;
      });

      return rows.map((r) => ({
        userId: r.user_id,
        lastSeenAt: r.last_seen_at,
        platform: r.platform || "unknown",
        displayName: profileMap[r.user_id]?.display_name || "Unknown User",
        email: profileMap[r.user_id]?.email || null,
        avatarUrl: profileMap[r.user_id]?.avatar_url || null,
      }));
    },
    refetchInterval: 30_000,
  });

  const filtered = (data || []).filter((u) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      u.displayName.toLowerCase().includes(q) ||
      (u.email && u.email.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{isLoading ? "–" : data?.length || 0}</p>
              <p className="text-xs text-muted-foreground">Online now ({windowMinutes}m)</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Smartphone className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">
                {isLoading ? "–" : (data || []).filter((u) => u.platform === "ios" || u.platform === "android").length}
              </p>
              <p className="text-xs text-muted-foreground">Native</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Globe className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">
                {isLoading ? "–" : (data || []).filter((u) => u.platform === "web").length}
              </p>
              <p className="text-xs text-muted-foreground">Web</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <Select
          value={String(windowMinutes)}
          onValueChange={(v) => setWindowMinutes(Number(v) as WindowMinutes)}
        >
          <SelectTrigger className="w-[160px] h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="2">Active &lt; 2 min</SelectItem>
            <SelectItem value="5">Active &lt; 5 min</SelectItem>
            <SelectItem value="15">Active &lt; 15 min</SelectItem>
            <SelectItem value="60">Active &lt; 1 hour</SelectItem>
          </SelectContent>
        </Select>

        <Input
          placeholder="Search users..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[180px] h-9 text-sm"
        />

        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="gap-1.5"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <Users className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p className="font-medium">No users online in this window</p>
            <p className="text-sm mt-1">
              Heartbeats are sent every 25 seconds while the app is open.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead className="text-right">Last seen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((u) => {
                  const seenMs = now - new Date(u.lastSeenAt).getTime();
                  const isLive = seenMs < 90_000;
                  return (
                    <TableRow key={u.userId}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="relative">
                            <Avatar className="h-8 w-8">
                              <AvatarImage src={u.avatarUrl || undefined} />
                              <AvatarFallback className="text-xs">
                                {u.displayName.charAt(0).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                              <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-success ring-2 ring-background" style={{ backgroundColor: "hsl(142 71% 45%)" }} />

                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-sm truncate max-w-[180px]">
                              {u.displayName}
                            </p>
                            {u.email && (
                              <p className="text-xs text-muted-foreground truncate max-w-[180px]">
                                {u.email}
                              </p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-[10px] capitalize">
                          {u.platform}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground whitespace-nowrap">
                        {formatDistanceToNow(new Date(u.lastSeenAt), { addSuffix: true })}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
}
