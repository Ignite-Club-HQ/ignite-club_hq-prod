import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Navigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Bell, 
  CheckCircle, 
  XCircle, 
  AlertCircle, 
  Clock, 
  RefreshCw,
  Trash2,
  TrendingUp,
  TrendingDown,
  Users
} from "lucide-react";
import { format, subDays, startOfDay, endOfDay } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";

interface LogEntry {
  id: string;
  status: string;
  status_code: number | null;
  created_at: string;
  endpoint: string;
  error_message: string | null;
}

interface DailyStats {
  date: string;
  sent: number;
  failed: number;
  expired: number;
  skipped: number;
  total: number;
}

const STATUS_COLORS: Record<string, string> = {
  sent: 'hsl(142.1 76.2% 36.3%)', // green-600
  failed: 'hsl(0 84.2% 60.2%)', // red-500
  expired: 'hsl(47.9 95.8% 53.1%)', // yellow-500
  skipped: 'hsl(var(--muted-foreground))',
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  sent: <CheckCircle className="h-4 w-4 text-green-500" />,
  failed: <XCircle className="h-4 w-4 text-destructive" />,
  expired: <AlertCircle className="h-4 w-4 text-yellow-500" />,
  skipped: <Clock className="h-4 w-4 text-muted-foreground" />,
};

export default function PushAnalyticsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [timeRange, setTimeRange] = useState("7");
  const [isCleaningUp, setIsCleaningUp] = useState(false);

  // Check if user is admin
  const { data: isAdmin } = useQuery({
    queryKey: ["is-admin", user?.id],
    queryFn: async () => {
      if (!user) return false;
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "app_admin")
        .maybeSingle();
      return !!data;
    },
    enabled: !!user,
  });

  // Fetch push notification logs
  const { data: logs, isLoading: logsLoading, refetch: refetchLogs } = useQuery({
    queryKey: ["push-logs", timeRange],
    queryFn: async () => {
      const startDate = startOfDay(subDays(new Date(), parseInt(timeRange)));
      const { data, error } = await supabase
        .from("push_notification_logs")
        .select("*")
        .gte("created_at", startDate.toISOString())
        .order("created_at", { ascending: false })
        .limit(1000);

      if (error) throw error;
      return data as LogEntry[];
    },
    enabled: isAdmin === true,
  });

  // Fetch subscription count
  const { data: subscriptionCount } = useQuery({
    queryKey: ["push-subscription-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("push_subscriptions")
        .select("*", { count: "exact", head: true });

      if (error) throw error;
      return count || 0;
    },
    enabled: isAdmin === true,
  });

  // Calculate stats
  const stats = logs ? {
    total: logs.length,
    sent: logs.filter(l => l.status === 'sent').length,
    failed: logs.filter(l => l.status === 'failed').length,
    expired: logs.filter(l => l.status === 'expired').length,
    skipped: logs.filter(l => l.status === 'skipped').length,
  } : { total: 0, sent: 0, failed: 0, expired: 0, skipped: 0 };

  const successRate = stats.total > 0 
    ? Math.round((stats.sent / stats.total) * 100) 
    : 0;

  // Group logs by day for chart
  const dailyStats: DailyStats[] = logs ? (() => {
    const dayMap = new Map<string, DailyStats>();
    
    for (const log of logs) {
      const date = format(new Date(log.created_at), 'MMM dd');
      const existing = dayMap.get(date) || { date, sent: 0, failed: 0, expired: 0, skipped: 0, total: 0 };
      existing[log.status as keyof Omit<DailyStats, 'date' | 'total'>]++;
      existing.total++;
      dayMap.set(date, existing);
    }

    return Array.from(dayMap.values()).reverse();
  })() : [];

  // Pie chart data
  const pieData = [
    { name: 'Sent', value: stats.sent, color: STATUS_COLORS.sent },
    { name: 'Failed', value: stats.failed, color: STATUS_COLORS.failed },
    { name: 'Expired', value: stats.expired, color: STATUS_COLORS.expired },
    { name: 'Skipped', value: stats.skipped, color: STATUS_COLORS.skipped },
  ].filter(d => d.value > 0);

  // Run cleanup
  const handleCleanup = async () => {
    setIsCleaningUp(true);
    try {
      const { data, error } = await supabase.functions.invoke('cleanup-push-subscriptions');
      
      if (error) throw error;
      
      toast({
        title: "Cleanup Complete",
        description: `Removed ${data.subscriptions_removed} stale subscriptions`,
      });
      
      refetchLogs();
    } catch (error: any) {
      toast({
        title: "Cleanup Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsCleaningUp(false);
    }
  };

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (isAdmin === false) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="container max-w-6xl py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
              <Bell className="h-6 w-6" />
              Push Notification Analytics
            </h1>
            <p className="text-muted-foreground">
              Monitor push notification delivery performance
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Last 24 hours</SelectItem>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="14">Last 14 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={() => refetchLogs()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Notifications</CardDescription>
              <CardTitle className="text-3xl">
                {logsLoading ? <Skeleton className="h-9 w-20" /> : stats.total.toLocaleString()}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Last {timeRange} day{timeRange !== "1" ? "s" : ""}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Success Rate</CardDescription>
              <CardTitle className="text-3xl flex items-center gap-2">
                {logsLoading ? (
                  <Skeleton className="h-9 w-20" />
                ) : (
                  <>
                    {successRate}%
                    {successRate >= 90 ? (
                      <TrendingUp className="h-5 w-5 text-green-500" />
                    ) : successRate >= 70 ? (
                      <TrendingUp className="h-5 w-5 text-yellow-500" />
                    ) : (
                      <TrendingDown className="h-5 w-5 text-destructive" />
                    )}
                  </>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Progress value={successRate} className="h-2" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Active Subscriptions</CardDescription>
              <CardTitle className="text-3xl flex items-center gap-2">
                {subscriptionCount !== undefined ? (
                  <>
                    {subscriptionCount}
                    <Users className="h-5 w-5 text-muted-foreground" />
                  </>
                ) : (
                  <Skeleton className="h-9 w-20" />
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Registered devices
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Failed Deliveries</CardDescription>
              <CardTitle className="text-3xl text-destructive">
                {logsLoading ? <Skeleton className="h-9 w-20" /> : stats.failed}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleCleanup}
                disabled={isCleaningUp}
              >
                {isCleaningUp ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-2" />
                )}
                Cleanup Stale
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Charts */}
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Bar Chart */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Daily Delivery Stats</CardTitle>
            </CardHeader>
            <CardContent>
              {logsLoading ? (
                <Skeleton className="h-[300px] w-full" />
              ) : dailyStats.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={dailyStats}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis 
                      dataKey="date" 
                      tick={{ fontSize: 12 }}
                      className="fill-muted-foreground"
                    />
                    <YAxis 
                      tick={{ fontSize: 12 }}
                      className="fill-muted-foreground"
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px'
                      }}
                    />
                    <Bar dataKey="sent" name="Sent" fill={STATUS_COLORS.sent} stackId="a" />
                    <Bar dataKey="failed" name="Failed" fill={STATUS_COLORS.failed} stackId="a" />
                    <Bar dataKey="expired" name="Expired" fill={STATUS_COLORS.expired} stackId="a" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                  No data available
                </div>
              )}
            </CardContent>
          </Card>

          {/* Pie Chart */}
          <Card>
            <CardHeader>
              <CardTitle>Status Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              {logsLoading ? (
                <Skeleton className="h-[300px] w-full" />
              ) : pieData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Legend />
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                  No data available
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Status Legend */}
        <Card>
          <CardHeader>
            <CardTitle>Status Legend</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex items-center gap-2">
                {STATUS_ICONS.sent}
                <span className="font-medium">Sent</span>
                <span className="text-muted-foreground text-sm">
                  - Successfully delivered to push service
                </span>
              </div>
              <div className="flex items-center gap-2">
                {STATUS_ICONS.failed}
                <span className="font-medium">Failed</span>
                <span className="text-muted-foreground text-sm">
                  - Push service rejected the notification
                </span>
              </div>
              <div className="flex items-center gap-2">
                {STATUS_ICONS.expired}
                <span className="font-medium">Expired</span>
                <span className="text-muted-foreground text-sm">
                  - Subscription no longer valid (410/404)
                </span>
              </div>
              <div className="flex items-center gap-2">
                {STATUS_ICONS.skipped}
                <span className="font-medium">Skipped</span>
                <span className="text-muted-foreground text-sm">
                  - Invalid subscription data
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Recent Logs */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Delivery Logs</CardTitle>
            <CardDescription>Last 50 push notification attempts</CardDescription>
          </CardHeader>
          <CardContent>
            {logsLoading ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : logs && logs.length > 0 ? (
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {logs.slice(0, 50).map((log) => (
                  <div 
                    key={log.id} 
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                  >
                    <div className="flex items-center gap-3">
                      {STATUS_ICONS[log.status]}
                      <div>
                        <p className="text-sm font-medium">
                          {log.endpoint.substring(0, 50)}...
                        </p>
                        {log.error_message && (
                          <p className="text-xs text-muted-foreground">
                            {log.error_message}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {log.status_code && (
                        <Badge variant={log.status_code >= 200 && log.status_code < 300 ? "default" : "destructive"}>
                          {log.status_code}
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(log.created_at), 'MMM dd HH:mm')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                No logs available for this time period
              </div>
            )}
          </CardContent>
        </Card>
      </div>
  );
}
