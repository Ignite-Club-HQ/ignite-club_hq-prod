import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Award,
  Bell,
  Briefcase,
  Bus,
  Cake,
  Calendar,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Coffee,
  Coins,
  Drum,
  Dumbbell,
  Flag,
  Gift,
  HandHeart,
  HelpCircle,
  Megaphone,
  Music,
  PartyPopper,
  PiggyBank,
  Pizza,
  Search,
  Shield,
  Shirt,
  ShoppingBag,
  Sparkles,
  Stethoscope,
  Trophy,
  Users,
  Utensils,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

interface OpenGroup {
  id: string;
  name: string;
  category: string | null;
  club_id: string;
  member_count: number;
  joined: boolean;
  last_text: string | null;
  last_at: string | null;
}

interface DiscoverGroupsListProps {
  activeClubFilter?: string | null;
}

type CategoryKey =
  | "operations"
  | "volunteers"
  | "events"
  | "match day"
  | "admin"
  | "finance"
  | "other";

const CATEGORY_META: Record<
  CategoryKey,
  { label: string; icon: typeof Briefcase; tone: string }
> = {
  operations: { label: "Operations", icon: Briefcase, tone: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  volunteers: { label: "Volunteers", icon: HandHeart, tone: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  events: { label: "Events", icon: Calendar, tone: "bg-purple-500/10 text-purple-600 dark:text-purple-400" },
  "match day": { label: "Match Day", icon: Trophy, tone: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  admin: { label: "Admin", icon: Shield, tone: "bg-rose-500/10 text-rose-600 dark:text-rose-400" },
  finance: { label: "Finance", icon: Coins, tone: "bg-teal-500/10 text-teal-600 dark:text-teal-400" },
  other: { label: "Other", icon: Sparkles, tone: "bg-muted text-muted-foreground" },
};

function categoryKey(raw: string | null | undefined): CategoryKey {
  const k = (raw ?? "").trim().toLowerCase();
  if (k in CATEGORY_META) return k as CategoryKey;
  return "other";
}

// Keyword → icon map. Lets each group get a visually distinct icon based on
// what the group is actually about, instead of every Operations group looking
// the same.
const KEYWORD_ICONS: { match: RegExp; icon: LucideIcon }[] = [
  { match: /canteen|kitchen|bbq|barbecue|food|catering|lunch|breakfast/i, icon: Utensils },
  { match: /pizza|dinner/i, icon: Pizza },
  { match: /coffee|cafe|tea/i, icon: Coffee },
  { match: /cake|bake/i, icon: Cake },
  { match: /uniform|kit|merch|apparel|shop/i, icon: Shirt },
  { match: /shop|store|gear/i, icon: ShoppingBag },
  { match: /fundrais|sponsor|donat|raffle/i, icon: PiggyBank },
  { match: /finance|treasur|payment|fees|invoice|budget/i, icon: Coins },
  { match: /gift|prize|award|present/i, icon: Gift },
  { match: /presentation|trophy|awards night|gala/i, icon: Award },
  { match: /committee|board|admin|exec/i, icon: Shield },
  { match: /coach|coaches/i, icon: Megaphone },
  { match: /referee|umpire|official/i, icon: Flag },
  { match: /training|practice|gym|fitness|strength/i, icon: Dumbbell },
  { match: /first ?aid|medic|physio|injury|health/i, icon: Stethoscope },
  { match: /transport|bus|carpool|travel|driver/i, icon: Bus },
  { match: /photo|media|video|gallery/i, icon: Camera },
  { match: /music|band|song|dj/i, icon: Music },
  { match: /announce|news|notice|broadcast/i, icon: Megaphone },
  { match: /alert|reminder|notif/i, icon: Bell },
  { match: /roster|signup|sign-?up|sheet|list/i, icon: ClipboardList },
  { match: /social|party|celebrat|function/i, icon: PartyPopper },
  { match: /parade|march/i, icon: Drum },
  { match: /maintenance|ground|repair|setup|pack ?down|equipment/i, icon: Wrench },
  { match: /parent|family|member|community|crew|team/i, icon: Users },
  { match: /event|day|night|fixture/i, icon: Calendar },
  { match: /match|game|comp/i, icon: Trophy },
  { match: /volunteer|help/i, icon: HandHeart },
];

// Tone palette indexed by a stable hash of the group name so two groups in the
// same category still look visually distinct.
const TONE_PALETTE = [
  "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  "bg-teal-500/10 text-teal-600 dark:text-teal-400",
  "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  "bg-pink-500/10 text-pink-600 dark:text-pink-400",
  "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
  "bg-lime-500/10 text-lime-600 dark:text-lime-400",
  "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400",
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function resolveGroupVisual(name: string, category: string | null): {
  Icon: LucideIcon;
  tone: string;
} {
  const matched = KEYWORD_ICONS.find((k) => k.match.test(name));
  const Icon = matched?.icon ?? CATEGORY_META[categoryKey(category)].icon;
  const tone = TONE_PALETTE[hashString(name) % TONE_PALETTE.length];
  return { Icon, tone };
}

const FILTER_CHIPS: { key: "all" | CategoryKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "operations", label: "Operations" },
  { key: "volunteers", label: "Volunteers" },
  { key: "events", label: "Events" },
  { key: "match day", label: "Match Day" },
  { key: "admin", label: "Admin" },
];

/**
 * WhatsApp/Slack-style channel discovery for Operations & Volunteers chat
 * groups in the user's active club. Server-side RLS on `chat_groups` gates
 * which groups are surfaced; `join_open_chat_group` RPC handles the join.
 */
export default function DiscoverGroupsList({ activeClubFilter }: DiscoverGroupsListProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(true);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [chip, setChip] = useState<(typeof FILTER_CHIPS)[number]["key"]>("all");
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());

  const { data: groups = [] } = useQuery({
    queryKey: ["discover-open-groups", user?.id, activeClubFilter ?? null],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<OpenGroup[]> => {
      let q = supabase
        .from("chat_groups")
        .select("id, name, category, club_id")
        .eq("join_policy", "open_to_club")
        .is("deleted_at", null)
        .not("club_id", "is", null)
        .is("team_id", null)
        .is("mini_league_id", null);
      if (activeClubFilter) q = q.eq("club_id", activeClubFilter);
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data ?? []) as any[];
      if (rows.length === 0) return [];

      const ids = rows.map((r) => r.id);
      const [{ data: mine }, { data: members }, { data: msgs }] = await Promise.all([
        supabase
          .from("group_members")
          .select("group_id")
          .eq("user_id", user!.id)
          .in("group_id", ids),
        supabase
          .from("group_members")
          .select("group_id")
          .in("group_id", ids),
        supabase
          .from("group_messages")
          .select("group_id, text, image_url, created_at, is_system_message")
          .in("group_id", ids)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(200),
      ]);
      const joined = new Set((mine ?? []).map((m: any) => m.group_id));
      const counts = new Map<string, number>();
      (members ?? []).forEach((m: any) => {
        counts.set(m.group_id, (counts.get(m.group_id) ?? 0) + 1);
      });
      const lastByGroup = new Map<string, { text: string | null; at: string }>();
      (msgs ?? []).forEach((m: any) => {
        if (m.is_system_message) return;
        if (lastByGroup.has(m.group_id)) return;
        const text = m.text?.trim() || (m.image_url ? "📷 Photo" : null);
        lastByGroup.set(m.group_id, { text, at: m.created_at });
      });
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        category: r.category ?? null,
        club_id: r.club_id,
        member_count: counts.get(r.id) ?? 0,
        joined: joined.has(r.id),
        last_text: lastByGroup.get(r.id)?.text ?? null,
        last_at: lastByGroup.get(r.id)?.at ?? null,
      }));
    },
  });

  const joinMutation = useMutation({
    mutationFn: async (groupId: string) => {
      const { data, error } = await (supabase as any).rpc("join_open_chat_group", {
        _group_id: groupId,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (_id, groupId) => {
      toast.success("You joined the group");
      queryClient.invalidateQueries({ queryKey: ["discover-open-groups"] });
      queryClient.invalidateQueries({ queryKey: ["my-chat-groups"] });
      queryClient.invalidateQueries({ queryKey: ["my-chat-groups-with-messages"] });
      navigate(`/groups/${groupId}`);
    },
    onError: (err: any) => {
      toast.error(err?.message ?? "Could not join group");
    },
    onSettled: () => setJoiningId(null),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups.filter((g) => {
      if (chip !== "all" && categoryKey(g.category) !== chip) return false;
      if (!q) return true;
      return (
        g.name.toLowerCase().includes(q) ||
        (g.category ?? "").toLowerCase().includes(q)
      );
    });
  }, [groups, search, chip]);

  // Group filtered list by category for scalability
  const grouped = useMemo(() => {
    const map = new Map<CategoryKey, OpenGroup[]>();
    for (const g of filtered) {
      const k = categoryKey(g.category);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(g);
    }
    // Stable order
    const order: CategoryKey[] = ["operations", "volunteers", "events", "match day", "admin", "finance", "other"];
    return order
      .filter((k) => map.has(k))
      .map((k) => ({ key: k, meta: CATEGORY_META[k], items: map.get(k)! }));
  }, [filtered]);

  const joinableCount = groups.filter((g) => !g.joined).length;
  const showCategories = groups.length >= 6;

  const toggleCat = (k: string) => {
    setCollapsedCats((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const renderRow = (g: OpenGroup) => {
    const { Icon, tone } = resolveGroupVisual(g.name, g.category);
    const active = g.last_at
      ? Date.now() - new Date(g.last_at).getTime() < 1000 * 60 * 60 * 24
      : false;
    const subtitle =
      g.last_text ||
      (g.member_count === 0
        ? "Needs volunteers — be the first to join"
        : `${g.member_count} ${g.member_count === 1 ? "member" : "members"}`);

    return (
      <button
        key={g.id}
        type="button"
        onClick={() => g.joined && navigate(`/groups/${g.id}`)}
        className={cn(
          "group w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-left transition-all",
          "active:scale-[0.99]",
          g.joined
            ? "opacity-70 hover:opacity-100 hover:bg-muted/50"
            : "hover:bg-muted/60",
        )}
      >
        <div
          className={cn(
            "relative h-8 w-8 rounded-md flex items-center justify-center shrink-0",
            tone,
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          {g.joined && (
            <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-500 border-2 border-background flex items-center justify-center">
              <Check className="h-1.5 w-1.5 text-white" strokeWidth={4} />
            </span>
          )}
          {!g.joined && active && (
            <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 border-2 border-background" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p
              className={cn(
                "text-[13px] font-semibold truncate text-foreground",
                g.joined && "font-medium",
              )}
            >
              {g.name}
            </p>
            {active && !g.joined && (
              <span className="text-[9px] font-medium text-emerald-600 dark:text-emerald-400 shrink-0">
                Active today
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground/80 truncate leading-tight">
            {subtitle}
          </p>
        </div>

        {g.joined ? (
          <span className="text-[11px] text-muted-foreground shrink-0 pr-1 opacity-0 group-hover:opacity-100 transition-opacity">
            Open
          </span>
        ) : (
          <Button
            size="sm"
            variant="default"
            className="h-7 px-3 text-xs font-semibold shrink-0 rounded-full"
            disabled={joiningId === g.id}
            onClick={(e) => {
              e.stopPropagation();
              setJoiningId(g.id);
              joinMutation.mutate(g.id);
            }}
          >
            {joiningId === g.id ? "…" : "+ Join"}
          </Button>
        )}
      </button>
    );
  };


  return (
    <Card className="border-dashed shadow-none">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm font-medium truncate">Discover groups</span>
          {joinableCount > 0 && (
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px] shrink-0">
              {joinableCount} new
            </Badge>
          )}
          <Popover>
            <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                aria-label="How discover works"
                className="text-muted-foreground hover:text-foreground shrink-0"
              >
                <HelpCircle className="h-3.5 w-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-72 text-xs leading-relaxed"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="font-medium text-sm mb-1">How this works</p>
              <p className="text-muted-foreground">
                Admins can mark <strong>Operations</strong> or <strong>Volunteers</strong> groups
                as open. Any club member can tap <strong>Join</strong> — no approval needed.
              </p>
            </PopoverContent>
          </Popover>
        </div>
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="px-2 pb-2 space-y-2">
          {groups.length === 0 ? (
            <p className="text-xs text-muted-foreground italic px-2 py-3">
              No open groups yet. Ask a club admin to open an Operations or Volunteers group to the club.
            </p>
          ) : (
            <>
              {groups.length > 4 && (
                <div className="space-y-2 px-1">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search groups…"
                      className="h-8 pl-8 text-xs"
                    />
                  </div>
                  <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-1 scrollbar-none">
                    {FILTER_CHIPS.map((c) => {
                      const has = c.key === "all" || groups.some((g) => categoryKey(g.category) === c.key);
                      if (!has) return null;
                      const active = chip === c.key;
                      return (
                        <button
                          key={c.key}
                          type="button"
                          onClick={() => setChip(c.key)}
                          className={cn(
                            "shrink-0 h-6 px-2.5 rounded-full text-[11px] font-medium border transition-colors",
                            active
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-background text-muted-foreground border-border hover:text-foreground",
                          )}
                        >
                          {c.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {filtered.length === 0 ? (
                <p className="text-xs text-muted-foreground italic px-2 py-3">
                  No groups match your filters.
                </p>
              ) : showCategories ? (
                <div className="space-y-3 pt-1">
                  {grouped.map(({ key, meta, items }) => {
                    const collapsed = collapsedCats.has(key);
                    const joinable = items.filter((i) => !i.joined).length;
                    return (
                      <div key={key}>
                        <button
                          type="button"
                          onClick={() => toggleCat(key)}
                          className="w-full flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/90 hover:text-foreground transition-colors"
                        >
                          {collapsed ? (
                            <ChevronRight className="h-3 w-3" />
                          ) : (
                            <ChevronDown className="h-3 w-3" />
                          )}
                          <span>{meta.label}</span>
                          <span className="text-muted-foreground/50 font-normal normal-case tracking-normal">
                            · {items.length}
                          </span>
                          {joinable > 0 && (
                            <span className="ml-auto normal-case tracking-normal text-[10px] font-medium text-primary">
                              {joinable} to join
                            </span>
                          )}
                        </button>
                        {!collapsed && (
                          <div className="space-y-0.5 mt-0.5 animate-in fade-in-0 slide-in-from-top-1 duration-150">
                            {items.map(renderRow)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-0.5">{filtered.map(renderRow)}</div>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  );
}
