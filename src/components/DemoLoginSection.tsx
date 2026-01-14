import { useState, useEffect, useMemo } from "react";
import { Loader2, LogIn, Users, ChevronDown, ChevronUp, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface DemoUser {
  id: string;
  name: string;
  email: string;
  password: string;
  roles?: string[];
  clubs?: string[];
  teams?: string[];
  ignite_points?: number;
}

export function DemoLoginSection() {
  const [isOpen, setIsOpen] = useState(false);
  const [demoUsers, setDemoUsers] = useState<DemoUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loggingInAs, setLoggingInAs] = useState<string | null>(null);
  const [selectedClub, setSelectedClub] = useState<string>("all");

  const fetchDemoUsers = async () => {
    setLoadingUsers(true);
    try {
      const response = await fetch(
        `https://yabcfiuntwqjwvschnji.supabase.co/functions/v1/generate-demo-data`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhYmNmaXVudHdxand2c2NobmppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3MzI0MjcsImV4cCI6MjA4MzMwODQyN30.ew6qjjYM3BR3S1rYupohNEQmQ_3MeHFFn8zDXhLM4as",
          },
          body: JSON.stringify({ action: "list-public" }),
        }
      );

      const data = await response.json();
      if (response.ok && data.users) {
        setDemoUsers(data.users);
      }
    } catch (error) {
      console.error("Error fetching demo users:", error);
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    if (isOpen && demoUsers.length === 0) {
      fetchDemoUsers();
    }
  }, [isOpen]);

  // Extract unique clubs from demo users (filter out empty strings)
  const uniqueClubs = useMemo(() => {
    const clubs = new Set<string>();
    demoUsers.forEach(user => {
      user.clubs?.forEach(club => {
        if (club && club.trim()) {
          clubs.add(club);
        }
      });
    });
    return Array.from(clubs).sort();
  }, [demoUsers]);

  // Filter users by selected club (check if any of user's clubs matches)
  const filteredUsers = useMemo(() => {
    if (selectedClub === "all") return demoUsers;
    if (selectedClub === "unassociated") {
      return demoUsers.filter(user => !user.roles || user.roles.length === 0);
    }
    return demoUsers.filter(user => 
      user.clubs?.some(club => club === selectedClub)
    );
  }, [demoUsers, selectedClub]);

  // Check if there are unassociated users
  const hasUnassociatedUsers = useMemo(() => {
    return demoUsers.some(user => !user.roles || user.roles.length === 0);
  }, [demoUsers]);

  const handleLoginAs = async (user: DemoUser) => {
    setLoggingInAs(user.id);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: user.password,
      });

      if (error) {
        throw error;
      }

      toast.success(`Logged in as ${user.name}`);
    } catch (error) {
      console.error("Error logging in as demo user:", error);
      toast.error(error instanceof Error ? error.message : "Failed to login as demo user");
    } finally {
      setLoggingInAs(null);
    }
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="w-full gap-2 text-muted-foreground hover:text-foreground">
          <Users className="h-4 w-4" />
          Demo Accounts
          {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">
        <div className="border rounded-lg p-3 bg-muted/30">
          {loadingUsers ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : demoUsers.length === 0 ? (
            <div className="text-center py-4 text-muted-foreground">
              <p className="text-xs">No demo accounts available.</p>
            </div>
          ) : (
            <>
              {uniqueClubs.length > 0 && (
                <div className="mb-3">
                  <Select value={selectedClub} onValueChange={setSelectedClub}>
                    <SelectTrigger className="w-full h-8 text-xs">
                      <Filter className="h-3 w-3 mr-1.5" />
                      <SelectValue placeholder="Filter by club" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Accounts</SelectItem>
                      {uniqueClubs.map(club => (
                        <SelectItem key={club} value={club}>{club}</SelectItem>
                      ))}
                      {hasUnassociatedUsers && (
                        <SelectItem value="unassociated">No Club (Unassociated)</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="max-h-[350px] overflow-y-auto space-y-2 pr-1">
                {filteredUsers.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-2">No users in this club</p>
                ) : (
                  filteredUsers.map((user) => (
                    <div
                      key={user.id}
                      className="flex items-center justify-between p-2 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">
                          {user.name}
                          <span className="ml-2 text-xs text-primary font-normal">
                            🔥 {user.ignite_points ?? 0}
                          </span>
                        </p>
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {user.roles && user.roles.length > 0 ? (
                            <>
                              {user.roles.slice(0, 2).map((role, i) => {
                                const clubName = user.clubs?.[i];
                                const teamName = user.teams?.[i];
                                let context = '';
                                if (clubName && !teamName) {
                                  context = ` (${clubName})`;
                                } else if (teamName) {
                                  context = ` (${teamName})`;
                                }
                                return (
                                  <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary font-medium">
                                    {role}{context}
                                  </span>
                                );
                              })}
                              {user.roles.length > 2 && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                                  +{user.roles.length - 2} more
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">No roles</span>
                          )}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="ml-2 shrink-0"
                        onClick={() => handleLoginAs(user)}
                        disabled={loggingInAs === user.id}
                      >
                        {loggingInAs === user.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <LogIn className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
