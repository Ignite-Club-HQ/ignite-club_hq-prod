import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, TrendingUp, Users, MessageSquare, CalendarCheck, Eye, UserPlus } from "lucide-react";
import { useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  BarChart,
  Bar,
} from "recharts";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { PageLoading } from "@/components/ui/page-loading";

type DauRow = { day: string; dau: number; wau: number; mau: number };
type ActivityRow = {
  day: string;
  messages: number;
  rsvps: number;
  event_views: number;
  new_users: number;
};

const RANGE_OPTIONS = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

export default function AdminEngagementPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [days, setDays] = useState(30);

  const { data: isAppAdmin, isLoading: roleLoading } = useQuery({
    queryKey: ["is-app-admin", user?.id],
    queryFn: async () => {
      if (!user?.id) return false;
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "app_admin")
        .maybeSingle();
      return !!data;
    },
    enabled: !!user?.id,
  });

  const { data: dauData = [], isLoading: dauLoading } = useQuery({
    queryKey: ["engagement-dau", days],
    queryFn: async (): Promise<DauRow[]> => {
      const { data, error } = await supabase.rpc("engagement_dau_trend", { _days: days });
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        day: r.day,
        dau: Number(r.dau),
        wau: Number(r.wau),
        mau: Number(r.mau),
      }));
    },
    enabled: !!isAppAdmin,
  });

  const { data: activityData = [], isLoading: actLoading } = useQuery({
    queryKey: ["engagement-activity", days],
    queryFn: async (): Promise<ActivityRow[]> => {
      const { data, error } = await supabase.rpc("engagement_activity_trend", { _days: days });
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        day: r.day,
        messages: Number(r.messages),
        rsvps: Number(r.rsvps),
        event_views: Number(r.event_views),
        new_users: Number(r.new_users),
      }));
    },
    enabled: !!isAppAdmin,
  });

  if (roleLoading) return <PageLoading />;

  if (!isAppAdmin) {
    return (
      <div className="py-6 space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">Engagement</h1>
        </div>
        <p className="text-muted-foreground text-center py-12">
          Access denied. App admin role required.
        </p>
      </div>
    );
  }

  const today = dauData[dauData.length - 1];
  const yesterday = dauData[dauData.length - 2];
  const totals = activityData.reduce(
    (acc, r) => ({
      messages: acc.messages + r.messages,
      rsvps: acc.rsvps + r.rsvps,
      event_views: acc.event_views + r.event_views,
      new_users: acc.new_users + r.new_users,
    }),
    { messages: 0, rsvps: 0, event_views: 0, new_users: 0 },
  );

  const formatDay = (d: string) => {
    const date = new Date(d);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  };

  return (
    <div className="py-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Engagement</h1>
          <p className="text-sm text-muted-foreground">
            Daily active users and activity trends
          </p>
        </div>
      </div>

      <div className="flex gap-2">
        {RANGE_OPTIONS.map((opt) => (
          <Button
            key={opt.days}
            variant={days === opt.days ? "default" : "outline"}
            size="sm"
            onClick={() => setDays(opt.days)}
          >
            {opt.label}
          </Button>
        ))}
      </div>

      {/* Top metric cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          icon={Users}
          label="DAU today"
          value={today?.dau ?? 0}
          delta={today && yesterday ? today.dau - yesterday.dau : 0}
        />
        <MetricCard icon={TrendingUp} label="WAU" value={today?.wau ?? 0} />
        <MetricCard icon={TrendingUp} label="MAU" value={today?.mau ?? 0} />
        <MetricCard icon={UserPlus} label={`New users (${days}d)`} value={totals.new_users} />
      </div>

      {/* DAU/WAU/MAU chart */}
      <Card>
        <CardHeader>
          <CardTitle>Active users</CardTitle>
          <CardDescription>
            Based on app heartbeats from <code className="text-xs">user_presence</code>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {dauLoading ? (
            <div className="h-64 flex items-center justify-center text-muted-foreground">
              Loading…
            </div>
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dauData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="day" tickFormatter={formatDay} fontSize={11} />
                  <YAxis fontSize={11} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="dau" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} name="DAU" />
                  <Line type="monotone" dataKey="wau" stroke="hsl(var(--chart-2, 142 70% 45%))" strokeWidth={2} dot={false} name="WAU" />
                  <Line type="monotone" dataKey="mau" stroke="hsl(var(--muted-foreground))" strokeWidth={2} dot={false} name="MAU" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Activity tabs */}
      <Card>
        <CardHeader>
          <CardTitle>Activity trends</CardTitle>
          <CardDescription>Messages, RSVPs, event views and signups per day</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="all">
            <TabsList className="mb-3">
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="messages">
                <MessageSquare className="h-3.5 w-3.5 mr-1" />
                Messages
              </TabsTrigger>
              <TabsTrigger value="rsvps">
                <CalendarCheck className="h-3.5 w-3.5 mr-1" />
                RSVPs
              </TabsTrigger>
              <TabsTrigger value="views">
                <Eye className="h-3.5 w-3.5 mr-1" />
                Views
              </TabsTrigger>
            </TabsList>

            <TabsContent value="all">
              <ActivityChart data={activityData} loading={actLoading} formatDay={formatDay} keys={["messages", "rsvps", "event_views"]} />
            </TabsContent>
            <TabsContent value="messages">
              <ActivityChart data={activityData} loading={actLoading} formatDay={formatDay} keys={["messages"]} />
              <Totals label="Messages" value={totals.messages} days={days} />
            </TabsContent>
            <TabsContent value="rsvps">
              <ActivityChart data={activityData} loading={actLoading} formatDay={formatDay} keys={["rsvps"]} />
              <Totals label="RSVPs" value={totals.rsvps} days={days} />
            </TabsContent>
            <TabsContent value="views">
              <ActivityChart data={activityData} loading={actLoading} formatDay={formatDay} keys={["event_views"]} />
              <Totals label="Event views" value={totals.event_views} days={days} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  delta,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  delta?: number;
}) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center gap-2 text-muted-foreground text-xs">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </div>
        <div className="mt-1 text-2xl font-bold">{value.toLocaleString()}</div>
        {typeof delta === "number" && delta !== 0 && (
          <div className={`text-xs ${delta > 0 ? "text-emerald-500" : "text-destructive"}`}>
            {delta > 0 ? "+" : ""}
            {delta} vs yesterday
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const COLORS: Record<string, string> = {
  messages: "hsl(var(--primary))",
  rsvps: "hsl(142 70% 45%)",
  event_views: "hsl(38 92% 50%)",
  new_users: "hsl(280 70% 55%)",
};

const LABELS: Record<string, string> = {
  messages: "Messages",
  rsvps: "RSVPs",
  event_views: "Event views",
  new_users: "New users",
};

function ActivityChart({
  data,
  loading,
  formatDay,
  keys,
}: {
  data: ActivityRow[];
  loading: boolean;
  formatDay: (d: string) => string;
  keys: string[];
}) {
  if (loading) {
    return <div className="h-64 flex items-center justify-center text-muted-foreground">Loading…</div>;
  }
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis dataKey="day" tickFormatter={formatDay} fontSize={11} />
          <YAxis fontSize={11} allowDecimals={false} />
          <Tooltip
            contentStyle={{
              background: "hsl(var(--popover))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {keys.map((k) => (
            <Bar key={k} dataKey={k} fill={COLORS[k]} name={LABELS[k]} radius={[2, 2, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function Totals({ label, value, days }: { label: string; value: number; days: number }) {
  return (
    <div className="mt-2 text-sm text-muted-foreground">
      Total {label.toLowerCase()} in last {days} days:{" "}
      <span className="font-semibold text-foreground">{value.toLocaleString()}</span>
    </div>
  );
}
