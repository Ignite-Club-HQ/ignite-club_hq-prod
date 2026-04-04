import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ArrowLeft, Send, Filter, Users, CheckSquare, Square, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PageLoading } from "@/components/ui/page-loading";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface UserWithVersion {
  userId: string;
  name: string;
  platform: string;
  appVersion: string | null;
  buildNumber: string | null;
}

export default function SendUpdateReminderPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [selectedClubId, setSelectedClubId] = useState<string>("all");
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [selectedVersions, setSelectedVersions] = useState<Set<string>>(new Set());
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());

  // Check app_admin
  const { data: isAppAdmin, isLoading: adminLoading } = useQuery({
    queryKey: ["is-app-admin", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .eq("role", "app_admin")
        .maybeSingle();
      return !!data;
    },
    enabled: !!user?.id,
  });

  // Fetch clubs
  const { data: clubs } = useQuery({
    queryKey: ["admin-clubs-list"],
    queryFn: async () => {
      const { data } = await supabase
        .from("clubs")
        .select("id, name")
        .order("name");
      return data || [];
    },
    enabled: isAppAdmin === true,
  });

  // Fetch users via edge function (bypasses RLS on fcm_tokens)
  const { data: usersWithVersions, isLoading: usersLoading } = useQuery({
    queryKey: ["admin-users-fcm", selectedClubId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("send-update-reminder", {
        body: { action: "list-users", clubId: selectedClubId },
      });
      if (error) throw error;
      return (data?.users || []) as UserWithVersion[];
    },
    enabled: isAppAdmin === true,
  });

  // Compute latest versions per platform
  const latestVersions = useMemo(() => {
    if (!usersWithVersions) return { ios: null as string | null, android: null as string | null };
    let latestIos: string | null = null;
    let latestAndroid: string | null = null;
    for (const u of usersWithVersions) {
      if (!u.appVersion) continue;
      if (u.platform === 'ios') {
        if (!latestIos || u.appVersion.localeCompare(latestIos, undefined, { numeric: true }) > 0) {
          latestIos = u.appVersion;
        }
      } else if (u.platform === 'android') {
        if (!latestAndroid || u.appVersion.localeCompare(latestAndroid, undefined, { numeric: true }) > 0) {
          latestAndroid = u.appVersion;
        }
      }
    }
    return { ios: latestIos, android: latestAndroid };
  }, [usersWithVersions]);

  // Platform-filtered users
  const platformFilteredUsers = useMemo(() => {
    if (!usersWithVersions) return [];
    if (platformFilter === "all") return usersWithVersions;
    return usersWithVersions.filter(u => u.platform === platformFilter);
  }, [usersWithVersions, platformFilter]);

  // Get unique versions for filter dropdown (scoped to platform filter)
  const versions = useMemo(() => {
    const vSet = new Set<string>();
    platformFilteredUsers.forEach(u => {
      vSet.add(u.appVersion || "null");
    });
    return Array.from(vSet).sort((a, b) => {
      if (a === "null") return 1;
      if (b === "null") return -1;
      return a.localeCompare(b, undefined, { numeric: true });
    });
  }, [platformFilteredUsers]);

  // Filtered users (platform + version)
  const filteredUsers = useMemo(() => {
    if (selectedVersions.size === 0) return platformFilteredUsers;
    return platformFilteredUsers.filter(u => {
      const v = u.appVersion || "null";
      return selectedVersions.has(v);
    });
  }, [platformFilteredUsers, selectedVersions]);

  // Select all / none
  const toggleSelectAll = () => {
    if (selectedUserIds.size === filteredUsers.length) {
      setSelectedUserIds(new Set());
    } else {
      setSelectedUserIds(new Set(filteredUsers.map(u => u.userId)));
    }
  };

  const toggleUser = (userId: string) => {
    const next = new Set(selectedUserIds);
    if (next.has(userId)) next.delete(userId);
    else next.add(userId);
    setSelectedUserIds(next);
  };

  // Send mutation
  const sendMutation = useMutation({
    mutationFn: async (userIds: string[]) => {
      const { data, error } = await supabase.functions.invoke("send-update-reminder", {
        body: { userIds },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(data.message || "Notifications sent!");
      setSelectedUserIds(new Set());
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to send notifications");
    },
  });

  const resetFilters = () => {
    setSelectedUserIds(new Set());
  };

  if (adminLoading) return <PageLoading />;
  if (!isAppAdmin) {
    return (
      <div className="py-6 space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">Access Denied</h1>
        </div>
        <p className="text-muted-foreground">App admin role required.</p>
      </div>
    );
  }

  return (
    <div className="py-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Send Update Reminder</h1>
          <p className="text-sm text-muted-foreground">
            Notify native app users to update their app
          </p>
        </div>
      </div>

      {/* Latest versions summary */}
      {(latestVersions.ios || latestVersions.android) && (
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs font-medium text-muted-foreground mb-2">Latest Detected Versions</p>
            <div className="flex items-center gap-3">
              {latestVersions.ios && (
                <Badge variant="outline" className="text-xs gap-1">
                  <Smartphone className="h-3 w-3" />
                  iOS: {latestVersions.ios}
                </Badge>
              )}
              {latestVersions.android && (
                <Badge variant="outline" className="text-xs gap-1">
                  <Smartphone className="h-3 w-3" />
                  Android: {latestVersions.android}
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Club</label>
              <Select value={selectedClubId} onValueChange={(v) => {
                setSelectedClubId(v);
                resetFilters();
              }}>
                <SelectTrigger>
                  <SelectValue placeholder="All clubs" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All clubs</SelectItem>
                  {clubs?.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Platform</label>
              <Select value={platformFilter} onValueChange={(v) => {
                setPlatformFilter(v);
                setVersionFilter("all");
                resetFilters();
              }}>
                <SelectTrigger>
                  <SelectValue placeholder="All platforms" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All platforms</SelectItem>
                  <SelectItem value="ios">iOS</SelectItem>
                  <SelectItem value="android">Android</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">App Version</label>
              <Select value={versionFilter} onValueChange={(v) => {
                setVersionFilter(v);
                resetFilters();
              }}>
                <SelectTrigger>
                  <SelectValue placeholder="All versions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All versions</SelectItem>
                  {versions.map(v => (
                    <SelectItem key={v} value={v}>
                      {v === "null" ? "No version (not tracked)" : v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Users list */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="h-5 w-5" />
                Users ({filteredUsers.length})
              </CardTitle>
              <CardDescription>
                {selectedUserIds.size} selected
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={toggleSelectAll}>
                {selectedUserIds.size === filteredUsers.length && filteredUsers.length > 0 ? (
                  <><Square className="h-4 w-4 mr-1" /> Deselect All</>
                ) : (
                  <><CheckSquare className="h-4 w-4 mr-1" /> Select All</>
                )}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {usersLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading users...</div>
          ) : filteredUsers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No native app users found with current filters
            </div>
          ) : (
            <ScrollArea className="h-[400px]">
              <div className="space-y-1">
                {filteredUsers.map(u => (
                  <div
                    key={u.userId}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted cursor-pointer transition-colors"
                    onClick={() => toggleUser(u.userId)}
                  >
                    <Checkbox
                      checked={selectedUserIds.has(u.userId)}
                      onCheckedChange={() => toggleUser(u.userId)}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{u.name}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          <Smartphone className="h-2.5 w-2.5 mr-0.5" />
                          {u.platform === 'ios' ? 'iOS' : u.platform === 'android' ? 'Android' : 'None'}
                        </Badge>
                        <Badge variant={u.appVersion ? "secondary" : "destructive"} className="text-[10px] px-1.5 py-0">
                          {u.appVersion || "No version"}
                        </Badge>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Send button */}
      <Button
        className="w-full"
        size="lg"
        disabled={selectedUserIds.size === 0 || sendMutation.isPending}
        onClick={() => sendMutation.mutate(Array.from(selectedUserIds))}
      >
        <Send className="h-5 w-5 mr-2" />
        {sendMutation.isPending
          ? "Sending..."
          : `Send Update Reminder to ${selectedUserIds.size} user${selectedUserIds.size !== 1 ? "s" : ""}`}
      </Button>
    </div>
  );
}
