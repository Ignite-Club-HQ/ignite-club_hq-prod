import {
  Award,
  Bell,
  Briefcase,
  Bus,
  Cake,
  Calendar,
  Camera,
  ClipboardList,
  Coffee,
  Coins,
  Drum,
  Dumbbell,
  Flag,
  Gift,
  HandHeart,
  Megaphone,
  Music,
  PartyPopper,
  PiggyBank,
  Pizza,
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

const CATEGORY_ICON: Record<string, LucideIcon> = {
  operations: Briefcase,
  volunteers: HandHeart,
  events: Calendar,
  "match day": Trophy,
  admin: Shield,
  finance: Coins,
  other: Sparkles,
};

// Keyword → icon. Matched against the group name (case-insensitive).
const KEYWORD_ICONS: { match: RegExp; icon: LucideIcon }[] = [
  { match: /canteen|kitchen|bbq|barbecue|catering|lunch|breakfast/i, icon: Utensils },
  { match: /pizza|dinner|food/i, icon: Pizza },
  { match: /coffee|cafe|tea/i, icon: Coffee },
  { match: /cake|bake/i, icon: Cake },
  { match: /uniform|kit|merch|apparel/i, icon: Shirt },
  { match: /shop|store|gear/i, icon: ShoppingBag },
  { match: /fundrais|sponsor|donat|raffle/i, icon: PiggyBank },
  { match: /finance|treasur|payment|fees|invoice|budget|registr/i, icon: Coins },
  { match: /gift|prize|present/i, icon: Gift },
  { match: /presentation|awards? night|gala|trophy/i, icon: Award },
  { match: /committee|board|admin|exec|leadership|management/i, icon: Shield },
  { match: /coach|coaches|coordinator/i, icon: Megaphone },
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
  { match: /ground|maintenance|repair|setup|pack ?down|equipment/i, icon: Wrench },
  { match: /parent|family|member|community|crew|squad/i, icon: Users },
  { match: /event|fixture/i, icon: Calendar },
  { match: /match|game|comp/i, icon: Trophy },
  { match: /volunteer|help/i, icon: HandHeart },
];

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

// Solid color palette for filled circular avatars (good white-text contrast).
const SOLID_PALETTE = [
  "hsl(210, 60%, 42%)",
  "hsl(340, 55%, 48%)",
  "hsl(160, 50%, 38%)",
  "hsl(270, 45%, 50%)",
  "hsl(30, 65%, 45%)",
  "hsl(190, 55%, 40%)",
  "hsl(0, 55%, 48%)",
  "hsl(120, 40%, 38%)",
  "hsl(250, 50%, 52%)",
  "hsl(15, 60%, 45%)",
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function getGroupIcon(name: string, category?: string | null): LucideIcon {
  const matched = KEYWORD_ICONS.find((k) => k.match.test(name));
  if (matched) return matched.icon;
  const key = (category ?? "").trim().toLowerCase();
  return CATEGORY_ICON[key] ?? Sparkles;
}

export function getGroupTone(name: string): string {
  return TONE_PALETTE[hashString(name) % TONE_PALETTE.length];
}

export function getGroupSolidColor(name: string): string {
  return SOLID_PALETTE[hashString(name) % SOLID_PALETTE.length];
}
