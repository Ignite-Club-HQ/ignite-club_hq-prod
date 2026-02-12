// Sport emoji mapping for consistent display across the app
export const SPORT_EMOJIS: Record<string, string> = {
  "AFL": "🏈",
  "Basketball": "🏀",
  "Cricket": "🏏",
  "Football (Soccer)": "⚽",
  "Hockey": "🏑",
  "Netball": "🏐",
  "Rugby League": "🏉",
  "Rugby Union": "🏉",
  "Swimming": "🏊",
  "Tennis": "🎾",
  "Volleyball": "🏐",
  "Other": "🎯",
};

// Sports/activities that default to class mode instead of team mode
export const CLASS_MODE_SPORTS: Set<string> = new Set([
  "Swimming",
  "Tennis",
]);

export function isClassModeSport(sport: string | null | undefined): boolean {
  if (!sport) return false;
  if (CLASS_MODE_SPORTS.has(sport)) return true;
  const lower = sport.toLowerCase();
  return lower.includes("swim") || lower.includes("tennis") || lower.includes("dance") || lower.includes("martial") || lower.includes("gymnast") || lower.includes("yoga") || lower.includes("pilates");
}

export function getSportEmoji(sport: string | null | undefined): string {
  if (!sport) return "🏆";
  
  // Direct match
  if (SPORT_EMOJIS[sport]) {
    return SPORT_EMOJIS[sport];
  }
  
  // Case-insensitive partial match
  const lowerSport = sport.toLowerCase();
  
  if (lowerSport.includes("afl") || lowerSport.includes("aussie rules")) return "🏈";
  if (lowerSport.includes("basketball")) return "🏀";
  if (lowerSport.includes("cricket")) return "🏏";
  if (lowerSport.includes("soccer") || lowerSport.includes("football") || lowerSport.includes("futsal")) return "⚽";
  if (lowerSport.includes("hockey")) return "🏑";
  if (lowerSport.includes("netball")) return "🏐";
  if (lowerSport.includes("rugby")) return "🏉";
  if (lowerSport.includes("swim")) return "🏊";
  if (lowerSport.includes("tennis")) return "🎾";
  if (lowerSport.includes("volleyball")) return "🏐";
  
  return "🎯"; // Default for unknown sports
}
