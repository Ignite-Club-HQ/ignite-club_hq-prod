import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Shield, Building2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

const roleLabels: Record<string, string> = {
  app_admin: "App Admin",
  club_admin: "Club Admin",
  team_admin: "Team Admin",
  coach: "Coach",
  player: "Player",
  parent: "Parent",
  basic_user: "Member",
};

const roleColors: Record<string, string> = {
  app_admin: "bg-destructive/20 text-destructive",
  club_admin: "bg-primary/20 text-primary",
  team_admin: "bg-secondary text-secondary-foreground",
  coach: "bg-warning/20 text-warning",
  player: "bg-accent/20 text-accent-foreground",
  parent: "bg-muted text-muted-foreground",
  basic_user: "bg-muted text-muted-foreground",
};

export default function MyRolesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data: roles, isLoading } = useQuery({
    queryKey: ["my-roles", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select(`
          id,
          role,
          club_id,
          team_id,
          clubs (id, name, logo_url),
          teams (id, name, clubs (name))
        `)
        .eq("user_id", user!.id);

      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  // Group roles by type
  const appRoles = roles?.filter((r) => r.role === "app_admin") || [];
  const clubRoles = roles?.filter((r) => r.club_id && !r.team_id) || [];
  const teamRoles = roles?.filter((r) => r.team_id) || [];

  return (
    <div className="py-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-2xl font-bold">My Roles</h1>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : roles?.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-8 text-center">
            <Shield className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No roles assigned yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Join a club or team to get started
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* App-level roles */}
          {appRoles.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-destructive" />
                <h2 className="font-semibold">App Administration</h2>
              </div>
              {appRoles.map((role: any) => (
                <Card key={role.id}>
                  <CardContent className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-destructive/10">
                        <Shield className="h-5 w-5 text-destructive" />
                      </div>
                      <div>
                        <p className="font-medium">Ignite Platform</p>
                        <p className="text-sm text-muted-foreground">Global administration access</p>
                      </div>
                    </div>
                    <Badge className={roleColors[role.role]}>
                      {roleLabels[role.role]}
                    </Badge>
                  </CardContent>
                </Card>
              ))}
            </section>
          )}

          {/* Club roles */}
          {clubRoles.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" />
                <h2 className="font-semibold">Club Roles</h2>
              </div>
              {clubRoles.map((role: any) => (
                <Card 
                  key={role.id} 
                  className="cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => navigate(`/clubs/${role.club_id}`)}
                >
                  <CardContent className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-primary/10">
                        <Building2 className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium">{roleLabels[role.role]}</p>
                        <p className="text-sm text-muted-foreground">{role.clubs?.name}</p>
                      </div>
                    </div>
                    <Badge className={roleColors[role.role]}>
                      {roleLabels[role.role]}
                    </Badge>
                  </CardContent>
                </Card>
              ))}
            </section>
          )}

          {/* Team roles */}
          {teamRoles.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                <h2 className="font-semibold">Team Roles</h2>
              </div>
              {teamRoles.map((role: any) => (
                <Card 
                  key={role.id}
                  className="cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => navigate(`/teams/${role.team_id}`)}
                >
                  <CardContent className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-secondary">
                        <Users className="h-5 w-5 text-secondary-foreground" />
                      </div>
                      <div>
                        <p className="font-medium">{roleLabels[role.role]}</p>
                        <p className="text-sm text-muted-foreground">
                          {role.teams?.name} • {role.teams?.clubs?.name}
                        </p>
                      </div>
                    </div>
                    <Badge className={roleColors[role.role]}>
                      {roleLabels[role.role]}
                    </Badge>
                  </CardContent>
                </Card>
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
